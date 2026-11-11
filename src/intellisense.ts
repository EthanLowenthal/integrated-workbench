import { existsSync, promises as fsp } from 'node:fs';
import { extname, join, relative, isAbsolute } from 'node:path';
import * as vscode from 'vscode';
import {
  getCppToolsApi,
  Version,
  type CppToolsApi,
  type CustomConfigurationProvider,
  type SourceFileConfigurationItem,
  type WorkspaceBrowseConfiguration,
} from 'vscode-cpptools';
import type { Session } from './session.js';
import {
  COMPILE_DB,
  extractPrototypes,
  prototypesHeader,
  rewriteForSketch,
  sketchIntelliSense,
  type CompileDbEntry,
  type SketchIntelliSense,
} from './toolchains/arduino/compileDb.js';
import type { ArduinoToolchain } from './toolchains/arduino/index.js';

export const CPPTOOLS_ID = 'ms-vscode.cpptools';
export const CLANGD_ID = 'llvm-vs-code-extensions.vscode-clangd';

/**
 * Microsoft's C/C++ extension is licensed for Microsoft's VS Code only; editors built on VS Code
 * (Cursor, Windsurf, VSCodium, ...) use clangd instead.
 */
export function cppToolsAvailableHere(): boolean {
  return vscode.env.appName.startsWith('Visual Studio Code');
}

export type IntelliSenseStatus = 'off' | 'needsExtension' | 'updating' | 'ready' | 'error';

const SOURCE = new Set(['.ino', '.pde', '.cpp', '.cc', '.cxx', '.c', '.h', '.hh', '.hpp', '.hxx', '.S']);

