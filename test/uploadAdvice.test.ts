import { describe, expect, it } from 'vitest';
import { adviseUploadFailure } from '../src/toolchains/arduino/uploadAdvice.js';
import { parseBoardDetails } from '../src/toolchains/arduino/parse.js';
import { text } from '../src/text.js';
import { fixture } from './helpers.js';

// avrdude 8 (arduino:avr 1.8.8) uploading to a port with no board: ten "not in sync" attempts, then
// a misleading "unable to open port".
const notInSync = fixture('arduino/upload-not-in-sync-nano.real.txt');
const nanoOptions = parseBoardDetails(fixture('arduino/board-details-nano.real.json'));

describe('upload failure advice', () => {
  it('Nano, new bootloader selected: suggests the old bootloader with a one-click fix', () => {
    const a = adviseUploadFailure(notInSync, 'arduino:avr:nano', nanoOptions);
    expect(a?.reason).toBe(text.uploadAdvice.nanoOldBootloader);
    expect(a?.option).toMatchObject({ id: 'cpu', value: 'atmega328old' });
    expect(a?.option?.label).toMatch(/Old Bootloader/);
  });

  it('Nano, old bootloader selected: suggests the new one', () => {
    const a = adviseUploadFailure(notInSync, 'arduino:avr:nano:cpu=atmega328old', nanoOptions);
    expect(a?.option).toMatchObject({ id: 'cpu', value: 'atmega328' });
  });

  it('other AVR boards: explains without an option change; sync failure wins over "unable to open port"', () => {
    const a = adviseUploadFailure(notInSync, 'arduino:avr:uno', []);
    expect(a).toEqual({ reason: text.uploadAdvice.notInSync });
  });

  it('ESP32 not in download mode (esptool 5.6.0 wording)', () => {
    const out = 'A fatal error occurred: Failed to connect to ESP32: No serial data received.';
    expect(adviseUploadFailure(out, 'esp32:esp32:esp32', [])?.reason).toBe(text.uploadAdvice.espBootMode);
  });

  it('busy port, missing permission, and unknown output', () => {
    expect(adviseUploadFailure('ser_open(): cannot open port: Resource busy', 'x:y:z', [])?.reason).toBe(
      text.uploadAdvice.portBusy,
    );
    expect(adviseUploadFailure("can't open /dev/ttyUSB0: Permission denied", 'x:y:z', [])?.reason).toBe(
      text.uploadAdvice.permission,
    );
    expect(adviseUploadFailure('something else entirely', 'x:y:z', [])).toBeUndefined();
  });
});
