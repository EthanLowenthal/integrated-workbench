import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/types.js';
import { diffSnapshots, watchForDevice } from '../src/core/watch.js';
import { snapshot } from './helpers.js';

const base = snapshot({
  os: 'windows',
  usb: [{ vid: '046d', pid: 'c52b', location: 'mouse', driverStatus: 'ok' }],
  ports: [{ path: 'COM1' }],
});
const withBoard: Snapshot = {
  ...base,
  usb: [...base.usb, { vid: '1a86', pid: '7523', location: 'ch340', driverStatus: 'ok' }],
  ports: [...base.ports, { path: 'COM5', vid: '1a86', pid: '7523', usbLocation: 'ch340' }],
};

describe('diffSnapshots', () => {
  it('finds added and removed devices and ports', () => {
    const d = diffSnapshots(base, withBoard);
    expect(d.addedDevices.map((x) => x.location)).toEqual(['ch340']);
    expect(d.addedPorts.map((x) => x.path)).toEqual(['COM5']);
    expect(diffSnapshots(withBoard, base).removedPorts.map((x) => x.path)).toEqual(['COM5']);
  });

  it('a same-model board in a different USB port counts as new', () => {
    const other: Snapshot = {
      ...withBoard,
      usb: [...base.usb, { ...withBoard.usb[1]!, location: 'ch340-port2' }],
    };
    expect(diffSnapshots(withBoard, other).addedDevices).toHaveLength(1);
  });
});

describe('watchForDevice', () => {
  function clock() {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  }

  it('times out when nothing is plugged in', async () => {
    const c = clock();
    const r = await watchForDevice(async () => base, base, { timeoutMs: 5_000, intervalMs: 1_000, ...c });
    expect(r.timedOut).toBe(true);
    expect(r.diff.addedDevices).toEqual([]);
    expect(c.now()).toBe(5_000);
  });

  it('waits for the port to settle after the device appears', async () => {
    const c = clock();
    // t=1s: device only (driver still loading). t>=2s: device + port.
    const take = async () => (c.now() < 2_000 ? { ...withBoard, ports: base.ports } : withBoard);
    const r = await watchForDevice(take, base, { intervalMs: 1_000, settleMs: 2_000, ...c });
    expect(r.timedOut).toBe(false);
    expect(r.diff.addedDevices).toHaveLength(1);
    expect(r.diff.addedPorts.map((p) => p.path)).toEqual(['COM5']);
  });

  it('stops when aborted', async () => {
    const ac = new AbortController();
    const c = clock();
    let n = 0;
    const r = await watchForDevice(
      async () => {
        if (++n === 2) ac.abort();
        return base;
      },
      base,
      { signal: ac.signal, ...c },
    );
    expect(r.timedOut).toBe(false);
    expect(n).toBe(2);
  });
});
