import { join } from 'node:path';
import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import { readDefaultFqbn, writeDefaultFqbn } from './toolchains/arduino/sketchYaml.js';
import type { BuildTarget, DetectedBoard, Project, Toolchain } from './toolchains/types.js';

const PORTS_KEY = 'integratedWorkbench.ports';

/**
 * Tracks the project behind the active editor, the boards that are plugged in, and the
 * board/port selected for that project.
 * - Board: `default_fqbn` in the sketch's sketch.yaml (shared with arduino-cli and Arduino IDE,
 *   travels with the sketch).
 * - Port: per machine, in VS Code's global state (ports differ between computers).
 */
export class Session implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  project?: Project;
  boards: DetectedBoard[] = [];
  toolReady = false;
  /** Every board from installed board packages (empty until arduino-cli is ready). */
  targets: BuildTarget[] = [];
  /** Board ID from sketch.yaml, if set. */
  fqbn?: string;

  private lastPortKey: string | undefined;
  private pollTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly toolchain: Toolchain,
    private readonly doctor: BoardDoctor,
    private readonly globalState: vscode.Memento,
    private readonly pollIntervalMs: () => number,
  ) {
    const yaml = vscode.workspace.createFileSystemWatcher('**/sketch.yaml');
    const onYaml = (uri: vscode.Uri) => {
      if (this.project && uri.fsPath === this.yamlPath) void this.readFqbn().then(() => this.changed.fire());
    };
    this.disposables.push(
      yaml,
      yaml.onDidChange(onYaml),
      yaml.onDidCreate(onYaml),
      yaml.onDidDelete(onYaml),
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

  /** Re-check the toolchain (after it was installed, a core changed, or settings changed). */
  async recheckTool(): Promise<void> {
    await this.updateProject(true);
  }

  private get yamlPath(): string | undefined {
    return this.project ? join(this.project.root, 'sketch.yaml') : undefined;
  }

  /** The board to build for, with a display name when we can find one. */
  get target(): BuildTarget | undefined {
    if (!this.fqbn) return undefined;
    const name =
      this.targets.find((t) => t.id === this.fqbn)?.name ??
      this.boards.flatMap((b) => b.candidates).find((t) => t.id === this.fqbn)?.name ??
      this.fqbn;
    return { id: this.fqbn, name };
  }

  /** Is the board's package installed? Treated as yes until arduino-cli can tell us. */
  get targetInstalled(): boolean {
    return !this.fqbn || !this.toolReady || this.targets.some((t) => t.id === this.fqbn);
  }

  get port(): string | undefined {
    if (!this.project) return undefined;
    return this.globalState.get<Record<string, string>>(PORTS_KEY, {})[this.project.root];
  }

  /** The board plugged into the selected port, if it's plugged in. */
  get selectedBoard(): DetectedBoard | undefined {
    return this.boards.find((b) => b.port === this.port);
  }

  async setTarget(target: BuildTarget): Promise<void> {
    if (!this.yamlPath) return;
    const uri = vscode.Uri.file(this.yamlPath);
    let current: string | undefined;
    try {
      current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      current = undefined;
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(writeDefaultFqbn(current, target.id)));
    this.fqbn = target.id;
    if (!this.targets.some((t) => t.id === target.id)) this.targets = [...this.targets, target];
    this.changed.fire();
  }

  async setPort(path: string | undefined): Promise<void> {
    if (!this.project) return;
    const all = { ...this.globalState.get<Record<string, string>>(PORTS_KEY, {}) };
    if (path) all[this.project.root] = path;
    else delete all[this.project.root];
    await this.globalState.update(PORTS_KEY, all);
    this.changed.fire();
  }

  private async readFqbn(): Promise<void> {
    if (!this.yamlPath) {
      this.fqbn = undefined;
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.yamlPath));
      this.fqbn = readDefaultFqbn(new TextDecoder().decode(bytes));
    } catch {
      this.fqbn = undefined;
    }
  }

  private async updateProject(force = false): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    // Keep the last project when focus moves to output panels, settings, etc.
    if (doc?.uri.scheme === 'file') {
      const next = await this.toolchain.findProject(doc.uri.fsPath);
      if (!force && next && next.root === this.project?.root) return;
      this.project = next;
    } else if (!force) {
      return;
    }
    void vscode.commands.executeCommand('setContext', 'integratedWorkbench.inProject', !!this.project);
    await this.readFqbn();
    this.changed.fire();
    this.toolReady = (await this.toolchain.checkInstalled()).installed;
    if (this.project) {
      await this.refreshTargets();
      void this.doctor.refresh();
      await this.refreshBoards();
    }
    this.schedulePoll();
  }

  async refreshTargets(): Promise<void> {
    if (!this.toolReady) {
      this.targets = [];
      return;
    }
    try {
      this.targets = await this.toolchain.listTargets();
    } catch {
      this.targets = [];
    }
    this.changed.fire();
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
   * - If that board identifies itself and the sketch has no board yet, use it (written to sketch.yaml).
   */
  private async autoSelect(): Promise<void> {
    if (!this.project) return;
    let port = this.port;
    if (!this.boards.some((b) => b.port === port) && this.boards.length === 1) port = this.boards[0]!.port;
    if (port !== this.port) await this.setPort(port);
    const identified = this.boards.find((b) => b.port === port)?.target;
    if (identified && !this.fqbn) await this.setTarget(identified);
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
