/** esptool command lines and output (pure; see firmwareInstaller.ts for running them). */

/** Erase the whole flash, then write the firmware at its offset. Same port and chip for both. */
export function esptoolSteps(
  chip: string,
  address: string,
  port: string,
  file: string,
): { erase: string[]; write: string[] } {
  return {
    erase: ['--chip', chip, '--port', port, 'erase-flash'],
    write: ['--chip', chip, '--port', port, '--baud', '460800', 'write-flash', address, file],
  };
}

/** esptool ends with a troubleshooting link; the line that says what went wrong comes before it. */
export function errorLine(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const err = [...lines].reverse().find((l) => /error/i.test(l));
  return (err ?? lines.pop() ?? '').replace(/^(A fatal error occurred:\s*|ERROR:\s*)+/i, '');
}
