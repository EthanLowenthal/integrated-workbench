import type { DriverKey } from './drivers.js';

/**
 * - `bridge`: a USB-to-serial converter chip next to the microcontroller (CH340, CP210x, FTDI).
 *   Needs a vendor driver on some OSes.
 * - `native`: the microcontroller itself speaks USB (Leonardo, ESP32-S3, RP2040). Uses the OS's
 *   built-in CDC driver, but the VID:PID can change between sketch and bootloader mode.
 */
export type ChipKind = 'bridge' | 'native';

export type ChipFamily = 'ch34x' | 'cp210x' | 'ftdi' | 'arduino' | 'espressif' | 'rp2040';

export interface ChipInfo {
  vid: string;
  pid: string;
  /** Plain-English name shown to users, e.g. "CH340". */
  name: string;
  family: ChipFamily;
  kind: ChipKind;
  /** Which vendor driver page to point at when this chip has no driver. */
  driver?: DriverKey;
  /** This VID:PID is the board's bootloader / download mode, not its normal sketch mode. */
  bootloader?: boolean;
  /** In this mode the device never creates a serial port (e.g. RP2040 BOOTSEL is a USB drive). */
  noSerialPort?: boolean;
  /** Arduino board package (core) that supports this board, e.g. "arduino:avr". */
  platform?: string;
}

export interface VendorInfo {
  vid: string;
  name: string;
  family: ChipFamily;
  kind: ChipKind;
  driver?: DriverKey;
  /** Board package for any board from this vendor (native-USB vendors only). */
  platform?: string;
}

/** Match VID first, then PID. Entries not checked against a primary source are marked TODO verify. */
export const VENDORS: readonly VendorInfo[] = [
  { vid: '1a86', name: 'WCH', family: 'ch34x', kind: 'bridge', driver: 'wch-ch34x' },
  { vid: '10c4', name: 'Silicon Labs', family: 'cp210x', kind: 'bridge', driver: 'silabs-cp210x' },
  { vid: '0403', name: 'FTDI', family: 'ftdi', kind: 'bridge', driver: 'ftdi-vcp' },
  { vid: '2341', name: 'Arduino', family: 'arduino', kind: 'native' },
  { vid: '2a03', name: 'Arduino (arduino.org)', family: 'arduino', kind: 'native' }, // TODO verify
  { vid: '303a', name: 'Espressif', family: 'espressif', kind: 'native', platform: 'esp32:esp32' },
  { vid: '2e8a', name: 'Raspberry Pi', family: 'rp2040', kind: 'native', platform: 'rp2040:rp2040' },
];

export const CHIPS: readonly ChipInfo[] = [
  // WCH
  { vid: '1a86', pid: '7523', name: 'CH340', family: 'ch34x', kind: 'bridge', driver: 'wch-ch34x' },
  {
    vid: '1a86',
    pid: '5523',
    name: 'CH341 (serial mode)',
    family: 'ch34x',
    kind: 'bridge',
    driver: 'wch-ch34x',
  },
  { vid: '1a86', pid: '7522', name: 'CH340K', family: 'ch34x', kind: 'bridge', driver: 'wch-ch34x' }, // TODO verify
  { vid: '1a86', pid: '55d4', name: 'CH9102', family: 'ch34x', kind: 'bridge', driver: 'wch-ch9102' },
  // Silicon Labs
  { vid: '10c4', pid: 'ea60', name: 'CP210x', family: 'cp210x', kind: 'bridge', driver: 'silabs-cp210x' },
  { vid: '10c4', pid: 'ea70', name: 'CP2105', family: 'cp210x', kind: 'bridge', driver: 'silabs-cp210x' }, // TODO verify
  // FTDI
  { vid: '0403', pid: '6001', name: 'FTDI FT232R', family: 'ftdi', kind: 'bridge', driver: 'ftdi-vcp' },
  { vid: '0403', pid: '6015', name: 'FTDI FT-X', family: 'ftdi', kind: 'bridge', driver: 'ftdi-vcp' },
  { vid: '0403', pid: '6010', name: 'FTDI FT2232', family: 'ftdi', kind: 'bridge', driver: 'ftdi-vcp' }, // TODO verify
  // Arduino (referential naming: these are the boards' own USB IDs)
  { vid: '2341', pid: '0043', name: 'Uno R3', family: 'arduino', kind: 'native', platform: 'arduino:avr' },
  { vid: '2341', pid: '0001', name: 'Uno', family: 'arduino', kind: 'native', platform: 'arduino:avr' }, // TODO verify
  { vid: '2341', pid: '0042', name: 'Mega 2560 R3', family: 'arduino', kind: 'native', platform: 'arduino:avr' },
  { vid: '2341', pid: '8036', name: 'Leonardo', family: 'arduino', kind: 'native', platform: 'arduino:avr' },
  {
    vid: '2341',
    pid: '0036',
    name: 'Leonardo (bootloader)',
    family: 'arduino',
    kind: 'native',
    bootloader: true,
  },
  { vid: '2341', pid: '8037', name: 'Micro', family: 'arduino', kind: 'native', platform: 'arduino:avr' }, // TODO verify
  {
    vid: '2341',
    pid: '0037',
    name: 'Micro (bootloader)',
    family: 'arduino',
    kind: 'native',
    bootloader: true,
  }, // TODO verify
  // Espressif native USB
  { vid: '303a', pid: '1001', name: 'ESP32-S3 / C3 (USB-Serial-JTAG)', family: 'espressif', kind: 'native' },
  {
    vid: '303a',
    pid: '0002',
    name: 'ESP32-S2 (download mode)',
    family: 'espressif',
    kind: 'native',
    bootloader: true,
  }, // TODO verify
  // Raspberry Pi RP2040
  { vid: '2e8a', pid: '0005', name: 'RP2040 (MicroPython)', family: 'rp2040', kind: 'native', platform: '' },
  { vid: '2e8a', pid: '000a', name: 'RP2040 (Pico SDK / Arduino core)', family: 'rp2040', kind: 'native' }, // TODO verify
  {
    vid: '2e8a',
    pid: '0003',
    name: 'RP2040 (BOOTSEL bootloader)',
    family: 'rp2040',
    kind: 'native',
    bootloader: true,
    noSerialPort: true,
  },
];

export interface ChipMatch {
  vendor?: VendorInfo;
  chip?: ChipInfo;
  /** Best plain-English label: chip name, "<Vendor> device", or "Unknown device". */
  label: string;
}

export function normalizeHex(id: string): string {
  return id.trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
}

/** Board package to recommend for a plugged-in device, if we can tell. Empty string in the table = none. */
export function platformFor(match: ChipMatch): string | undefined {
  const p = match.chip?.platform ?? (match.vendor?.kind === 'native' ? match.vendor.platform : undefined);
  return p || undefined;
}

export function lookupChip(vid: string | undefined, pid: string | undefined): ChipMatch {
  if (!vid) return { label: 'Unknown device' };
  const v = normalizeHex(vid);
  const vendor = VENDORS.find((x) => x.vid === v);
  if (!vendor) return { label: 'Unknown device' };
  const p = pid ? normalizeHex(pid) : undefined;
  const chip = p ? CHIPS.find((c) => c.vid === v && c.pid === p) : undefined;
  return { vendor, chip, label: chip ? chip.name : `${vendor.name} device` };
}
