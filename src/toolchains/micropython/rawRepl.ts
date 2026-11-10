/**
 * MicroPython raw REPL over any byte link (no vscode, no Python on the host).
 *
 * Protocol (as in MicroPython's pyboard.py / mpremote):
 * - Ctrl-C twice interrupts a running program; Ctrl-A enters raw REPL, which answers
 *   "raw REPL; CTRL-B to exit\r\n>".
 * - Code is sent as-is, then Ctrl-D. The board answers "OK", then the program's stdout, \x04,
 *   its stderr (traceback), \x04, and ">" when it is ready for the next command.
 * - Ctrl-B returns to the normal (friendly) REPL; Ctrl-D there soft-resets and runs main.py.
 */

export interface ByteLink {
  write(data: Uint8Array | string): void;
  /** Subscribes to incoming bytes; returns an unsubscribe function. */
  onData(cb: (data: Uint8Array) => void): () => void;
}

export class ReplError extends Error {}

/** A traceback from the board (the program raised). */
export class ProgramError extends ReplError {
  constructor(readonly traceback: string) {
    super(lastLine(traceback) || 'The program raised an exception.');
  }
}

export interface ExecOptions {
  /** Program output as it arrives. */
  onStdout?: (text: string) => void;
  /** Aborting sends Ctrl-C; the board then reports KeyboardInterrupt. */
  signal?: AbortSignal;
  /** Limit for the whole command, output included. Omit for programs that run until stopped. */
  timeoutMs?: number;
}

const RAW_PROMPT = 'raw REPL; CTRL-B to exit\r\n>';
/** Bytes per write; boards with small UART buffers drop data on larger writes. */
const CHUNK = 256;
const CHUNK_DELAY_MS = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function lastLine(s: string): string {
  return (
    s
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .pop() ?? ''
  );
}

export class RawRepl {
  private buf = '';
  private readonly decoder = new TextDecoder();
  private waiter?: () => void;
  private readonly unsubscribe: () => void;
  private stream?: (text: string) => void;

  constructor(
    private readonly link: ByteLink,
    private readonly opts: { commandTimeoutMs: number } = { commandTimeoutMs: 10000 },
  ) {
    this.unsubscribe = link.onData((d) => {
      const text = this.decoder.decode(d, { stream: true });
      this.buf += text;
      this.waiter?.();
    });
  }

  close(): void {
    this.unsubscribe();
  }

  /**
   * Waits until `marker` is in the buffer and returns everything before it (consumed).
   * `onText` gets text as it arrives, minus anything that could be the start of the marker.
   */
  private readUntil(marker: string, timeoutMs?: number, onText?: (t: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let streamed = 0;
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              this.waiter = undefined;
              reject(new ReplError(`The board did not respond within ${Math.round(timeoutMs / 1000)} s.`));
            }, timeoutMs)
          : undefined;
      const check = () => {
        const i = this.buf.indexOf(marker);
        if (onText) {
          // Hold back a possible partial marker at the end.
          const safe = i >= 0 ? i : Math.max(streamed, this.buf.length - marker.length + 1);
          if (safe > streamed) {
            onText(this.buf.slice(streamed, safe));
            streamed = safe;
          }
        }
        if (i < 0) return;
        clearTimeout(timer);
        this.waiter = undefined;
        const out = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + marker.length);
        resolve(out);
      };
      this.waiter = check;
      check();
    });
  }

  /** Stops any running program and enters raw REPL. */
  async enter(): Promise<void> {
    this.link.write('\r\x03');
    await sleep(100);
    this.link.write('\x03');
    await sleep(100);
    this.buf = '';
    this.link.write('\r\x01');
    try {
      await this.readUntil(RAW_PROMPT, this.opts.commandTimeoutMs);
    } catch {
      throw new ReplError(
        'The board did not enter raw REPL. Check that it runs MicroPython and nothing else uses the port.',
      );
    }
  }

  /** Returns to the normal REPL. */
  exit(): void {
    this.link.write('\r\x02');
  }

  /** Soft reset from the normal REPL: the board restarts and runs boot.py and main.py. */
  softReset(): void {
    this.link.write('\r\x02\x04');
  }

  /** Stops a running program (KeyboardInterrupt). */
  interrupt(): void {
    this.link.write('\x03');
  }

  /**
   * Runs code in raw REPL (call enter() first). Returns stdout. Throws ProgramError with the
   * traceback if the code raised.
   */
  async exec(code: string, o: ExecOptions = {}): Promise<string> {
    const bytes = new TextEncoder().encode(code);
    for (let i = 0; i < bytes.length; i += CHUNK) {
      this.link.write(bytes.subarray(i, i + CHUNK));
      if (bytes.length > CHUNK) await sleep(CHUNK_DELAY_MS);
    }
    this.link.write('\x04');
    const ack = await this.readUntil('OK', this.opts.commandTimeoutMs).catch(() => {
      throw new ReplError('The board did not accept the command.');
    });
    if (ack.includes('raw REPL') || ack.trim().length > 2)
      throw new ReplError(`Unexpected reply from the board: ${ack.trim().slice(0, 80)}`);
    const onAbort = () => this.interrupt();
    o.signal?.addEventListener('abort', onAbort);
    try {
      const stdout = await this.readUntil('\x04', o.timeoutMs, o.onStdout);
      const stderr = await this.readUntil('\x04', this.opts.commandTimeoutMs);
      await this.readUntil('>', this.opts.commandTimeoutMs);
      if (stderr.trim()) throw new ProgramError(stderr);
      return stdout;
    } finally {
      o.signal?.removeEventListener('abort', onAbort);
    }
  }
}

