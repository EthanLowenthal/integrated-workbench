import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { basename, extname, sep } from 'node:path';
import type { BuildLog } from './buildLog.js';
import { MicroPythonBoard } from './toolchains/micropython/board.js';
import { projectFiles, tracebackLocation } from './toolchains/micropython/index.js';
import { adviseUploadFailure } from './toolchains/arduino/uploadAdvice.js';
import { ProgramError, ReplError, type ByteLink } from './toolchains/micropython/rawRepl.js';
import type { BoardDoctor } from './doctor.js';
import type { Session } from './session.js';
import { text } from './text.js';
import type { BuildDiagnostic, MemoryUsage, SuggestedFix } from './toolchains/types.js';

export type RunKind = 'build' | 'upload' | 'fix' | 'run';

export interface LastRun {
  kind: 'build' | 'upload' | 'run';
  ok: boolean;
  durationMs: number;
  sketch: string;
  /** One-line summary, e.g. "Compile failed with 2 errors". */
  summary: string;
  diagnostics: BuildDiagnostic[];
  /** A fix the user can apply from the sidebar (e.g. install the board package). */
  fix?: SuggestedFix;
  /** What Board Doctor found about the port after a failed upload. */
  hint?: string;
  /** Flash and RAM use from the compile. */
  memory?: MemoryUsage;
  /** MicroPython: the board didn't answer as MicroPython (offer to install it). */
  notMicroPython?: boolean;
}

export interface RunState {
  running?: { kind: RunKind; title: string };
  last?: LastRun;
  /** Why Verify/Upload can't run yet (shown in the sidebar). */
  blocked?: string;
}

const severityMap = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

