import { execFile } from 'node:child_process';
import { constants, promises as fsp } from 'node:fs';

/**
 * Everything a probe touches on the host machine. Probes receive this so tests can substitute fakes
 * that return fixture data.
 */
export interface ProbeHost {
  /** Runs a program with an argument array (never through a shell). Never throws for a non-zero exit. */
  run(file: string, args: string[], opts?: { timeoutMs?: number }): Promise<RunResult>;
  readFile(path: string): Promise<string | undefined>;
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string | undefined>;
  /** Can the current user open this path read/write? */
  canReadWrite(path: string): Promise<boolean>;
  /** Group id owning the path. */
  statGid(path: string): Promise<number | undefined>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Exit code; null if the program couldn't be started (e.g. not installed) or timed out. */
  code: number | null;
}

const MAX_BUFFER = 32 * 1024 * 1024;

export const nodeHost: ProbeHost = {
  run(file, args, opts) {
    return new Promise((resolve) => {
      execFile(
        file,
        args,
        { timeout: opts?.timeoutMs ?? 15_000, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
        (err, stdout, stderr) => {
          let code: number | null = 0;
          if (err) code = typeof err.code === 'number' ? err.code : null;
          resolve({ stdout, stderr, code });
        },
      );
    });
  },
  async readFile(path) {
    try {
      return await fsp.readFile(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  async readdir(path) {
    try {
      return await fsp.readdir(path);
    } catch {
      return [];
    }
  },
  async realpath(path) {
    try {
      return await fsp.realpath(path);
    } catch {
      return undefined;
    }
  },
  async canReadWrite(path) {
    try {
      await fsp.access(path, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
  async statGid(path) {
    try {
      return (await fsp.stat(path)).gid;
    } catch {
      return undefined;
    }
  },
};
