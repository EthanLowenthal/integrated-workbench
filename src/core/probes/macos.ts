import { parseLsofF } from '../parse/common.js';
import { parseDevListing, parseIoregUsb, parseSystemProfilerUsb } from '../parse/macos.js';
import type { SerialPort, Snapshot, UsbDevice } from '../types.js';
import type { ProbeHost } from './host.js';

export async function probeMacos(host: ProbeHost): Promise<Snapshot> {
  let usb: UsbDevice[] = [];
  let ports: SerialPort[] = [];

  const ioreg = await host.run('/usr/sbin/ioreg', ['-r', '-c', 'IOUSBHostDevice', '-l', '-w0']);
  if (ioreg.code === 0) {
    ({ usb, ports } = parseIoregUsb(ioreg.stdout));
  } else {
    for (const dataType of ['SPUSBHostDataType', 'SPUSBDataType']) {
      const sp = await host.run('/usr/sbin/system_profiler', [dataType, '-json'], { timeoutMs: 30_000 });
      if (sp.code === 0) {
        usb = parseSystemProfilerUsb(sp.stdout);
        if (usb.length) break;
      }
    }
  }

  // /dev listing catches ports ioreg didn't tie to a USB device.
  const known = new Set(ports.map((p) => p.path));
  for (const p of parseDevListing(await host.readdir('/dev'))) {
    if (!known.has(p.path)) ports.push(p);
  }

  await Promise.all(ports.map(async (p) => (p.inUseBy = await whoHolds(host, p.path))));
  return { os: 'macos', takenAt: Date.now(), usb, ports, env: {} };
}

export async function whoHolds(
  host: ProbeHost,
  path: string,
): Promise<{ pid: number; name: string } | null | undefined> {
  const res = await host.run('lsof', ['-F', 'pc', '--', path], { timeoutMs: 5_000 });
  if (res.code === null) return undefined; // lsof not available
  return parseLsofF(res.stdout)[0] ?? null;
}
