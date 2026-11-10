import type { SerialPort, UsbDevice } from '../types.js';

/**
 * Linux parsers. The probe reads sysfs into this raw, serializable shape (so fixtures are plain JSON);
 * these functions turn it into UsbDevice[] / SerialPort[].
 */
export interface LinuxSysfsRaw {
  /** One entry per /sys/bus/usb/devices/<name>, both devices ("1-1") and interfaces ("1-1:1.0"). */
  devices: {
    name: string;
    /** Resolved real path, e.g. /sys/devices/pci0000:00/0000:00:14.0/usb1/1-1 */
    path: string;
    /** File contents (trimmed): idVendor, idProduct, manufacturer, product, serial. */
    attrs: Record<string, string>;
    /** basename of the `driver` symlink, if bound. */
    driver?: string;
  }[];
  /** One entry per /sys/class/tty/ttyUSB* and ttyACM*. */
  ttys: {
    name: string;
    /** Resolved real path of /sys/class/tty/<name>/device. */
    devicePath?: string;
  }[];
}

/** Kernel drivers that create a /dev/ttyUSB* or /dev/ttyACM* node. */
const SERIAL_DRIVERS = new Set([
  'ch341',
  'cp210x',
  'ftdi_sio',
  'cdc_acm',
  'pl2303',
  'usbserial_generic',
  'usbserial',
]);

export function parseLinuxSysfs(raw: LinuxSysfsRaw): { usb: UsbDevice[]; ports: SerialPort[] } {
  const usb: UsbDevice[] = [];
  const ifaces = raw.devices.filter((d) => d.name.includes(':'));

  for (const d of raw.devices) {
    if (d.name.includes(':') || d.name.startsWith('usb')) continue; // interfaces and root hubs
    const vid = d.attrs['idVendor']?.toLowerCase();
    const pid = d.attrs['idProduct']?.toLowerCase();
    if (!vid || !pid) continue;
    const myIfaces = ifaces.filter((i) => i.name.startsWith(`${d.name}:`));
    const serialDriver = myIfaces.map((i) => i.driver).find((drv) => drv && SERIAL_DRIVERS.has(drv));
    const anyDriver = myIfaces.map((i) => i.driver).find((drv) => drv);
    usb.push({
      vid,
      pid,
      serialNumber: d.attrs['serial'] || undefined,
      manufacturer: d.attrs['manufacturer'] || undefined,
      product: d.attrs['product'] || undefined,
      location: d.path,
      // Without a serial-capable driver bound we can't call it "missing" for arbitrary devices
      // (a keyboard is fine with usbhid); diagnose() decides using the chip database.
      driverStatus: serialDriver ? 'ok' : 'unknown',
      driverName: serialDriver ?? anyDriver,
    });
  }

  const ports: SerialPort[] = [];
  for (const t of raw.ttys) {
    // The tty's device is an interface (or a ttyUSB child of one); its USB device is the longest
    // device path that prefixes it.
    const owner = t.devicePath
      ? usb
          .filter((u) => u.location && t.devicePath!.startsWith(`${u.location}/`))
          .sort((a, b) => (b.location?.length ?? 0) - (a.location?.length ?? 0))[0]
      : undefined;
    ports.push({ path: `/dev/${t.name}`, vid: owner?.vid, pid: owner?.pid, usbLocation: owner?.location });
  }
  return { usb, ports };
}

/** Fallback when sysfs isn't readable: `lsusb` lines like "Bus 001 Device 005: ID 1a86:7523 QinHeng ...". */
export function parseLsusb(text: string): UsbDevice[] {
  const out: UsbDevice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^Bus (\d+) Device (\d+): ID ([0-9a-f]{4}):([0-9a-f]{4})\s*(.*)$/i.exec(line.trim());
    if (!m) continue;
    out.push({
      vid: m[3]!.toLowerCase(),
      pid: m[4]!.toLowerCase(),
      product: m[5] || undefined,
      location: `bus${m[1]}-dev${m[2]}`,
      driverStatus: 'unknown',
    });
  }
  return out;
}

/** `id -nG` -> ["alice", "sudo", "dialout"]. */
export function parseIdGroups(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * `systemctl is-active brltty-udev.service brltty.service` prints one state per unit
 * ("active", "inactive", "failed", ...). Active if any unit is active.
 */
export function parseSystemctlIsActive(text: string): boolean {
  return text.split(/\r?\n/).some((l) => l.trim() === 'active');
}

/** /etc/group contents -> gid -> name. */
export function parseEtcGroup(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const [name, , gid] = line.split(':');
    if (name && gid && /^\d+$/.test(gid)) out.set(Number(gid), name);
  }
  return out;
}
