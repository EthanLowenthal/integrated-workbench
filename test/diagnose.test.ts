import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/core/diagnose.js';
import { parseLinuxSysfs, type LinuxSysfsRaw } from '../src/core/parse/linux.js';
import { parseIoregUsb } from '../src/core/parse/macos.js';
import { parseWindowsPnp } from '../src/core/parse/windows.js';
import type { Diagnosis, Snapshot, UsbDevice } from '../src/core/types.js';
import { diffSnapshots } from '../src/core/watch.js';
import { fixture, fixtureJson, snapshot } from './helpers.js';

const win = (name: string): Snapshot =>
  snapshot({ os: 'windows', ...parseWindowsPnp(fixture(`windows/${name}`)) });
const mac = (name: string): Snapshot => snapshot({ os: 'macos', ...parseIoregUsb(fixture(`macos/${name}`)) });
const linux = (name: string, env: Snapshot['env'] = {}): Snapshot =>
  snapshot({ os: 'linux', env, ...parseLinuxSysfs(fixtureJson<LinuxSysfsRaw>(`linux/${name}`)) });

const codes = (ds: Diagnosis[]) => ds.map((d) => d.code);

describe('diagnose: Windows', () => {
  it('nothing connected -> NO_BOARDS (COM1 and the mouse receiver are ignored)', () => {
    expect(codes(diagnose(win('nothing-connected.synth.json')))).toEqual(['NO_BOARDS']);
  });

  it('CH340 with driver -> OK on COM5', () => {
    const [d] = diagnose(win('ch340-driver-ok.synth.json'));
    expect(d).toMatchObject({ code: 'OK', severity: 'ok', title: 'Board (CH340) on COM5' });
    expect(d!.actions).toContainEqual({ kind: 'selectPort', label: 'Use This Port', path: 'COM5' });
  });

  it('CH340 without driver -> DRIVER_MISSING with WCH link, Windows Update, and confirm-only rescan', () => {
    const ds = diagnose(win('ch340-no-driver.synth.json'));
    expect(codes(ds)).toEqual(['DRIVER_MISSING']);
    expect(ds[0]!.title).toContain('CH340');
    const kinds = ds[0]!.actions.map((a) => a.kind);
    expect(kinds).toEqual(['openUrl', 'openUrl', 'runCommand', 'retry']);
    expect(ds[0]!.actions[0]).toMatchObject({ url: expect.stringContaining('wch-ic.com') });
    expect(ds[0]!.actions[2]).toMatchObject({ needsAdmin: true, command: 'pnputil /scan-devices' });
  });

  it('genuine Uno -> OK with board name', () => {
    expect(diagnose(win('uno-genuine.synth.json'))[0]).toMatchObject({
      code: 'OK',
      title: 'Uno R3 on COM3',
    });
  });

  it('FTDI and Leonardo composite -> OK', () => {
    expect(codes(diagnose(win('ftdi.synth.json')))).toEqual(['OK']);
    expect(diagnose(win('leonardo-composite.synth.json'))[0]).toMatchObject({
      code: 'OK',
      title: 'Leonardo on COM9',
    });
  });

  it('driver installed but failing (code 43) -> DRIVER_MISSING with the "not working" wording', () => {
    const s = win('ch340-no-driver.synth.json');
    s.usb = s.usb.map((d) => (d.vid === '1a86' ? { ...d, driverStatus: 'error', osErrorCode: 43 } : d));
    const [d] = diagnose(s);
    expect(d).toMatchObject({
      code: 'DRIVER_MISSING',
      title: 'CH340 driver failed to start',
    });
    expect(d!.detail).toContain('43');
  });
});

