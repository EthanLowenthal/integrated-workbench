import { basename, dirname } from 'node:path';
import * as vscode from 'vscode';
import { lookupChip } from '../core/chips.js';
import { runDoctorAction, type BoardDoctor } from '../doctor.js';
import type { RegistryService } from '../registryService.js';
import type { Runs } from '../runs.js';
import type { Session } from '../session.js';
import { text } from '../text.js';
import type { ToolsModel } from '../toolsModel.js';
import type { IntelliSense } from '../intellisense.js';
import { webviewHtml, webviewOptions } from './webview.js';
import { findFilesLimited } from '../findFiles.js';

export const SKETCH_VIEW = 'integratedWorkbench.sketch';

function shortPort(path: string): string {
  return path.replace(/^\/dev\//, '');
}

type Msg =
  | {
      type:
        | 'ready'
        | 'build'
        | 'upload'
        | 'cancel'
        | 'selectBoard'
        | 'refreshPorts'
        | 'showOutput'
        | 'applyFix'
        | 'monitor';
    }
  | { type: 'selectPort'; path: string }
  | { type: 'setOption'; id: string; value: string }
  | { type: 'installCpp' }
  | { type: 'openSettings' }
  | { type: 'openFile'; file: string; line: number; column?: number }
  | { type: 'showTools'; focus?: string }
  | { type: 'doctorAction'; d: number; a: number }
  | { type: 'openSketch'; path: string };

/** The "Sketch" section of the sidebar: board, port, Verify/Upload, last result, board check. */
export class SketchView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  /** Set after construction; its status shows as a hint row. */
  set intellisense(i: IntelliSense) {
    this.intelli = i;
    this.subs.push(i.onDidChange(() => void this.post()));
  }
  private intelli?: IntelliSense;
  private sketches: { name: string; path: string }[] = [];
  private sketchesLoaded = false;
  /** Last state sent, so the 2-second board poll doesn't redraw (and close dropdowns) when nothing changed. */
  private lastPosted = '';
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
    private readonly runs: Runs,
    private readonly tools: ToolsModel,
    private readonly registry: RegistryService,
    private readonly output: vscode.OutputChannel,
  ) {
    const post = () => this.post();
    // Re-list sketches when .ino files are created or deleted.
    const inos = vscode.workspace.createFileSystemWatcher('**/*.{ino,pde}', false, true, false);
    const rescan = () => {
      this.sketchesLoaded = false;
      void this.post();
    };
    this.subs = [
      session.onDidChange(post),
      doctor.onDidChange(post),
      runs.onDidChange(post),
      tools.onDidChange(post),
      inos,
      inos.onDidCreate(rescan),
      inos.onDidDelete(rescan),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'sketch.js', 'Sketch');
    view.webview.onDidReceiveMessage((m: Msg) => void this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  /** Arduino sketches in the workspace, for when no sketch file is open. */
  private async findSketches(): Promise<void> {
    const files = await findFilesLimited('**/*.{ino,pde}', 50);
    this.sketches = files
      .filter((f) => basename(dirname(f.fsPath)) === basename(f.fsPath).replace(/\.(ino|pde)$/, ''))
      .map((f) => ({ name: basename(dirname(f.fsPath)), path: f.fsPath }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private keyLabel(mac: string, other: string): string {
    return process.platform === 'darwin' ? mac : other;
  }

  private async post(): Promise<void> {
    if (!this.view?.visible) return;
    const s = this.session;
    if (!s.project && !this.sketchesLoaded) {
      this.sketchesLoaded = true;
      await this.findSketches();
    }
    const last = this.runs.state.last;
    const doctor = this.shownDiagnoses();
    const missing = this.tools.state.missingRecommended.length;
    const state = {
      project: s.project && { name: s.project.name, root: s.project.root },
      sketches: this.sketches,
      intellisense: this.intelli && {
        status: this.intelli.status,
        message:
          this.intelli.status === 'needsExtension'
            ? text.intellisense.needsExtension
            : this.intelli.status === 'error'
              ? text.intellisense.failed
              : this.intelli.status === 'updating'
                ? text.intellisense.updating
                : undefined,
      },
      board: s.target,
      options: s.boardOptions.map((o) => ({
        id: o.id,
        label: o.label,
        value: s.optionValues[o.id] ?? o.defaultValue,
        changed: o.id in s.optionValues && s.optionValues[o.id] !== o.defaultValue,
        values: o.values,
      })),
      boardInstalled: s.targetInstalled,
      engineReady: s.toolReady,
      port: s.port,
      ports: s.boards.map((b) => ({
        path: b.port,
        label: `${shortPort(b.port)} · ${b.target?.name ?? lookupChip(b.vid, b.pid, this.registry.chips).chip?.name ?? text.unknownBoard}`,
      })),
      run: {
        running: this.runs.state.running,
        blocked: this.runs.state.blocked,
        last: last && { ...last, fix: last.fix && { label: last.fix.label, message: last.fix.message } },
      },
      missingRecommended: missing,
      doctor: doctor.map((d) => ({
        title: d.title,
        detail: d.detail,
        severity: d.severity,
        actions: d.actions.map((a) => ({ label: a.label })),
      })),
      keys: {
        build: this.keyLabel('Cmd+Alt+R', 'Ctrl+Alt+R'),
        upload: this.keyLabel('Cmd+Alt+U', 'Ctrl+Alt+U'),
        monitor: this.keyLabel('Cmd+Alt+M', 'Ctrl+Alt+M'),
      },
      text: {
        openSketch: text.openSketch,
        sketchesHeading: text.sketchesHeading,
        noSketches: text.noSketches,
        sketchKind: text.sketchKind,
        selectBoard: text.selectBoard,
        noBoardsPlugged: text.noBoardsPlugged,
        boardSaved: text.boardSaved,
        engineMissing: text.engineMissing,
        boardPackageMissing: text.boardPackageMissing,
        recommendedMissing: text.recommendedMissing(missing),
        install: text.install,
        view: text.view,
        boardCheck: text.boardCheck,
        openMonitor: text.openMonitor,
        refreshPorts: text.refreshPorts,
        showOutput: text.showOutput,
        cancel: text.cancel,
        webview: text.webview,
      },
    };
    const json = JSON.stringify(state);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: 'state', state });
  }

  /** Board Doctor findings to show: problems, or "no boards" when nothing is plugged in. */
  private shownDiagnoses() {
    const problems = this.doctor.problems;
    if (this.session.boards.length && !problems.length) return [];
    return problems.length ? problems : this.doctor.state.diagnoses.filter((d) => d.code === 'NO_BOARDS');
  }

  private async onMessage(m: Msg): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.lastPosted = ''; // a new webview instance has nothing yet
        return this.post();
      case 'build':
        await this.runs.build();
        return;
      case 'upload':
        await this.runs.upload();
        return;
      case 'cancel':
        return this.runs.cancel();
      case 'applyFix':
        return this.runs.applyFix();
      case 'selectBoard':
        await vscode.commands.executeCommand('integratedWorkbench.selectBoard');
        return;
      case 'selectPort':
        return this.session.setPort(m.path);
      case 'setOption':
        return this.session.setOption(m.id, m.value);
      case 'openSettings':
        await vscode.commands.executeCommand('integratedWorkbench.openSketchSettings');
        return;
      case 'installCpp':
        await vscode.commands.executeCommand('integratedWorkbench.installCppExtension');
        return;
      case 'refreshPorts':
        await this.doctor.refresh();
        return this.session.refreshBoards();
      case 'showOutput':
        return this.output.show();
      case 'showTools':
        await vscode.commands.executeCommand('integratedWorkbench.showTools', m.focus);
        return;
      case 'monitor':
        await vscode.commands.executeCommand('integratedWorkbench.openMonitor');
        return;
      case 'openFile': {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
        const pos = new vscode.Position(Math.max(0, m.line - 1), Math.max(0, (m.column ?? 1) - 1));
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
        return;
      }
      case 'openSketch':
        await vscode.window.showTextDocument(vscode.Uri.file(m.path));
        return;
      case 'doctorAction': {
        const action = this.shownDiagnoses()[m.d]?.actions[m.a];
        if (action) {
          await runDoctorAction(action, this.doctor, async (path) => {
            await this.session.setPort(path);
            await this.session.refreshBoards();
          });
        }
        return;
      }
    }
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
  }
}
