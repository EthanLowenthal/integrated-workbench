import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import type { Runs } from './runs.js';
import type { Session } from './session.js';
import { text } from './text.js';

/** "/dev/cu.usbmodem1101" -> "cu.usbmodem1101"; "COM5" stays. */
export function shortPort(path: string): string {
  return path.replace(/^\/dev\//, '');
}

/** One status bar item while a sketch is active: board · port, a spinner while running. Opens the sidebar. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'integratedWorkbench.status',
    vscode.StatusBarAlignment.Left,
    50,
  );
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
    private readonly runs: Runs,
  ) {
    this.item.name = 'Integrated Workbench';
    this.item.command = 'integratedWorkbench.showSketch';
    this.item.tooltip = text.statusTooltip;
    const r = () => this.render();
    this.subs = [session.onDidChange(r), doctor.onDidChange(r), runs.onDidChange(r)];
    this.render();
  }

  render(): void {
    const s = this.session;
    if (!s.project) {
      this.item.hide();
      return;
    }
    const running = this.runs.state.running;
    const needsSetup = !s.toolReady || !s.targetInstalled;
    const problem = !s.selectedBoard && this.doctor.problems.length > 0;
    const board = s.target?.name ?? text.statusSelectBoard;
    const port = s.selectedBoard && s.port ? ` · ${shortPort(s.port)}` : '';
    if (running) this.item.text = `$(loading~spin) ${running.title}`;
    else if (needsSetup) this.item.text = `$(warning) ${board} · ${text.statusSetup}`;
    else if (problem) this.item.text = `$(warning) ${board} · ${text.statusProblem}`;
    else this.item.text = `$(circuit-board) ${board}${port}`;
    this.item.backgroundColor =
      !running && (needsSetup || problem)
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    for (const s of this.subs) s.dispose();
  }
}
