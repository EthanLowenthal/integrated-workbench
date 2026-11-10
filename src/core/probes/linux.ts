import { parseFuserPids } from '../parse/common.js';
import {
  parseEtcGroup,
  parseIdGroups,
  parseLinuxSysfs,
  parseLsusb,
  parseSystemctlIsActive,
  type LinuxSysfsRaw,
} from '../parse/linux.js';
import type { Snapshot } from '../types.js';
import type { ProbeHost } from './host.js';
import { whoHolds } from './macos.js';
import { TIMEOUTS } from '../timeouts.js';

const USB_DEVICES = '/sys/bus/usb/devices';
const TTY_CLASS = '/sys/class/tty';
const USB_ATTRS = ['idVendor', 'idProduct', 'manufacturer', 'product', 'serial'];

/** Reads sysfs into the serializable shape parseLinuxSysfs() takes (and fixtures store). */
export async function readLinuxSysfs(host: ProbeHost): Promise<LinuxSysfsRaw> {
  const names = await host.readdir(USB_DEVICES);
  const devices = await Promise.all(
    names.map(async (name) => {
      const base = `${USB_DEVICES}/${name}`;
      const attrs: Record<string, string> = {};
      for (const a of USB_ATTRS) {
        const v = await host.readFile(`${base}/${a}`);
        if (v !== undefined) attrs[a] = v.trim();
      }
      const driverPath = await host.realpath(`${base}/driver`);
      return {
        name,
        path: (await host.realpath(base)) ?? base,
        attrs,
        driver: driverPath?.split('/').pop(),
      };
    }),
  );
  const ttyNames = (await host.readdir(TTY_CLASS)).filter((n) => /^tty(USB|ACM)\d+$/.test(n));
  const ttys = await Promise.all(
    ttyNames.map(async (name) => ({ name, devicePath: await host.realpath(`${TTY_CLASS}/${name}/device`) })),
  );
  return { devices, ttys };
}

async function inUse(host: ProbeHost, path: string) {
  const viaLsof = await whoHolds(host, path);
  if (viaLsof !== undefined) return viaLsof;
  const fuser = await host.run('fuser', [path], { timeoutMs: TIMEOUTS.probeMs });
  if (fuser.code === null) return undefined;
  const pid = parseFuserPids(fuser.stdout)[0];
  if (pid === undefined) return null;
  const comm = await host.readFile(`/proc/${pid}/comm`);
  return { pid, name: comm?.trim() || `process ${pid}` };
}

export async function probeLinux(host: ProbeHost): Promise<Snapshot> {
  const raw = await readLinuxSysfs(host);
  let { usb, ports } = parseLinuxSysfs(raw);
  if (usb.length === 0) {
    const lsusb = await host.run('lsusb', [], { timeoutMs: TIMEOUTS.probeMs });
    if (lsusb.code === 0) usb = parseLsusb(lsusb.stdout);
  }

  const groupsById = parseEtcGroup((await host.readFile('/etc/group')) ?? '');
  ports = await Promise.all(
    ports.map(async (p) => {
      const gid = await host.statGid(p.path);
      return {
        ...p,
        permissionOk: await host.canReadWrite(p.path),
        ownerGroup: gid !== undefined ? groupsById.get(gid) : undefined,
        inUseBy: await inUse(host, p.path),
      };
    }),
  );

  const id = await host.run('id', ['-nG'], { timeoutMs: TIMEOUTS.probeMs });
  const brltty = await host.run('systemctl', ['is-active', 'brltty-udev.service', 'brltty.service'], {
    timeoutMs: TIMEOUTS.probeMs,
  });
  let brlttyActive = brltty.code !== null && parseSystemctlIsActive(brltty.stdout);
  if (brltty.code === null) {
    const pgrep = await host.run('pgrep', ['-x', 'brltty'], { timeoutMs: TIMEOUTS.probeMs });
    brlttyActive = pgrep.code === 0;
  }

  return {
    os: 'linux',
    takenAt: Date.now(),
    usb,
    ports,
    env: { linuxGroups: id.code === 0 ? parseIdGroups(id.stdout) : undefined, brlttyActive },
  };
}
