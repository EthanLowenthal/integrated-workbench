import * as vscode from 'vscode';
import type { ChipDb } from './core/chips.js';
import type { DriverDb } from './core/drivers.js';
import {
  deviceKey,
  diagnose,
  takeSnapshot,
  watchForDevice,
  type Action,
  type Diagnosis,
  type Snapshot,
} from './core/index.js';
import { text } from './text.js';

export interface DoctorState {
  snapshot?: Snapshot;
  diagnoses: Diagnosis[];
  error?: string;
  /** Detect Board: waiting for the user to connect a board, or what it found. */
  detect?: { phase: 'waiting'; endsAt: number } | { phase: 'done'; result: Diagnosis[] };
}

/** How long Detect Board waits for a board to be connected. */
export const DETECT_MS = 20_000;

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

  private detectAbort?: AbortController;

  /**
   * Detect Board ("plug-in watch"): snapshot USB, ask the user to connect the board, and report
   * what changed. Nothing new at all usually means a charge-only cable.
   */
  async detect(): Promise<Diagnosis[]> {
    this.detectAbort?.abort();
    const ac = (this.detectAbort = new AbortController());
    const baseline = await takeSnapshot();
    this.setDetect({ phase: 'waiting', endsAt: Date.now() + DETECT_MS });
    try {
      const r = await watchForDevice(() => takeSnapshot(), baseline, {
        timeoutMs: DETECT_MS,
        intervalMs: 1000,
        settleMs: 2500,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return [];
      const all = diagnose(r.after, { ...this.dbs(), watch: r.diff });
      // Report only what this connection caused (plus "nothing appeared").
      const added = new Set(r.diff.addedDevices.map(deviceKey));
      const addedPorts = new Set(r.diff.addedPorts.map((p) => p.path));
      const result = all.filter(
        (d) =>
          d.code === 'NO_DEVICE_AFTER_PLUG' ||
          (d.device && added.has(deviceKey(d.device))) ||
          (d.port && addedPorts.has(d.port.path)),
      );
      this.setDetect({ phase: 'done', result });
      void this.refresh();
      return result;
    } finally {
      if (this.detectAbort === ac) this.detectAbort = undefined;
    }
  }

  cancelDetect(): void {
    this.detectAbort?.abort();
    this.setDetect(undefined);
  }

  private setDetect(detect: DoctorState['detect']): void {
    this.current = { ...this.current, detect };
    this.changed.fire(this.current);
  }

  /** Problems worth flagging in the status bar (not OK / info). */
  get problems(): Diagnosis[] {
    return this.current.diagnoses.filter((d) => d.severity === 'error' || d.severity === 'warning');
  }

  private async run(): Promise<DoctorState> {
    try {
      const snapshot = await takeSnapshot();
      this.current = {
        ...this.current,
        snapshot,
        diagnoses: diagnose(snapshot, this.dbs()),
        error: undefined,
      };
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
