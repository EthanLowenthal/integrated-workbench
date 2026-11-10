import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeHost, RunResult } from '../src/core/probes/host.js';
import type { Snapshot } from '../src/core/types.js';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(rel: string): string {
  return readFileSync(join(here, 'fixtures', rel), 'utf8');
}

export function fixtureJson<T>(rel: string): T {
  return JSON.parse(fixture(rel)) as T;
}

export function snapshot(partial: Partial<Snapshot> & Pick<Snapshot, 'os'>): Snapshot {
  return { takenAt: 0, usb: [], ports: [], env: {}, ...partial };
}

type RunHandler = (file: string, args: string[]) => RunResult | undefined;

/** Fake host: commands answered by `run`, files from `files`. Unknown commands look "not installed". */
export function fakeHost(opts: {
  run?: RunHandler;
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  realpaths?: Record<string, string>;
  readWrite?: Record<string, boolean>;
  gids?: Record<string, number>;
}): ProbeHost & { calls: { file: string; args: string[] }[] } {
  const calls: { file: string; args: string[] }[] = [];
  return {
    calls,
    async run(file, args) {
      calls.push({ file, args });
      return opts.run?.(file, args) ?? { stdout: '', stderr: 'not found', code: null };
    },
    async readFile(p) {
      return opts.files?.[p];
    },
    async readdir(p) {
      return opts.dirs?.[p] ?? [];
    },
    async realpath(p) {
      return opts.realpaths?.[p];
    },
    async canReadWrite(p) {
      return opts.readWrite?.[p] ?? true;
    },
    async statGid(p) {
      return opts.gids?.[p];
    },
  };
}

export const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 });
export const exit = (code: number, stdout = ''): RunResult => ({ stdout, stderr: '', code });
