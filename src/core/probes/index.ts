import type { OsName, Snapshot } from '../types.js';
import { nodeHost, type ProbeHost } from './host.js';
import { probeLinux } from './linux.js';
import { probeMacos } from './macos.js';
import { probeWindows } from './windows.js';

export function currentOs(platform: NodeJS.Platform = process.platform): OsName {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

export async function takeSnapshot(host: ProbeHost = nodeHost, os: OsName = currentOs()): Promise<Snapshot> {
  switch (os) {
    case 'windows':
      return probeWindows(host);
    case 'macos':
      return probeMacos(host);
    case 'linux':
      return probeLinux(host);
  }
}

export { nodeHost, type ProbeHost, type RunResult } from './host.js';
export { probeLinux, readLinuxSysfs } from './linux.js';
export { probeMacos } from './macos.js';
export { probeWindows, WINDOWS_PNP_SCRIPT } from './windows.js';
