import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lookupChip, createChipDb } from '../src/core/chips.js';
import {
  loadRegistry,
  mergeRegistries,
  parseRegistrySpec,
  validateRegistryFile,
  type RegistryIO,
} from '../src/registry/load.js';
import { globsToCheck, recommend } from '../src/registry/recommend.js';
import type { ToolPackage } from '../src/registry/types.js';
import { nodeRegistryIO } from '../src/registry/io.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'workbench-registry');

/** In-memory registry files keyed by URL or path. */
function memoryIO(files: Record<string, unknown>): RegistryIO {
  return {
    async read(loc) {
      const key = loc.kind === 'url' ? loc.url : loc.path;
      if (!(key in files)) throw new Error(`404 ${key}`);
      return typeof files[key] === 'string' ? (files[key] as string) : JSON.stringify(files[key]);
    },
  };
}

describe('built-in registry', () => {
  it('loads with no errors or duplicate warnings', async () => {
    const loaded = await loadRegistry(root, nodeRegistryIO, { builtin: true });
    expect(loaded.errors).toEqual([]);
    expect(loaded.name).toBe('Integrated Workbench');
    expect(loaded.files.map((f) => f.location.split('/').pop())).toEqual([
      'index.json',
      'tools.json',
      'arduino-cores.json',
      'usb.json',
      'drivers.json',
      'recipes.json',
      'firmware.json',
    ]);
    const reg = mergeRegistries([loaded]);
    expect(reg.warnings).toEqual([]);
    expect(reg.packages.every((p) => p.origin.builtin)).toBe(true);
  });

  it('has arduino-cli for every common OS/CPU, each with a sha256', async () => {
    const reg = mergeRegistries([await loadRegistry(root, nodeRegistryIO, { builtin: true })]);
    const cli = reg.packages.find((p) => p.id === 'arduino-cli') as ToolPackage;
    for (const k of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']) {
      expect(cli.downloads[k]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(cli.downloads['win32-x64']?.bin).toBe('arduino-cli.exe');
  });

  it('MicroPython firmware: a sha256 per file, uf2 entries name their drive, esptool entries their chip', async () => {
    const loaded = await loadRegistry(root, nodeRegistryIO, { builtin: true });
    const fw = loaded.files.flatMap((f) => f.data.packages ?? []).filter((p) => p.kind === 'firmware');
    expect(fw.length).toBeGreaterThanOrEqual(7);
    for (const p of fw) {
      if (p.kind !== 'firmware') continue;
      expect(p.file.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (p.method === 'uf2') expect(p.uf2BoardIds?.length).toBeGreaterThan(0);
      else expect(p.chip && p.address).toBeTruthy();
    }
  });

  it('every usb entry that names a driver points at a real driver entry', () => {
    const usb = JSON.parse(readFileSync(join(root, 'usb.json'), 'utf8')).usb as { driver?: string }[];
    const ids = new Set(
      (JSON.parse(readFileSync(join(root, 'drivers.json'), 'utf8')).drivers as { id: string }[]).map(
        (d) => d.id,
      ),
    );
    for (const u of usb) if (u.driver) expect(ids).toContain(u.driver);
  });

  it('the bundled USB table still answers lookups', () => {
    expect(lookupChip('1a86', '7523').chip?.name).toBe('CH340');
    expect(lookupChip('1A86', '0xffff').label).toBe('WCH device');
    expect(lookupChip('abcd', '1234').label).toBe('Unknown device');
  });
});

describe('parseRegistrySpec', () => {
  it.each([
    ['me/boards', 'https://raw.githubusercontent.com/me/boards/HEAD/workbench-registry/index.json'],
    ['me/boards@dev', 'https://raw.githubusercontent.com/me/boards/dev/workbench-registry/index.json'],
    [
      'https://github.com/me/boards',
      'https://raw.githubusercontent.com/me/boards/HEAD/workbench-registry/index.json',
    ],
    [
      'https://github.com/me/boards.git',
      'https://raw.githubusercontent.com/me/boards/HEAD/workbench-registry/index.json',
    ],
    ['https://example.com/reg/index.json', 'https://example.com/reg/index.json'],
  ])('%s', (spec, url) => {
    expect(parseRegistrySpec(spec)).toEqual({ kind: 'url', url });
  });

  it('local folders and files', () => {
    expect(parseRegistrySpec('/home/me/my-registry')).toEqual({
      kind: 'file',
      path: '/home/me/my-registry/index.json',
    });
    expect(parseRegistrySpec('~/reg', '/home/me')).toEqual({ kind: 'file', path: '/home/me/reg/index.json' });
    expect(parseRegistrySpec('/x/custom.json')).toEqual({ kind: 'file', path: '/x/custom.json' });
  });

  it('rejects http, non-json URLs and relative paths', () => {
    expect(parseRegistrySpec('http://example.com/index.json')).toHaveProperty('error');
    expect(parseRegistrySpec('https://example.com/reg/')).toHaveProperty('error');
    expect(parseRegistrySpec('./reg')).toHaveProperty('error');
  });
});

describe('loadRegistry', () => {
  const base = 'https://raw.githubusercontent.com/me/boards/HEAD/workbench-registry/';

  it('resolves includes relative to index.json, reading each file once', async () => {
    const io = memoryIO({
      [`${base}index.json`]: { schema: 1, name: 'My boards', include: ['usb.json', 'more/cores.json'] },
      [`${base}usb.json`]: { schema: 1, usb: [{ vid: 'cafe', name: 'My Board', kind: 'native' }] },
      [`${base}more/cores.json`]: { schema: 1, include: ['usb.json'], packages: [] },
    });
    const l = await loadRegistry('me/boards', io);
    expect(l.errors).toEqual([]);
    expect(l.name).toBe('My boards');
    expect(l.files).toHaveLength(3);
  });

  it('reports invalid files with the field that is wrong, and keeps the valid ones', async () => {
    const io = memoryIO({
      [`${base}index.json`]: { schema: 1, include: ['bad.json', 'missing.json', 'broken.json'] },
      [`${base}bad.json`]: { schema: 1, usb: [{ vid: 'CAFE', name: 'x', kind: 'other' }] },
      [`${base}broken.json`]: '{ not json',
    });
    const l = await loadRegistry('me/boards', io);
    expect(l.files).toHaveLength(1);
    expect(l.errors.join('\n')).toMatch(/bad\.json: \/usb\/0\/vid must match pattern/);
    expect(l.errors.join('\n')).toMatch(
      /bad\.json: \/usb\/0\/kind must be equal to one of the allowed values \(bridge, native\)/,
    );
    expect(l.errors.join('\n')).toMatch(/missing\.json: could not be read/);
    expect(l.errors.join('\n')).toMatch(/broken\.json: not valid JSON/);
  });

  it('a tool package must have a sha256 for every download', () => {
    const errs = validateRegistryFile({
      schema: 1,
      packages: [
        {
          id: 'x',
          kind: 'tool',
          name: 'X',
          version: '1',
          provides: ['x'],
          downloads: { 'linux-x64': { url: 'https://e/x', bin: 'x' } },
        },
      ],
    });
    expect(errs.join('\n')).toMatch(/sha256/);
  });

  it('rejects include paths that escape the registry', () => {
    expect(validateRegistryFile({ schema: 1, include: ['../../etc/passwd.json'] }).length).toBeGreaterThan(0);
    expect(validateRegistryFile({ schema: 1, include: ['/abs.json'] }).length).toBeGreaterThan(0);
  });
});

describe('mergeRegistries', () => {
  it('first registry wins on duplicate ids; later ones can add, with a warning on conflicts', async () => {
    const io = memoryIO({
      '/a/index.json': {
        schema: 1,
        name: 'A',
        usb: [{ vid: '1a86', pid: '7523', name: 'CH340', kind: 'bridge' }],
      },
      '/b/index.json': {
        schema: 1,
        name: 'B',
        usb: [
          { vid: '1a86', pid: '7523', name: 'Totally Not CH340', kind: 'bridge' },
          { vid: 'cafe', pid: '0001', name: 'My Board', kind: 'native' },
        ],
      },
    });
    const reg = mergeRegistries([
      await loadRegistry('/a', io, { builtin: true }),
      await loadRegistry('/b', io),
    ]);
    const db = createChipDb(reg.usb);
    expect(lookupChip('1a86', '7523', db).chip?.name).toBe('CH340');
    expect(lookupChip('cafe', '0001', db).chip?.name).toBe('My Board');
    expect(reg.warnings).toEqual(['B: usb "1a86:7523" is already defined by A; ignored.']);
    expect(reg.usb.find((u) => u.vid === 'cafe')?.origin).toEqual({ registry: 'B', builtin: false });
  });
});

describe('recommend', () => {
  it('recommends from files, plugged-in USB devices and sketch boards, with reasons', async () => {
    const reg = mergeRegistries([await loadRegistry(root, nodeRegistryIO, { builtin: true })]);
    expect(globsToCheck(reg.packages)).toContain('**/*.ino');
    const recs = recommend(reg.packages, {
      matchedGlobs: new Set(['**/*.ino']),
      usb: [
        { vid: '303a', pid: '1001', name: 'ESP32-S3' },
        { vid: '046d', pid: 'c52b', name: 'Mouse' },
      ],
      sketches: [{ name: 'Blink', fqbn: 'arduino:avr:uno', boardName: 'Arduino Uno' }],
    });
    expect(recs.map((r) => [r.pkg.id, r.reasons])).toEqual([
      ['arduino-cli', ['Required to build .ino sketches']],
      ['serial-monitor', ['Required for the Serial Monitor']],
      ['arduino:avr', ['Blink targets Arduino Uno']],
      ['esp32:esp32', ['ESP32-S3 connected']],
    ]);
  });

  it('STM32: a plugged-in Nucleo (ST-LINK/V2-1) recommends the STM32 board package', async () => {
    const reg = mergeRegistries([await loadRegistry(root, nodeRegistryIO, { builtin: true })]);
    const db = createChipDb(reg.usb);
    const name = lookupChip('0483', '374b', db).chip!.name;
    expect(name).toBe('ST-LINK/V2-1 (Nucleo, Discovery)');
    expect(lookupChip('0483', 'df11', db).chip).toMatchObject({ bootloader: true, noSerialPort: true });
    const recs = recommend(reg.packages, {
      matchedGlobs: new Set(),
      usb: [{ vid: '0483', pid: '374b', name }],
      sketches: [],
    });
    expect(recs.map((r) => [r.pkg.id, r.reasons])).toEqual([
      ['stmicroelectronics:stm32', ['ST-LINK/V2-1 (Nucleo, Discovery) connected']],
    ]);
    const stm = reg.packages.find((p) => p.id === 'stmicroelectronics:stm32');
    expect(stm).toMatchObject({
      platform: 'STMicroelectronics:stm32',
      boardIndex: expect.stringContaining('stm32duino'),
    });
  });

  it('recommends nothing for an empty workspace with nothing plugged in', async () => {
    const reg = mergeRegistries([await loadRegistry(root, nodeRegistryIO, { builtin: true })]);
    expect(recommend(reg.packages, { matchedGlobs: new Set(), usb: [], sketches: [] })).toEqual([]);
  });

  it('all conditions in one rule must match', () => {
    const pkg = {
      id: 'x',
      kind: 'arduino-core' as const,
      platform: 'x:y',
      name: 'X',
      recommendWhen: [{ usb: ['cafe:*'], fqbn: ['x:y:*'], reason: '${device} with ${sketch}' }],
    };
    const ctx = {
      matchedGlobs: new Set<string>(),
      usb: [{ vid: 'cafe', pid: '0001', name: 'Board' }],
      sketches: [],
    };
    expect(recommend([pkg], ctx)).toEqual([]);
    expect(recommend([pkg], { ...ctx, sketches: [{ name: 'S', fqbn: 'x:y:z' }] })[0]?.reasons).toEqual([
      'Board with S',
    ]);
  });
});
