import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { TIMEOUTS } from '../core/timeouts.js';
import type { RegistryService } from '../registryService.js';
import type { Session } from '../session.js';
import { text } from '../text.js';
import { toolBinPath } from '../tools.js';
import { openPluggableMonitor, type MonitorConnection } from './pluggableMonitor.js';

export type MonitorStatus = 'idle' | 'connecting' | 'connected' | 'paused' | 'reconnecting' | 'error';
export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf';

export interface MonitorState {
  status: MonitorStatus;
  port?: string;
  baud: string;
  bauds: string[];
  lineEnding: LineEnding;
  /** Status detail or error, shown in the toolbar. */
  message?: string;
  /** Is the Serial Monitor Engine (serial-monitor tool) installed? */
  engineReady: boolean;
}

const BAUD_KEY = 'integratedWorkbench.monitor.baud';
const ENDING_KEY = 'integratedWorkbench.monitor.lineEnding';
const DEFAULT_BAUDS = [
  '300',
  '1200',
  '2400',
  '4800',
  '9600',
  '19200',
  '38400',
  '57600',
  '74880',
  '115200',
  '230400',
  '250000',
  '460800',
  '500000',
  '921600',
  '1000000',
  '2000000',
];
const ENDINGS: Record<LineEnding, string> = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' };
const MAX_LOG = 5 * 1024 * 1024;

/**
 * Owns the serial connection: connect/disconnect, send, live baud changes, releasing the port for
 * uploads, and reconnecting when a board comes back. The panel view only renders and forwards input.
 */
