import * as vscode from 'vscode';

/** One Verify, Upload or fix run and everything it printed. */
export interface BuildLogRun {
  id: number;
  kind: 'build' | 'upload' | 'fix';
  title: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  summary?: string;
  text: string;
}

/** Runs kept for the Build panel. */
const KEEP = 5;
/** Output kept per run; older text is dropped from the start. */
const MAX_CHARS = 2_000_000;

/**
 * Output of build and upload runs. Mirrors everything to the Output channel and keeps the last few
 * runs for the Build panel, which receives appended text as it arrives.
 */
export class BuildLog implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when a run starts or finishes (not for every chunk of text). */
  readonly onDidChange = this.changed.event;
  private readonly appended = new vscode.EventEmitter<{ id: number; text: string }>();
  readonly onDidAppend = this.appended.event;
  runs: BuildLogRun[] = [];
  private nextId = 1;

  constructor(private readonly output: vscode.OutputChannel) {}

  get current(): BuildLogRun | undefined {
    return this.runs[0];
  }

  /** Starts a new run (Upload continues the run its compile started). */
  start(kind: BuildLogRun['kind'], title: string): void {
    this.output.clear();
    this.runs = [{ id: this.nextId++, kind, title, startedAt: Date.now(), text: '' }, ...this.runs].slice(
      0,
      KEEP,
    );
    this.changed.fire();
    this.append(`${title}\n`);
  }

  /** Renames the current run, e.g. when a compile moves on to uploading. */
  retitle(kind: BuildLogRun['kind'], title: string): void {
    const run = this.current;
    if (!run) return this.start(kind, title);
    run.kind = kind;
    run.title = title;
    this.changed.fire();
  }

  append(text: string): void {
    this.output.append(text);
    const run = this.current;
    if (!run) return;
    run.text += text;
    if (run.text.length > MAX_CHARS) run.text = run.text.slice(run.text.length - MAX_CHARS);
    this.appended.fire({ id: run.id, text });
  }

  finish(ok: boolean, summary: string): void {
    const run = this.current;
    if (!run) return;
    run.ok = ok;
    run.summary = summary;
    run.endedAt = Date.now();
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
    this.appended.dispose();
  }
}
