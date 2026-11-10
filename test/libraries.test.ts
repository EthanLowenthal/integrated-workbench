import { describe, expect, it } from 'vitest';
import { ArduinoToolchain } from '../src/toolchains/arduino/index.js';
import {
  architectureOf,
  includesIn,
  libraryForHeader,
  parseLibList,
  parseLibSearch,
  parseLibUpdatable,
  unresolvedIncludes,
} from '../src/toolchains/arduino/libraries.js';
import type { StreamRunner } from '../src/toolchains/process.js';
import { fakeHost, fixture, ok } from './helpers.js';

const byName = parseLibSearch(fixture('arduino/lib-search-name-servo.real.json'));
const byHeader = parseLibSearch(fixture('arduino/lib-search-provides-servo.real.json'));

describe('library index (arduino-cli 1.5.1, real)', () => {
  it('parses search results', () => {
    expect(byName.map((l) => l.name)).toEqual(['Servo']);
    expect(byName[0]).toMatchObject({
      version: '1.3.0',
      providesIncludes: [],
      maintainer: 'Arduino <info@arduino.cc>',
    });
    expect(byName[0]!.architectures).toContain('avr');
    expect(byHeader.map((l) => l.name)).toEqual(['XMC_Servo', 'vovagorodok_Servo']);
    expect(parseLibSearch(fixture('arduino/lib-search-servo.real.json')).length).toBeGreaterThan(3);
  });

  it('parses installed libraries, including ones bundled with the board package', () => {
    const all = parseLibList(fixture('arduino/lib-list-all-uno.real.json'));
    expect(all.map((l) => `${l.name}@${l.location}`)).toEqual([
      'Wire@platform',
      'Servo@user',
      'EEPROM@platform',
      'HID@platform',
      'SPI@platform',
      'SoftwareSerial@platform',
    ]);
    expect(all.find((l) => l.name === 'Servo')?.providesIncludes).toEqual(['Servo.h']);
    expect(parseLibList('{"installed_libraries": []}')).toEqual([]);
  });
});

describe('libraryForHeader', () => {
  it('Servo.h on an Uno is the official Servo, not a lookalike that merely declares the header', () => {
    expect(libraryForHeader('Servo.h', [...byName, ...byHeader], 'avr')?.name).toBe('Servo');
  });

  it("skips libraries that don't support the board's architecture", () => {
    expect(libraryForHeader('Servo.h', [...byName, ...byHeader], 'xmc')?.name).toBe('XMC_Servo');
  });

  it('returns nothing when no candidate matches the header', () => {
    expect(libraryForHeader('Nope.h', byName, 'avr')).toBeUndefined();
    expect(architectureOf('esp32:esp32:esp32s3:FlashSize=8M')).toBe('esp32');
  });
});

describe('includes', () => {
  it('finds includes and keeps only ones a library would provide', () => {
    const src =
      '#include <Servo.h>\n  #include "blinker.h"\n#include <Wire.h>\n#include <avr/pgmspace.h>\n#include <Arduino.h>\n#include <FastLED.h>\n#include <string.h>\n';
    const inc = includesIn(src);
    expect(inc).toEqual([
      'Servo.h',
      'blinker.h',
      'Wire.h',
      'avr/pgmspace.h',
      'Arduino.h',
      'FastLED.h',
      'string.h',
    ]);
    const installed = parseLibList(fixture('arduino/lib-list-all-uno.real.json'));
    // Servo and Wire are installed; blinker.h is a sketch file; avr/ and std/core headers are never libraries.
    expect(unresolvedIncludes(inc, installed, ['/s/MultiFile/blinker.h'])).toEqual(['FastLED.h']);
  });
});

describe('missing #include -> Install library fix', () => {
  it('a compile failing on FastLED.h offers to install FastLED, and applying it runs lib install', async () => {
    const calls: string[][] = [];
    const stream: StreamRunner = async (_f, args) => {
      calls.push(args);
      if (args[0] === 'compile')
        return { code: 1, stdout: '', stderr: fixture('arduino/compile-missing-library.real.txt') };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fastled = JSON.stringify({
      libraries: [
        { name: 'FastLED', latest: { version: '3.9.0', architectures: ['*'], maintainer: 'FastLED' } },
      ],
    });
    const host = fakeHost({
      run: (_f, args) => {
        if (args[0] === 'lib' && args[1] === 'search')
          return ok(args[2] === 'name=FastLED' ? fastled : '{"libraries":[]}');
        return ok('{"VersionString":"1.5.1"}');
      },
    });
    const tc = new ArduinoToolchain({ host, buildRoot: '/b', stream });
    const res = await tc.build({
      project: { root: '/s/NeedsLib', name: 'NeedsLib' },
      target: { id: 'arduino:avr:uno', name: 'Uno' },
      onOutput: () => {},
    });
    expect(res.success).toBe(false);
    expect(res.fix?.label).toBe('Install FastLED');
    expect(res.fix?.message).toBe('FastLED.h is provided by the FastLED library, which is not installed.');
    expect(await res.fix!.apply(() => {})).toBe(true);
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['lib', 'install', 'FastLED']);
  });
});

describe('library updates', () => {
  it('lists installed libraries with a newer release (arduino-cli 1.5.1, real)', () => {
    expect(parseLibUpdatable(fixture('arduino/lib-list-updatable.real.json'))).toEqual([
      { name: 'Servo', installed: '1.2.0', latest: '1.3.0' },
    ]);
    expect(parseLibUpdatable('{"installed_libraries":[]}')).toEqual([]);
    expect(parseLibUpdatable('')).toEqual([]);
  });
});
