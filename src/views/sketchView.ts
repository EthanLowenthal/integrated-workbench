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
import type { LibrariesModel } from '../librariesModel.js';
import type { BoardFiles } from '../boardFiles.js';
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
  | { type: 'detectBoard' | 'cancelDetect' | 'clearDetect' }
  | { type: 'openFile'; file: string; line: number; column?: number }
  | { type: 'showTools'; focus?: string }
  | { type: 'notice'; id: string; a: number }
  | { type: 'listBoardFiles' }
  | { type: 'openBoardFile' | 'deleteBoardFile'; path: string }
  | { type: 'dismiss'; id: string }
  | { type: 'openSketch'; path: string };

type Severity = 'error' | 'warning' | 'info';
interface NoticeAction {
  label: string;
  run: () => unknown;
}
/** One entry in the Notifications list: every warning from every view is shown here. */
interface Notice {
  id: string;
  severity: Severity;
  title: string;
  /** Longer explanation, shown on hover. */
  detail?: string;
  actions: NoticeAction[];
  /** Info notices can be dismissed until the window reloads. */
  dismissible?: boolean;
}

/** The "Sketch" section of the sidebar: notifications, board, port, Verify/Upload, last result. */
export class SketchView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  /** Set after construction; its status shows as a hint row. */
  set intellisense(i: IntelliSense) {
    this.intelli = i;
    this.subs.push(i.onDidChange(() => void this.post()));
  }
  private intelli?: IntelliSense;
  /** Set after construction; its errors and missing libraries show as notifications. */
  set libraries(l: LibrariesModel) {
    this.libs = l;
    this.subs.push(l.onDidChange(() => void this.post()));
  }
  private libs?: LibrariesModel;
  /** Set after construction: files on a MicroPython board. */
  set boardFiles(b: BoardFiles) {
    this.files = b;
    this.subs.push(b.onDidChange(() => void this.post()));
  }
  private files?: BoardFiles;
  private notices: Notice[] = [];
  private readonly dismissed = new Set<string>();
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
    this.notices = this.collectNotices().filter((n) => !this.dismissed.has(n.id));
    this.updateBadge();
    if (!this.view?.visible) return;
    const s = this.session;
    if (!s.project && !this.sketchesLoaded) {
      this.sketchesLoaded = true;
      await this.findSketches();
    }
    const last = this.runs.state.last;
    const state = {
      kind: s.kind,
      boardFiles: s.kind === 'micropython' ? this.files?.state : undefined,
      project: s.project && { name: s.project.name, root: s.project.root },
      sketches: this.sketches,
      board: s.target,
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
      notices: this.notices.map((n) => ({
        id: n.id,
        severity: n.severity,
        title: n.title,
        detail: n.detail,
        dismissible: n.dismissible,
        actions: n.actions.map((a) => a.label),
      })),
      detect:
        this.doctor.state.detect?.phase === 'waiting'
          ? { phase: 'waiting', endsAt: this.doctor.state.detect.endsAt }
          : undefined,
      noBoards: !s.boards.length,
      keys: {
        build: this.keyLabel('Cmd+Alt+R', 'Ctrl+Alt+R'),
        upload: this.keyLabel('Cmd+Alt+U', 'Ctrl+Alt+U'),
        monitor: this.keyLabel('Cmd+Alt+M', 'Ctrl+Alt+M'),
      },
      text: {
        openSketch: text.openSketch,
        sketchesHeading: text.sketchesHeading,
        noSketches: text.noSketches,
        selectBoard: text.selectBoard,
        noBoardsPlugged: text.noBoardsPlugged,
        notifications: text.notifications,
        dismiss: text.dismiss,
        openMonitor: text.openMonitor,
        refreshPorts: text.refreshPorts,
        showOutput: text.showOutput,
        cancel: text.cancel,
        detectSecondsLeft: text.detectSecondsLeft,
        detectWaitingDetail: text.detectWaitingDetail,
        detectWaiting: text.detectWaiting,
        detectBoard: text.detectBoard,
        webview: text.webview,
        mp: text.micropythonUi,
      },
    };
    const json = JSON.stringify(state);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: 'state', state });
  }

  /** Everything that needs attention, most important first. */
  private collectNotices(): Notice[] {
    const s = this.session;
    const out: Notice[] = [];
    const showOutput = { label: text.showOutput, run: () => this.output.show() };
    const showTools = (focus?: string) => ({
      label: text.install,
      run: () => vscode.commands.executeCommand('integratedWorkbench.showTools', focus),
    });
    if (!s.toolReady && s.kind === 'micropython') {
      out.push({
        id: 'serialEngine',
        severity: 'warning',
        title: text.monitor.engineMissing,
        detail: text.serialEngineDetail,
        actions: [showTools('engine')],
      });
    } else if (!s.toolReady) {
      out.push({
        id: 'engine',
        severity: 'warning',
        title: text.engineMissing,
        detail: text.engineMissingDetail,
        actions: [showTools('engine')],
      });
    } else if (s.target && !s.targetInstalled) {
      out.push({
        id: 'boardPackage',
        severity: 'warning',
        title: text.boardPackageMissing,
        detail: text.boardPackageMissingDetail(s.target.name),
        actions: [showTools()],
      });
    }
    const runDoctor = (d: (typeof this.doctor.problems)[number]) =>
      d.actions.map((a) => ({
        label: a.label,
        run: () =>
          runDoctorAction(a, this.doctor, async (path) => {
            await s.setPort(path);
            await s.refreshBoards();
          }),
      }));
    const det = this.doctor.state.detect;
    if (det?.phase === 'done') {
      det.result.forEach((d, i) =>
        out.push({
          id: `detect:${i}`,
          severity: d.severity === 'error' || d.severity === 'warning' ? d.severity : 'info',
          title: d.title,
          detail: d.detail,
          actions: [...runDoctor(d), { label: text.detectDone, run: () => this.doctor.cancelDetect() }],
        }),
      );
    }
    for (const d of this.doctor.problems) {
      out.push({
        id: `doctor:${d.code}:${d.title}`,
        severity: d.severity === 'error' ? 'error' : 'warning',
        title: d.title,
        detail: d.detail,
        actions: runDoctor(d),
      });
    }
    const tools = this.tools.state;
    if (tools.error) out.push({ id: 'tools', severity: 'error', title: tools.error, actions: [showOutput] });
    for (const r of tools.registries.filter((x) => x.errors.length)) {
      out.push({
        id: `registry:${r.spec}`,
        severity: 'warning',
        title: text.registryErrors(r.name, r.errors.length),
        detail: r.errors.join('\n'),
        actions: [showOutput],
      });
    }
    const libs = this.libs?.state;
    if (libs?.error)
      out.push({ id: 'libraries', severity: 'error', title: libs.error, actions: [showOutput] });
    const required = libs?.required.filter((r) => r.library) ?? [];
    if (required.length) {
      out.push({
        id: 'requiredLibraries',
        severity: 'warning',
        title: text.librariesRequired(required.length),
        detail: required.map((r) => `#include <${r.header}>: ${r.library!.name}`).join('\n'),
        actions: [
          {
            label: text.view,
            run: () => vscode.commands.executeCommand('integratedWorkbench.showLibraries'),
          },
        ],
      });
    }
    // MicroPython firmware: a Pico waiting in BOOTSEL mode, or a board that didn't answer as MicroPython.
    const install = {
      label: text.installMicroPython,
      run: () => vscode.commands.executeCommand('integratedWorkbench.installMicroPython'),
    };
    const usb = new Set((this.doctor.state.snapshot?.usb ?? []).map((d) => `${d.vid}:${d.pid}`));
    const bootsel = this.registry.firmware.some((f) => (f.bootloaderUsb ?? []).some((id) => usb.has(id)));
    // Arduino projects for RP2040 boards use BOOTSEL to upload, so only offer this outside them.
    if (bootsel && (!s.project || s.kind === 'micropython') && !this.runs.state.running) {
      out.push({
        id: 'bootsel',
        severity: 'info',
        title: text.bootselNotice,
        detail: text.bootselNoticeDetail,
        actions: [install],
      });
    } else if (s.kind === 'micropython' && this.runs.state.last?.notMicroPython) {
      out.push({
        id: 'notMicroPython',
        severity: 'warning',
        title: text.notMicroPythonNotice,
        detail: text.notMicroPythonDetail,
        actions: [install],
      });
    }
    // Updates: informational, dismissible, not counted on the badge.
    const coreUpdates = tools.installed.filter((i) => i.state === 'update');
    if (coreUpdates.length) {
      out.push({
        id: `updates:tools:${coreUpdates.map((i) => `${i.id}@${i.latestVersion}`).join(',')}`,
        severity: 'info',
        title: text.packageUpdates(coreUpdates.length),
        detail: coreUpdates.map((i) => `${i.name}: ${i.installedVersion} -> ${i.latestVersion}`).join('\n'),
        actions: [
          { label: text.view, run: () => vscode.commands.executeCommand('integratedWorkbench.showTools') },
        ],
        dismissible: true,
      });
    }
    const libUpdates = libs?.updates ?? [];
    if (libUpdates.length) {
      out.push({
        id: `updates:libraries:${libUpdates.map((u) => `${u.name}@${u.latest}`).join(',')}`,
        severity: 'info',
        title: text.libraryUpdates(libUpdates.length),
        detail: libUpdates.map((u) => `${u.name}: ${u.installed} -> ${u.latest}`).join('\n'),
        actions: [
          {
            label: text.view,
            run: () => vscode.commands.executeCommand('integratedWorkbench.showLibraries'),
          },
        ],
        dismissible: true,
      });
    }
    const intelli = this.intelli?.status;
    if (s.project && s.kind === 'arduino' && intelli === 'needsExtension') {
      out.push({
        id: 'cpptools',
        severity: 'info',
        title: text.intellisense.needsExtension,
        actions: [
          {
            label: text.install,
            run: () => vscode.commands.executeCommand('integratedWorkbench.installCppExtension'),
          },
        ],
        dismissible: true,
      });
    } else if (s.project && s.kind === 'arduino' && intelli === 'error') {
      out.push({
        id: 'intellisense',
        severity: 'warning',
        title: text.intellisense.failed,
        actions: [showOutput],
      });
    }
    return out;
  }

  /** Count of warnings and errors on the sidebar icon, so they're visible from anywhere. */
  private updateBadge(): void {
    if (!this.view) return;
    const n = this.notices.filter((x) => x.severity !== 'info').length;
    this.view.badge = n ? { value: n, tooltip: text.notificationsBadge(n) } : undefined;
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
      case 'detectBoard':
        await vscode.commands.executeCommand('integratedWorkbench.detectBoard');
        return;
      case 'cancelDetect':
      case 'clearDetect':
        return this.doctor.cancelDetect();
      case 'notice': {
        await this.notices.find((n) => n.id === m.id)?.actions[m.a]?.run();
        return;
      }
      case 'listBoardFiles':
        return this.files?.refresh();
      case 'openBoardFile':
        return this.files?.open(m.path);
      case 'deleteBoardFile':
        return this.files?.remove(m.path);
      case 'dismiss':
        this.dismissed.add(m.id);
        return this.post();
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
        await vscode.commands.executeCommand('integratedWorkbench.showOutput');
        return;
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
    }
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
  }
}
