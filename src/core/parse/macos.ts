import type { SerialPort, UsbDevice } from '../types.js';

/**
 * macOS parsers.
 *
 * Primary source: `ioreg -r -c IOUSBHostDevice -l -w0`. It gives VID/PID/serial for every USB device
 * AND the IOSerialBSDClient nodes (with "IOCalloutDevice" = "/dev/cu.*") nested under them, so we can
 * link ports to devices exactly instead of guessing from the /dev name.
 *
 * Fallback: `system_profiler SPUSBHostDataType -json` (macOS 14+; keys USBDeviceKey*) or
 * `system_profiler SPUSBDataType -json` (older macOS; keys vendor_id/product_id). Note that on current
 * macOS SPUSBDataType returns an empty list, which is why it's not the primary source.
 */

interface IoregNode {
  depth: number;
  name: string;
  cls: string;
  props: Record<string, string | number | boolean>;
  parent?: IoregNode;
}

const NODE_RE = /^([ |]*)\+-o (.+?)\s+<class (\w+)/;
const PROP_RE = /^[ |]*"([^"]+)" = (.*)$/;

function parseValue(raw: string): string | number | boolean {
  const v = raw.trim();
  if (v === 'Yes') return true;
  if (v === 'No') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = /^"(.*)"$/.exec(v);
  return m ? (m[1] ?? '') : v;
}

export function parseIoregTree(text: string): IoregNode[] {
  const nodes: IoregNode[] = [];
  const stack: IoregNode[] = [];
  for (const line of text.split(/\r?\n/)) {
    const n = NODE_RE.exec(line);
    if (n) {
      const depth = n[1]?.length ?? 0;
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
      const node: IoregNode = {
        depth,
        name: n[2] ?? '',
        cls: n[3] ?? '',
        props: {},
        parent: stack[stack.length - 1],
      };
      stack.push(node);
      nodes.push(node);
      continue;
    }
    const p = PROP_RE.exec(line);
    const top = stack[stack.length - 1];
    if (p && top && p[1] !== undefined && p[2] !== undefined) top.props[p[1]] = parseValue(p[2]);
  }
  return nodes;
}

const USB_DEVICE_CLASSES = new Set(['IOUSBHostDevice', 'IOUSBDevice']);

function hex4(n: unknown): string | undefined {
  return typeof n === 'number' ? n.toString(16).padStart(4, '0') : undefined;
}

function strProp(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function locationKey(node: IoregNode): string {
  const loc = node.props['locationID'];
  return typeof loc === 'number' ? `0x${loc.toString(16).padStart(8, '0')}` : node.name;
}

export function parseIoregUsb(text: string): { usb: UsbDevice[]; ports: SerialPort[] } {
  const nodes = parseIoregTree(text);
  const usb = new Map<string, UsbDevice>();
  const ports = new Map<string, SerialPort>();

  for (const node of nodes) {
    if (USB_DEVICE_CLASSES.has(node.cls)) {
      const vid = hex4(node.props['idVendor']);
      const pid = hex4(node.props['idProduct']);
      if (!vid || !pid) continue;
      const key = locationKey(node);
      if (usb.has(key)) continue; // -r prints nested devices again as their own roots
      usb.set(key, {
        vid,
        pid,
        serialNumber:
          strProp(node.props['USB Serial Number']) ?? strProp(node.props['kUSBSerialNumberString']),
        manufacturer: strProp(node.props['USB Vendor Name']) ?? strProp(node.props['kUSBVendorString']),
        product: strProp(node.props['USB Product Name']) ?? strProp(node.props['kUSBProductString']),
        location: key,
        // ioreg can't tell "no driver" from "driver not needed"; diagnose() infers it from missing ports.
        driverStatus: 'unknown',
      });
    }
    const callout = strProp(node.props['IOCalloutDevice']);
    if (callout && !ports.has(callout)) {
      let owner = node.parent;
      while (owner && !USB_DEVICE_CLASSES.has(owner.cls)) owner = owner.parent;
      ports.set(callout, {
        path: callout,
        vid: owner ? hex4(owner.props['idVendor']) : undefined,
        pid: owner ? hex4(owner.props['idProduct']) : undefined,
        usbLocation: owner ? locationKey(owner) : undefined,
      });
    }
  }

  // A port proves the device has a working driver.
  for (const port of ports.values()) {
    const dev = port.usbLocation ? usb.get(port.usbLocation) : undefined;
    if (dev) dev.driverStatus = 'ok';
  }
  return { usb: [...usb.values()], ports: [...ports.values()] };
}

interface SpItem {
  _name?: string;
  _items?: SpItem[];
  [key: string]: unknown;
}

function spHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /0x([0-9a-f]{1,4})/i.exec(v);
  return m?.[1]?.toLowerCase().padStart(4, '0');
}

function spStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' && v !== 'Not Provided' ? v : undefined;
}

/** Handles both SPUSBHostDataType (USBDeviceKey*) and legacy SPUSBDataType (vendor_id/product_id). */
export function parseSystemProfilerUsb(json: string): UsbDevice[] {
  const root = JSON.parse(json) as Record<string, SpItem[] | undefined>;
  const top = root['SPUSBHostDataType'] ?? root['SPUSBDataType'] ?? [];
  const out: UsbDevice[] = [];
  const walk = (items: SpItem[]) => {
    for (const it of items) {
      const vid = spHex(it['USBDeviceKeyVendorID'] ?? it['vendor_id']);
      const pid = spHex(it['USBDeviceKeyProductID'] ?? it['product_id']);
      if (vid && pid) {
        const loc = spStr(it['USBKeyLocationID'] ?? it['location_id']);
        out.push({
          vid,
          pid,
          serialNumber: spStr(it['USBDeviceKeySerialNumber'] ?? it['serial_num']),
          manufacturer: spStr(it['USBDeviceKeyVendorName'] ?? it['manufacturer']),
          product: spStr(it._name),
          location: loc ? (/0x[0-9a-f]+/i.exec(loc)?.[0]?.toLowerCase() ?? loc) : undefined,
          driverStatus: 'unknown',
        });
      }
      if (it._items) walk(it._items);
    }
  };
  walk(top);
  return out;
}

/** `/dev` entries we never care about. */
const IGNORED_DEV = /^cu\.(Bluetooth-Incoming-Port|debug-console|wlan-debug)$/i;

/** From a directory listing of /dev, return outgoing serial ports (cu.*, preferred over tty.*). */
export function parseDevListing(names: string[]): SerialPort[] {
  return names
    .filter((n) => n.startsWith('cu.') && !IGNORED_DEV.test(n))
    .sort()
    .map((n) => ({ path: `/dev/${n}` }));
}
