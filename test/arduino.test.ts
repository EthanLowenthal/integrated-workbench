import { describe, expect, it } from 'vitest';
import { ArduinoToolchain, cliCandidates } from '../src/toolchains/arduino/index.js';
import {
  parseBoardList,
  parseBoardListAll,
  parseCompilerDiagnostics,
  parseMissingHeaders,
  parseMissingPlatform,
  parseVersion,
} from '../src/toolchains/arduino/parse.js';
import type { StreamRunner } from '../src/toolchains/process.js';
import { fakeHost, fixture, ok } from './helpers.js';

describe('arduino-cli parsers', () => {
  it('version', () => {
    expect(parseVersion('{"Application":"arduino-cli","VersionString":"1.1.1","Commit":"fa6eafcb"}')).toBe(
      '1.1.1',
    );
    expect(parseVersion('not json')).toBeUndefined();
  });

  it('board list (1.x): recognized board, unrecognized CH340 clone; skips network ports', () => {
    const boards = parseBoardList(fixture('arduino/board-list-1x.synth.json'));
    expect(boards.map((b) => b.port)).toEqual([
      '/dev/cu.usbmodem1101',
      '/dev/cu.usbserial-110',
      '/dev/cu.Bluetooth-Incoming-Port',
    ]);
    expect(boards[0]).toEqual({
      port: '/dev/cu.usbmodem1101',
      target: { id: 'arduino:avr:uno', name: 'Arduino Uno' },
      candidates: [{ id: 'arduino:avr:uno', name: 'Arduino Uno' }],
      vid: '2341',
      pid: '0043',
      serialNumber: '95530343834351A0B1C2',
    });
    expect(boards[1]).toMatchObject({ target: undefined, candidates: [], vid: '1a86', pid: '7523' });
  });

  it('board list (0.x array): ambiguous match leaves target unset', () => {
    const [b] = parseBoardList(fixture('arduino/board-list-0x.synth.json'));
    expect(b).toMatchObject({ port: 'COM9', target: undefined });
    expect(b!.candidates).toHaveLength(2);
  });

  it('board list: empty output', () => {
    expect(parseBoardList('{}')).toEqual([]);
    expect(parseBoardList('')).toEqual([]);
  });

  it('board listall sorted by name', () => {
    expect(parseBoardListAll(fixture('arduino/board-listall.synth.json')).map((t) => t.name)).toEqual([
      'Arduino Leonardo',
      'Arduino Mega or Mega 2560',
      'Arduino Uno',
    ]);
  });

  it('compiler diagnostics: dedupes, skips notes, maps copied .cpp back to the sketch', () => {
    const ds = parseCompilerDiagnostics(fixture('arduino/compile-errors-macos.synth.txt'), {
      buildPath: '/tmp/sd-build/Blink-abc',
      sketchRoot: '/Users/me/Arduino/Blink',
    });
    expect(ds).toEqual([
      {
        file: '/Users/me/Arduino/Blink/Blink.ino',
        line: 7,
        column: 3,
        severity: 'error',
        message: "'digitalWirte' was not declared in this scope",
      },
      {
        file: '/Users/me/Arduino/Blink/helper.cpp',
        line: 12,
        column: 7,
        severity: 'warning',
        message: "unused variable 'x' [-Wunused-variable]",
      },
    ]);
  });

  it('compiler diagnostics: Windows drive letters, fatal errors, no column', () => {
    const ds = parseCompilerDiagnostics(fixture('arduino/compile-errors-windows.synth.txt'), {
      buildPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\sd\\Blink-abc',
      sketchRoot: 'C:\\Users\\me\\Documents\\Arduino\\Blink',
    });
    expect(ds[0]).toMatchObject({
      file: 'C:\\Users\\me\\Documents\\Arduino\\Blink\\Blink.ino',
      line: 3,
      column: 10,
      severity: 'error',
      message: 'Servo.h: No such file or directory',
    });
    expect(ds[1]).toMatchObject({
      file: 'C:\\Users\\me\\Documents\\Arduino\\Blink/util.h',
      line: 4,
      column: undefined,
    });
  });

  it('missing platform and headers', () => {
    expect(parseMissingPlatform(fixture('arduino/compile-platform-missing.synth.txt'))).toBe('esp32:esp32');
    expect(parseMissingPlatform('platform not installed', 'rp2040:rp2040:rpipico')).toBe('rp2040:rp2040');
    expect(parseMissingPlatform('all good')).toBeUndefined();
    expect(parseMissingHeaders(fixture('arduino/compile-errors-windows.synth.txt'))).toEqual(['Servo.h']);
  });
});