/** Verify / Upload. Progress and results go to the sidebar and status bar, not notifications. */
export class Runs implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<RunState>();
  readonly onDidChange = this.changed.event;
  state: RunState = {};
  private abort?: AbortController;
  private lastMemory?: MemoryUsage;
  /** Port access for MicroPython projects (provided by the Serial Monitor). */
  micropython?: {
    exclusive<T>(port: string, work: (link: ByteLink) => Promise<T>): Promise<T>;
    /** Opens the Serial Monitor and connects it to the project's port. */
    showMonitor(): Promise<void>;
    /** Shows text in the Serial Monitor. */
    print(text: string): void;
  };
  /** Called around the flash step so the Serial Monitor can release and re-take the port. */
  uploadHooks: { before?: (port: string) => Promise<void>; after?: (port: string) => Promise<void> } = {};

  constructor(
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
    private readonly log: BuildLog,
    private readonly problems: vscode.DiagnosticCollection,
    /** Opens the sidebar on the thing that's missing. */
    private readonly needsSetup: (what: 'engine' | 'board' | 'boardPackage' | 'port') => Promise<void>,
  ) {}

  private set(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    this.changed.fire(this.state);
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Runs `work` with status bar progress and the sidebar's running state. */
  private async track<T>(
    kind: RunKind,
    title: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.set({ running: { kind, title }, blocked: undefined });
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, () =>
        work(signal),
      );
    } finally {
      this.abort = undefined;
      this.set({ running: undefined });
    }
  }

  /** Checks everything Verify needs. Opens the sidebar on what's missing and returns false. */
  private async ready(): Promise<boolean> {
    const s = this.session;
    if (this.state.running) return false;
    if (!s.project) {
      this.set({ blocked: text.notInSketch });
      await this.needsSetup('board');
      return false;
    }
    if (!s.toolReady) {
      this.set({ blocked: text.needEngine });
      await this.needsSetup('engine');
      return false;
    }
    if (!s.target) {
      this.set({ blocked: text.needBoard });
      await this.needsSetup('board');
      return false;
    }
    if (!s.targetInstalled) {
      this.set({ blocked: text.needBoardPackage(s.target.name) });
      await this.needsSetup('boardPackage');
      return false;
    }
    return true;
  }

  private publish(diags: BuildDiagnostic[]): void {
    this.problems.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of diags) {
      const line = Math.max(0, d.line - 1);
      const col = Math.max(0, (d.column ?? 1) - 1);
      const range = new vscode.Range(line, col, line, d.column ? col + 1 : Number.MAX_SAFE_INTEGER);
      const diag = new vscode.Diagnostic(range, d.message, severityMap[d.severity]);
      diag.source = 'arduino-cli';
      byFile.set(d.file, [...(byFile.get(d.file) ?? []), diag]);
    }
    for (const [file, list] of byFile) this.problems.set(vscode.Uri.file(file), list);
  }

  /**
   * Runs a long task (e.g. installing firmware) with the sidebar's progress, Cancel, Build tab output
   * and result line. `work` returns the success summary; a thrown error becomes the failure hint.
   */
  async task(
    title: string,
    work: (
      signal: AbortSignal,
      log: (text: string) => void,
      setTitle: (t: string) => void,
    ) => Promise<string>,
    failSummary: string,
  ): Promise<boolean> {
    if (this.state.running) return false;
    this.log.start('upload', title);
    const started = Date.now();
    let ok = true;
    let summary = failSummary;
    let hint: string | undefined;
    await this.track('upload', title, async (signal) => {
      try {
        summary = await work(
          signal,
          (t) => this.log.append(t),
          (t) => this.set({ running: { kind: 'upload', title: t } }),
        );
      } catch (err) {
        ok = false;
        hint = signal.aborted ? text.cancelled : err instanceof Error ? err.message : String(err);
        this.log.append(`${hint}\n`);
      }
    });
    this.log.finish(ok, summary);
    this.set({
      last: {
        kind: 'upload',
        ok,
        durationMs: Date.now() - started,
        sketch: this.session.project?.name ?? '',
        summary,
        diagnostics: [],
        hint,
      },
    });
    return ok;
  }

  /** MicroPython needs the serial tool and a port; there is no board package or build. */
  private async readyMicroPython(): Promise<string | undefined> {
    const s = this.session;
    if (this.state.running) return undefined;
    if (!s.toolReady) {
      this.set({ blocked: text.needSerialEngine });
      await this.needsSetup('engine');
      return undefined;
    }
    if (!s.port || !s.selectedBoard) {
      this.set({ blocked: text.needPort });
      await this.needsSetup('port');
      return undefined;
    }
    if (!this.micropython) return undefined;
    return s.port;
  }

  /**
   * MicroPython Run: runs the open .py file (or main.py) on the board without saving it there.
   * Output appears in the Serial Monitor; Cancel stops the program (Ctrl-C).
   */
  async run(): Promise<boolean> {
    const port = await this.readyMicroPython();
    const mp = this.micropython;
    const project = this.session.project;
    if (!port || !mp || !project) return false;
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const file =
      active && extname(active) === '.py' && active.startsWith(project.root + sep)
        ? active
        : `${project.root}${sep}main.py`;
    await vscode.workspace.saveAll(false);
    let code: string;
    try {
      code = await readFile(file, 'utf8');
    } catch {
      this.set({ blocked: text.noMainPy });
      return false;
    }
    const name = basename(file);
    const title = text.running(name, port);
    this.problems.clear();
    await mp.showMonitor();
    const started = Date.now();
    let ok = true;
    let notMicroPython = false;
    let summary = text.runDone(name);
    const diagnostics: BuildDiagnostic[] = [];
    await this.track('run', title, async (signal) => {
      try {
        await mp.exclusive(port, (link) => {
          const board = new MicroPythonBoard(link);
          return board.run(code, { onStdout: (t) => mp.print(t), signal }).finally(() => board.close());
        });
      } catch (err) {
        if (err instanceof ProgramError) {
          mp.print(err.traceback);
          if (signal.aborted) {
            summary = text.runStopped(name);
            return;
          }
          ok = false;
          const loc = tracebackLocation(err.traceback);
          summary = text.runFailed(name, loc?.message ?? err.message);
          if (loc) diagnostics.push({ file, line: loc.line, severity: 'error', message: loc.message });
        } else {
          ok = false;
          notMicroPython = err instanceof ReplError;
          summary = text.runFailed(name, err instanceof Error ? err.message : String(err));
        }
      }
    });
    this.publish(diagnostics);
    this.set({
      last: {
        kind: 'run',
        ok,
        durationMs: Date.now() - started,
        sketch: project.name,
        summary,
        diagnostics,
        notMicroPython,
      },
    });
    return ok;
  }

  /** MicroPython Upload: copies changed project files to the board, then soft-resets it to run main.py. */
  private async uploadMicroPython(): Promise<boolean> {
    const port = await this.readyMicroPython();
    const mp = this.micropython;
    const project = this.session.project;
    if (!port || !mp || !project) return false;
    await vscode.workspace.saveAll(false);
    const title = text.uploading(project.name, port);
    this.log.start('upload', title);
    const started = Date.now();
    let ok = true;
    let summary: string;
    let hint: string | undefined;
    let notMicroPython = false;
    try {
      const files = await projectFiles(project.root);
      const res = await this.track('upload', title, () =>
        mp.exclusive(port, async (link) => {
          const board = new MicroPythonBoard(link);
          try {
            const r = await board.sync(files, (path, i, n) => this.log.append(`[${i + 1}/${n}] ${path}\n`));
            board.softReset();
            return r;
          } finally {
            board.close();
          }
        }),
      );
      this.log.append(text.syncSummary(res.uploaded.length, res.unchanged.length) + '\n');
      summary = res.uploaded.length ? text.filesUploaded(res.uploaded.length, port) : text.noChanges;
    } catch (err) {
      ok = false;
      notMicroPython = err instanceof ReplError;
      hint = err instanceof Error ? err.message : String(err);
      this.log.append(`${hint}\n`);
      summary = text.uploadFailed(port);
    }
    this.log.finish(ok, summary);
    this.set({
      last: {
        kind: 'upload',
        ok,
        durationMs: Date.now() - started,
        sketch: project.name,
        summary,
        diagnostics: [],
        hint,
        notMicroPython,
      },
    });
    return ok;
  }

  /** Compiles. Returns true on success. */
  async build(kind: 'build' | 'upload' = 'build'): Promise<boolean> {
    if (this.session.kind === 'micropython') return kind === 'build' ? this.run() : false;
    if (!(await this.ready())) return false;
    const s = this.session;
    const project = s.project!;
    const target = s.target!;
    await vscode.workspace.saveAll(false); // compile what's on screen
    const title = text.building(project.name, target.name);
    this.log.start(kind, title);
    const started = Date.now();
    const result = await this.track(kind, title, (signal) =>
      s.toolchain.build({ project, target, onOutput: (t) => this.log.append(t), signal }),
    );
    this.lastMemory = result.memory;
    this.publish(result.diagnostics);
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    const summary = result.success ? text.buildOk : text.buildFailed(errors);
    if (!result.success || kind === 'build') this.log.finish(result.success, summary);
    if (!result.success || kind === 'build') {
      this.set({
        last: {
          kind,
          ok: result.success,
          durationMs: Date.now() - started,
          sketch: project.name,
          summary,
          diagnostics: result.diagnostics,
          fix: result.fix,
          hint: result.error,
          memory: result.memory,
        },
      });
    }
    return result.success;
  }

  async upload(): Promise<boolean> {
    if (this.session.kind === 'micropython') return this.uploadMicroPython();
    if (!(await this.ready())) return false;
    const s = this.session;
    if (!s.port || !s.selectedBoard) {
      this.set({ blocked: text.needPort });
      await this.needsSetup('port');
      return false;
    }
    const port = s.port;
    const started = Date.now();
    if (!(await this.build('upload'))) return false;
    const project = s.project!;
    const target = s.target!;
    await this.uploadHooks.before?.(port);
    const title = text.uploading(project.name, port);
    this.log.retitle('upload', title);
    this.log.append(`\n${title}\n`);
    const res = await this.track('upload', title, (signal) =>
      s.toolchain.flash({ project, target, port, onOutput: (t) => this.log.append(t), signal }),
    );
    void this.uploadHooks.after?.(port);
    let hint = res.error;
    let fix: SuggestedFix | undefined;
    if (!res.success && !hint) {
      // Ask Board Doctor whether it knows why (port held by a named app, permissions, ...),
      // then read the uploader's own output for the usual causes.
      const st = await this.doctor.refresh();
      hint = st.diagnoses.find(
        (d) => d.port?.path === port && (d.severity === 'error' || d.severity === 'warning'),
      )?.title;
      const advice = adviseUploadFailure(this.log.current?.text ?? '', target.id, s.boardOptions);
      hint ??= advice?.reason;
      if (advice?.option) {
        const { id, value, label } = advice.option;
        fix = {
          message: advice.reason,
          label,
          apply: async () => {
            await s.setOption(id, value);
            return true;
          },
        };
        hint = undefined; // the fix card says it
      }
    }
    const summary = res.success ? text.uploadOk(port) : text.uploadFailed(port);
    this.log.finish(res.success, summary);
    this.set({
      last: {
        kind: 'upload',
        ok: res.success,
        durationMs: Date.now() - started,
        sketch: project.name,
        summary,
        diagnostics: [],
        hint,
        fix,
        memory: this.lastMemory,
      },
    });
    return res.success;
  }

  /** Applies the last run's suggested fix, then retries the build. */
  async applyFix(): Promise<void> {
    const fix = this.state.last?.fix;
    if (!fix || this.state.running) return;
    this.log.start('fix', fix.label);
    const ok = await this.track('fix', fix.label, (signal) => fix.apply((t) => this.log.append(t), signal));
    this.log.finish(ok, fix.label);
    if (ok) {
      await this.session.recheckTool();
      if (this.state.last?.kind === 'upload') await this.upload();
      else await this.build();
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
