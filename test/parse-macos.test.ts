import { describe, expect, it } from 'vitest';
import { parseLsofF } from '../src/core/parse/common.js';
import {
  parseDevListing,
  parseIoregTree,
  parseIoregUsb,
  parseSystemProfilerUsb,
} from '../src/core/parse/macos.js';
import { fixture } from './helpers.js';

describe('parseIoregUsb', () => {
  it('real machine, no boards: finds devices, no ports, no duplicates', () => {
    const { usb, ports } = parseIoregUsb(fixture('macos/ioreg-no-boards.real.txt'));
    expect(ports).toEqual([]);
    expect(usb.length).toBeGreaterThan(3);
    expect(new Set(usb.map((d) => d.location)).size).toBe(usb.length);
    expect(usb.some((d) => d.vid === '046d' && d.pid === 'c52b')).toBe(true); // Logitech receiver
    for (const d of usb) {
      expect(d.vid).toMatch(/^[0-9a-f]{4}$/);
      expect(d.pid).toMatch(/^[0-9a-f]{4}$/);
    }
  });

  it('CH340: ties /dev/cu.usbserial-110 to the device and marks driver ok', () => {
    const { usb, ports } = parseIoregUsb(fixture('macos/ioreg-ch340.synth.txt'));
    expect(usb).toEqual([
      expect.objectContaining({ vid: '1a86', pid: '7523', location: '0x01100000', driverStatus: 'ok' }),
    ]);
    expect(ports).toEqual([
      { path: '/dev/cu.usbserial-110', vid: '1a86', pid: '7523', usbLocation: '0x01100000' },
    ]);
  });

  it('CH340 without a bound driver: device, no port, driver unknown', () => {
    const { usb, ports } = parseIoregUsb(fixture('macos/ioreg-ch340-no-port.synth.txt'));
    expect(usb).toEqual([expect.objectContaining({ vid: '1a86', pid: '7523', driverStatus: 'unknown' })]);
    expect(ports).toEqual([]);
  });

  it('CP2102 and ESP32-S3', () => {
    const cp = parseIoregUsb(fixture('macos/ioreg-cp2102.synth.txt'));
    expect(cp.usb[0]).toMatchObject({
      vid: '10c4',
      pid: 'ea60',
      serialNumber: '0001',
      manufacturer: 'Silicon Labs',
    });
    expect(cp.ports[0]?.path).toBe('/dev/cu.usbserial-0001');

    const esp = parseIoregUsb(fixture('macos/ioreg-esp32s3.synth.txt'));
    expect(esp.usb[0]).toMatchObject({ vid: '303a', pid: '1001' });
    expect(esp.ports[0]).toMatchObject({ path: '/dev/cu.usbmodem1101', vid: '303a', pid: '1001' });
  });

  it('builds a parent chain from indentation', () => {
    const nodes = parseIoregTree(fixture('macos/ioreg-ch340.synth.txt'));
    const client = nodes.find((n) => n.cls === 'IOSerialBSDClient');
    expect(client?.parent?.cls).toBe('AppleUSBCHCOMDevice');
    expect(client?.parent?.parent?.parent?.cls).toBe('IOUSBHostDevice');
  });
});

describe('parseSystemProfilerUsb', () => {
  it('new SPUSBHostDataType format (real)', () => {
    const usb = parseSystemProfilerUsb(fixture('macos/sp-usbhost-no-boards.real.json'));
    expect(usb.some((d) => d.vid === '046d' && d.pid === 'c52b')).toBe(true);
    expect(usb.every((d) => d.location?.startsWith('0x'))).toBe(true);
  });

  it('legacy SPUSBDataType format', () => {
    expect(parseSystemProfilerUsb(fixture('macos/sp-usb-legacy-ch340.synth.json'))).toEqual([
      {
        vid: '1a86',
        pid: '7523',
        serialNumber: undefined,
        manufacturer: 'QinHeng Electronics',
        product: 'USB2.0-Serial',
        location: '0x14100000',
        driverStatus: 'unknown',
      },
    ]);
  });
});

describe('parseDevListing / parseLsofF', () => {
  it('keeps cu.* only and drops Bluetooth / debug-console', () => {
    expect(
      parseDevListing([
        'tty.usbserial-110',
        'cu.usbserial-110',
        'cu.Bluetooth-Incoming-Port',
        'cu.debug-console',
        'null',
      ]),
    ).toEqual([{ path: '/dev/cu.usbserial-110' }]);
  });

  it('parses lsof -F pc', () => {
    expect(parseLsofF(fixture('macos/lsof-in-use.synth.txt'))).toEqual([{ pid: 4321, name: 'screen' }]);
    expect(parseLsofF('')).toEqual([]);
  });
});
