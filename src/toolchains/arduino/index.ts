import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { ProbeHost } from '../../core/probes/host.js';
import { streamProcess, type StreamRunner } from '../process.js';
import { parseFqbn } from './fqbn.js';
import type {
  BoardOption,
  BuildResult,
  BuildTarget,
  DetectedBoard,
  FlashResult,
  Project,
  RunContext,
  SuggestedFix,
  Toolchain,
  ToolStatus,
} from '../types.js';
import {
  parseBoardList,
  parseBoardListAll,
  parseBoardDetails,
  parseCoreSearch,
  type CoreInfo,
  parseCompilerDiagnostics,
  parseMissingPlatform,
  parseVersion,
} from './parse.js';
import type { Download, ToolPackage } from '../../registry/types.js';
import { installTool, toolBinPath, toolDownload } from '../../tools.js';
import { describeTimeout, TIMEOUTS } from '../../core/timeouts.js';

export interface ArduinoOptions {
  host: ProbeHost;
  /** Folder for build output (extension global storage). One subfolder per sketch. */
  buildRoot: string;
  /** User setting `integratedWorkbench.arduinoCliPath`; empty = search. */
  cliPath?: () => string | undefined;
  stream?: StreamRunner;
  platform?: NodeJS.Platform;
  /** Where Integrated Workbench keeps downloaded tools (extension global storage). */
  toolsDir?: string;
  /** The registry's `arduino-cli` tool package, if any. */
  cliPackage?: () => ToolPackage | undefined;
  /** Extra board package index URLs from registry `arduino-core` packages. */
  boardIndexes?: () => string[];
}

const SKETCH_FILE_EXTS = new Set(['.ino', '.pde', '.cpp', '.c', '.h', '.hpp', '.hh', '.S']);

/** Places arduino-cli lives when it isn't on VS Code's PATH (a Dock-launched VS Code on macOS often lacks Homebrew's). */
export function cliCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    return [
      'arduino-cli.exe',
      join(
        home,
        'AppData',
        'Local',
        'Programs',
        'arduino-ide',
        'resources',
        'app',
        'lib',
        'backend',
        'resources',
        'arduino-cli.exe',
      ), // TODO verify
    ];
  }
  if (platform === 'darwin') {
    return [
      'arduino-cli',
      '/opt/homebrew/bin/arduino-cli',
      '/usr/local/bin/arduino-cli',
      join(home, 'bin', 'arduino-cli'),
      '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli', // TODO verify
    ];
  }
  return [
    'arduino-cli',
    join(home, 'bin', 'arduino-cli'),
    join(home, '.local', 'bin', 'arduino-cli'),
    '/usr/local/bin/arduino-cli',
  ];
}

export class ArduinoToolchain implements Toolchain {
  readonly id = 'arduino';
  readonly label = 'Arduino';

