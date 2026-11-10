import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUf2Drives, parseInfoUf2, uf2Families, uf2Fits } from '../src/toolchains/micropython/uf2.js';
import { errorLine, esptoolSteps } from '../src/toolchains/micropython/esptool.js';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'micropython', n)));
// First two 512-byte blocks of MicroPython 1.29.0 for Pico (RP2040) and Pico 2 (RP2350).
const pico = fx('rpi-pico-head.real.uf2');
const pico2 = fx('rpi-pico2-head.real.uf2');

// INFO_UF2.TXT as the RP2040 and RP2350 boot ROMs write it (synthesized from their documented format).
const RP2040_INFO = 'UF2 Bootloader v3.0\r\nModel: Raspberry Pi RP2\r\nBoard-ID: RPI-RP2\r\n';
const RP2350_INFO = 'UF2 Bootloader v1.0\r\nModel: Raspberry Pi RP2350\r\nBoard-ID: RP2350\r\n';

describe('UF2 files', () => {
  it('reads family IDs from real firmware blocks', () => {
    expect([...uf2Families(pico)]).toEqual([0xe48bff56]);
    expect([...uf2Families(pico2)].sort()).toEqual([0xe48bff57, 0xe48bff59]);
    expect(uf2Families(new Uint8Array(1024)).size).toBe(0);
  });

  it('only lets firmware onto the chip it is built for', () => {
    expect(uf2Fits(pico, 'RPI-RP2')).toBe(true);
    expect(uf2Fits(pico, 'RP2350')).toBe(false);
    expect(uf2Fits(pico2, 'RP2350')).toBe(true);
    expect(uf2Fits(pico2, 'RPI-RP2')).toBe(false);
    expect(uf2Fits(pico, 'SOME-OTHER-BOARD')).toBe(true); // unknown bootloader: allowed
    expect(uf2Fits(new Uint8Array(1024), 'RPI-RP2')).toBe(false); // not a UF2 file
  });
});

describe('UF2 drives', () => {
  it('parses INFO_UF2.TXT', () => {
    expect(parseInfoUf2(RP2040_INFO)).toEqual({ boardId: 'RPI-RP2', model: 'Raspberry Pi RP2' });
    expect(parseInfoUf2(RP2350_INFO).boardId).toBe('RP2350');
    expect(parseInfoUf2('nothing').boardId).toBeUndefined();
  });

  const fakeFs = (dirs: Record<string, string[]>, files: Record<string, string>) => ({
    readdir: async (p: string) => {
      if (!dirs[p]) throw new Error('ENOENT');
      return dirs[p]!;
    },
    readFile: async (p: string) => {
      if (files[p] === undefined) throw new Error('ENOENT');
      return files[p]!;
    },
  });

  it('macOS: finds the drive among /Volumes', async () => {
    const drives = await findUf2Drives({
      platform: 'darwin',
      ...fakeFs(
        { '/Volumes': ['Macintosh HD', 'RPI-RP2', 'USB STICK'] },
        { '/Volumes/RPI-RP2/INFO_UF2.TXT': RP2040_INFO },
      ),
    });
    expect(drives).toEqual([{ path: '/Volumes/RPI-RP2', boardId: 'RPI-RP2', model: 'Raspberry Pi RP2' }]);
  });

  it('Linux: looks under /media/<user> and /run/media/<user>', async () => {
    const drives = await findUf2Drives({
      platform: 'linux',
      user: 'pat',
      ...fakeFs({ '/run/media/pat': ['RP2350'] }, { '/run/media/pat/RP2350/INFO_UF2.TXT': RP2350_INFO }),
    });
    expect(drives.map((d) => [d.path, d.boardId])).toEqual([['/run/media/pat/RP2350', 'RP2350']]);
  });

  it('Windows: checks drive letters', async () => {
    const drives = await findUf2Drives({
      platform: 'win32',
      ...fakeFs({}, { [join('E:\\', 'INFO_UF2.TXT')]: RP2040_INFO }),
    });
    expect(drives.map((d) => d.boardId)).toEqual(['RPI-RP2']);
  });

  it('nothing mounted', async () => {
    expect(await findUf2Drives({ platform: 'darwin', ...fakeFs({ '/Volumes': [] }, {}) })).toEqual([]);
  });
});

describe('esptool', () => {
  it('erases, then writes at the firmware offset', () => {
    expect(esptoolSteps('esp32s3', '0x0', '/dev/cu.usbmodem1101', '/fw/x.bin')).toEqual({
      erase: ['--chip', 'esp32s3', '--port', '/dev/cu.usbmodem1101', 'erase-flash'],
      write: [
        '--chip',
        'esp32s3',
        '--port',
        '/dev/cu.usbmodem1101',
        '--baud',
        '460800',
        'write-flash',
        '0x0',
        '/fw/x.bin',
      ],
    });
  });

  it('reports the error line, not the troubleshooting link (esptool 5.6.0, real output)', () => {
    const out =
      'esptool v5.6.0\nConnecting...\n\nA fatal error occurred: Failed to connect to ESP32: No serial data received.\nFor troubleshooting steps visit: https://docs.espressif.com/projects/esptool/en/latest/troubleshooting.html\n';
    expect(errorLine(out)).toBe('Failed to connect to ESP32: No serial data received.');
    expect(errorLine('just one line')).toBe('just one line');
  });
});
