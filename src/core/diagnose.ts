import { lookupChip, type ChipMatch } from './chips.js';
import { DRIVER_LINKS, ISSUE_URL } from './drivers.js';
import { commands, labels, messages, urls, type Text } from './messages.js';
import type { Action, Diagnosis, DiagnosisCode, Severity, SerialPort, Snapshot, UsbDevice } from './types.js';
import { deviceKey, type SnapshotDiff } from './watch.js';

export interface DiagnoseOptions {
  /** Result of a plug-in watch. Enables NO_DEVICE_AFTER_PLUG and UNKNOWN_DEVICE_NO_PORT. */
  watch?: SnapshotDiff;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, ok: 3 };

/** Ports that look like USB serial even when the probe couldn't tie them to a USB device. */
const USB_PORT_NAME = /^\/dev\/(cu\.(usbserial|usbmodem|wchusbserial|SLAB_USBtoUART)|ttyUSB|ttyACM)/i;

/** Linux group names are safe to put in a copy-paste command only if they look like group names. */
const SAFE_GROUP = /^[a-z_][a-z0-9_-]{0,31}$/;

function diag(
  code: DiagnosisCode,
  severity: Severity,
  text: Text,
  actions: Action[],
  extra: { device?: UsbDevice; port?: SerialPort } = {},
): Diagnosis {
  return { code, severity, title: text.title, detail: text.detail, actions, ...extra };
}

function boardLabel(match: ChipMatch, device?: UsbDevice): string {
  if (match.chip?.kind === 'bridge') return `Board (${match.chip.name})`;
  if (match.chip) return match.chip.name;
  return device?.product ?? match.label;
}

function portsFor(device: UsbDevice, ports: SerialPort[]): SerialPort[] {
  return ports.filter((p) =>
    p.usbLocation !== undefined
      ? p.usbLocation === device.location
      : p.vid === device.vid && p.pid === device.pid,
  );
}

function driverActions(snapshot: Snapshot, match: ChipMatch): Action[] {
  const key = match.chip?.driver ?? match.vendor?.driver;
  const actions: Action[] = [];
  if (key && snapshot.os !== 'linux') {
    const link = DRIVER_LINKS[key];
    actions.push({ kind: 'openUrl', label: labels.openDriverPage(link.name), url: link[snapshot.os] });
  }
  if (snapshot.os === 'windows') {
    actions.push({ kind: 'openUrl', label: labels.windowsUpdate, url: urls.windowsUpdate });
    actions.push({
      kind: 'runCommand',
      label: labels.rescanDevices,
      command: commands.windowsRescan,
      needsAdmin: true,
    });
  }
  actions.push({ kind: 'retry', label: labels.retry });
  return actions;
}

/** Checks on a port that exists. Returns the problems, or an OK diagnosis. */
function diagnosePort(
  snapshot: Snapshot,
  port: SerialPort,
  match: ChipMatch,
  device?: UsbDevice,
): Diagnosis[] {
  const out: Diagnosis[] = [];
  const extra = { device, port };
  if (port.inUseBy) {
    out.push(
      diag(
        'PORT_IN_USE',
        'error',
        messages.portInUse(port.path, port.inUseBy.name, port.inUseBy.pid),
        [{ kind: 'retry', label: labels.retry }],
        extra,
      ),
    );
  }
  if (snapshot.os === 'linux' && port.permissionOk === false) {
    const group = port.ownerGroup && SAFE_GROUP.test(port.ownerGroup) ? port.ownerGroup : 'dialout';
    // `id -nG` reads the group database, so it can list a group this login session doesn't have yet.
    // In that case the fix is just logging out and back in.
    const alreadyAdded = snapshot.env.linuxGroups?.includes(group) ?? false;
    out.push(
      alreadyAdded
        ? diag(
            'LINUX_PERMISSION',
            'error',
            messages.linuxPermissionRelogin(port.path, group),
            [{ kind: 'retry', label: labels.retry }],
            extra,
          )
        : diag(
            'LINUX_PERMISSION',
            'error',
            messages.linuxPermission(port.path, group),
            [
              { kind: 'copyCommand', label: labels.copyDialoutFix, command: commands.linuxAddToGroup(group) },
              { kind: 'retry', label: labels.retry },
            ],
            extra,
          ),
    );
  }
  if (out.length) return out;
  if (match.chip?.bootloader) {
    return [
      diag(
        'NATIVE_USB_BOOTLOADER',
        'info',
        messages.nativeUsbBootloader(match.chip.name),
        [{ kind: 'selectPort', label: labels.setActivePort, path: port.path }],
        extra,
      ),
    ];
  }
  return [
    diag(
      'OK',
      'ok',
      messages.ok(boardLabel(match, device), port.path),
      [{ kind: 'selectPort', label: labels.setActivePort, path: port.path }],
      extra,
    ),
  ];
}

