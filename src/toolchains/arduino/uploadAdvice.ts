import { text } from '../../text.js';
import type { BoardOption } from '../types.js';
import { parseFqbn } from './fqbn.js';

/** What went wrong with an upload, in plain words, and a board option that likely fixes it. */
export interface UploadAdvice {
  reason: string;
  /** Change this board option and upload again. */
  option?: { id: string; value: string; label: string };
}

const NOT_IN_SYNC = /not in sync|programmer is not responding|stk500_getsync|stk500_recv/i;
const ESP_BOOT = /Failed to connect to ESP\w*|Wrong boot mode detected|No serial data received/i;
const NO_BOARD_ON_PORT = /No device found on|Couldn't find a Board on the selected port|can't open device/i;
const PORT_BUSY = /Resource busy|Access is denied|could not open port|cannot open port/i;
const NO_PERMISSION = /Permission denied/i;

/**
 * Reads a failed upload's output (avrdude, esptool, bossac, ...) and explains the usual cause.
 * Order matters: avrdude ends a sync failure with "unable to open port", which is not the cause.
 */
export function adviseUploadFailure(
  output: string,
  fqbn: string,
  options: BoardOption[],
): UploadAdvice | undefined {
  const { base, options: set } = parseFqbn(fqbn);
  if (NOT_IN_SYNC.test(output)) {
    // Arduino Nano: clones (and Nanos made before 2018) use the old bootloader, and the reverse.
    const cpu = options.find((o) => o.id === 'cpu');
    if (base === 'arduino:avr:nano' && cpu) {
      const current = set['cpu'] ?? cpu.defaultValue;
      const other = current === 'atmega328old' ? 'atmega328' : 'atmega328old';
      const value = cpu.values.find((v) => v.id === other);
      if (value)
        return {
          reason:
            other === 'atmega328old'
              ? text.uploadAdvice.nanoOldBootloader
              : text.uploadAdvice.nanoNewBootloader,
          option: { id: 'cpu', value: other, label: text.uploadAdvice.useOption(value.label) },
        };
    }
    return { reason: text.uploadAdvice.notInSync };
  }
  if (ESP_BOOT.test(output)) return { reason: text.uploadAdvice.espBootMode };
  if (NO_BOARD_ON_PORT.test(output)) return { reason: text.uploadAdvice.doubleReset };
  if (PORT_BUSY.test(output)) return { reason: text.uploadAdvice.portBusy };
  if (NO_PERMISSION.test(output)) return { reason: text.uploadAdvice.permission };
  return undefined;
}