describe('diagnose: macOS', () => {
  it('real machine with no boards -> NO_BOARDS', () => {
    expect(codes(diagnose(mac('ioreg-no-boards.real.txt')))).toEqual(['NO_BOARDS']);
  });

  it('CH340 -> OK; CP2102 -> OK; ESP32-S3 native -> OK', () => {
    expect(diagnose(mac('ioreg-ch340.synth.txt'))[0]).toMatchObject({
      code: 'OK',
      title: 'Board (CH340) on /dev/cu.usbserial-110',
    });
    expect(diagnose(mac('ioreg-cp2102.synth.txt'))[0]).toMatchObject({
      code: 'OK',
      title: 'Board (CP210x) on /dev/cu.usbserial-0001',
    });
    expect(diagnose(mac('ioreg-esp32s3.synth.txt'))[0]).toMatchObject({
      code: 'OK',
      port: { path: '/dev/cu.usbmodem1101' },
    });
  });

  it('CH340 with no port -> DRIVER_MISSING with macOS driver link, no Windows actions', () => {
    const [d] = diagnose(mac('ioreg-ch340-no-port.synth.txt'));
    expect(d!.code).toBe('DRIVER_MISSING');
    expect(d!.actions.map((a) => a.kind)).toEqual(['openUrl', 'retry']);
    expect(d!.detail).not.toContain('Windows Update');
  });

  it('two boards -> two OKs plus MULTIPLE_CANDIDATES', () => {
    const ds = diagnose(mac('ioreg-two-boards.synth.txt'));
    expect(codes(ds)).toEqual(['MULTIPLE_CANDIDATES', 'OK', 'OK']);
    expect(ds[0]!.actions[0]).toEqual({
      kind: 'pickPort',
      label: 'Select Port...',
      paths: ['/dev/cu.usbserial-110', '/dev/cu.usbserial-0001'],
    });
  });

  it('port held by another process -> PORT_IN_USE instead of OK', () => {
    const s = mac('ioreg-ch340.synth.txt');
    s.ports[0]!.inUseBy = { pid: 4321, name: 'screen' };
    const ds = diagnose(s);
    expect(codes(ds)).toEqual(['PORT_IN_USE']);
    expect(ds[0]!.title).toBe('/dev/cu.usbserial-110 in use by screen');
  });

  it('unlinked usbserial port from /dev listing still counts', () => {
    const s = snapshot({
      os: 'macos',
      ports: [{ path: '/dev/cu.usbserial-A1' }, { path: '/dev/cu.Bluetooth-Incoming-Port' }],
    });
    expect(diagnose(s).map((d) => d.port?.path)).toEqual(['/dev/cu.usbserial-A1']);
  });
});

describe('diagnose: Linux', () => {
  it('CH340 + brltty active -> LINUX_BRLTTY with both disable and remove commands', () => {
    const ds = diagnose(linux('ch340-brltty.synth.json', { brlttyActive: true }));
    expect(codes(ds)).toEqual(['LINUX_BRLTTY']);
    const cmds = ds[0]!.actions
      .filter((a) => a.kind === 'copyCommand')
      .map((a) => (a as { command: string }).command);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain('systemctl');
    expect(cmds[1]).toContain('remove brltty');
  });

  it('CH340 with no tty and brltty inactive -> DRIVER_MISSING without vendor link (kernel driver)', () => {
    const ds = diagnose(linux('ch340-brltty.synth.json', { brlttyActive: false }));
    expect(codes(ds)).toEqual(['DRIVER_MISSING']);
    expect(ds[0]!.actions.map((a) => a.kind)).toEqual(['retry']);
  });

  it('not in dialout -> LINUX_PERMISSION with usermod command', () => {
    const s = linux('ch340-ok.synth.json', { linuxGroups: ['maker', 'sudo'] });
    s.ports[0]!.permissionOk = false;
    s.ports[0]!.ownerGroup = 'dialout';
    const [d] = diagnose(s);
    expect(d!.code).toBe('LINUX_PERMISSION');
    expect(d!.actions[0]).toEqual({
      kind: 'copyCommand',
      label: 'Copy Command',
      command: 'sudo usermod -aG dialout $USER',
    });
  });

  it('Arch-style uucp group is used in the command', () => {
    const s = linux('ch340-ok.synth.json', { linuxGroups: ['maker'] });
    s.ports[0]!.permissionOk = false;
    s.ports[0]!.ownerGroup = 'uucp';
    expect(diagnose(s)[0]!.actions[0]).toMatchObject({ command: 'sudo usermod -aG uucp $USER' });
  });

  it('already in the group -> tells you to log out and back in, no usermod', () => {
    const s = linux('ch340-ok.synth.json', { linuxGroups: ['maker', 'dialout'] });
    s.ports[0]!.permissionOk = false;
    s.ports[0]!.ownerGroup = 'dialout';
    const [d] = diagnose(s);
    expect(d!.title).toBe('Log out to apply group membership');
    expect(d!.actions.map((a) => a.kind)).toEqual(['retry']);
  });

  it('never puts a weird group name into a copy-paste command', () => {
    const s = linux('ch340-ok.synth.json', { linuxGroups: [] });
    s.ports[0]!.permissionOk = false;
    s.ports[0]!.ownerGroup = 'x; rm -rf ~';
    expect(diagnose(s)[0]!.actions[0]).toMatchObject({ command: 'sudo usermod -aG dialout $USER' });
  });

  it('port in use and permission problem both reported, errors first', () => {
    const s = linux('uno-acm.synth.json', { linuxGroups: ['maker'] });
    s.ports[0]!.inUseBy = { pid: 4321, name: 'screen' };
    s.ports[0]!.permissionOk = false;
    expect(codes(diagnose(s))).toEqual(['PORT_IN_USE', 'LINUX_PERMISSION']);
  });
});

