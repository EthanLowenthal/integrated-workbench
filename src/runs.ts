import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import type { Session } from './session.js';
import { text } from './text.js';
import type { BuildDiagnostic, SuggestedFix } from './toolchains/types.js';

export type RunKind = 'build' | 'upload' | 'fix';

export interface LastRun {
  kind: 'build' | 'upload';
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

  constructor(
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
    private readonly output: vscode.OutputChannel,
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

  /** Compiles. Returns true on success. */
  async build(kind: 'build' | 'upload' = 'build'): Promise<boolean> {
    if (!(await this.ready())) return false;
    const s = this.session;
    const project = s.project!;
    const target = s.target!;
    await vscode.workspace.saveAll(false); // compile what's on screen
    this.output.clear();
    this.output.appendLine(`Compiling ${project.name} for ${target.name}`);
    const started = Date.now();
    const result = await this.track(kind, text.building(project.name, target.name), (signal) =>
      s.toolchain.build({ project, target, onOutput: (t) => this.output.append(t), signal }),
    );
    this.publish(result.diagnostics);
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    if (!result.success || kind === 'build') {
      this.set({
        last: {
          kind,
          ok: result.success,
          durationMs: Date.now() - started,
          sketch: project.name,
          summary: result.success ? text.buildOk(project.name) : text.buildFailed(errors),
          diagnostics: result.diagnostics,
          fix: result.fix,
        },
      });
    }
    return result.success;
  }

  async upload(): Promise<boolean> {
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
    const res = await this.track('upload', text.uploading(project.name, port), (signal) =>
      s.toolchain.flash({ project, target, port, onOutput: (t) => this.output.append(t), signal }),
    );
    let hint: string | undefined;
    if (!res.success) {
      // Ask Board Doctor whether it knows why (port held by another app, permissions, ...).
      const st = await this.doctor.refresh();
      hint = st.diagnoses.find(
        (d) => d.port?.path === port && (d.severity === 'error' || d.severity === 'warning'),
      )?.title;
    }
    this.set({
      last: {
        kind: 'upload',
        ok: res.success,
        durationMs: Date.now() - started,
        sketch: project.name,
        summary: res.success ? text.uploadOk(project.name, port) : text.uploadFailed(port),
        diagnostics: [],
        hint,
      },
    });
    return res.success;
  }

  /** Applies the last run's suggested fix, then retries the build. */
  async applyFix(): Promise<void> {
    const fix = this.state.last?.fix;
    if (!fix || this.state.running) return;
    const ok = await this.track('fix', fix.label, (signal) =>
      fix.apply((t) => this.output.append(t), signal),
    );
    if (ok) {
      await this.session.recheckTool();
      await this.build(this.state.last?.kind ?? 'build');
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
