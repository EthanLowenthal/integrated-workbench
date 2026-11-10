import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import type { BuildLog } from '../buildLog.js';
import type { Runs } from '../runs.js';
import type { Session } from '../session.js';
import { text } from '../text.js';
import { webviewHtml, webviewOptions } from './webview.js';

export const BUILD_VIEW = 'integratedWorkbench.build';

type Msg =
  | { type: 'ready' }
  | { type: 'select'; id: number }
  | { type: 'openLine'; line: string }
  | { type: 'copy'; id: number };

/** Batches output so a chatty compile doesn't send one message per chunk. */
const FLUSH_MS = 50;

/** "Build" panel tab: live compiler and upload output for the last few runs, with errors you can select. */
export class BuildView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private selected?: number;
  private pending = '';
  private pendingId?: number;
  private timer?: NodeJS.Timeout;
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: BuildLog,
    private readonly runs: Runs,
    private readonly session: Session,
  ) {
    this.subs = [
      log.onDidChange(() => {
        // A new run takes over the view.
        this.selected = undefined;
        this.flush();
        this.postRuns(true);
      }),
      log.onDidAppend(({ id, text: t }) => {
        if (id !== (this.selected ?? this.log.current?.id)) return;
        if (this.pendingId !== id) this.flush();
        this.pendingId = id;
        this.pending += t;
        this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
      }),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'build.js', 'Build');
    view.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.postRuns(true));
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${BUILD_VIEW}.focus`);
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending && this.pendingId !== undefined)
      void this.view?.webview.postMessage({ type: 'append', id: this.pendingId, text: this.pending });
    this.pending = '';
    this.pendingId = undefined;
  }

  /** Sends the run list, and the selected run's full text when `withText`. */
  private postRuns(withText: boolean): void {
    if (!this.view?.visible) return;
    const id = this.selected ?? this.log.current?.id;
    const run = this.log.runs.find((r) => r.id === id);
    void this.view.webview.postMessage({
      type: 'runs',
      runs: this.log.runs.map((r) => ({
        id: r.id,
        title: r.title,
        ok: r.ok,
        summary: r.summary,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      })),
      selected: id,
      text: withText ? (run?.text ?? '') : undefined,
      ui: text.build.ui,
    });
  }

  private async onMessage(m: Msg): Promise<void> {
    switch (m.type) {
      case 'ready':
        return this.postRuns(true);
      case 'select':
        this.selected = m.id;
        return this.postRuns(true);
      case 'copy': {
        const run = this.log.runs.find((r) => r.id === m.id);
        if (run) await vscode.env.clipboard.writeText(run.text);
        return;
      }
      case 'openLine':
        return this.openLine(m.line);
    }
  }

  /** Opens the file and line an error or warning line refers to. */
  private async openLine(line: string): Promise<void> {
    const m = /^(.*?):(\d+):(?:(\d+):)?/.exec(line.trim());
    if (!m) return;
    const [, file, ln, col] = m;
    const lineNo = Number(ln);
    // Prefer the matching diagnostic: it already maps build-folder copies back to the sketch.
    const diag = this.runs.state.last?.diagnostics.find(
      (d) => d.line === lineNo && basename(d.file) === basename(file!).replace(/\.ino\.cpp$/, '.ino'),
    );
    let path = diag?.file ?? file!;
    if (!isAbsolute(path) && this.session.project) path = join(this.session.project.root, path);
    if (!existsSync(path)) return;
    const pos = new vscode.Position(
      Math.max(0, lineNo - 1),
      Math.max(0, Number(diag?.column ?? col ?? 1) - 1),
    );
    await vscode.window.showTextDocument(vscode.Uri.file(path), { selection: new vscode.Range(pos, pos) });
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const s of this.subs) s.dispose();
  }
}
