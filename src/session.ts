import { join } from 'node:path';
import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import { readDefaultFqbn, writeDefaultFqbn } from './toolchains/arduino/sketchYaml.js';
import { formatFqbn, parseFqbn } from './toolchains/arduino/fqbn.js';
import type { BoardOption, BuildTarget, DetectedBoard, Project, Toolchain } from './toolchains/types.js';

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
  /** Board ID from sketch.yaml, if set, including any board options ("esp32:esp32:esp32s3:FlashSize=8M"). */
  fqbn?: string;
  /** Menus for the current board (Flash Size, Processor, ...). Empty until loaded or if none. */
  boardOptions: BoardOption[] = [];
  private optionsFor?: string;

  private lastPortKey: string | undefined;
  /** Bumped on every project update; slower, older updates check it and stop. */
  private generation = 0;
  private pollTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly toolchain: Toolchain,
    private readonly doctor: BoardDoctor,
    private readonly globalState: vscode.Memento,
    private readonly pollIntervalMs: () => number,
  ) {
    this.changed.event(() => this.publishContext());
    const yaml = vscode.workspace.createFileSystemWatcher('**/sketch.yaml');
    const onYaml = (uri: vscode.Uri) => {
      if (this.project && uri.fsPath === this.yamlPath)
        void this.readFqbn().then(() => {
          this.changed.fire();
          void this.loadBoardOptions();
        });
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

  /** Context keys the Get Started walkthrough uses to mark steps done. */
  private publishContext(): void {
    const set = (k: string, v: boolean) =>
      void vscode.commands.executeCommand('setContext', `integratedWorkbench.${k}`, v);
    set('engineReady', this.toolReady);
    set('boardSelected', !!this.fqbn);
    set('portSelected', !!this.selectedBoard);
  }

  /** Re-check the toolchain (after it was installed, a core changed, or settings changed). */
  async recheckTool(): Promise<void> {
    await this.updateProject(true);
  }

  private get yamlPath(): string | undefined {
    return this.project ? join(this.project.root, 'sketch.yaml') : undefined;
  }

  /** Board ID without options. */
  get baseFqbn(): string | undefined {
    return this.fqbn ? parseFqbn(this.fqbn).base : undefined;
  }

  /** Option values set in the board ID (only non-default ones are written). */
  get optionValues(): Record<string, string> {
    return this.fqbn ? parseFqbn(this.fqbn).options : {};
  }

  /** The board to build for (id includes options), with a display name when we can find one. */
  get target(): BuildTarget | undefined {
    const base = this.baseFqbn;
    if (!this.fqbn || !base) return undefined;
    const name =
      this.targets.find((t) => t.id === base)?.name ??
      this.boards.flatMap((b) => b.candidates).find((t) => t.id === base)?.name ??
      base;
    return { id: this.fqbn, name };
  }

  /** Is the board's package installed? Treated as yes until arduino-cli can tell us. */
  get targetInstalled(): boolean {
    return !this.fqbn || !this.toolReady || this.targets.some((t) => t.id === this.baseFqbn);
  }

  /** Sets one board option and writes the board ID to sketch.yaml. Defaults are left out. */
  async setOption(id: string, value: string): Promise<void> {
    const base = this.baseFqbn;
    if (!base) return;
    const options = { ...this.optionValues };
    const def = this.boardOptions.find((o) => o.id === id)?.defaultValue;
    if (value === def) delete options[id];
    else options[id] = value;
    await this.writeFqbn(formatFqbn(base, options));
  }

  /** Loads the board's menus when the board changes. */
  async loadBoardOptions(): Promise<void> {
    const base = this.baseFqbn;
    if (base === this.optionsFor) return;
    this.optionsFor = base;
    this.boardOptions = [];
    if (base && this.toolReady && this.targetInstalled && this.toolchain.boardOptions) {
      try {
        const options = await this.toolchain.boardOptions(base);
        if (this.baseFqbn === base) this.boardOptions = options;
      } catch {
        this.boardOptions = [];
      }
    }
    this.changed.fire();
  }

  /** Forget loaded menus (board package installed or removed). */
  resetBoardOptions(): void {
    this.optionsFor = undefined;
    void this.loadBoardOptions();
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
    // A different board has different menus: start from its defaults.
    await this.writeFqbn(parseFqbn(target.id).base);
    if (!this.targets.some((t) => t.id === parseFqbn(target.id).base))
      this.targets = [...this.targets, target];
    this.changed.fire();
  }

  private async writeFqbn(fqbn: string): Promise<void> {
    if (!this.yamlPath) return;
    const uri = vscode.Uri.file(this.yamlPath);
    let current: string | undefined;
    try {
      current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      current = undefined;
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(writeDefaultFqbn(current, fqbn)));
    this.fqbn = fqbn;
    void this.loadBoardOptions();
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
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    const doc = vscode.window.activeTextEditor?.document;
    // Keep the last project when focus moves to output panels, settings, etc.
    if (doc?.uri.scheme === 'file') {
      const next = await this.toolchain.findProject(doc.uri.fsPath);
      if (stale()) return;
      if (!force && next && next.root === this.project?.root) return;
      this.project = next;
    } else if (!force) {
      return;
    }
    void vscode.commands.executeCommand('setContext', 'integratedWorkbench.inProject', !!this.project);
    await this.readFqbn();
    this.changed.fire();
    const ready = (await this.toolchain.checkInstalled()).installed;
    if (stale()) return;
    this.toolReady = ready;
    if (this.project) {
      await this.refreshTargets();
      if (stale()) return;
      this.optionsFor = undefined;
      void this.loadBoardOptions();
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
