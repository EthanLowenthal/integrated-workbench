import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeHost, runWithTimeout } from '../src/core/probes/host.js';
import type { ToolPackage } from '../src/registry/types.js';
import { ArduinoToolchain } from '../src/toolchains/arduino/index.js';
import type { StreamRunner } from '../src/toolchains/process.js';
import { installTool, type Fetcher } from '../src/tools.js';
import { fakeHost, ok } from './helpers.js';

const unix = process.platform !== 'win32';

describe('runWithTimeout', () => {
  it.skipIf(!unix)('stops a hung program at its limit and says so', async () => {
    const t0 = Date.now();
    const r = await runWithTimeout('sleep', ['30'], { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ code: null, timedOut: true });
    expect(r.stderr).toMatch(/time limit/);
  });

  it.skipIf(!unix)('resolves on time even if the program ignores SIGTERM (then force-kills it)', async () => {
    const t0 = Date.now();
    const r = await runWithTimeout('sh', ['-c', 'trap "" TERM; sleep 30'], { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.timedOut).toBe(true);
  });

  it.skipIf(!unix)('cancels promptly on abort', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    const r = await runWithTimeout('sleep', ['30'], { timeoutMs: 60_000, signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ code: null });
    expect(r.timedOut).toBeUndefined();
  });

  it('a missing program fails fast, not as a timeout', async () => {
    const r = await runWithTimeout('definitely-not-a-real-program-xyz', [], { timeoutMs: 5000 });
    expect(r.code).toBeNull();
    expect(r.timedOut).toBeUndefined();
  });

  it.skipIf(!unix)('normal programs are unaffected', async () => {
    expect(await nodeHost.run('echo', ['hi'])).toMatchObject({ code: 0, stdout: 'hi\n' });
  });
});

describe('download limits', () => {
  let dir: string;
  afterEach(() => dir && execFileSync('rm', ['-rf', dir]));

  const pkg: ToolPackage = {
    id: 'x',
    kind: 'tool',
    name: 'X',
    version: '1',
    provides: ['x'],
    downloads: {
      [`${process.platform}-${process.arch}`]: { url: 'https://e.test/x', sha256: '0'.repeat(64), bin: 'x' },
    },
  };

  it('gives up when the server stops sending data', async () => {
    dir = mkdtempSync(join(tmpdir(), 'iw-dl-'));
    // A body that sends one chunk and then never finishes.
    const stalled: Fetcher = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1, 2, 3]));
          },
        }),
      );
    const t0 = Date.now();
    await expect(
      installTool({ storageDir: dir, pkg, host: nodeHost, fetch: stalled, stallMs: 200, totalMs: 60_000 }),
    ).rejects.toThrow(/No data received/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('gives up when the whole download takes too long', async () => {
    dir = mkdtempSync(join(tmpdir(), 'iw-dl-'));
    // Keeps trickling bytes (never stalls) but never ends.
    const trickle: Fetcher = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            const t = setInterval(() => c.enqueue(new Uint8Array([0])), 20);
            setTimeout(() => clearInterval(t), 5000);
          },
        }),
      );
    await expect(
      installTool({ storageDir: dir, pkg, host: nodeHost, fetch: trickle, stallMs: 1000, totalMs: 300 }),
    ).rejects.toThrow(/took longer than/);
  });
});

describe('arduino-cli time limits', () => {
  it('every long-running command passes a time limit, and a timed-out compile says so', async () => {
    const limits: Record<string, number> = {};
    const stream: StreamRunner = async (_f, args, opts) => {
      limits[args[0] === 'core' ? `${args[0]} ${args[1]}` : args[0]!] = opts.timeoutMs;
      return args[0] === 'compile'
        ? { code: null, stdout: '', stderr: 'Stopped', timedOut: true }
        : { code: 0, stdout: '', stderr: '' };
    };
    const tc = new ArduinoToolchain({
      host: fakeHost({ run: () => ok('{"VersionString":"1.5.1"}') }),
      buildRoot: '/b',
      stream,
    });
    const project = { root: '/s/Blink', name: 'Blink' };
    const target = { id: 'arduino:avr:uno', name: 'Uno' };
    const res = await tc.build({ project, target, onOutput: () => {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Stopped after 15 min \(time limit\)/);
    await tc.flash({ project, target, port: 'COM5', onOutput: () => {} });
    await tc.installCore('arduino:avr', () => {});
    await tc.uninstallCore('arduino:avr', () => {});
    await tc.updateIndex();
    for (const k of ['compile', 'upload', 'core update-index', 'core install', 'core uninstall']) {
      expect(limits[k], k).toBeGreaterThan(0);
    }
  });
});
