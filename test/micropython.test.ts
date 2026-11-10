import { describe, expect, it } from 'vitest';
import { filesToUpload, MicroPythonBoard, sha256 } from '../src/toolchains/micropython/board.js';
import { ProgramError, RawRepl, parseFileList, parseHashes } from '../src/toolchains/micropython/rawRepl.js';
import {
  MicroPythonToolchain,
  projectFiles,
  tracebackLocation,
} from '../src/toolchains/micropython/index.js';
import { FakeBoard } from './fixtures/micropython/fakeBoard.js';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('raw REPL', () => {
  it('enters raw REPL, runs code, returns stdout, and goes back to the normal REPL', async () => {
    const dev = new FakeBoard();
    const repl = new RawRepl(dev);
    await repl.enter();
    expect(dev.mode).toBe('raw');
    expect(await repl.exec('print("hello")\nprint("world")\n')).toBe('hello\r\nworld\r\n');
    repl.exit();
    expect(dev.mode).toBe('friendly');
    expect(dev.written.startsWith('\r\x03')).toBe(true); // interrupts whatever was running first
  });

  it('reports a traceback as ProgramError with the last line as the message', async () => {
    const repl = new RawRepl(new FakeBoard());
    await repl.enter();
    const err = await repl.exec('print("before")\nraise ValueError("bad value")\n').catch((e) => e);
    expect(err).toBeInstanceOf(ProgramError);
    expect(err.message).toBe('ValueError: bad value');
    expect((err as ProgramError).traceback).toContain('line 2');
  });

  it('streams output and stops a running program with Ctrl-C', async () => {
    const repl = new RawRepl(new FakeBoard());
    await repl.enter();
    const abort = new AbortController();
    let seen = '';
    const run = repl
      .exec('n=0\nwhile True:\n print(n)\n', {
        signal: abort.signal,
        onStdout: (t) => {
          seen += t;
          if (seen.includes('tick 3')) abort.abort();
        },
      })
      .catch((e) => e);
    const err = await run;
    expect(seen).toMatch(/tick 0\r\ntick 1\r\ntick 2\r\n/);
    expect(seen).not.toContain('\x04');
    expect(err).toBeInstanceOf(ProgramError);
    expect(err.message).toContain('KeyboardInterrupt');
  });

  it('gives up on a board that never answers', async () => {
    const silent = { write: () => undefined, onData: () => () => undefined };
    const repl = new RawRepl(silent, { commandTimeoutMs: 50 });
    await expect(repl.enter()).rejects.toThrow(/did not enter raw REPL/);
  });
});

describe('MicroPython board', () => {
  it('reads board info', async () => {
    expect(await new MicroPythonBoard(new FakeBoard()).info()).toBe('micropython 1.24.1; Fake Board');
  });

  it('uploads only changed files, creating folders, and never deletes', async () => {
    const dev = new FakeBoard();
    dev.files.set('/main.py', Buffer.from('print("old")\n'));
    dev.files.set('/data.log', Buffer.from('keep me'));
    dev.files.set('/lib/util.py', Buffer.from('X=1\n'));
    const board = new MicroPythonBoard(dev);
    const big = bytes('# ' + 'x'.repeat(5000) + '\n'); // several chunks
    const res = await board.sync([
      { boardPath: '/main.py', data: bytes('print("new")\n') },
      { boardPath: '/lib/util.py', data: bytes('X=1\n') },
      { boardPath: '/lib/sensors/bme.py', data: big },
    ]);
    expect(res.uploaded).toEqual(['/main.py', '/lib/sensors/bme.py']);
    expect(res.unchanged).toEqual(['/lib/util.py']);
    expect(dev.files.get('/main.py')!.toString()).toBe('print("new")\n');
    expect(Buffer.compare(dev.files.get('/lib/sensors/bme.py')!, Buffer.from(big))).toBe(0);
    expect(dev.dirs).toContain('/lib/sensors');
    expect(dev.files.get('/data.log')!.toString()).toBe('keep me');
    expect(dev.mode).toBe('friendly');
  });

  it('lists, reads and removes files', async () => {
    const dev = new FakeBoard();
    dev.dirs.add('/lib');
    dev.files.set('/main.py', Buffer.from('print(1)\n'));
    const board = new MicroPythonBoard(dev);
    expect(await board.list()).toEqual([
      { path: '/lib', dir: true, size: 0 },
      { path: '/main.py', dir: false, size: 9 },
    ]);
    expect(new TextDecoder().decode(await board.read('/main.py'))).toBe('print(1)\n');
    await board.remove('/main.py', false);
    expect(dev.files.has('/main.py')).toBe(false);
  });
});

