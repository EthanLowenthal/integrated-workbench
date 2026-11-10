import * as vscode from 'vscode';
import type { LibrariesModel } from '../librariesModel.js';
import { text } from '../text.js';
import { webviewHtml, webviewOptions } from './webview.js';

export const LIBRARIES_VIEW = 'integratedWorkbench.libraries';

type Msg =
  | { type: 'ready' | 'refresh' | 'showOutput' | 'openTools' }
  | { type: 'search'; query: string }
  | { type: 'install' | 'uninstall'; name: string };

/** The "Libraries" section of the sidebar. */
export class LibrariesView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private lastPosted = '';
  private activated = false;
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: LibrariesModel,
    private readonly output: vscode.OutputChannel,
  ) {
    this.sub = model.onDidChange(() => this.post());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'libraries.js', 'Libraries');
    view.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  private post(): void {
    if (!this.view?.visible) return;
    const state = { ...this.model.state, text: text.libraries.ui };
    const json = JSON.stringify(state);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: 'state', state });
  }

  private async onMessage(m: Msg): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.lastPosted = '';
        this.post();
        if (!this.activated) {
          this.activated = true;
          await this.model.activate();
        }
        return;
      case 'refresh':
        return this.model.refresh();
      case 'search':
        return this.model.search(m.query);
      case 'install':
        await this.model.install(m.name);
        return;
      case 'uninstall':
        return this.model.uninstall(m.name);
      case 'showOutput':
        return this.output.show();
      case 'openTools':
        await vscode.commands.executeCommand('integratedWorkbench.showTools', 'engine');
        return;
    }
  }

  dispose(): void {
    this.sub.dispose();
  }
}
