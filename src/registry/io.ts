import { promises as fsp } from 'node:fs';
import type { RegistryIO } from './load.js';
import { TIMEOUTS } from '../core/timeouts.js';

const MAX_BYTES = 5 * 1024 * 1024;

/** Reads registries from disk or over https (5 MB cap, time-limited). */
export const nodeRegistryIO: RegistryIO = {
  async read(loc) {
    if (loc.kind === 'file') return fsp.readFile(loc.path, 'utf8');
    const res = await fetch(loc.url, { signal: AbortSignal.timeout(TIMEOUTS.registryFetchMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('file is larger than 5 MB');
    return text;
  },
};
