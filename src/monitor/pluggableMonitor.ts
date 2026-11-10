import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { TIMEOUTS } from '../core/timeouts.js';

/**
 * Client for Arduino's pluggable monitor protocol (used by arduino/serial-monitor).
 * Commands go to the monitor's stdin, one per line; replies come back on stdout as JSON objects
 * (pretty-printed, so they span lines). Port data flows over a TCP connection the monitor makes
 * back to us on 127.0.0.1. No vscode import; no native modules.
 *
 *   HELLO 1 "client"         -> { eventType: "hello", message: "OK", protocolVersion: 1 }
 *   DESCRIBE                 -> { eventType: "describe", port_description: { configuration_parameters } }
 *   CONFIGURE baudrate 9600  -> { eventType: "configure", message: "OK" }
 *   OPEN 127.0.0.1:N <port>  -> monitor connects to N, then { eventType: "open", message: "OK" }
 *   CLOSE / QUIT
 * Unsolicited: { eventType: "port_closed", message } when the port goes away.
 */

export interface MonitorEvent {
  eventType: string;
  message?: string;
  error?: boolean;
  protocolVersion?: number;
  port_description?: {
    protocol?: string;
    configuration_parameters?: Record<string, MonitorParameter>;
  };
}

export interface MonitorParameter {
  label: string;
  type: string;
  value: string[];
  selected: string;
}

/** Splits a stream of concatenated (possibly multi-line) JSON objects into complete objects. */
export class JsonObjectStream {
  private buf = '';

  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    let consumed = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(start, i + 1)));
          } catch {
            // Not JSON after all; skip it.
          }
          consumed = i + 1;
          start = -1;
        }
      }
    }
    this.buf = depth === 0 ? '' : this.buf.slice(consumed);
    return out;
  }
}

export interface MonitorConnection {
  /** Configuration parameters the port supports (baud rates, bits, parity, ...). */
  readonly parameters: Record<string, MonitorParameter>;
  write(data: Uint8Array | string): void;
  /** Changes a setting on the open port, e.g. configure('baudrate', '115200'). */
  configure(param: string, value: string): Promise<void>;
  close(): Promise<void>;
  onData(cb: (data: Buffer) => void): void;
  /** Called once if the connection ends without close(): port unplugged, monitor crashed, etc. */
  onLost(cb: (reason: string) => void): void;
}

export interface OpenOptions {
  /** Port settings applied before opening, e.g. { baudrate: '115200' }. */
  settings?: Record<string, string>;
  commandTimeoutMs?: number;
  openTimeoutMs?: number;
  /** For tests: how to start the monitor program. */
  spawnMonitor?: () => ChildProcess;
}

export class MonitorError extends Error {}

/** Starts the monitor program, opens `port`, and returns a live connection. Always time-limited. */
export async function openPluggableMonitor(
  bin: string,
  port: string,
  opts: OpenOptions = {},
): Promise<MonitorConnection> {
  const commandMs = opts.commandTimeoutMs ?? TIMEOUTS.monitorCommandMs;
  const openMs = opts.openTimeoutMs ?? TIMEOUTS.monitorOpenMs;
  const child = opts.spawnMonitor
    ? opts.spawnMonitor()
    : spawn(bin, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  const events = new JsonObjectStream();
  const waiters: { type: string; resolve: (e: MonitorEvent) => void }[] = [];
  let lostCb: ((reason: string) => void) | undefined;
  let dataCb: ((d: Buffer) => void) | undefined;
  let closing = false;
  let lostReported = false;
  let socket: net.Socket | undefined;
  let stderr = '';

  const lost = (reason: string) => {
    if (closing || lostReported) return;
    lostReported = true;
    lostCb?.(reason);
  };

  child.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-2000)));
  child.stdout?.setEncoding('utf8').on('data', (d: string) => {
    for (const raw of events.push(d)) {
      const e = raw as MonitorEvent;
      if (e.eventType === 'port_closed') {
        lost(e.message || 'The port was closed.');
        continue;
      }
      const i = waiters.findIndex((w) => w.type === e.eventType);
      if (i >= 0) waiters.splice(i, 1)[0]!.resolve(e);
    }
  });
  const exited = new Promise<string>((resolve) => {
    child.on('error', (err) => resolve(`Could not start the serial monitor: ${err.message}`));
    child.on('exit', (code) =>
      resolve(`The serial monitor stopped (exit ${code ?? 'signal'}). ${stderr.trim()}`.trim()),
    );
  });
  void exited.then((why) => lost(why));

  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, TIMEOUTS.killGraceMs).unref();
  };

  const request = (command: string, type: string, ms = commandMs): Promise<MonitorEvent> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        reject(
          new MonitorError(
            `The serial monitor didn't answer "${command.split(' ')[0]}" within ${Math.round(ms / 1000)} s.`,
          ),
        );
      }, ms);
      const waiter = {
        type,
        resolve: (e: MonitorEvent) => {
          clearTimeout(timer);
          if (e.error) reject(new MonitorError(e.message || `${command.split(' ')[0]} failed.`));
          else resolve(e);
        },
      };
      waiters.push(waiter);
      void exited.then((why) => {
        clearTimeout(timer);
        reject(new MonitorError(why));
      });
      child.stdin?.write(`${command}\n`);
    });

  const server = net.createServer();
  try {
    await request('HELLO 1 "integrated-workbench"', 'hello');
    const described = await request('DESCRIBE', 'describe');
    const parameters = described.port_description?.configuration_parameters ?? {};
    for (const [k, v] of Object.entries(opts.settings ?? {}))
      await request(`CONFIGURE ${k} ${v}`, 'configure');

    // Only the monitor should connect, only once, only from this machine.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as net.AddressInfo;
    const connected = new Promise<net.Socket>((resolve) => {
      server.once('connection', (s) => {
        server.on('connection', (extra) => extra.destroy());
        resolve(s);
      });
    });
    const [s] = await Promise.all([
      Promise.race([
        connected,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new MonitorError(`Couldn't open ${port} within ${Math.round(openMs / 1000)} s.`)),
            openMs,
          ),
        ),
      ]),
      request(`OPEN 127.0.0.1:${address.port} ${port}`, 'open', openMs),
    ]);
    socket = s;
    socket.on('data', (d) => dataCb?.(d));
    socket.on('close', () => lost('The connection to the port closed.'));
    socket.on('error', (err) => lost(err.message));

    return {
      parameters,
      write: (data) => socket?.write(data),
      configure: async (param, value) => {
        await request(`CONFIGURE ${param} ${value}`, 'configure');
      },
      onData: (cb) => (dataCb = cb),
      onLost: (cb) => (lostCb = cb),
      close: async () => {
        closing = true;
        await request('CLOSE', 'close').catch(() => undefined);
        await request('QUIT', 'quit').catch(() => undefined);
        socket?.destroy();
        server.close();
        kill();
      },
    };
  } catch (err) {
    closing = true;
    socket?.destroy();
    server.close();
    kill();
    throw err instanceof MonitorError
      ? err
      : new MonitorError(err instanceof Error ? err.message : String(err));
  }
}
