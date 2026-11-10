import { join } from 'node:path';
import * as vscode from 'vscode';
import { lookupChip } from '../core/chips.js';
import type { IntelliSense } from '../intellisense.js';
import type { LineEnding, MonitorController } from '../monitor/controller.js';
import type { RegistryService } from '../registryService.js';
import type { Session } from '../session.js';
import { text } from '../text.js';
import { webviewHtml, webviewOptions } from './webview.js';

type Msg =
  | {
      type:
        | 'ready'
        | 'selectBoard'
        | 'resetOptions'
        | 'refreshPorts'
        | 'openYaml'
        | 'installCpp'
        | 'writeCompileCommands'
        | 'refreshIntellisense'
        | 'showTools';
    }
  | { type: 'setOption'; id: string; value: string }
  | { type: 'selectPort'; path: string }
  | { type: 'baud'; baud: string }
  | { type: 'lineEnding'; ending: LineEnding };

/** "Sketch Settings": an editor-tab page for everything about the current sketch's setup. */
export class SettingsPage implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private lastPosted = '';
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: Session,
    private readonly monitor: MonitorController,
    private readonly intellisense: IntelliSense,
    private readonly registry: RegistryService,
  ) {
    const post = () => this.post();
    this.subs = [session.onDidChange(post), monitor.onDidChange(post), intellisense.onDidChange(post)];
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'integratedWorkbench.settings',
      text.settingsPage.title,
      vscode.ViewColumn.Active,
      {
        ...webviewOptions(this.extensionUri),
        retainContextWhenHidden: true,
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = webviewHtml(
      this.panel.webview,
      this.extensionUri,
      'settings.js',
      text.settingsPage.title,
    );
    this.panel.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.lastPosted = '';
    });
  }

  private post(): void {
    if (!this.panel) return;
    const s = this.session;
    const opts = s.optionValues;
    const state = {
      project: s.project && { name: s.project.name, root: s.project.root },
      engineReady: s.toolReady,
      board: s.target && { name: s.target.name, base: s.baseFqbn, fqbn: s.fqbn },
      boardInstalled: s.targetInstalled,
      options: s.boardOptions.map((o) => ({
        id: o.id,
        label: o.label,
        value: opts[o.id] ?? o.defaultValue,
        defaultValue: o.defaultValue,
        changed: o.id in opts && opts[o.id] !== o.defaultValue,
        values: o.values,
      })),
      port: s.port,
      ports: s.boards.map((b) => ({
        path: b.port,
        label: `${b.port} · ${b.target?.name ?? lookupChip(b.vid, b.pid, this.registry.chips).chip?.name ?? text.unknownBoard}`,
      })),
      monitor: {
        baud: this.monitor.state.baud,
        bauds: this.monitor.state.bauds,
        lineEnding: this.monitor.state.lineEnding,
      },
      intellisense: { status: this.intellisense.status, message: this.intellisense.message },
      text: text.settingsPage.ui,
      endings: text.monitor.ui.endings,
    };
    const json = JSON.stringify(state);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    this.panel.title = s.project ? text.settingsPage.titleFor(s.project.name) : text.settingsPage.title;
    void this.panel.webview.postMessage({ type: 'state', state });
  }

  private async onMessage(m: Msg): Promise<void> {
    const s = this.session;
    switch (m.type) {
      case 'ready':
        this.lastPosted = '';
        return this.post();
      case 'selectBoard':
        await vscode.commands.executeCommand('integratedWorkbench.selectBoard');
        return;
      case 'setOption':
        return s.setOption(m.id, m.value);
      case 'resetOptions':
        if (s.target && s.baseFqbn) await s.setTarget({ id: s.baseFqbn, name: s.target.name });
        return;
      case 'selectPort':
        return s.setPort(m.path);
      case 'refreshPorts':
        return s.refreshBoards();
      case 'baud':
        return this.monitor.setBaud(m.baud);
      case 'lineEnding':
        return this.monitor.setLineEnding(m.ending);
      case 'openYaml':
        if (s.project)
          await vscode.window.showTextDocument(vscode.Uri.file(join(s.project.root, 'sketch.yaml')));
        return;
      case 'installCpp':
        await vscode.commands.executeCommand('integratedWorkbench.installCppExtension');
        return;
      case 'writeCompileCommands':
        await vscode.commands.executeCommand('integratedWorkbench.writeCompileCommands');
        return;
      case 'refreshIntellisense':
        return this.intellisense.refresh();
      case 'showTools':
        await vscode.commands.executeCommand('integratedWorkbench.showTools');
        return;
    }
  }

  dispose(): void {
    this.panel?.dispose();
    for (const s of this.subs) s.dispose();
  }
}
