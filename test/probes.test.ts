import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/core/diagnose.js';
import type { LinuxSysfsRaw } from '../src/core/parse/linux.js';
import { probeLinux } from '../src/core/probes/linux.js';
import { probeMacos } from '../src/core/probes/macos.js';
import { probeWindows } from '../src/core/probes/windows.js';
import { exit, fakeHost, fixture, fixtureJson, ok } from './helpers.js';

describe('probeWindows', () => {
  it('runs PowerShell with an argument array and no profile', async () => {
    const host = fakeHost({ run: () => ok(fixture('windows/ch340-no-driver.synth.json')) });
    const s = await probeWindows(host);
    expect(host.calls[0]!.file).toBe('powershell.exe');
    expect(host.calls[0]!.args.slice(0, 2)).toEqual(['-NoProfile', '-NonInteractive']);
    expect(s.os).toBe('windows');
    expect(diagnose(s)[0]!.code).toBe('DRIVER_MISSING');
  });

  it('throws a readable error when PowerShell fails', async () => {
    const host = fakeHost({ run: () => ({ stdout: '', stderr: 'Access denied', code: 1 }) });
    await expect(probeWindows(host)).rejects.toThrow(/Access denied/);
  });
});

describe('probeMacos', () => {
  it('ioreg + /dev listing + lsof -> PORT_IN_USE', async () => {
    const host = fakeHost({
      run: (file, args) => {
        if (file.endsWith('ioreg')) return ok(fixture('macos/ioreg-ch340.synth.txt'));
        if (file === 'lsof' && args.includes('/dev/cu.usbserial-110'))
          return ok(fixture('macos/lsof-in-use.synth.txt'));
        if (file === 'lsof') return exit(1);
        return undefined;
      },
      dirs: { '/dev': ['cu.usbserial-110', 'tty.usbserial-110', 'cu.Bluetooth-Incoming-Port', 'null'] },
    });
    const s = await probeMacos(host);
    expect(s.ports).toHaveLength(1);
    expect(s.ports[0]!.inUseBy).toEqual({ pid: 4321, name: 'screen' });
    expect(diagnose(s)[0]!.code).toBe('PORT_IN_USE');
  });

  it('falls back to system_profiler when ioreg fails', async () => {
    const host = fakeHost({
      run: (file, args) => {
        if (file.endsWith('ioreg')) return exit(1);
        if (file.endsWith('system_profiler') && args[0] === 'SPUSBHostDataType')
          return ok('{"SPUSBHostDataType":[]}');
        if (file.endsWith('system_profiler')) return ok(fixture('macos/sp-usb-legacy-ch340.synth.json'));
        return undefined;
      },
    });
    const s = await probeMacos(host);
    expect(s.usb.map((d) => d.vid)).toEqual(['1a86']);
    expect(diagnose(s)[0]!.code).toBe('DRIVER_MISSING');
  });
});

describe('probeLinux', () => {
  /** Turns a sysfs fixture back into the fake filesystem the probe reads. */
  function sysfsHost(raw: LinuxSysfsRaw, extra: Parameters<typeof fakeHost>[0] = {}) {
    const files: Record<string, string> = { '/etc/group': fixture('linux/etc-group.txt'), ...extra.files };
    const realpaths: Record<string, string> = { ...extra.realpaths };
    for (const d of raw.devices) {
      const base = `/sys/bus/usb/devices/${d.name}`;
      realpaths[base] = d.path;
      if (d.driver) realpaths[`${base}/driver`] = `/sys/bus/usb/drivers/${d.driver}`;
      for (const [k, v] of Object.entries(d.attrs)) files[`${base}/${k}`] = `${v}\n`;
    }
    for (const t of raw.ttys) if (t.devicePath) realpaths[`/sys/class/tty/${t.name}/device`] = t.devicePath;
    return fakeHost({
      ...extra,
      files,
      realpaths,
      dirs: {
        '/sys/bus/usb/devices': raw.devices.map((d) => d.name),
        '/sys/class/tty': ['tty0', 'ttyS0', ...raw.ttys.map((t) => t.name)],
      },
    });
  }

  it('brltty grabbing a CH340', async () => {
    const host = sysfsHost(fixtureJson('linux/ch340-brltty.synth.json'), {
      run: (file) => {
        if (file === 'systemctl') return ok(fixture('linux/systemctl-brltty-active.txt'));
        if (file === 'id') return ok(fixture('linux/id-groups-no-dialout.txt'));
        return undefined;
      },
    });
    const s = await probeLinux(host);
    expect(s.env.brlttyActive).toBe(true);
    expect(s.usb[0]!.driverName).toBe('usbfs');
    expect(diagnose(s)[0]!.code).toBe('LINUX_BRLTTY');
  });

  it('user not in dialout, port held via fuser fallback when lsof is missing', async () => {
    const host = sysfsHost(fixtureJson('linux/ch340-ok.synth.json'), {
      run: (file) => {
        if (file === 'systemctl') return exit(3, fixture('linux/systemctl-brltty-inactive.txt'));
        if (file === 'id') return ok(fixture('linux/id-groups-no-dialout.txt'));
        if (file === 'fuser') return ok(' 4321');
        return undefined; // lsof not installed
      },
      files: { '/proc/4321/comm': 'arduino-cli\n' },
      readWrite: { '/dev/ttyUSB0': false },
      gids: { '/dev/ttyUSB0': 20 },
    });
    const s = await probeLinux(host);
    expect(s.ports[0]).toMatchObject({
      path: '/dev/ttyUSB0',
      permissionOk: false,
      ownerGroup: 'dialout',
      inUseBy: { pid: 4321, name: 'arduino-cli' },
    });
    expect(s.env.brlttyActive).toBe(false);
    expect(diagnose(s).map((d) => d.code)).toEqual(['PORT_IN_USE', 'LINUX_PERMISSION']);
  });

  it('falls back to lsusb when sysfs is empty', async () => {
    const host = fakeHost({
      run: (file) => (file === 'lsusb' ? ok(fixture('linux/lsusb-ch340.synth.txt')) : undefined),
    });
    const s = await probeLinux(host);
    expect(s.usb.map((d) => d.vid)).toContain('1a86');
  });
});