// ---- Board-side snippets (MicroPython code, kept small: they run on boards with ~100 KB RAM) ----

const py = (s: string) => JSON.stringify(s); // a JSON string is a valid Python string literal

/** Prints "MicroPython v1.24.1 on 2024-11-29; Raspberry Pi Pico with RP2040". */
export const BOARD_INFO = `import sys\ntry:\n import os\n u=os.uname()\n print('%s %s; %s'%(sys.implementation.name,u.release,u.machine))\nexcept Exception:\n print(sys.implementation.name)\n`;

/**
 * Lists every file under `/` (or `root`) as "f <size> <path>" and directories as "d 0 <path>".
 * Uses ilistdir (type 0x4000 = directory).
 */
export function listFilesCode(root = ''): string {
  return `import os
def _w(p):
 for e in os.ilistdir(p or '/'):
  n=p+'/'+e[0]
  if e[1]&0x4000:
   print('d 0',n);_w(n)
  else:
   print('f',e[3] if len(e)>3 else os.stat(n)[6],n)
_w(${py(root)})
`;
}

export interface BoardFile {
  path: string;
  dir: boolean;
  size: number;
}

export function parseFileList(out: string): BoardFile[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^([fd]) (\d+) (.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ path: m[3]!, dir: m[1] === 'd', size: Number(m[2]) }));
}

/** Prints "<sha256 hex> <path>" for each path that exists ("- <path>" for missing ones). */
export function hashFilesCode(paths: string[]): string {
  return `import hashlib,binascii
for p in ${JSON.stringify(paths)}:
 try:
  h=hashlib.sha256()
  with open(p,'rb') as f:
   while 1:
    b=f.read(512)
    if not b:break
    h.update(b)
  print(binascii.hexlify(h.digest()).decode(),p)
 except OSError:
  print('-',p)
`;
}

export function parseHashes(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of out.split(/\r?\n/)) {
    const r = /^([0-9a-f]{64}|-) (.+)$/.exec(l.trim());
    if (r && r[1] !== '-') m.set(r[2]!, r[1]!);
  }
  return m;
}

/** Creates each directory on the way to `dir` (ignores ones that exist). */
export function mkdirsCode(dir: string): string {
  return `import os
p=''
for d in ${py(dir)}.strip('/').split('/'):
 p+='/'+d
 try:
  os.mkdir(p)
 except OSError:
  pass
`;
}

/** Commands that write `data` to `path`: open, then base64 chunks, then close. */
export function putFileCodes(path: string, data: Uint8Array, chunk = 768): string[] {
  const codes = [`import binascii\n_f=open(${py(path)},'wb')\n_w=_f.write\n_d=binascii.a2b_base64\n`];
  for (let i = 0; i < data.length; i += chunk)
    codes.push(`_w(_d(${py(Buffer.from(data.subarray(i, i + chunk)).toString('base64'))}))\n`);
  codes.push('_f.close()\ndel _f,_w,_d\n');
  return codes;
}

/** Prints the file as base64 lines. */
export function getFileCode(path: string): string {
  return `import binascii
with open(${py(path)},'rb') as f:
 while 1:
  b=f.read(384)
  if not b:break
  print(binascii.b2a_base64(b).decode().strip())
`;
}

export function decodeFile(out: string): Uint8Array {
  return Buffer.from(
    out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .join(''),
    'base64',
  );
}

/** Deletes a file, or an empty directory. */
export function removeCode(path: string, dir: boolean): string {
  return `import os\nos.${dir ? 'rmdir' : 'remove'}(${py(path)})\n`;
}
