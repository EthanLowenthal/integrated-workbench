import { describe, expect, it } from 'vitest';
import {
  rewriteForSketch,
  sketchIntelliSense,
  type CompileDbEntry,
} from '../src/toolchains/arduino/compileDb.js';
import { formatFqbn, parseFqbn, platformOf } from '../src/toolchains/arduino/fqbn.js';
import { parseBoardDetails, parseCompilerDiagnostics } from '../src/toolchains/arduino/parse.js';
import { fixture, fixtureJson } from './helpers.js';

describe('FQBN', () => {
  it('parses and formats board IDs with options', () => {
    expect(parseFqbn('esp32:esp32:esp32s3:FlashSize=8M,PSRAM=opi')).toEqual({
      base: 'esp32:esp32:esp32s3',
      options: { FlashSize: '8M', PSRAM: 'opi' },
    });
    expect(parseFqbn('arduino:avr:uno')).toEqual({ base: 'arduino:avr:uno', options: {} });
    expect(formatFqbn('arduino:avr:nano', { cpu: 'atmega328old' })).toBe('arduino:avr:nano:cpu=atmega328old');
    expect(formatFqbn('arduino:avr:nano', {})).toBe('arduino:avr:nano');
    expect(platformOf('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE')).toBe(
      'STMicroelectronics:stm32',
    );
  });
});

describe('board details (arduino-cli 1.5.1, real)', () => {
  it('Nano: one option (Processor) with its default', () => {
    expect(parseBoardDetails(fixture('arduino/board-details-nano.real.json'))).toEqual([
      {
        id: 'cpu',
        label: 'Processor',
        values: [
          { id: 'atmega328', label: 'ATmega328P' },
          { id: 'atmega328old', label: 'ATmega328P (Old Bootloader)' },
          { id: 'atmega168', label: 'ATmega168' },
        ],
        defaultValue: 'atmega328',
      },
    ]);
  });

  it('boards without options (Uno) have no config_options field', () => {
    expect(parseBoardDetails('{"fqbn":"arduino:avr:uno","name":"Arduino Uno"}')).toEqual([]);
  });
});

describe('compiler errors (arduino-cli 1.5.1 + avr-gcc, real BrokenSketch)', () => {
  it('finds both errors at the real files and lines, and ignores notes', () => {
    const ds = parseCompilerDiagnostics(fixture('arduino/compile-errors-avr.real.txt'), {
      buildPath: '<BUILD>',
      sketchRoot: '<SKETCH>',
    });
    expect(ds.map((d) => [d.file.split('/').pop(), d.line, d.column, d.severity])).toEqual([
      ['BrokenSketch.ino', 10, 3, 'error'],
      ['helper.cpp', 6, 3, 'error'],
    ]);
    expect(ds[1]!.message).toBe("expected ';' before 'delay'");
  });
});

describe('IntelliSense from the compilation database (real MultiFile)', () => {
  const entries = fixtureJson<CompileDbEntry[]>('arduino/compile-commands-multifile.real.json');
  const build = '/tmp/iw/build/MultiFile-abc-intellisense';
  const sketch = '/home/me/sketches/MultiFile';
  const ino = `${sketch}/MultiFile.ino`;
  const core = '/home/me/.arduino15/packages/arduino/hardware/avr/1.8.8/cores/arduino';
  const findArduinoH = (paths: string[]) => (paths.includes(core) ? `${core}/Arduino.h` : undefined);

  it('maps .ino and copied .cpp entries back to the files the user edits', () => {
    const r = sketchIntelliSense(entries, build, sketch, [ino], findArduinoH);
    expect([...r.files.keys()].sort()).toEqual([ino, `${sketch}/blinker.cpp`]);
    const inoCfg = r.files.get(ino)!;
    expect(inoCfg.forcedInclude).toEqual([`${core}/Arduino.h`]);
    expect(inoCfg.includePath).toContain(core);
    expect(inoCfg.defines).toEqual(
      expect.arrayContaining(['F_CPU=16000000L', 'ARDUINO_AVR_UNO', 'ARDUINO_ARCH_AVR']),
    );
    expect(inoCfg.standard).toBe('gnu++11');
    expect(inoCfg.compilerPath).toMatch(/avr-g\+\+$/);
    expect(inoCfg.compilerArgs).toContain('-mmcu=atmega328p');
    expect(r.files.get(`${sketch}/blinker.cpp`)!.forcedInclude).toEqual([]);
    expect(r.fallback?.standard).toBe('gnu++11');
    expect(r.browsePath).toContain(core);
  });

  it('rewrites a clangd-friendly database pointing at the real sketch files', () => {
    const out = rewriteForSketch(entries, build, sketch, [ino]);
    const inoEntry = out.find((e) => e.file === ino)!;
    expect(inoEntry.arguments).toEqual(expect.arrayContaining(['-x', 'c++', '-include', 'Arduino.h', ino]));
    expect(out.find((e) => e.file === `${sketch}/blinker.cpp`)?.arguments).toContain(`${sketch}/blinker.cpp`);
    expect(out.some((e) => e.file.endsWith('WString.cpp'))).toBe(true); // core entries kept as-is
  });
});