function inside(file: string, folder: string): boolean {
  const rel = relative(folder, file);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Feeds the Microsoft C/C++ extension exact per-file settings (include folders, defines, compiler,
 * target flags, forced Arduino.h for .ino) from arduino-cli's compilation database. Nothing is written
 * into the user's sketch. clangd users can opt into a compile_commands.json via a command.
 */
export class IntelliSense implements vscode.Disposable, CustomConfigurationProvider {
  readonly name = 'Integrated Workbench';
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  status: IntelliSenseStatus = 'off';
  message?: string;

  private api?: CppToolsApi;
  private readonly sketches = new Map<
    string,
    SketchIntelliSense & { raw: CompileDbEntry[]; buildPath: string }
  >();
  private lastKey = '';
  private timer?: NodeJS.Timeout;
  private abort?: AbortController;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    readonly extensionId: string,
    private readonly session: Session,
    private readonly arduino: ArduinoToolchain,
    private readonly output: vscode.OutputChannel,
  ) {
    this.subs.push(
      session.onDidChange(() => this.maybeRefresh()),
      vscode.extensions.onDidChange(() => void this.connect()),
    );
  }

  async start(): Promise<void> {
    await this.connect();
    this.maybeRefresh();
  }

  /** Registers with the C/C++ extension if it's installed (and when it gets installed later). */
  private async connect(): Promise<void> {
    if (this.api || !vscode.extensions.getExtension(CPPTOOLS_ID)) {
      this.update();
      return;
    }
    try {
      this.api = await getCppToolsApi(Version.v5);
      if (this.api) {
        this.api.registerCustomConfigurationProvider(this);
        this.api.notifyReady(this);
        this.lastKey = '';
        this.maybeRefresh();
      }
    } catch (err) {
      this.output.appendLine(`[intellisense] ${String(err)}`);
    }
    this.update();
  }

  private update(): void {
    if (!this.api && this.status !== 'updating') {
      const hasClangd = !!vscode.extensions.getExtension(CLANGD_ID);
      this.status = this.session.project && !hasClangd ? 'needsExtension' : 'off';
    }
    this.changed.fire();
  }

  /** Regenerate when the sketch, board (with options), or toolchain readiness changes. */
  private maybeRefresh(): void {
    const s = this.session;
    const key = [s.project?.root, s.fqbn, s.toolReady, s.targetInstalled].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 800);
  }

  async refresh(): Promise<void> {
    const s = this.session;
    const project = s.project;
    const target = s.target;
    if (!project || !target || !s.toolReady || !s.targetInstalled) return this.update();
    if (!this.api && !vscode.extensions.getExtension(CLANGD_ID)) return this.update();
    this.abort?.abort();
    const ac = (this.abort = new AbortController());
    this.status = 'updating';
    this.message = undefined;
    this.changed.fire();
    try {
      const buildPath = await this.arduino.compilationDatabase(project, target.id, ac.signal);
      if (ac.signal.aborted) return;
      const raw = JSON.parse(await fsp.readFile(join(buildPath, COMPILE_DB), 'utf8')) as CompileDbEntry[];
      const inoFiles = (await fsp.readdir(project.root))
        .filter((f) => /\.(ino|pde)$/i.test(f))
        .map((f) => join(project.root, f));
      const data = sketchIntelliSense(raw, buildPath, project.root, inoFiles, (paths) =>
        paths.map((p) => join(p, 'Arduino.h')).find((p) => existsSync(p)),
      );
      // Function prototypes arduino-cli generates for .ino files, so calling a function before its
      // definition isn't flagged in the editor (the compiler accepts it).
      const generated = await fsp
        .readFile(join(buildPath, 'sketch', `${project.name}.ino.cpp`), 'utf8')
        .catch(() => '');
      const prototypes = extractPrototypes(generated);
      if (prototypes.length) {
        const header = join(buildPath, 'sketch', `${project.name}.prototypes.h`);
        await fsp.writeFile(header, prototypesHeader(prototypes));
        for (const ino of inoFiles) {
          const cfg = data.files.get(ino);
          if (cfg) data.files.set(ino, { ...cfg, forcedInclude: [...cfg.forcedInclude, header] });
        }
      }
      this.sketches.set(project.root, { ...data, raw, buildPath });
      this.status = 'ready';
      // clangd: keep a compile_commands.json the user asked for in step with the board.
      if (!this.api && existsSync(join(project.root, COMPILE_DB))) await this.writeCompileCommands();
      this.api?.didChangeCustomConfiguration(this);
      this.api?.didChangeCustomBrowseConfiguration(this);
    } catch (err) {
      if (ac.signal.aborted) return;
      this.status = 'error';
      this.message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[intellisense] ${this.message}`);
    }
    this.changed.fire();
  }

  /** Installs clangd (from this editor's extension store) and writes the sketch's compile_commands.json. */
  async setUpClangd(): Promise<vscode.Uri | undefined> {
    if (!vscode.extensions.getExtension(CLANGD_ID))
      await vscode.commands.executeCommand('workbench.extensions.installExtension', CLANGD_ID);
    this.lastKey = '';
    await this.refresh();
    return this.writeCompileCommands();
  }

  /** clangd: write a compile_commands.json pointing at the real sketch files into the sketch folder. */
  async writeCompileCommands(): Promise<vscode.Uri | undefined> {
    const root = this.session.project?.root;
    if (!root) return undefined;
    if (!this.sketches.has(root)) await this.refresh();
    const data = this.sketches.get(root);
    if (!data) return undefined;
    const inoFiles = [...data.files.keys()].filter((f) => /\.(ino|pde)$/i.test(f));
    const uri = vscode.Uri.file(join(root, COMPILE_DB));
    const entries = rewriteForSketch(data.raw, data.buildPath, root, inoFiles);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(entries, null, 2)));
    return uri;
  }

  // ---- CustomConfigurationProvider (called by the C/C++ extension) ----

  private sketchFor(file: string) {
    for (const [root, data] of this.sketches) if (inside(file, root)) return data;
    return undefined;
  }

  async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    const data = this.sketchFor(uri.fsPath);
    return !!data && (data.files.has(uri.fsPath) || (!!data.fallback && SOURCE.has(extname(uri.fsPath))));
  }

  async provideConfigurations(uris: vscode.Uri[]): Promise<SourceFileConfigurationItem[]> {
    const items: SourceFileConfigurationItem[] = [];
    for (const uri of uris) {
      const data = this.sketchFor(uri.fsPath);
      const cfg = data?.files.get(uri.fsPath) ?? data?.fallback;
      if (!cfg) continue;
      items.push({
        uri,
        configuration: {
          includePath: cfg.includePath,
          defines: cfg.defines,
          standard: cfg.standard as never,
          compilerPath: cfg.compilerPath,
          compilerArgs: cfg.compilerArgs,
          forcedInclude: cfg.forcedInclude,
        },
      });
    }
    return items;
  }

  async canProvideBrowseConfiguration(): Promise<boolean> {
    return this.sketches.size > 0;
  }

  async provideBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration | null> {
    const data = this.session.project
      ? this.sketches.get(this.session.project.root)
      : [...this.sketches.values()][0];
    if (!data) return null;
    return { browsePath: data.browsePath, compilerPath: data.compilerPath, standard: data.standard as never };
  }

  async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> {
    return false;
  }

  async provideFolderBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration | null> {
    return null;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.abort?.abort();
    this.api?.dispose();
    this.changed.dispose();
    for (const s of this.subs) s.dispose();
  }
}