  private resolved?: { path: string; version: string };
  private readonly stream: StreamRunner;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly opts: ArduinoOptions) {
    // Every long-running command's output ends up in front of a person: no terminal color codes.
    const stream = opts.stream ?? streamProcess;
    this.stream = (file, args, o) => stream(file, [...args, '--no-color'], o);
    this.platform = opts.platform ?? process.platform;
  }

  /**
   * An Arduino sketch is a folder containing `<folder>.ino`. Files may also sit in the sketch's
   * `src/` subtree, so walk up a few levels.
   */
  async findProject(filePath: string): Promise<Project | undefined> {
    if (!SKETCH_FILE_EXTS.has(extname(filePath))) return undefined;
    let dir = dirname(filePath);
    for (let i = 0; i < 4; i++) {
      const name = basename(dir);
      const entries = await this.opts.host.readdir(dir);
      if (entries.includes(`${name}.ino`) || entries.includes(`${name}.pde`)) return { root: dir, name };
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  }

  /** Forget the cached binary (e.g. after the user changes the path setting). */
  resetCli(): void {
    this.resolved = undefined;
  }

  async checkInstalled(): Promise<ToolStatus> {
    if (this.resolved) return { installed: true, ...this.resolved };
    const configured = this.opts.cliPath?.()?.trim();
    // Order: the user's explicit setting, then Integrated Workbench's own pinned copy, then one already installed.
    const pkg = this.opts.cliPackage?.();
    const managedPath =
      this.opts.toolsDir && pkg ? toolBinPath(this.opts.toolsDir, pkg, this.platform) : undefined;
    const managed = managedPath ? [managedPath] : [];
    const candidates = configured ? [configured] : [...managed, ...cliCandidates(this.platform, homedir())];
    for (const path of candidates) {
      const res = await this.opts.host.run(path, ['version', '--format', 'json'], {
        timeoutMs: TIMEOUTS.cliVersionMs,
      });
      const version = res.code === 0 ? parseVersion(res.stdout) : undefined;
      if (version) {
        this.resolved = { path, version };
        return { installed: true, path, version };
      }
    }
    return {
      installed: false,
      reason: configured ? `arduino-cli not found at ${configured}` : 'arduino-cli not found',
    };
  }

  /** The registry download for this OS/CPU, if Integrated Workbench can install arduino-cli itself. */
  managedDownload(): { pkg: ToolPackage; download: Download } | undefined {
    const pkg = this.opts.cliPackage?.();
    const download = pkg && this.opts.toolsDir ? toolDownload(pkg, this.platform) : undefined;
    return pkg && download ? { pkg, download } : undefined;
  }

  /** Downloads Integrated Workbench's own arduino-cli. Only call after the user agreed. */
  async installManaged(onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<ToolStatus> {
    const m = this.managedDownload();
    if (!m || !this.opts.toolsDir) throw new Error('No arduino-cli download for this computer.');
    await installTool({
      storageDir: this.opts.toolsDir,
      pkg: m.pkg,
      host: this.opts.host,
      platform: this.platform,
      onProgress,
      signal,
    });
    this.resetCli();
    return this.checkInstalled();
  }

  private async cli(): Promise<string> {
    const status = await this.checkInstalled();
    if (!status.installed) throw new Error(status.reason);
    return status.path;
  }

  async listBoards(): Promise<DetectedBoard[]> {
    const res = await this.opts.host.run(await this.cli(), ['board', 'list', '--format', 'json'], {
      timeoutMs: TIMEOUTS.cliListMs,
    });
    if (res.code !== 0) throw new Error(res.stderr.trim() || `arduino-cli board list failed (${res.code})`);
    return parseBoardList(res.stdout);
  }

  async listTargets(): Promise<BuildTarget[]> {
    const res = await this.opts.host.run(await this.cli(), ['board', 'listall', '--format', 'json'], {
      timeoutMs: TIMEOUTS.cliListMs,
    });
    if (res.code !== 0)
      throw new Error(res.stderr.trim() || `arduino-cli board listall failed (${res.code})`);
    return parseBoardListAll(res.stdout);
  }

  private optionsCache = new Map<string, BoardOption[]>();

  /** Board menus (Flash Size, Processor, Upload Method, ...) with each default. */
  async boardOptions(targetId: string): Promise<BoardOption[]> {
    const base = parseFqbn(targetId).base;
    const cached = this.optionsCache.get(base);
    if (cached) return cached;
    const res = await this.opts.host.run(
      await this.cli(),
      ['board', 'details', '-b', base, '--format', 'json'],
      {
        timeoutMs: TIMEOUTS.cliListMs,
      },
    );
    if (res.code !== 0)
      throw new Error(lastLine(res.stderr) || `arduino-cli board details failed (${res.code})`);
    const options = parseBoardDetails(res.stdout);
    this.optionsCache.set(base, options);
    return options;
  }

  /** Forget cached board details (after installing or removing board packages). */
  clearCaches(): void {
    this.optionsCache.clear();
  }

  /**
   * Writes compile_commands.json for the sketch without building it (a few seconds).
   * Returns the build folder it was written to.
   */
  async compilationDatabase(project: Project, fqbn: string, signal?: AbortSignal): Promise<string> {
    const buildPath = `${this.buildPath(project)}-intellisense`;
    const res = await this.stream(
      await this.cli(),
      ['compile', '--fqbn', fqbn, '--build-path', buildPath, '--only-compilation-database', project.root],
      { signal, timeoutMs: TIMEOUTS.compileDbMs },
    );
    if (res.code !== 0)
      throw new Error(lastLine(res.stderr) || lastLine(res.stdout) || 'Could not read the build settings.');
    return buildPath;
  }

  buildPath(project: Project): string {
    const hash = createHash('sha1').update(project.root).digest('hex').slice(0, 12);
    return join(this.opts.buildRoot, `${project.name}-${hash}`);
  }

  async build(ctx: RunContext): Promise<BuildResult> {
    const cli = await this.cli();
    const buildPath = this.buildPath(ctx.project);
    const args = ['compile', '--fqbn', ctx.target.id, '--build-path', buildPath, ctx.project.root];
    ctx.onOutput(`$ arduino-cli ${args.join(' ')}\n`);
    const res = await this.stream(cli, args, {
      onStdout: ctx.onOutput,
      onStderr: ctx.onOutput,
      signal: ctx.signal,
      timeoutMs: TIMEOUTS.compileMs,
    });
    const all = `${res.stdout}\n${res.stderr}`;
    return {
      success: res.code === 0,
      diagnostics: parseCompilerDiagnostics(all, { buildPath, sketchRoot: ctx.project.root }),
      fix: res.code === 0 ? undefined : this.platformFix(all, ctx.target.id),
      error: res.timedOut ? `Stopped after ${describeTimeout(TIMEOUTS.compileMs)} (time limit).` : undefined,
    };
  }

  /** Uploads the last build. Call build() first. */
  async flash(ctx: RunContext & { port: string }): Promise<FlashResult> {
    const cli = await this.cli();
    const args = [
      'upload',
      '-p',
      ctx.port,
      '--fqbn',
      ctx.target.id,
      '--input-dir',
      this.buildPath(ctx.project),
      ctx.project.root,
    ];
    ctx.onOutput(`$ arduino-cli ${args.join(' ')}\n`);
    const res = await this.stream(cli, args, {
      onStdout: ctx.onOutput,
      onStderr: ctx.onOutput,
      signal: ctx.signal,
      timeoutMs: TIMEOUTS.uploadMs,
    });
    return {
      success: res.code === 0,
      error: res.timedOut ? `Stopped after ${describeTimeout(TIMEOUTS.uploadMs)} (time limit).` : undefined,
    };
  }

  /** Refreshes the board package index (Arduino's plus the registries' extra indexes). Small download. */
  async updateIndex(signal?: AbortSignal): Promise<void> {
    const res = await this.stream(await this.cli(), ['core', 'update-index', ...this.urlArgs()], {
      signal,
      timeoutMs: TIMEOUTS.updateIndexMs,
    });
    if (res.code !== 0) throw new Error(lastLine(res.stderr) || 'Could not update the board list.');
  }

  /** Every board package arduino-cli knows about, with installed/latest versions. */
  async searchCores(): Promise<CoreInfo[]> {
    const res = await this.opts.host.run(
      await this.cli(),
      ['core', 'search', '--format', 'json', ...this.urlArgs()],
      { timeoutMs: TIMEOUTS.cliSearchMs },
    );
    if (res.code !== 0) throw new Error(lastLine(res.stderr) || 'Could not read the board list.');
    return parseCoreSearch(res.stdout);
  }

  /** Installs (or upgrades to the latest) a board package. Only call after the user asked for it. */
  async installCore(platform: string, onOutput: (t: string) => void, signal?: AbortSignal): Promise<boolean> {
    const cli = await this.cli();
    for (const args of [
      ['core', 'update-index', ...this.urlArgs()],
      ['core', 'install', platform, ...this.urlArgs()],
    ]) {
      onOutput(`$ arduino-cli ${args.join(' ')}\n`);
      const timeoutMs = args[1] === 'install' ? TIMEOUTS.coreInstallMs : TIMEOUTS.updateIndexMs;
      const res = await this.stream(cli, args, { onStdout: onOutput, onStderr: onOutput, signal, timeoutMs });
      if (res.code !== 0) return false;
    }
    return true;
  }

  async uninstallCore(
    platform: string,
    onOutput: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const args = ['core', 'uninstall', platform];
    onOutput(`$ arduino-cli ${args.join(' ')}\n`);
    const res = await this.stream(await this.cli(), args, {
      onStdout: onOutput,
      onStderr: onOutput,
      signal,
      timeoutMs: TIMEOUTS.coreUninstallMs,
    });
    return res.code === 0;
  }

  private urlArgs(): string[] {
    const urls = this.opts.boardIndexes?.() ?? [];
    return urls.length ? ['--additional-urls', urls.join(',')] : [];
  }

  private platformFix(output: string, fqbn: string): SuggestedFix | undefined {
    const platform = parseMissingPlatform(output, fqbn);
    if (!platform) return undefined;
    return {
      message: `Support for this board (${platform}) isn't installed yet.`,
      label: `Install ${platform}`,
      apply: (onOutput, signal) => this.installCore(platform, onOutput, signal),
    };
  }
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop() ?? '';
}
