import { parseWindowsPnp } from '../parse/windows.js';
import type { Snapshot } from '../types.js';
import type { ProbeHost } from './host.js';

/**
 * Fixed script (no interpolated data). Win32_PnPEntity lists present devices only and gives
 * ConfigManagerErrorCode as a number (28 = drivers not installed).
 * FTDIBUS covers FTDI's own port nodes; class Ports covers COM ports from any bus.
 */
export const WINDOWS_PNP_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_PnPEntity |',
  "  Where-Object { $_.PNPDeviceID -match '^(USB|FTDIBUS)\\\\' -or $_.PNPClass -eq 'Ports' } |",
  '  Select-Object PNPDeviceID, Name, Status, PNPClass, ConfigManagerErrorCode, Manufacturer, Service |',
  '  ConvertTo-Json -Depth 2 -Compress',
].join('\n');

export async function probeWindows(host: ProbeHost): Promise<Snapshot> {
  const res = await host.run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    WINDOWS_PNP_SCRIPT,
  ]);
  if (res.code !== 0) {
    throw new Error(`PowerShell device query failed (exit ${res.code}): ${res.stderr.trim().slice(0, 500)}`);
  }
  const { usb, ports } = parseWindowsPnp(res.stdout);
  // Port-in-use detection on Windows needs serial I/O; deferred (spec section 7, open question).
  return { os: 'windows', takenAt: Date.now(), usb, ports, env: {} };
}
