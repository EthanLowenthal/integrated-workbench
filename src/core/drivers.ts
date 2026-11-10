/**
 * Vendor driver download pages. The data lives in registries (workbench-registry/drivers.json);
 * we link to vendors and never redistribute their drivers.
 */
import bundled from '../../workbench-registry/drivers.json';

export interface DriverEntry {
  id: string;
  vendor: string;
  name: string;
  urls: { windows?: string; macos?: string; linux?: string };
  verified?: boolean;
}

export type DriverDb = Map<string, DriverEntry>;

export function createDriverDb(entries: readonly DriverEntry[]): DriverDb {
  const db: DriverDb = new Map();
  for (const d of entries) if (!db.has(d.id)) db.set(d.id, d);
  return db;
}

export const defaultDriverDb: DriverDb = createDriverDb(bundled.drivers as DriverEntry[]);

/** Where to report devices we don't recognize. A product link, not registry data. */
export const ISSUE_URL = 'https://github.com/EthanLowenthal/sketchdesk/issues/new';
