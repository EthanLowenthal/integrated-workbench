import type { SerialPort, Snapshot, UsbDevice } from './types.js';

export interface SnapshotDiff {
  addedDevices: UsbDevice[];
  removedDevices: UsbDevice[];
  addedPorts: SerialPort[];
  removedPorts: SerialPort[];
}

export function deviceKey(d: UsbDevice): string {
  return `${d.vid}:${d.pid}:${d.serialNumber ?? ''}:${d.location ?? ''}`;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeDev = new Set(before.usb.map(deviceKey));
  const afterDev = new Set(after.usb.map(deviceKey));
  const beforePorts = new Set(before.ports.map((p) => p.path));
  const afterPorts = new Set(after.ports.map((p) => p.path));
  return {
    addedDevices: after.usb.filter((d) => !beforeDev.has(deviceKey(d))),
    removedDevices: before.usb.filter((d) => !afterDev.has(deviceKey(d))),
    addedPorts: after.ports.filter((p) => !beforePorts.has(p.path)),
    removedPorts: before.ports.filter((p) => !afterPorts.has(p.path)),
  };
}

export function hasChanges(diff: SnapshotDiff): boolean {
  return diff.addedDevices.length + diff.addedPorts.length > 0;
}

export interface WatchOptions {
  /** Give up after this long. Default 20 s. */
  timeoutMs?: number;
  /** Poll interval. Default 1 s. */
  intervalMs?: number;
  /**
   * After the first change, keep polling this long so slow drivers can create their port
   * (and native-USB boards can finish re-enumerating). Default 2 s.
   */
  settleMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface WatchResult {
  before: Snapshot;
  after: Snapshot;
  diff: SnapshotDiff;
  /** True if we stopped because nothing happened before the timeout. */
  timedOut: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Plug-in watch: take a baseline, then poll until a new USB device or port appears (or timeout).
 * The caller should take/hand over the baseline BEFORE asking the user to plug in.
 */
export async function watchForDevice(
  takeSnapshot: () => Promise<Snapshot>,
  baseline: Snapshot,
  opts: WatchOptions = {},
): Promise<WatchResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const settleMs = opts.settleMs ?? 2_000;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  const start = now();
  let after = baseline;
  let changedAt: number | undefined;

  while (!opts.signal?.aborted) {
    await sleep(intervalMs);
    after = await takeSnapshot();
    const diff = diffSnapshots(baseline, after);
    if (hasChanges(diff) && changedAt === undefined) changedAt = now();
    if (changedAt !== undefined && now() - changedAt >= settleMs) break;
    if (changedAt === undefined && now() - start >= timeoutMs) {
      return { before: baseline, after, diff, timedOut: true };
    }
  }
  return { before: baseline, after, diff: diffSnapshots(baseline, after), timedOut: false };
}
