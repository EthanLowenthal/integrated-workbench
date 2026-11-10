/**
 * USB ID lookups. The data lives in registries (workbench-registry/usb.json and any the user adds);
 * this module only knows how to search it. The bundled default registry is used when no
 * database is passed, so src/core keeps working on its own (tests, a future CLI).
 */
import bundled from '../../workbench-registry/usb.json';

/**
 * A USB vendor (no pid) or device (vid + pid). Same shape as a registry `usb` entry.
 * - `bridge`: a USB-to-serial chip next to the microcontroller (may need a vendor driver).
 * - `native`: the microcontroller speaks USB itself; the VID:PID can change in bootloader mode.
 */
export interface UsbEntry {
  vid: string;
  pid?: string;
  name: string;
  kind: 'bridge' | 'native';
  family?: string;
  /** id of a drivers entry. */
  driver?: string;
  bootloader?: boolean;
  noSerialPort?: boolean;
  verified?: boolean;
}

export interface ChipDb {
  vendors: Map<string, UsbEntry>;
  devices: Map<string, UsbEntry>;
}

export function createChipDb(entries: readonly UsbEntry[]): ChipDb {
  const db: ChipDb = { vendors: new Map(), devices: new Map() };
  for (const e of entries) {
    const vid = normalizeHex(e.vid);
    if (e.pid) {
      const key = `${vid}:${normalizeHex(e.pid)}`;
      if (!db.devices.has(key)) db.devices.set(key, e);
    } else if (!db.vendors.has(vid)) {
      db.vendors.set(vid, e);
    }
  }
  return db;
}

export const defaultChipDb: ChipDb = createChipDb(bundled.usb as UsbEntry[]);

export interface ChipMatch {
  vendor?: UsbEntry;
  chip?: UsbEntry;
  /** Best plain-English label: chip name, "<Vendor> device", or "Unknown device". */
  label: string;
}

export function normalizeHex(id: string): string {
  return id.trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
}

/** Match VID:PID first, then VID alone. */
export function lookupChip(
  vid: string | undefined,
  pid: string | undefined,
  db: ChipDb = defaultChipDb,
): ChipMatch {
  if (!vid) return { label: 'Unknown device' };
  const v = normalizeHex(vid);
  const chip = pid ? db.devices.get(`${v}:${normalizeHex(pid)}`) : undefined;
  const vendor = db.vendors.get(v);
  if (chip) return { vendor, chip, label: chip.name };
  if (vendor) return { vendor, label: `${vendor.name} device` };
  return { label: 'Unknown device' };
}
