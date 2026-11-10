import * as vscode from 'vscode';
import { lookupChip } from './core/index.js';
import type { BoardDoctor } from './doctor.js';
import type { Session } from './session.js';
import { text } from './text.js';

/** "/dev/cu.usbmodem1101" -> "cu.usbmodem1101"; "COM5" stays. */
export function shortPort(path: string): string {
  return path.replace(/^\/dev\//, '');
}

/** Board · Port · [Verify] [Upload], shown while a sketch file is active. */
export class StatusBar implements vscode.Disposable {
  private readonly board = vscode.window.createStatusBarItem(
    'integratedWorkbench.board',
    vscode.StatusBarAlignment.Left,
    50,
  );
  private readonly port = vscode.window.createStatusBarItem(
    'integratedWorkbench.port',
    vscode.StatusBarAlignment.Left,
    49,
  );
  private readonly build = vscode.window.createStatusBarItem(
    'integratedWorkbench.build',
    vscode.StatusBarAlignment.Left,
    48,
  );
  private readonly upload = vscode.window.createStatusBarItem(
    'integratedWorkbench.upload',
    vscode.StatusBarAlignment.Left,
    47,
  );
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
  ) {
    this.board.name = 'Integrated Workbench Board';
    this.board.command = 'integratedWorkbench.selectBoard';
    this.board.tooltip = text.boardTooltip;
    this.port.name = 'Integrated Workbench Port';
    this.build.name = 'Integrated Workbench Verify';
    this.build.text = '$(check)';
    this.build.tooltip = text.buildTooltip;
    this.build.command = 'integratedWorkbench.build';
    this.upload.name = 'Integrated Workbench Upload';
    this.upload.text = '$(arrow-right)';
    this.upload.tooltip = text.uploadTooltip;
    this.upload.command = 'integratedWorkbench.upload';
    this.subs = [session.onDidChange(() => this.render()), doctor.onDidChange(() => this.render())];
    this.render();
  }

  render(): void {
    const items = [this.board, this.port, this.build, this.upload];
    if (!this.session.project) {
      items.forEach((i) => i.hide());
      return;
    }
    const sel = this.session.selection;
    this.board.text = `$(circuit-board) ${sel.target?.name ?? text.selectBoard}`;

    const problem = this.doctor.problems[0];
    if (sel.port && this.session.selectedBoard) {
      const b = this.session.selectedBoard;
      const chip = b.target ? undefined : lookupChip(b.vid, b.pid).chip?.name;
      this.port.text = `$(plug) ${shortPort(sel.port)}${chip ? ` (${chip})` : ''}`;
      this.port.tooltip = text.portTooltip;
      this.port.command = 'integratedWorkbench.selectPort';
      this.port.backgroundColor = undefined;
    } else if (problem) {
      this.port.text = `$(warning) ${text.boardProblem}`;
      this.port.tooltip = `${problem.title}\n\n${text.problemTooltip}`;
      this.port.command = 'integratedWorkbench.boardDoctor';
      this.port.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.port.text = `$(plug) ${text.noPort}`;
      this.port.tooltip = text.portTooltip;
      this.port.command = 'integratedWorkbench.selectPort';
      this.port.backgroundColor = undefined;
    }
    items.forEach((i) => i.show());
  }

  dispose(): void {
    [this.board, this.port, this.build, this.upload, ...this.subs].forEach((d) => d.dispose());
  }
}