export class MonitorController implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<MonitorState>();
  readonly onDidChange = this.changed.event;
  private readonly dataEmitter = new vscode.EventEmitter<Buffer>();
  /** Raw bytes as they arrive. */
  readonly onData = this.dataEmitter.event;

  private conn?: MonitorConnection;
  /** The user wants to be connected (so reconnect after uploads and unplugs). */
  private wanted = false;
  private reconnectTimer?: NodeJS.Timeout;
  private log = '';
  private readonly decoder = new TextDecoder();
  state: MonitorState;

  constructor(
    private readonly registry: RegistryService,
    private readonly toolsDir: string,
    private readonly session: Session,
    private readonly memento: vscode.Memento,
    private readonly output: vscode.OutputChannel,
  ) {
    this.state = {
      status: 'idle',
      baud: this.savedBaud(),
      bauds: DEFAULT_BAUDS,
      lineEnding: memento.get<LineEnding>(ENDING_KEY, 'lf'),
      engineReady: !!this.bin(),
    };
  }

  private set(patch: Partial<MonitorState>): void {
    this.state = { ...this.state, ...patch, engineReady: !!this.bin() };
    this.changed.fire(this.state);
  }

  /** Re-check whether the engine is installed (after Boards and Tools installs it). */
  refresh(): void {
    this.set({});
  }

  private bin(): string | undefined {
    const pkg = this.registry.toolProviding('serial-monitor');
    const path = pkg ? toolBinPath(this.toolsDir, pkg) : undefined;
    return path && existsSync(path) ? path : undefined;
  }

  get engineId(): string | undefined {
    return this.registry.toolProviding('serial-monitor')?.id;
  }

  private savedBaud(): string {
    const root = this.session.project?.root;
    const saved = root ? this.memento.get<Record<string, string>>(BAUD_KEY, {})[root] : undefined;
    const recipe = this.registry.registry.recipes.find((r) => r.id === 'arduino')?.monitor?.baud;
    return saved ?? String(recipe ?? 9600);
  }

  /** Connects to the sketch's selected port (or `port`). */
  async connect(port = this.session.port): Promise<void> {
    this.wanted = true;
    clearTimeout(this.reconnectTimer);
    const bin = this.bin();
    if (!bin) {
      this.set({ status: 'error', message: text.monitor.engineMissing });
      return;
    }
    if (!port) {
      this.set({ status: 'error', message: text.monitor.noPort });
      return;
    }
    if (this.conn) await this.closeConn();
    const baud = this.savedBaud();
    this.set({ status: 'connecting', port, baud, message: undefined });
    try {
      const conn = await openPluggableMonitor(bin, port, { settings: { baudrate: baud } });
      if (!this.wanted) {
        await conn.close();
        return;
      }
      this.conn = conn;
      const bauds = conn.parameters['baudrate']?.value;
      conn.onData((d) => this.receive(d));
      conn.onLost((reason) => void this.onLost(reason));
      this.set({ status: 'connected', bauds: bauds?.length ? bauds : DEFAULT_BAUDS, message: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[monitor] ${port}: ${message}`);
      this.set({ status: 'error', message });
    }
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    clearTimeout(this.reconnectTimer);
    await this.closeConn();
    this.set({ status: 'idle', message: undefined });
  }

  private async closeConn(): Promise<void> {
    const c = this.conn;
    this.conn = undefined;
    await c?.close();
  }

  private receive(d: Buffer): void {
    this.log += this.decoder.decode(d, { stream: true });
    if (this.log.length > MAX_LOG) this.log = this.log.slice(-MAX_LOG / 2);
    this.dataEmitter.fire(d);
  }

  send(textToSend: string): void {
    if (!this.conn) return;
    this.conn.write(textToSend + ENDINGS[this.state.lineEnding]);
  }

  async setBaud(baud: string): Promise<void> {
    const root = this.session.project?.root;
    if (root)
      await this.memento.update(BAUD_KEY, {
        ...this.memento.get<Record<string, string>>(BAUD_KEY, {}),
        [root]: baud,
      });
    this.set({ baud });
    if (this.conn) {
      try {
        await this.conn.configure('baudrate', baud); // live, no reconnect
      } catch (err) {
        this.set({ message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async setLineEnding(ending: LineEnding): Promise<void> {
    await this.memento.update(ENDING_KEY, ending);
    this.set({ lineEnding: ending });
  }

  clearLog(): void {
    this.log = '';
  }

  async saveLog(): Promise<void> {
    const name = `${this.session.project?.name ?? 'serial'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
      filters: { [text.monitor.logFiles]: ['log', 'txt'] },
    });
    if (uri) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(this.log));
  }

  /** Upload hook: release the port so the uploader can use it. */
  async pauseForUpload(port: string): Promise<void> {
    if (!this.conn || this.state.port !== port) return;
    clearTimeout(this.reconnectTimer);
    await this.closeConn();
    this.set({ status: 'paused', message: text.monitor.pausedForUpload });
  }

  /** Upload hook: reconnect once the board is back (it often resets and re-enumerates). */
  async resumeAfterUpload(): Promise<void> {
    if (this.state.status === 'paused' && this.wanted) this.scheduleReconnect();
  }

  private async onLost(reason: string): Promise<void> {
    this.conn = undefined;
    this.output.appendLine(`[monitor] ${this.state.port}: ${reason}`);
    if (!this.wanted) return;
    this.set({ status: 'reconnecting', message: text.monitor.waitingForPort });
    this.scheduleReconnect();
  }

  /** Tries every second until the port is back or the time limit passes. */
  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    const port = this.state.port;
    const deadline = Date.now() + TIMEOUTS.monitorReconnectMs;
    this.set({ status: 'reconnecting', message: text.monitor.waitingForPort });
    const attempt = async () => {
      if (!this.wanted || !port) return;
      if (Date.now() > deadline) {
        this.set({ status: 'error', message: text.monitor.portGone(port) });
        return;
      }
      if (this.session.boards.some((b) => b.port === port)) {
        await this.connect(port);
        if (this.state.status === 'connected') return;
      }
      this.reconnectTimer = setTimeout(() => void attempt(), 1000);
    };
    this.reconnectTimer = setTimeout(() => void attempt(), 1000);
  }

  dispose(): void {
    this.wanted = false;
    clearTimeout(this.reconnectTimer);
    void this.closeConn();
    this.changed.dispose();
    this.dataEmitter.dispose();
  }
}
