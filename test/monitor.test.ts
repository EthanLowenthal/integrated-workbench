import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JsonObjectStream, openPluggableMonitor } from '../src/monitor/pluggableMonitor.js';
import { fixture } from './helpers.js';

const fake = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'monitor', 'fake-monitor.mjs');
const start =
  (env: Record<string, string> = {}) =>
  () =>
    spawn(process.execPath, [fake], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });

/** Collects incoming data until `pattern` shows up (or fails after 3 s). */
function collector() {
  let text = '';
  const waits: { re: RegExp; resolve: () => void }[] = [];
  return {
    push(d: Buffer) {
      text += d.toString();
      for (const w of [...waits]) {
        if (!w.re.test(text)) continue;
        waits.splice(waits.indexOf(w), 1);
        w.resolve();
      }
    },
    until(re: RegExp) {
      if (re.test(text)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waits.push({ re, resolve });
        setTimeout(() => reject(new Error(`no ${re} in ${JSON.stringify(text)}`)), 3000);
      });
    },
  };
}

describe('JsonObjectStream', () => {
  it('splits the real serial-monitor session (pretty-printed JSON) into events', () => {
    const events = new JsonObjectStream().push(fixture('monitor/serial-monitor-0.15.0-session.real.txt')) as {
      eventType: string;
      port_description?: { configuration_parameters: Record<string, { value: string[]; selected: string }> };
    }[];
    expect(events.map((e) => e.eventType)).toEqual(['hello', 'describe', 'quit']);
    const baud = events[1]!.port_description!.configuration_parameters['baudrate']!;
    expect(baud.value).toContain('115200');
    expect(baud.selected).toBe('9600');
  });

  it('handles objects split across chunks, braces inside strings, and junk between objects', () => {
    const s = new JsonObjectStream();
    expect(s.push('{"a": "x}{y", ')).toEqual([]);
    expect(s.push('"b": {"c": 1}}\nnoise {"d"')).toEqual([{ a: 'x}{y', b: { c: 1 } }]);
    expect(s.push(': 2}')).toEqual([{ d: 2 }]);
  });
});

describe('openPluggableMonitor', () => {
  it('opens a port with settings, receives data, sends data, changes baud live, closes', async () => {
    const conn = await openPluggableMonitor('unused', '/dev/board', {
      settings: { baudrate: '115200' },
      spawnMonitor: start(),
    });
    const rx = collector();
    conn.onData((d) => rx.push(d));
    expect(conn.parameters['baudrate']?.value).toEqual(['9600', '115200']);
    await rx.until(/hello from \/dev\/board at 115200/);
    conn.write('ping\n');
    await rx.until(/echo:PING/);
    await conn.configure('baudrate', '9600');
    await rx.until(/baud=9600/);
    let lost = false;
    conn.onLost(() => (lost = true));
    await conn.close();
    expect(lost).toBe(false); // closing on purpose isn't "lost"
  });

  it('reports a lost port (unplugged) once', async () => {
    const conn = await openPluggableMonitor('unused', '/dev/vanish', { spawnMonitor: start() });
    const reasons: string[] = [];
    await new Promise<void>((resolve) => conn.onLost((r) => (reasons.push(r), resolve())));
    expect(reasons[0]).toMatch(/disappeared/);
    await new Promise((r) => setTimeout(r, 300));
    expect(reasons).toHaveLength(1);
    await conn.close();
  });

  it('surfaces the monitor error when the port cannot be opened', async () => {
    await expect(openPluggableMonitor('unused', '/dev/fail', { spawnMonitor: start() })).rejects.toThrow(
      /Invalid serial port/,
    );
  });

  it('gives up on a monitor that never answers', async () => {
    const t0 = Date.now();
    await expect(
      openPluggableMonitor('unused', '/dev/board', {
        spawnMonitor: start({ FAKE_SILENT: '1' }),
        commandTimeoutMs: 300,
      }),
    ).rejects.toThrow(/didn't answer "HELLO" within/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('reports a monitor program that cannot start', async () => {
    await expect(openPluggableMonitor('/definitely/not/here/serial-monitor', '/dev/board')).rejects.toThrow(
      /Could not start|stopped/,
    );
  });
});
