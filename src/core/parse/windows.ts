import type { DriverStatus, SerialPort, UsbDevice } from '../types.js';

/**
 * Parses the JSON from the Windows probe:
 *   Get-CimInstance Win32_PnPEntity | Where-Object {...} |
 *     Select-Object PNPDeviceID, Name, Status, PNPClass, ConfigManagerErrorCode, Manufacturer, Service |
 *     ConvertTo-Json
 * Also accepts Get-PnpDevice output (InstanceId, FriendlyName, Class, Problem).
 *
 * Shapes we need to handle:
 * - Single-function bridge (CH340, CP210x): one node `USB\VID_1A86&PID_7523\...`, class Ports when the
 *   driver works (Name "USB-SERIAL CH340 (COM5)"), or no class + error code 28 when it doesn't.
 * - FTDI: `USB\VID_0403&PID_6001\<serial>` (class USB) plus a child port node
 *   `FTDIBUS\VID_0403+PID_6001+<serial>A\0000` (class Ports).
 * - Composite native USB (Leonardo, ESP32-S3): parent `USB\VID_2341&PID_8036\<serial>` plus interface
 *   children `USB\VID_2341&PID_8036&MI_00\...` (class Ports).
 */

interface RawPnpEntity {
  PNPDeviceID?: string | null;
  InstanceId?: string | null;
  Name?: string | null;
  FriendlyName?: string | null;
  Status?: string | null;
  PNPClass?: string | null;
  Class?: string | null;
  ConfigManagerErrorCode?: number | null;
  Problem?: number | string | null;
  Manufacturer?: string | null;
  Service?: string | null;
}

interface PnpEntity {
  id: string;
  name?: string;
  status?: string;
  cls?: string;
  errorCode: number;
  manufacturer?: string;
  service?: string;
}

const VID_PID_RE = /VID_([0-9A-F]{4})[&+]PID_([0-9A-F]{4})/i;
const COM_RE = /\((COM\d+)\)/i;

/** Win32 CM_PROB_* names, for Get-PnpDevice output that serializes Problem as a string. */
const CM_PROB_NAMES: Record<string, number> = {
  CM_PROB_NONE: 0,
  CM_PROB_NOT_CONFIGURED: 1,
  CM_PROB_FAILED_START: 10,
  CM_PROB_REINSTALL: 18,
  CM_PROB_DISABLED: 22,
  CM_PROB_FAILED_INSTALL: 28,
  CM_PROB_FAILED_POST_START: 43,
};

function str(v: string | null | undefined): string | undefined {
  return v === null || v === undefined || v === '' ? undefined : v;
}

function problemCode(raw: RawPnpEntity): number {
  if (typeof raw.ConfigManagerErrorCode === 'number') return raw.ConfigManagerErrorCode;
  if (typeof raw.Problem === 'number') return raw.Problem;
  if (typeof raw.Problem === 'string') return CM_PROB_NAMES[raw.Problem] ?? (Number(raw.Problem) || 0);
  return 0;
}

function normalize(raw: RawPnpEntity): PnpEntity | undefined {
  const id = str(raw.PNPDeviceID) ?? str(raw.InstanceId);
  if (!id) return undefined;
  return {
    id,
    name: str(raw.Name) ?? str(raw.FriendlyName),
    status: str(raw.Status),
    cls: str(raw.PNPClass) ?? str(raw.Class),
    errorCode: problemCode(raw),
    manufacturer: str(raw.Manufacturer),
    service: str(raw.Service),
  };
}

export function driverStatusFromErrorCode(code: number, status?: string): DriverStatus {
  if (code === 0) return status === 'Error' ? 'error' : 'ok';
  // 1 = not configured, 18 = reinstall drivers, 28 = drivers not installed.
  if (code === 1 || code === 18 || code === 28) return 'missing';
  return 'error';
}

function vidPid(id: string): { vid: string; pid: string } | undefined {
  const m = VID_PID_RE.exec(id);
  if (!m || !m[1] || !m[2]) return undefined;
  return { vid: m[1].toLowerCase(), pid: m[2].toLowerCase() };
}

/** `USB\VID_1A86&PID_7523\5&2D3A1B&0&2` -> segments [USB, VID_..., 5&2D...]. */
function segments(id: string): string[] {
  return id.split('\\');
}

