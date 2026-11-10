import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import type { BuildTarget, DetectedBoard, Project, Toolchain } from './toolchains/types.js';

/** What the user chose for one project. Stored per project folder in workspace state. */
export interface Selection {
  target?: BuildTarget;
  port?: string;
}

const SELECTION_KEY = 'sketchdesk.selection';

/**
 * Tracks the project behind the active editor, the boards that are plugged in, and the
 * board/port selected for that project. Picks the plugged-in board automatically.
 */
export class Session implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  project?: Project;
  boards: DetectedBoard[] = [];
  toolReady = false;

  private lastPortKey = '';
  private pollTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly toolchain: Toolchain,
    private readonly doctor: BoardDoctor,
    private readonly state: vscode.Memento,
    private readonly pollIntervalMs: () => number,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.updateProject()),
      vscode.window.onDidChangeWindowState(() => this.schedulePoll()),
      // The cheap core probe tells us when ports change; only then ask arduino-cli (slow) again.
      doctor.onDidChange((s) => {
        const key = (s.snapshot?.ports ?? [])
          .map((p) => p.path)
          .sort()
          .join('|');
        if (key !== this.lastPortKey) {
          this.lastPortKey = key;
          void this.refreshBoards();
        } else {
          this.changed.fire();
        }
      }),
    );
  }

  async start(): Promise<void> {
    await this.updateProject();
  }

  get selection(): Selection {
    if (!this.project) return {};
    return this.state.get<Record<string, Selection>>(SELECTION_KEY, {})[this.project.root] ?? {};
  }

  async setSelection(patch: Selection): Promise<void> {
    if (!this.project) return;
    const all = this.state.get<Record<string, Selection>>(SELECTION_KEY, {});
    all[this.project.root] = { ...all[this.project.root], ...patch };
    await this.state.update(SELECTION_KEY, all);
    this.changed.fire();
  }

  /** The board plugged into the selected port, if any. */
  get selectedBoard(): DetectedBoard | undefined {
    return this.boards.find((b) => b.port === this.selection.port);
  }

  private async updateProject(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    // Keep the last project when focus moves to output panels, settings, etc.
    if (doc?.uri.scheme === 'file') {
      this.project = await this.toolchain.findProject(doc.uri.fsPath);
    }
    void vscode.commands.executeCommand('setContext', 'sketchdesk.inProject', !!this.project);
    this.changed.fire();
    if (this.project) {
      const status = await this.toolchain.checkInstalled();
      this.toolReady = status.installed;
      void this.doctor.refresh();
      await this.refreshBoards();
    }
    this.schedulePoll();
  }

  async refreshBoards(): Promise<void> {
    if (!this.toolReady) {
      this.changed.fire();
      return;
    }
    try {
      this.boards = (await this.toolchain.listBoards()).filter((b) => b.vid); // USB boards only
    } catch {
      this.boards = [];
    }
    await this.autoSelect();
    this.changed.fire();
  }

  /**
   * - Keep the user's port if that board is still plugged in.
   * - Otherwise, if exactly one board is plugged in, switch to it.
   * - If the board identifies itself, use that as the build target.
   */
  private async autoSelect(): Promise<void> {
    if (!this.project) return;
    const sel = this.selection;
    let port = sel.port;
    if (!this.boards.some((b) => b.port === port) && this.boards.length === 1) port = this.boards[0]!.port;
    const board = this.boards.find((b) => b.port === port);
    const target = board?.target ?? sel.target;
    if (port !== sel.port || target?.id !== sel.target?.id) await this.setSelection({ port, target });
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    // Only poll while a project is open and VS Code is focused.
    if (!this.project || !vscode.window.state.focused) return;
    this.pollTimer = setTimeout(async () => {
      await this.doctor.refresh();
      this.schedulePoll();
    }, this.pollIntervalMs());
  }

  dispose(): void {
    clearTimeout(this.pollTimer);
    this.changed.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
