import * as vscode from 'vscode';
import { parseRegistrySpec } from '../registry/load.js';
import { text } from '../text.js';
import type { ToolsModel } from '../toolsModel.js';
import { webviewHtml, webviewOptions } from './webview.js';

export const TOOLS_VIEW = 'integratedWorkbench.tools';

type Msg =
  | { type: 'ready' | 'refresh' | 'addRegistry' | 'editRegistries' | 'registryHelp' | 'showOutput' }
  | { type: 'install' | 'uninstall'; id: string };

/** The "Boards and Tools" section of the sidebar. */
export class ToolsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private loadedOnce = false;
  private pendingFocus?: string;
  /** Last state sent; identical states aren't re-sent (keeps the search box and scroll stable). */
  private lastPosted = '';
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: ToolsModel,
    private readonly output: vscode.OutputChannel,
  ) {
    this.sub = model.onDidChange(() => this.post());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'tools.js', 'Boards and Tools');
    view.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  /** Reveal the view and highlight one item (e.g. the build engine). */
  async focus(id?: string): Promise<void> {
    this.pendingFocus = id;
    await vscode.commands.executeCommand(`${TOOLS_VIEW}.focus`);
    this.post();
  }

  private post(): void {
    if (!this.view?.visible) return;
    const state = { ...this.model.state, text: text.webview };
    const json = JSON.stringify(state);
    if (json !== this.lastPosted) {
      this.lastPosted = json;
      void this.view.webview.postMessage({ type: 'state', state });
    }
    if (this.pendingFocus) {
      void this.view.webview.postMessage({ type: 'focus', id: this.pendingFocus });
      this.pendingFocus = undefined;
    }
  }

  private async onMessage(m: Msg): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.lastPosted = ''; // a new webview instance has nothing yet
        this.post();
        if (!this.loadedOnce) {
          this.loadedOnce = true;
          await this.model.refresh();
        }
        return;
      case 'refresh':
        return this.model.refresh({ updateIndex: true });
      case 'install':
        return this.model.install(m.id);
      case 'uninstall':
        return this.model.uninstall(m.id);
      case 'showOutput':
        return this.output.show();
      case 'registryHelp':
        await vscode.env.openExternal(vscode.Uri.parse(text.registryHelpUrl));
        return;
      case 'editRegistries':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'integratedWorkbench.registries',
        );
        return;
      case 'addRegistry': {
        const spec = await vscode.window.showInputBox({
          title: text.addRegistryPrompt,
          placeHolder: text.addRegistryPlaceholder,
          ignoreFocusOut: true,
          validateInput: (v) => {
            if (!v.trim()) return undefined;
            const r = parseRegistrySpec(v, process.env['HOME']);
            return 'error' in r ? r.error : undefined;
          },
        });
        if (!spec?.trim()) return;
        const cfg = vscode.workspace.getConfiguration('integratedWorkbench');
        const list = cfg.get<string[]>('registries', []);
        if (!list.includes(spec.trim())) {
          await cfg.update('registries', [...list, spec.trim()], vscode.ConfigurationTarget.Global);
        }
        return;
      }
    }
  }

  dispose(): void {
    this.sub.dispose();
  }
}
