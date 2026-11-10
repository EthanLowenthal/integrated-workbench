import * as vscode from 'vscode';
import type { LineEnding, MonitorController } from '../monitor/controller.js';
import { text } from '../text.js';
import { webviewHtml, webviewOptions } from './webview.js';

export const MONITOR_VIEW = 'integratedWorkbench.monitor';

type Msg =
  | { type: 'ready' | 'connect' | 'disconnect' | 'clear' | 'save' | 'installEngine' }
  | { type: 'send'; text: string }
  | { type: 'baud'; baud: string }
  | { type: 'lineEnding'; ending: LineEnding };

/** Batches incoming bytes so a chatty board doesn't flood the webview with tiny messages. */
const FLUSH_MS = 50;

/** The Serial Monitor panel view (next to Terminal and Problems). */
export class MonitorView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private pending: Buffer[] = [];
  private flushTimer?: NodeJS.Timeout;
  private lastState = '';
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly monitor: MonitorController,
  ) {
    this.subs = [
      monitor.onDidChange(() => this.postState()),
      monitor.onData((d) => {
        this.pending.push(d);
        this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
      }),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'monitor.js', 'Serial Monitor');
    view.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${MONITOR_VIEW}.focus`);
  }

  private flush(): void {
    this.flushTimer = undefined;
    const data = Buffer.concat(this.pending);
    this.pending = [];
    if (data.length)
      void this.view?.webview.postMessage({ type: 'data', time: Date.now(), b64: data.toString('base64') });
  }

  private postState(): void {
    if (!this.view) return;
    const state = { ...this.monitor.state, text: text.monitor.ui };
    const json = JSON.stringify(state);
    if (json === this.lastState) return;
    this.lastState = json;
    void this.view.webview.postMessage({ type: 'state', state });
  }

  private async onMessage(m: Msg): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.lastState = '';
        return this.postState();
      case 'connect':
        return this.monitor.connect();
      case 'disconnect':
        return this.monitor.disconnect();
      case 'send':
        return this.monitor.send(m.text);
      case 'baud':
        return this.monitor.setBaud(m.baud);
      case 'lineEnding':
        return this.monitor.setLineEnding(m.ending);
      case 'clear':
        return this.monitor.clearLog();
      case 'save':
        return this.monitor.saveLog();
      case 'installEngine':
        await vscode.commands.executeCommand('integratedWorkbench.showTools', this.monitor.engineId);
        return;
    }
  }

  dispose(): void {
    clearTimeout(this.flushTimer);
    for (const s of this.subs) s.dispose();
  }
}
