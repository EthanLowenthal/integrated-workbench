/**
 * Every user-facing string lives here so it's easy to review and edit.
 * Rules: plain English, explain any jargon, always say what to do next.
 */
import type { OsName } from './types.js';

export interface Text {
  title: string;
  detail: string;
}

const osLabel: Record<OsName, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export const labels = {
  retry: 'Try again',
  setActivePort: 'Use this port',
  pickPort: 'Pick a port',
  copyVidPid: 'Copy device ID',
  reportDevice: 'Report this device',
  openDriverPage: (driverName: string) => `Get the ${driverName}`,
  windowsUpdate: 'Open Windows Update',
  rescanDevices: 'Rescan devices (admin)',
  copyDialoutFix: 'Copy fix command',
  copyBrlttyDisable: 'Copy command: disable brltty',
  copyBrlttyRemove: 'Copy command: uninstall brltty',
};

export const messages = {
  noDeviceAfterPlug: (): Text => ({
    title: "Your computer didn't see anything when you plugged in",
    detail:
      'No new USB device appeared. The most common cause is a charge-only USB cable: it powers the board ' +
      "but has no data wires, so the computer can't talk to it. Try a different cable (one you know syncs " +
      'data, like a phone cable that works for file transfer) or a different USB port, then try again.',
  }),

  driverMissing: (chip: string, os: OsName, driverName: string | undefined): Text => ({
    title: `This is a ${chip} USB-serial chip and its driver isn't installed`,
    detail:
      `Your board uses a ${chip} chip to talk over USB. ${osLabel[os]} can see the chip, but no driver is ` +
      `loaded for it, so no serial port was created and you can't upload. ` +
      (driverName
        ? `Install the ${driverName} from the vendor's official page, then unplug the board and plug it back in.`
        : 'Install the driver from the chip vendor, then unplug the board and plug it back in.') +
      (os === 'windows'
        ? ' Windows Update sometimes installs it automatically under "Optional updates".'
        : ''),
  }),

  driverError: (chip: string, code: number | undefined): Text => ({
    title: `The ${chip} driver is installed but isn't working`,
    detail:
      `The driver for your ${chip} chip failed to start` +
      (code !== undefined ? ` (Windows error code ${code})` : '') +
      '. Unplug the board, plug it into a different USB port, and try again. If it keeps failing, ' +
      'reinstall the driver from the official page. Code 43 on very cheap boards can also mean a counterfeit chip.',
  }),

  unknownDeviceNoPort: (vid: string, pid: string): Text => ({
    title: "Something was detected, but it isn't a serial device we recognize",
    detail:
      `A USB device with ID ${vid}:${pid} appeared, but no serial port was created and Integrated Workbench doesn't ` +
      'know this chip yet. If this is your board, copy the ID and report it so we can add it. ' +
      'Searching the web for the ID usually tells you which driver it needs.',
  }),

  portInUse: (path: string, procName: string, pid: number): Text => ({
    title: `${path} is being used by ${procName}`,
    detail:
      `Only one program can use a serial port at a time, and ${procName} (process ${pid}) has ${path} open. ` +
      'Close it (or its serial monitor), then try again.',
  }),

  linuxPermission: (path: string, group: string): Text => ({
    title: "You don't have permission to use this port",
    detail:
      `${path} belongs to the "${group}" group and your user isn't in it. Add yourself with the command ` +
      'below, then log out and back in (group changes only apply to new sessions).',
  }),

  linuxPermissionRelogin: (path: string, group: string): Text => ({
    title: 'Log out and back in to use this port',
    detail:
      `Your user is in the "${group}" group that owns ${path}, but this login session started before you ` +
      'were added, so it does not have the permission yet. Log out and back in (or restart), then try again.',
  }),

  linuxBrltty: (chip: string): Text => ({
    title: `A braille-display service (brltty) is grabbing your ${chip} board`,
    detail:
      `brltty is a service for braille displays. Some of those displays use the same USB ID as the ${chip} ` +
      'chip, so brltty claims your board and no serial port appears. If you do not use a braille display, ' +
      'either disable brltty (reversible) or uninstall it. Then unplug the board and plug it back in.',
  }),

  nativeUsbBootloader: (board: string): Text => ({
    title: `${board} is in bootloader mode`,
    detail:
      'This board talks USB directly (no separate USB-serial chip), so it shows up differently while it is ' +
      'waiting for an upload. That is normal right after a reset. Uploading now should work; if it does not, ' +
      'double-tap the reset button, or hold BOOT while plugging it in, then upload within a few seconds.',
  }),

  nativeUsbNoPort: (board: string): Text => ({
    title: `${board} is connected but has no serial port right now`,
    detail:
      'This board talks USB directly, so its serial port only exists while the running sketch provides one. ' +
      'If a previous sketch crashed or turned off USB, put the board in bootloader mode: double-tap reset ' +
      '(Leonardo, Micro, RP2040) or hold BOOT while plugging it in (ESP32-S2/S3/C3), then upload.',
  }),

  multipleCandidates: (count: number): Text => ({
    title: `Found ${count} boards`,
    detail: 'More than one board is connected. Pick the one you want to use.',
  }),

  noBoards: (): Text => ({
    title: 'No boards found',
    detail:
      'Plug your board in; it shows up here within a couple of seconds. If nothing happens, try a ' +
      'different USB cable: many cables are charge-only and carry no data.',
  }),

  ok: (board: string, path: string): Text => ({
    title: `${board} ready on ${path}`,
    detail: `Your board is connected and ${path} is available.`,
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