describe('diagnose: native USB and bootloaders', () => {
  const dev = (vid: string, pid: string, extra: Partial<UsbDevice> = {}): UsbDevice => ({
    vid,
    pid,
    location: `${vid}:${pid}`,
    driverStatus: 'unknown',
    ...extra,
  });

  it('RP2040 BOOTSEL (USB drive, never a port) -> NATIVE_USB_BOOTLOADER info', () => {
    const [d] = diagnose(snapshot({ os: 'macos', usb: [dev('2e8a', '0003')] }));
    expect(d).toMatchObject({ code: 'NATIVE_USB_BOOTLOADER', severity: 'info' });
  });

  it('Leonardo in bootloader with a port -> NATIVE_USB_BOOTLOADER info (still selectable)', () => {
    const s = snapshot({
      os: 'windows',
      usb: [dev('2341', '0036')],
      ports: [{ path: 'COM10', vid: '2341', pid: '0036', usbLocation: '2341:0036' }],
    });
    const [d] = diagnose(s);
    expect(d).toMatchObject({ code: 'NATIVE_USB_BOOTLOADER', severity: 'info' });
    expect(d!.actions[0]).toMatchObject({ kind: 'selectPort', path: 'COM10' });
  });

  it('ESP32-S3 with no port -> NATIVE_USB_BOOTLOADER warning (reset / BOOT advice)', () => {
    const [d] = diagnose(snapshot({ os: 'linux', usb: [dev('303a', '1001')] }));
    expect(d).toMatchObject({ code: 'NATIVE_USB_BOOTLOADER', severity: 'warning' });
    expect(d!.detail).toContain('BOOT');
  });

  it('unknown PID under a known bridge vendor still gets a driver diagnosis with the vendor link', () => {
    const [d] = diagnose(
      snapshot({ os: 'windows', usb: [dev('1a86', 'ffff', { driverStatus: 'missing' })] }),
    );
    expect(d!.code).toBe('DRIVER_MISSING');
    expect(d!.actions[0]).toMatchObject({ kind: 'openUrl', url: expect.stringContaining('wch-ic.com') });
  });
});

describe('diagnose: plug-in watch', () => {
  const before = win('nothing-connected.synth.json');

  it('nothing appeared -> NO_DEVICE_AFTER_PLUG first', () => {
    const ds = diagnose(before, { watch: diffSnapshots(before, before) });
    expect(codes(ds)).toEqual(['NO_DEVICE_AFTER_PLUG']);
    expect(ds[0]!.detail).toContain('charge-only');
  });

  it('CH340 appeared without driver -> DRIVER_MISSING, no NO_DEVICE_AFTER_PLUG', () => {
    const after = win('ch340-no-driver.synth.json');
    expect(codes(diagnose(after, { watch: diffSnapshots(before, after) }))).toEqual(['DRIVER_MISSING']);
  });

  it('unknown device appeared with no port -> UNKNOWN_DEVICE_NO_PORT with copyable VID:PID', () => {
    const after: Snapshot = {
      ...before,
      usb: [
        ...before.usb,
        { vid: 'abcd', pid: '1234', location: 'USB\\VID_ABCD&PID_1234\\X', driverStatus: 'missing' },
      ],
    };
    const ds = diagnose(after, { watch: diffSnapshots(before, after) });
    expect(codes(ds)).toEqual(['UNKNOWN_DEVICE_NO_PORT']);
    expect(ds[0]!.actions[0]).toEqual({ kind: 'copyCommand', label: 'Copy Device ID', command: 'abcd:1234' });
  });

  it('unknown devices are NOT reported outside a watch (keyboards, hubs, etc.)', () => {
    const s: Snapshot = {
      ...before,
      usb: [...before.usb, { vid: 'abcd', pid: '1234', driverStatus: 'missing' }],
    };
    expect(codes(diagnose(s))).toEqual(['NO_BOARDS']);
  });
});

describe('diagnose: output contract', () => {
  it('every diagnosis has a title, detail, and at least one action; sorted by severity', () => {
    const scenarios = [
      win('ch340-no-driver.synth.json'),
      mac('ioreg-two-boards.synth.txt'),
      linux('ch340-brltty.synth.json', { brlttyActive: true }),
    ];
    const rank = { error: 0, warning: 1, info: 2, ok: 3 } as const;
    for (const s of scenarios) {
      const ds = diagnose(s);
      for (const d of ds) {
        expect(d.title.length).toBeGreaterThan(5);
        expect(d.detail.length).toBeGreaterThan(10);
        expect(d.actions.length).toBeGreaterThan(0);
      }
      const ranks = ds.map((d) => rank[d.severity]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