describe('MicroPython parsers', () => {
  it('file list and hashes', () => {
    expect(parseFileList('d 0 /lib\r\nf 12 /lib/a b.py\r\njunk\r\n')).toEqual([
      { path: '/lib', dir: true, size: 0 },
      { path: '/lib/a b.py', dir: false, size: 12 },
    ]);
    const h = 'a'.repeat(64);
    expect([...parseHashes(`${h} /main.py\r\n- /missing.py\r\n`)]).toEqual([['/main.py', h]]);
  });

  it('decides what to upload by content', () => {
    const a = { boardPath: '/a.py', data: bytes('1') };
    const b = { boardPath: '/b.py', data: bytes('2') };
    expect(filesToUpload([a, b], new Map([['/a.py', sha256(bytes('1'))]]))).toEqual([b]);
  });
});

describe('MicroPython projects', () => {
  const tc = (dirs: Record<string, string[]>, marked: string[] = []) =>
    new MicroPythonToolchain({
      host: { readdir: async (p: string) => dirs[p] ?? [] },
      workspaceRoots: () => ['/w'],
      isMarked: (root) => marked.includes(root),
      serialMonitorPath: () => undefined,
      ports: () => [
        { path: '/dev/cu.usbmodem1101', vid: '2e8a', pid: '0005' },
        { path: '/dev/cu.Bluetooth-Incoming-Port' },
      ],
    });

  it('a folder with boot.py is a project, from any file inside it', async () => {
    const t = tc({ '/w/pico': ['boot.py', 'main.py', 'lib'], '/w/pico/lib': ['util.py'] });
    expect(await t.findProject('/w/pico/main.py')).toEqual({
      root: '/w/pico',
      name: 'pico',
      kind: 'micropython',
    });
    expect(await t.findProject('/w/pico/lib/util.py')).toMatchObject({ root: '/w/pico' });
  });

  it('main.py alone is not enough; a marked folder is', async () => {
    const dirs = { '/w/app': ['main.py'] };
    expect(await tc(dirs).findProject('/w/app/main.py')).toBeUndefined();
    expect(await tc(dirs, ['/w/app']).findProject('/w/app/main.py')).toMatchObject({ kind: 'micropython' });
  });

  it('does not look above the workspace folder', async () => {
    expect(await tc({ '/': ['boot.py'] }).findProject('/w/x/y.py')).toBeUndefined();
  });

  it('lists USB serial ports as boards and needs the serial tool', async () => {
    const t = tc({});
    expect((await t.listBoards()).map((b) => b.port)).toEqual(['/dev/cu.usbmodem1101']);
    expect((await t.checkInstalled()).installed).toBe(false);
  });

  it('maps a traceback to the line in the file', () => {
    expect(
      tracebackLocation(
        'Traceback (most recent call last):\r\n  File "<stdin>", line 7, in <module>\r\n  File "<stdin>", line 3, in f\r\nZeroDivisionError: divide by zero\r\n',
      ),
    ).toEqual({ line: 3, message: 'ZeroDivisionError: divide by zero' });
    expect(tracebackLocation('KeyboardInterrupt')).toBeUndefined();
  });
});

describe('project files for the board', () => {
  it('skips hidden files, caches and stubs; keeps folders', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'iw-mp-'));
    for (const d of ['lib', '.vscode', '__pycache__', 'typings']) await mkdir(join(root, d));
    await writeFile(join(root, 'main.py'), 'print(1)\n');
    await writeFile(join(root, 'boot.py'), '');
    await writeFile(join(root, 'lib', 'util.py'), 'X=1\n');
    await writeFile(join(root, 'lib', 'util.pyi'), 'X: int\n');
    await writeFile(join(root, '.vscode', 'settings.json'), '{}');
    await writeFile(join(root, '__pycache__', 'x.pyc'), '');
    await writeFile(join(root, 'typings', 'machine.pyi'), '');
    expect((await projectFiles(root)).map((f) => f.boardPath)).toEqual([
      '/boot.py',
      '/lib/util.py',
      '/main.py',
    ]);
  });
});
