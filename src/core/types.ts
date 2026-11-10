export type OsName = 'windows' | 'macos' | 'linux';

export type DriverStatus = 'ok' | 'missing' | 'error' | 'unknown';

export interface UsbDevice {
  /** Lowercase hex, 4 chars, e.g. "1a86". */
  vid: string;
  /** Lowercase hex, 4 chars, e.g. "7523". */
  pid: string;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
  /** OS-specific path / instance ID. Used to link ports to devices and to diff snapshots. */
  location?: string;
  driverStatus: DriverStatus;
  driverName?: string;
  /** e.g. Windows ConfigManagerErrorCode. */
  osErrorCode?: number;
}

export interface SerialPort {
  /** "COM5", "/dev/cu.usbserial-1410", "/dev/ttyUSB0". */
  path: string;
  vid?: string;
  pid?: string;
  /** `location` of the UsbDevice this port belongs to, when the probe can tell. */
  usbLocation?: string;
  /** undefined = not checked; null = checked and free. */
  inUseBy?: { pid: number; name: string } | null;
  /** Linux: can the current user open it read/write. */
  permissionOk?: boolean;
  /** Linux: group that owns the device node (e.g. "dialout", "uucp"). */
  ownerGroup?: string;
}

export interface SnapshotEnv {
  linuxGroups?: string[];
  brlttyActive?: boolean;
  arduinoCli?: string | null;
}

export interface Snapshot {
  os: OsName;
  takenAt: number;
  usb: UsbDevice[];
  ports: SerialPort[];
  env: SnapshotEnv;
}

export type Severity = 'ok' | 'info' | 'warning' | 'error';

export type DiagnosisCode =
  | 'NO_DEVICE_AFTER_PLUG'
  | 'DRIVER_MISSING'
  | 'UNKNOWN_DEVICE_NO_PORT'
  | 'PORT_IN_USE'
  | 'LINUX_PERMISSION'
  | 'LINUX_BRLTTY'
  | 'NATIVE_USB_BOOTLOADER'
  | 'MULTIPLE_CANDIDATES'
  | 'NO_BOARDS'
  | 'OK';

export type Action =
  | { kind: 'openUrl'; label: string; url: string }
  | { kind: 'copyCommand'; label: string; command: string }
  /** Never run automatically: the UI must always confirm with the user first. */
  | { kind: 'runCommand'; label: string; command: string; needsAdmin: boolean }
  | { kind: 'retry'; label: string }
  | { kind: 'selectPort'; label: string; path: string }
  | { kind: 'pickPort'; label: string; paths: string[] };

export interface Diagnosis {
  code: DiagnosisCode;
  severity: Severity;
  /** Short, plain English. */
  title: string;
  /** What's going on and why, and what to do next. */
  detail: string;
  device?: UsbDevice;
  port?: SerialPort;
  actions: Action[];
}
