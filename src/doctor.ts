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

/** Board Doctor UI: pick a diagnosis, read the explanation, press a fix button. */
export async function showBoardDoctor(
  doctor: BoardDoctor,
  onSelectPort: (path: string) => Promise<void>,
): Promise<void> {
  const state = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: text.doctorChecking },
    () => doctor.refresh(),
  );
  if (state.error) {
    void vscode.window.showErrorMessage(text.doctorProbeFailed(state.error));
    return;
  }
  const icon = { error: '$(error)', warning: '$(warning)', info: '$(info)', ok: '$(pass)' } as const;
  const picked = await vscode.window.showQuickPick(
    state.diagnoses.map((d) => ({ label: `${icon[d.severity]} ${d.title}`, detail: d.detail, d })),
    { title: text.doctorTitle, matchOnDetail: true },
  );
  if (!picked) return;
  const d = picked.d;
  const buttons = d.actions.map((a) => a.label);
  const choice = await vscode.window.showInformationMessage(
    d.title,
    { modal: true, detail: d.detail },
    ...buttons,
  );
  const action = d.actions.find((a) => a.label === choice);
  if (action) await runAction(action, doctor, onSelectPort);
}

/** Never runs a shell command: commands are copied for the user to run themselves. */
async function runAction(action: Action, doctor: BoardDoctor, onSelectPort: (path: string) => Promise<void>) {
  switch (action.kind) {
    case 'openUrl':
      await vscode.env.openExternal(vscode.Uri.parse(action.url));
      return;
    case 'copyCommand':
      await vscode.env.clipboard.writeText(action.command);
      void vscode.window.showInformationMessage(text.copied(action.command));
      return;
    case 'runCommand': {
      const ok = await vscode.window.showWarningMessage(
        text.adminPrompt(action.command),
        { modal: true },
        text.adminCopy,
      );
      if (ok) {
        await vscode.env.clipboard.writeText(action.command);
        void vscode.window.showInformationMessage(text.copied(action.command));
      }
      return;
    }
    case 'retry':
      await showBoardDoctor(doctor, onSelectPort);
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
