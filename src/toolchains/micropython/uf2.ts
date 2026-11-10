import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

/**
 * UF2 bootloader drives (Raspberry Pi RP2040 / RP2350 in BOOTSEL mode). The board shows up as a
 * USB drive with INFO_UF2.TXT; copying a .uf2 file to it installs the firmware and restarts the board.
 */

export interface Uf2Drive {
  /** Mount point or drive root, e.g. "/Volumes/RPI-RP2", "E:\\". */
  path: string;
  /** From INFO_UF2.TXT, e.g. "RPI-RP2", "RP2350". */
  boardId: string;
  model?: string;
}

export function parseInfoUf2(text: string): { boardId?: string; model?: string } {
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'mi').exec(text)?.[1];
  return { boardId: field('Board-ID'), model: field('Model') };
}

export interface DriveSearch {
  platform: NodeJS.Platform;
  user?: string;
  /** Overrides for tests. */
  readdir?: (p: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
}

/** Folders whose entries may be mounted drives, by OS. Windows: every drive letter root. */
function candidateRoots(platform: NodeJS.Platform, user?: string): string[] {
  if (platform === 'darwin') return ['/Volumes'];
  if (platform === 'linux')
    return [user && `/media/${user}`, user && `/run/media/${user}`, '/media', '/mnt'].filter(
      (x): x is string => !!x,
    );
  return [];
}

/** Finds mounted UF2 bootloader drives. Never throws; unreadable places are skipped. */
export async function findUf2Drives(o: DriveSearch): Promise<Uf2Drive[]> {
  const readdir = o.readdir ?? ((p: string) => fsp.readdir(p));
  const readFile = o.readFile ?? ((p: string) => fsp.readFile(p, 'utf8'));
  const mounts: string[] = [];
  if (o.platform === 'win32') {
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') mounts.push(`${l}:\\`);
  } else {
    for (const root of candidateRoots(o.platform, o.user)) {
      const names = await readdir(root).catch(() => [] as string[]);
      mounts.push(...names.map((n) => join(root, n)));
    }
  }
  const found: Uf2Drive[] = [];
  await Promise.all(
    mounts.map(async (m) => {
      const info = await readFile(join(m, 'INFO_UF2.TXT')).catch(() => undefined);
      if (!info) return;
      const { boardId, model } = parseInfoUf2(info);
      if (boardId) found.push({ path: m, boardId, model });
    }),
  );
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

const UF2_MAGIC0 = 0x0a324655;
const UF2_MAGIC1 = 0x9e5d5157;
const FLAG_FAMILY = 0x2000;

/** Family IDs used in a UF2 file (every 512-byte block's familyID, when present). */
export function uf2Families(data: Uint8Array): Set<number> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const families = new Set<number>();
  for (let off = 0; off + 512 <= data.length; off += 512) {
    if (view.getUint32(off, true) !== UF2_MAGIC0 || view.getUint32(off + 4, true) !== UF2_MAGIC1) continue;
    if (view.getUint32(off + 8, true) & FLAG_FAMILY) families.add(view.getUint32(off + 28, true));
  }
  return families;
}

/** UF2 family IDs each bootloader accepts (from the RP2040/RP2350 datasheets and picotool). */
const FAMILIES_FOR_BOARD: Record<string, number[]> = {
  'RPI-RP2': [0xe48bff56],
  // RP2350: absolute, ARM secure, RISC-V, ARM non-secure.
  RP2350: [0xe48bff57, 0xe48bff59, 0xe48bff5a, 0xe48bff5b],
};

/** Does this UF2 file fit the drive's chip? Unknown drives are allowed (the bootloader ignores misfits). */
export function uf2Fits(data: Uint8Array, boardId: string): boolean {
  const allowed = FAMILIES_FOR_BOARD[boardId];
  const families = uf2Families(data);
  if (!families.size) return false; // not a UF2 file
  if (!allowed) return true;
  return [...families].every((f) => allowed.includes(f));
}
