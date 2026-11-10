import { describe, expect, it } from 'vitest';
import { driverStatusFromErrorCode, parseWindowsPnp } from '../src/core/parse/windows.js';
import { fixture } from './helpers.js';

const parse = (name: string) => parseWindowsPnp(fixture(`windows/${name}`));

describe('parseWindowsPnp', () => {
  it('nothing connected: ignores root hubs and interface children, keeps COM1 without VID', () => {
    const { usb, ports } = parse('nothing-connected.synth.json');
    expect(usb.map((d) => `${d.vid}:${d.pid}`)).toEqual(['046d:c52b']);
    expect(ports).toEqual([{ path: 'COM1', vid: undefined, pid: undefined, usbLocation: undefined }]);
  });

  it('CH340 with driver: one node is both the USB device and COM5', () => {
    const { usb, ports } = parse('ch340-driver-ok.synth.json');
    const ch340 = usb.find((d) => d.vid === '1a86');
    expect(ch340).toMatchObject({
      pid: '7523',
      driverStatus: 'ok',
      driverName: 'CH341SER_A64',
      product: 'USB-SERIAL CH340',
      serialNumber: undefined, // Windows-generated instance ID, not a real serial
    });
    expect(ports.find((p) => p.path === 'COM5')).toMatchObject({
      vid: '1a86',
      pid: '7523',
      usbLocation: ch340!.location,
    });
  });

  it('CH340 without driver: problem code 28 -> missing, no port', () => {
    const { usb, ports } = parse('ch340-no-driver.synth.json');
    expect(usb.find((d) => d.vid === '1a86')).toMatchObject({ driverStatus: 'missing', osErrorCode: 28 });
    expect(ports.map((p) => p.path)).toEqual(['COM1']);
  });

  it('accepts Get-PnpDevice output with a string Problem', () => {
    const { usb } = parse('ch340-no-driver.get-pnpdevice.synth.json');
    expect(usb).toHaveLength(1);
    expect(usb[0]).toMatchObject({ vid: '1a86', pid: '7523', driverStatus: 'missing', osErrorCode: 28 });
  });

  it('genuine Uno: real serial number kept', () => {
    const { usb, ports } = parse('uno-genuine.synth.json');
    expect(usb[0]).toMatchObject({ vid: '2341', pid: '0043', serialNumber: '95530343834351A0B1C2' });
    expect(ports.find((p) => p.path === 'COM3')?.usbLocation).toBe(usb[0]!.location);
  });

  it('FTDI: links FTDIBUS port node back to its USB parent', () => {
    const { usb, ports } = parse('ftdi.synth.json');
    expect(usb).toHaveLength(1);
    expect(usb[0]).toMatchObject({ vid: '0403', pid: '6001', serialNumber: 'A50285BI' });
    expect(ports).toEqual([{ path: 'COM7', vid: '0403', pid: '6001', usbLocation: usb[0]!.location }]);
  });

  it('composite native USB: port lives on the MI_00 child, linked to the parent', () => {
    const { usb, ports } = parse('leonardo-composite.synth.json');
    expect(usb).toHaveLength(1);
    expect(ports).toEqual([{ path: 'COM9', vid: '2341', pid: '8036', usbLocation: usb[0]!.location }]);
  });

  it('handles ConvertTo-Json single-object output and empty output', () => {
    expect(parse('cp2102-single-object.synth.json').ports.map((p) => p.path)).toEqual(['COM4']);
    expect(parseWindowsPnp('')).toEqual({ usb: [], ports: [] });
  });

  it('maps error codes', () => {
    expect(driverStatusFromErrorCode(0)).toBe('ok');
    expect(driverStatusFromErrorCode(28)).toBe('missing');
    expect(driverStatusFromErrorCode(43)).toBe('error');
    expect(driverStatusFromErrorCode(10)).toBe('error');
  });
});