function isInterfaceChild(id: string): boolean {
  return /&MI_[0-9A-F]{2}/i.test(id);
}

/** Windows invents instance IDs containing '&' when a device has no serial number. */
function serialFromInstance(id: string): string | undefined {
  const last = segments(id)[2];
  return last && !last.includes('&') ? last : undefined;
}

/** Key linking child nodes (MI_xx, FTDIBUS) back to their USB parent: vid:pid:serial. */
function parentKey(entity: PnpEntity): string | undefined {
  const ids = vidPid(entity.id);
  if (!ids) return undefined;
  const [bus, , inst] = segments(entity.id);
  if (bus?.toUpperCase() === 'FTDIBUS') {
    // FTDIBUS\VID_0403+PID_6001+A50285BIA\0000 -> serial "A50285BI" (FTDI appends a port letter).
    const m = /PID_[0-9A-F]{4}\+([^\\]+)/i.exec(entity.id);
    const serial = m?.[1]?.replace(/[A-Z]$/i, '');
    return `${ids.vid}:${ids.pid}:${serial ?? ''}`;
  }
  if (isInterfaceChild(entity.id)) {
    // Interface instance IDs don't carry the parent's serial; fall back to vid:pid only.
    return `${ids.vid}:${ids.pid}:`;
  }
  return `${ids.vid}:${ids.pid}:${inst && !inst.includes('&') ? inst : ''}`;
}

export function parseWindowsPnp(json: string): { usb: UsbDevice[]; ports: SerialPort[] } {
  const trimmed = json.trim();
  if (!trimmed) return { usb: [], ports: [] };
  const parsed: unknown = JSON.parse(trimmed);
  // ConvertTo-Json emits a bare object (not an array) when there's exactly one result.
  const rawList = (Array.isArray(parsed) ? parsed : [parsed]) as RawPnpEntity[];
  const entities = rawList.map(normalize).filter((e): e is PnpEntity => e !== undefined);

  const usb: UsbDevice[] = [];
  const byKey = new Map<string, UsbDevice>();
  const byVidPid = new Map<string, UsbDevice[]>();

  for (const e of entities) {
    const bus = segments(e.id)[0]?.toUpperCase();
    const ids = vidPid(e.id);
    if (bus !== 'USB' || !ids || isInterfaceChild(e.id)) continue;
    const dev: UsbDevice = {
      vid: ids.vid,
      pid: ids.pid,
      serialNumber: serialFromInstance(e.id),
      manufacturer: e.manufacturer,
      product: e.name?.replace(COM_RE, '').trim() || undefined,
      location: e.id,
      driverStatus: driverStatusFromErrorCode(e.errorCode, e.status),
      driverName: e.service,
      osErrorCode: e.errorCode || undefined,
    };
    usb.push(dev);
    const key = parentKey(e);
    if (key) byKey.set(key, dev);
    const vp = `${ids.vid}:${ids.pid}`;
    byVidPid.set(vp, [...(byVidPid.get(vp) ?? []), dev]);
  }

  const findParent = (e: PnpEntity): UsbDevice | undefined => {
    const key = parentKey(e);
    if (key && byKey.has(key)) return byKey.get(key);
    const ids = vidPid(e.id);
    if (!ids) return undefined;
    const candidates = byVidPid.get(`${ids.vid}:${ids.pid}`) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const ports: SerialPort[] = [];
  for (const e of entities) {
    const parent =
      segments(e.id)[0]?.toUpperCase() === 'USB' && !isInterfaceChild(e.id) ? undefined : findParent(e);

    // A broken interface child means the composite device has no working driver for its serial function.
    if (parent && e.errorCode !== 0 && parent.driverStatus === 'ok') {
      parent.driverStatus = driverStatusFromErrorCode(e.errorCode, e.status);
      parent.osErrorCode = e.errorCode;
    }

    const com = e.name ? COM_RE.exec(e.name)?.[1] : undefined;
    if (e.cls !== 'Ports' || !com || e.errorCode !== 0) continue;
    const ids = vidPid(e.id);
    const owner = parent ?? usb.find((d) => d.location === e.id);
    ports.push({
      path: com.toUpperCase(),
      vid: ids?.vid,
      pid: ids?.pid,
      usbLocation: owner?.location,
    });
  }

  return { usb, ports };
}