describe('ArduinoToolchain', () => {
  const version = ok('{"VersionString":"1.1.1"}');

  it('finds arduino-cli outside PATH (Dock-launched VS Code on macOS)', async () => {
    const host = fakeHost({
      run: (file) => (file === '/opt/homebrew/bin/arduino-cli' ? version : undefined),
    });
    const tc = new ArduinoToolchain({ host, buildRoot: '/b', platform: 'darwin' });
    expect(await tc.checkInstalled()).toEqual({
      installed: true,
      path: '/opt/homebrew/bin/arduino-cli',
      version: '1.1.1',
    });
  });

  it('uses only the configured path when set', async () => {
    const host = fakeHost({ run: (file) => (file === 'arduino-cli' ? version : undefined) });
    const tc = new ArduinoToolchain({
      host,
      buildRoot: '/b',
      cliPath: () => '/custom/arduino-cli',
      platform: 'linux',
    });
    expect(await tc.checkInstalled()).toEqual({
      installed: false,
      reason: 'arduino-cli not found at /custom/arduino-cli',
    });
  });

  it('candidate list starts with PATH lookup on every OS', () => {
    for (const p of ['darwin', 'linux', 'win32'] as const)
      expect(cliCandidates(p, '/home/me')[0]).toMatch(/^arduino-cli/);
  });

  it('findProject: sketch folder must contain <folder>.ino; works from .cpp and src/ files', async () => {
    const host = fakeHost({
      dirs: {
        '/s/Blink': ['Blink.ino', 'helper.cpp', 'src'],
        '/s/Blink/src': ['lib.cpp'],
        '/s/notasketch': ['main.cpp'],
      },
    });
    const tc = new ArduinoToolchain({ host, buildRoot: '/b' });
    expect(await tc.findProject('/s/Blink/Blink.ino')).toEqual({ root: '/s/Blink', name: 'Blink' });
    expect(await tc.findProject('/s/Blink/helper.cpp')).toEqual({ root: '/s/Blink', name: 'Blink' });
    expect(await tc.findProject('/s/Blink/src/lib.cpp')).toEqual({ root: '/s/Blink', name: 'Blink' });
    expect(await tc.findProject('/s/notasketch/main.cpp')).toBeUndefined();
    expect(await tc.findProject('/s/Blink/README.md')).toBeUndefined();
  });

  it('build: argument array, streamed output, diagnostics and missing-core fix', async () => {
    const calls: string[][] = [];
    const stream: StreamRunner = async (_file, args, opts) => {
      calls.push(args);
      if (args[0] === 'compile') {
        opts?.onStderr?.('compiling...\n');
        return { code: 1, stdout: '', stderr: fixture('arduino/compile-platform-missing.synth.txt') };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const host = fakeHost({ run: () => version });
    const tc = new ArduinoToolchain({ host, buildRoot: '/b', stream });
    const out: string[] = [];
    const res = await tc.build({
      project: { root: '/s/Blink', name: 'Blink' },
      target: { id: 'esp32:esp32:esp32s3', name: 'ESP32S3 Dev Module' },
      onOutput: (t) => out.push(t),
    });
    expect(res.success).toBe(false);
    expect(calls[0]).toEqual([
      'compile',
      '--fqbn',
      'esp32:esp32:esp32s3',
      '--build-path',
      expect.stringMatching(/^\/b\/Blink-/),
      '/s/Blink',
    ]);
    expect(out.join('')).toContain('compiling...');
    expect(res.fix?.label).toBe('Install esp32:esp32');

    // The fix only runs when applied, and runs update-index then install.
    expect(calls).toHaveLength(1);
    expect(await res.fix!.apply(() => {})).toBe(true);
    expect(calls.slice(1)).toEqual([
      ['core', 'update-index'],
      ['core', 'install', 'esp32:esp32'],
    ]);
  });

  it('flash uploads from the same build folder', async () => {
    const calls: string[][] = [];
    const stream: StreamRunner = async (_f, args) => (calls.push(args), { code: 0, stdout: '', stderr: '' });
    const tc = new ArduinoToolchain({ host: fakeHost({ run: () => version }), buildRoot: '/b', stream });
    const project = { root: '/s/Blink', name: 'Blink' };
    await tc.flash({
      project,
      target: { id: 'arduino:avr:uno', name: 'Uno' },
      port: 'COM5',
      onOutput: () => {},
    });
    expect(calls[0]).toEqual([
      'upload',
      '-p',
      'COM5',
      '--fqbn',
      'arduino:avr:uno',
      '--input-dir',
      tc.buildPath(project),
      '/s/Blink',
    ]);
  });
});
