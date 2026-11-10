import { createHash } from 'node:crypto';
import type { ByteLink } from '../../../src/toolchains/micropython/rawRepl.js';

/**
 * A pretend MicroPython board for tests. It speaks the real raw REPL framing (Ctrl-A, Ctrl-D,
 * "OK", \x04 separators, ">", Ctrl-B, Ctrl-C) and replies in small random chunks, like a UART.
 * It does not run Python: it recognizes the snippets Integrated Workbench sends and keeps an
 * in-memory filesystem. (Synthesized, not captured from a board.)
 */
export class FakeBoard implements ByteLink {
  files = new Map<string, Buffer>();
  dirs = new Set<string>();
  mode: 'friendly' | 'raw' = 'friendly';
  private pending = '';
  private listeners = new Set<(d: Uint8Array) => void>();
  private running?: () => void;
  private openPath?: string;
  /** Everything the host wrote, for assertions. */
  written = '';
  softResets = 0;

  onData(cb: (d: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(s: string): void {
    // Split into random small chunks, delivered asynchronously.
    let i = 0;
    while (i < s.length) {
      const n = 1 + Math.floor(Math.random() * 7);
      const part = Buffer.from(s.slice(i, i + n));
      i += n;
      setImmediate(() => this.listeners.forEach((l) => l(part)));
    }
  }

  write(data: Uint8Array | string): void {
    const s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    this.written += s;
    for (const c of s) this.char(c);
  }

  private char(c: string): void {
    if (c === '\x03') {
      if (this.running) {
        const stop = this.running;
        this.running = undefined;
        stop();
      }
      this.pending = '';
      return;
    }
    if (this.mode === 'friendly') {
      if (c === '\x01') {
        this.mode = 'raw';
        this.pending = '';
        this.emit('raw REPL; CTRL-B to exit\r\n>');
      } else if (c === '\x04') {
        this.softResets++;
        this.emit('MPY: soft reboot\r\nMicroPython v1.24.1 on 2024-11-29; Fake Board\r\n>>> ');
      }
      return;
    }
    // raw mode
    if (c === '\x02') {
      this.mode = 'friendly';
      this.emit('\r\nMicroPython v1.24.1 on 2024-11-29; Fake Board\r\nType "help()" for more information.\r\n>>> ');
      return;
    }
    if (c === '\x01') {
      this.pending = '';
      this.emit('raw REPL; CTRL-B to exit\r\n>');
      return;
    }
    if (c === '\x04') {
      const code = this.pending;
      this.pending = '';
      this.emit('OK');
      this.execute(code);
      return;
    }
    this.pending += c;
  }

  private finish(stdout: string, stderr = ''): void {
    this.emit(`${stdout}\x04${stderr}\x04>`);
  }

  private execute(code: string): void {
    const str = (re: RegExp) => JSON.parse(re.exec(code)![1]!) as string;
    if (code.includes('sys.implementation')) return this.finish('micropython 1.24.1; Fake Board\r\n');
    if (code.includes('def _w(p)')) {
      const lines = [...this.dirs].map((d) => `d 0 ${d}`);
      for (const [p, b] of this.files) lines.push(`f ${b.length} ${p}`);
      return this.finish(lines.map((l) => l + '\r\n').join(''));
    }
    if (code.includes('hashlib.sha256')) {
      const paths = JSON.parse(/for p in (\[.*\]):/.exec(code)![1]!) as string[];
      const out = paths.map((p) => {
        const b = this.files.get(p);
        return b ? `${createHash('sha256').update(b).digest('hex')} ${p}` : `- ${p}`;
      });
      return this.finish(out.map((l) => l + '\r\n').join(''));
    }
    if (code.includes('os.mkdir(p)')) {
      let p = '';
      for (const d of str(/for d in ("[^"]*")/).replace(/^\/+|\/+$/g, '').split('/')) {
        p += '/' + d;
        this.dirs.add(p);
      }
      return this.finish('');
    }
    if (code.includes('_f=open(')) {
      this.openPath = str(/_f=open\(("[^"]*")/);
      this.files.set(this.openPath, Buffer.alloc(0));
      return this.finish('');
    }
    if (code.startsWith('_w(_d(')) {
      const chunk = Buffer.from(str(/_w\(_d\(("[^"]*")/), 'base64');
      this.files.set(this.openPath!, Buffer.concat([this.files.get(this.openPath!)!, chunk]));
      return this.finish('');
    }
    if (code.startsWith('_f.close()')) return this.finish('');
    if (code.includes('b2a_base64')) {
      const b = this.files.get(str(/open\(("[^"]*"),'rb'\)/));
      if (!b) return this.finish('', 'Traceback (most recent call last):\r\nOSError: [Errno 2] ENOENT\r\n');
      const lines: string[] = [];
      for (let i = 0; i < b.length; i += 384) lines.push(b.subarray(i, i + 384).toString('base64'));
      return this.finish(lines.map((l) => l + '\n').join(''));
    }
    if (code.includes('os.remove(') || code.includes('os.rmdir(')) {
      const p = str(/os\.(?:remove|rmdir)\(("[^"]*")\)/);
      this.files.delete(p);
      this.dirs.delete(p);
      return this.finish('');
    }
    if (code.includes('while True')) {
      // Prints until stopped with Ctrl-C.
      let n = 0;
      const timer = setInterval(() => this.emit(`tick ${n++}\r\n`), 5);
      this.running = () => {
        clearInterval(timer);
        this.finish(
          '',
          'Traceback (most recent call last):\r\n  File "<stdin>", line 3, in <module>\r\nKeyboardInterrupt: \r\n',
        );
      };
      return;
    }
    if (code.includes('raise')) {
      return this.finish(
        'before\r\n',
        'Traceback (most recent call last):\r\n  File "<stdin>", line 2, in <module>\r\nValueError: bad value\r\n',
      );
    }
    const prints = [...code.matchAll(/print\("([^"]*)"\)/g)].map((m) => m[1] + '\r\n');
    return this.finish(prints.join(''));
  }
}
