import * as vscode from 'vscode';
import type { ChipDb } from './core/chips.js';
import type { DriverDb } from './core/drivers.js';
import { diagnose, takeSnapshot, type Action, type Diagnosis, type Snapshot } from './core/index.js';
import { text } from './text.js';

export interface DoctorState {
  snapshot?: Snapshot;
  diagnoses: Diagnosis[];
  error?: string;
}

/**
 * Runs the core USB probe + diagnosis. The session also uses its snapshots to notice plug/unplug
 * cheaply, without starting arduino-cli every few seconds.
 */
export class BoardDoctor implements vscode.Disposable {
  constructor(private readonly dbs: () => { chips: ChipDb; drivers: DriverDb }) {}

  private readonly changed = new vscode.EventEmitter<DoctorState>();
  readonly onDidChange = this.changed.event;
  private current: DoctorState = { diagnoses: [] };
  private inFlight?: Promise<DoctorState>;

  get state(): DoctorState {
    return this.current;
  }

  /** Overlapping calls share one probe run. */
  refresh(): Promise<DoctorState> {
    this.inFlight ??= this.run().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  /** Problems worth flagging in the status bar (not OK / info). */
  get problems(): Diagnosis[] {
    return this.current.diagnoses.filter((d) => d.severity === 'error' || d.severity === 'warning');
  }

  private async run(): Promise<DoctorState> {
    try {
      const snapshot = await takeSnapshot();
      this.current = { snapshot, diagnoses: diagnose(snapshot, this.dbs()) };
    } catch (err) {
      this.current = { ...this.current, error: err instanceof Error ? err.message : String(err) };
    }
    this.changed.fire(this.current);
    return this.current;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/** Carries out a Board Doctor button. Never runs a shell command: commands are copied for the user. */
export async function runDoctorAction(
  action: Action,
  doctor: BoardDoctor,
  onSelectPort: (path: string) => Promise<void>,
): Promise<void> {
  switch (action.kind) {
    case 'openUrl':
      await vscode.env.openExternal(vscode.Uri.parse(action.url));
      return;
    case 'copyCommand':
      await vscode.env.clipboard.writeText(action.command);
      vscode.window.setStatusBarMessage(text.copied(action.command), 5000);
      return;
    case 'runCommand': {
      // The one modal kept on purpose: it's about running something as administrator.
      const ok = await vscode.window.showWarningMessage(
        text.adminPrompt(action.command),
        { modal: true },
        text.adminCopy,
      );
      if (ok) {
        await vscode.env.clipboard.writeText(action.command);
        vscode.window.setStatusBarMessage(text.copied(action.command), 5000);
      }
      return;
    }
    case 'retry':
      await doctor.refresh();
      return;
    case 'selectPort':
      await onSelectPort(action.path);
      return;
    case 'pickPort': {
      const path = await vscode.window.showQuickPick(action.paths, { placeHolder: text.pickPort });
      if (path) await onSelectPort(path);
      return;
    }
  }
}