/** Diagnoses for a USB device that has no serial port. */
function diagnoseNoPort(
  snapshot: Snapshot,
  device: UsbDevice,
  match: ChipMatch,
  isNew: boolean,
): Diagnosis[] {
  const { chip, vendor } = match;
  const kind = chip?.kind ?? vendor?.kind;

  if (chip?.noSerialPort || (chip?.bootloader && kind === 'native')) {
    return [
      diag(
        'NATIVE_USB_BOOTLOADER',
        'info',
        messages.nativeUsbBootloader(chip.name),
        [{ kind: 'retry', label: labels.retry }],
        { device },
      ),
    ];
  }

  if (snapshot.os === 'linux' && (chip?.family ?? vendor?.family) === 'ch34x' && snapshot.env.brlttyActive) {
    return [
      diag(
        'LINUX_BRLTTY',
        'error',
        messages.linuxBrltty(chip?.name ?? 'CH340'),
        [
          { kind: 'copyCommand', label: labels.copyBrlttyDisable, command: commands.brlttyDisable },
          { kind: 'copyCommand', label: labels.copyBrlttyRemove, command: commands.brlttyRemove },
          { kind: 'retry', label: labels.retry },
        ],
        { device },
      ),
    ];
  }

  if (kind === 'bridge') {
    const key = chip?.driver ?? vendor?.driver;
    const name = chip?.name ?? `${vendor?.name ?? 'USB'}-serial`;
    const text =
      device.driverStatus === 'error'
        ? messages.driverError(name, device.osErrorCode)
        : messages.driverMissing(name, snapshot.os, key ? DRIVER_LINKS[key].name : undefined);
    return [diag('DRIVER_MISSING', 'error', text, driverActions(snapshot, match), { device })];
  }

  if (kind === 'native') {
    // Native-USB boards use the OS's built-in CDC driver. No port usually means the sketch isn't
    // providing one (crashed, or USB CDC disabled) rather than a missing driver, except on Windows
    // where the error code tells us otherwise.
    if (device.driverStatus === 'missing' || device.driverStatus === 'error') {
      return [
        diag(
          'DRIVER_MISSING',
          'error',
          messages.driverMissing(match.label, snapshot.os, undefined),
          driverActions(snapshot, match),
          { device },
        ),
      ];
    }
    return [
      diag(
        'NATIVE_USB_BOOTLOADER',
        'warning',
        messages.nativeUsbNoPort(match.label),
        [{ kind: 'retry', label: labels.retry }],
        { device },
      ),
    ];
  }

  if (isNew) {
    return [
      diag(
        'UNKNOWN_DEVICE_NO_PORT',
        'warning',
        messages.unknownDeviceNoPort(device.vid, device.pid),
        [
          { kind: 'copyCommand', label: labels.copyVidPid, command: `${device.vid}:${device.pid}` },
          { kind: 'openUrl', label: labels.reportDevice, url: ISSUE_URL },
          { kind: 'retry', label: labels.retry },
        ],
        { device },
      ),
    ];
  }
  return [];
}

/**
 * Pure function: Snapshot -> Diagnosis[], most severe first.
 * One device can produce several diagnoses.
 */
export function diagnose(snapshot: Snapshot, opts: DiagnoseOptions = {}): Diagnosis[] {
  const out: Diagnosis[] = [];
  const watch = opts.watch;
  const newKeys = new Set(watch?.addedDevices.map(deviceKey) ?? []);

  if (watch && watch.addedDevices.length === 0 && watch.addedPorts.length === 0) {
    out.push(
      diag('NO_DEVICE_AFTER_PLUG', 'error', messages.noDeviceAfterPlug(), [
        { kind: 'retry', label: labels.retry },
      ]),
    );
  }

  const claimed = new Set<string>();
  for (const device of snapshot.usb) {
    const match = lookupChip(device.vid, device.pid);
    const ports = portsFor(device, snapshot.ports);
    const isNew = newKeys.has(deviceKey(device));
    // Ignore keyboards, hubs, etc. unless they have a serial port or just appeared in a watch.
    if (!match.vendor && ports.length === 0 && !isNew) continue;

    if (ports.length === 0) {
      out.push(...diagnoseNoPort(snapshot, device, match, isNew));
      continue;
    }
    for (const port of ports) {
      claimed.add(port.path);
      out.push(...diagnosePort(snapshot, port, match, device));
    }
  }

  // Ports we couldn't tie to a USB device (e.g. probe only saw /dev entries).
  for (const port of snapshot.ports) {
    if (claimed.has(port.path)) continue;
    if (!port.vid && !USB_PORT_NAME.test(port.path)) continue; // COM1 on the motherboard, Bluetooth, etc.
    out.push(...diagnosePort(snapshot, port, lookupChip(port.vid, port.pid)));
  }

  const usable = out.filter((d) => d.port && (d.code === 'OK' || d.code === 'NATIVE_USB_BOOTLOADER'));
  if (usable.length > 1) {
    const paths = usable.map((d) => d.port!.path);
    out.push(
      diag('MULTIPLE_CANDIDATES', 'info', messages.multipleCandidates(paths.length), [
        { kind: 'pickPort', label: labels.pickPort, paths },
      ]),
    );
  }

  if (out.length === 0) {
    out.push(diag('NO_BOARDS', 'info', messages.noBoards(), [{ kind: 'retry', label: labels.retry }]));
  }

  // Array.prototype.sort is stable, so equal-severity items keep decision-tree order.
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
