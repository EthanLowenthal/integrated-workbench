/**
 * Diagnosis text. Style: professional and neutral, like VS Code's own messages. Titles are short
 * statements of fact; details explain the cause in plain English and state the fix.
 * Buttons use Title Case.
 */
import type { OsName } from './types.js';

export interface Text {
  title: string;
  detail: string;
}

const osLabel: Record<OsName, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export const labels = {
  retry: 'Retry',
  setActivePort: 'Use This Port',
  pickPort: 'Select Port...',
  copyVidPid: 'Copy Device ID',
  reportDevice: 'Report Device',
  openDriverPage: (driverName: string) => `Download ${driverName}`,
  windowsUpdate: 'Open Windows Update',
  rescanDevices: 'Rescan Devices (Administrator)',
  copyDialoutFix: 'Copy Command',
  copyBrlttyDisable: 'Copy Disable Command',
  copyBrlttyRemove: 'Copy Uninstall Command',
};

export const messages = {
  noDeviceAfterPlug: (): Text => ({
    title: 'No device detected',
    detail:
      'No new USB device appeared after the board was connected. The most common cause is a charge-only ' +
      'USB cable, which carries power but no data. Use a data cable or a different USB port.',
  }),

  driverMissing: (chip: string, os: OsName, driverName: string | undefined): Text => ({
    title: `${chip} driver not installed`,
    detail:
      `The board's ${chip} USB-to-serial chip is detected, but ${osLabel[os]} has no driver loaded for it, so no ` +
      'serial port is available. ' +
      (driverName ? `Install the ${driverName} from the vendor, ` : 'Install the vendor driver, ') +
      'then reconnect the board.' +
      (os === 'windows' ? ' The driver may also be available in Windows Update under Optional updates.' : ''),
  }),

  driverError: (chip: string, code: number | undefined): Text => ({
    title: `${chip} driver failed to start`,
    detail:
      `The ${chip} driver is installed but failed to start` +
      (code !== undefined ? ` (Windows error code ${code})` : '') +
      '. Reconnect the board to a different USB port. If the error persists, reinstall the driver. ' +
      'Error code 43 can also indicate a counterfeit chip.',
  }),

  unknownDeviceNoPort: (vid: string, pid: string): Text => ({
    title: 'Unrecognized USB device',
    detail:
      `A USB device (${vid}:${pid}) was detected but did not create a serial port, and its chip is not in ` +
      'any installed registry. If this is a development board, it may need a vendor driver.',
  }),

  portInUse: (path: string, procName: string, pid: number): Text => ({
    title: `${path} in use by ${procName}`,
    detail:
      `${procName} (process ${pid}) has the port open. A serial port can only be used by one program at a ` +
      'time. Close the port in that program and retry.',
  }),

  linuxPermission: (path: string, group: string): Text => ({
    title: 'Permission denied',
    detail:
      `${path} is owned by the "${group}" group, and the current user is not a member. Add the user to the ` +
      'group, then log out and back in for the change to take effect.',
  }),

  linuxPermissionRelogin: (path: string, group: string): Text => ({
    title: 'Log out to apply group membership',
    detail:
      `The current user is in the "${group}" group that owns ${path}, but this session started before the ` +
      'change. Log out and back in, then retry.',
  }),

  linuxBrltty: (chip: string): Text => ({
    title: `brltty is claiming the ${chip} device`,
    detail:
      `brltty, a braille display service, matches the ${chip} USB ID and takes over the device, so no serial ` +
      'port appears. If no braille display is in use, disable or uninstall brltty, then reconnect the board.',
  }),

  nativeUsbBootloader: (board: string): Text => ({
    title: `${board} in bootloader mode`,
    detail:
      'The board is waiting for an upload, which is expected right after a reset. If an upload does not ' +
      'start, double-press reset (or hold BOOT while connecting) and upload within a few seconds.',
  }),

  nativeUsbNoPort: (board: string): Text => ({
    title: `${board}: no serial port`,
    detail:
      'This board provides its serial port from the running program, so the port disappears if the program ' +
      'crashes or disables USB. Enter bootloader mode (double-press reset, or hold BOOT while connecting) ' +
      'and upload again.',
  }),

  multipleCandidates: (count: number): Text => ({
    title: `${count} boards connected`,
    detail: 'Select the port to use.',
  }),

  noBoards: (): Text => ({
    title: 'No boards connected',
    detail:
      'Connected boards appear here automatically. If a board does not appear, check that the USB cable ' +
      'supports data; charge-only cables are a common cause.',
  }),

  ok: (board: string, path: string): Text => ({
    title: `${board} on ${path}`,
    detail: 'Connected and ready.',
  }),
};

export const commands = {
  linuxAddToGroup: (group: string) => `sudo usermod -aG ${group} $USER`,
  brlttyDisable:
    'sudo systemctl stop brltty-udev.service brltty.service && sudo systemctl mask brltty-udev.service brltty.service',
  brlttyRemove: 'sudo apt remove brltty',
  windowsRescan: 'pnputil /scan-devices',
};

export const urls = {
  windowsUpdate: 'ms-settings:windowsupdate', // TODO verify (opens Settings > Windows Update)
};
