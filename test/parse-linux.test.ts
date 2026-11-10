import { describe, expect, it } from 'vitest';
import { parseFuserPids } from '../src/core/parse/common.js';
import {
  parseEtcGroup,
  parseIdGroups,
  parseLinuxSysfs,
  parseLsusb,
  parseSystemctlIsActive,
  type LinuxSysfsRaw,
} from '../src/core/parse/linux.js';
import { fixture, fixtureJson } from './helpers.js';

const sysfs = (name: string) => parseLinuxSysfs(fixtureJson<LinuxSysfsRaw>(`linux/${name}`));

describe('parseLinuxSysfs', () => {
  it('CH340 grabbed by brltty: device with usbfs driver, no tty', () => {
    const { usb, ports } = sysfs('ch340-brltty.synth.json');
    expect(usb.map((d) => `${d.vid}:${d.pid}`)).toEqual(['1a86:7523', '046d:c52b']); // root hub skipped
    expect(usb[0]).toMatchObject({ driverStatus: 'unknown', driverName: 'usbfs' });
    expect(ports).toEqual([]);
  });

  it('CH340 on ttyUSB0: maps tty to device through the sysfs path', () => {
    const { usb, ports } = sysfs('ch340-ok.synth.json');
    expect(usb[0]).toMatchObject({ vid: '1a86', driverStatus: 'ok', driverName: 'ch341' });
    expect(ports).toEqual([
      { path: '/dev/ttyUSB0', vid: '1a86', pid: '7523', usbLocation: usb[0]!.location },
    ]);
  });

  it('Uno on ttyACM0', () => {
    const { usb, ports } = sysfs('uno-acm.synth.json');
    expect(usb[0]).toMatchObject({
      vid: '2341',
      pid: '0043',
      serialNumber: '95530343834351A0B1C2',
      driverName: 'cdc_acm',
    });
    expect(ports[0]).toMatchObject({ path: '/dev/ttyACM0', vid: '2341', pid: '0043' });
  });

  it('does not confuse 1-2 with 1-20 when matching paths', () => {
    const raw: LinuxSysfsRaw = {
      devices: [
        { name: '1-2', path: '/sys/x/1-2', attrs: { idVendor: '1a86', idProduct: '7523' } },
        { name: '1-20', path: '/sys/x/1-20', attrs: { idVendor: '10c4', idProduct: 'ea60' } },
      ],
      ttys: [{ name: 'ttyUSB0', devicePath: '/sys/x/1-20/1-20:1.0/ttyUSB0' }],
    };
    expect(parseLinuxSysfs(raw).ports[0]?.vid).toBe('10c4');
  });
});

describe('Linux text parsers', () => {
  it('lsusb', () => {
    const usb = parseLsusb(fixture('linux/lsusb-ch340.synth.txt'));
    expect(usb.map((d) => `${d.vid}:${d.pid}`)).toEqual(['1d6b:0003', '1a86:7523', '1d6b:0002']);
    expect(usb[1]?.product).toBe('QinHeng Electronics CH340 serial converter');
  });

  it('id -nG', () => {
    expect(parseIdGroups(fixture('linux/id-groups-no-dialout.txt'))).toEqual([
      'maker',
      'adm',
      'cdrom',
      'sudo',
      'plugdev',
    ]);
  });

  it('systemctl is-active', () => {
    expect(parseSystemctlIsActive(fixture('linux/systemctl-brltty-active.txt'))).toBe(true);
    expect(parseSystemctlIsActive(fixture('linux/systemctl-brltty-inactive.txt'))).toBe(false);
    expect(parseSystemctlIsActive('inactive\nactive\n')).toBe(true);
  });

  it('/etc/group', () => {
    expect(parseEtcGroup(fixture('linux/etc-group.txt')).get(20)).toBe('dialout');
  });

  it('fuser', () => {
    expect(parseFuserPids(' 4321 4400')).toEqual([4321, 4400]);
    expect(parseFuserPids('/dev/ttyUSB0:  4321m')).toEqual([4321]);
    expect(parseFuserPids('')).toEqual([]);
  });
});
