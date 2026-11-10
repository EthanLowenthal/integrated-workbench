import * as vscode from 'vscode';
import type { Runs } from './runs.js';
import type { Session } from './session.js';
import { text } from './text.js';
import { MicroPythonBoard } from './toolchains/micropython/board.js';
import type { BoardFile } from './toolchains/micropython/rawRepl.js';

export interface BoardFilesState {
  loading: boolean;
  /** Undefined until listed (listing stops a running program, so it only happens on request). */
  files?: BoardFile[];
  /** "micropython 1.24.1; Raspberry Pi Pico with RP2040" */
  info?: string;
  error?: string;
}

/** Files on a MicroPython board: list, open (read-only copy), delete. */
export class BoardFiles implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<BoardFilesState>();
  readonly onDidChange = this.changed.event;
  state: BoardFilesState = { loading: false };
  private readonly sub: vscode.Disposable;
  private lastPort?: string;

  constructor(
    private readonly session: Session,
    private readonly runs: Runs,
  ) {
    // A different board: forget the old list.
    this.sub = session.onDidChange(() => {
      const port = session.kind === 'micropython' ? session.port : undefined;
      if (port !== this.lastPort) {
        this.lastPort = port;
        this.set({ files: undefined, info: undefined, error: undefined });
      }
    });
  }

  private set(patch: Partial<BoardFilesState>): void {
    this.state = { ...this.state, ...patch };
    this.changed.fire(this.state);
  }

  private async withBoard<T>(work: (board: MicroPythonBoard) => Promise<T>): Promise<T | undefined> {
    const port = this.session.port;
    const mp = this.runs.micropython;
    if (!port || !mp || !this.session.selectedBoard) {
      this.set({ error: text.needPort });
      return undefined;
    }
    if (this.runs.state.running) return undefined;
    this.set({ loading: true, error: undefined });
    try {
      return await mp.exclusive(port, async (link) => {
        const board = new MicroPythonBoard(link);
        try {
          return await work(board);
        } finally {
          board.close();
        }
      });
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
      return undefined;
    } finally {
      this.set({ loading: false });
    }
  }

  async refresh(): Promise<void> {
    await this.withBoard(async (b) => {
      const info = await b.info();
      const files = await b.list();
      this.set({ info, files: files.sort((x, y) => x.path.localeCompare(y.path)) });
    });
  }

  /** Opens a copy of the file in an editor tab (changes are not written back to the board). */
  async open(path: string): Promise<void> {
    const data = await this.withBoard((b) => b.read(path));
    if (!data) return;
    const doc = await vscode.workspace.openTextDocument({
      content: new TextDecoder().decode(data),
      language: path.endsWith('.py') ? 'python' : undefined,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /** Deletes a file from the board after the user confirms (it can't be undone). */
  async remove(path: string): Promise<void> {
    const file = this.state.files?.find((f) => f.path === path);
    if (!file) return;
    const choice = await vscode.window.showWarningMessage(
      text.deleteFromBoard(path),
      { modal: true, detail: text.deleteFromBoardDetail },
      text.delete,
    );
    if (choice !== text.delete) return;
    await this.withBoard((b) => b.remove(path, file.dir));
    await this.refresh();
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }
}
