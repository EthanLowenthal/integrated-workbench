import { spawn } from 'node:child_process';
import { constants, promises as fsp } from 'node:fs';
import { TIMEOUTS } from '../timeouts.js';

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
  /** True if the program was stopped because it ran past its time limit. */
  timedOut?: boolean;
}

const MAX_OUTPUT = 32 * 1024 * 1024;
/** Default limit for probes; callers pass their own for slower commands. */
export const DEFAULT_RUN_TIMEOUT_MS = TIMEOUTS.probeMs;
/** Between asking a timed-out program to stop and force-killing it. */
export const KILL_GRACE_MS = TIMEOUTS.killGraceMs;

/**
 * Starts a program with an argument array (never a shell) and always settles: on exit, on spawn
 * failure, or at the time limit. On timeout it sends SIGTERM, then SIGKILL after a grace period,
 * and resolves right away instead of waiting for a stuck program to exit.
 */
export function runWithTimeout(
  file: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    cwd?: string;
    signal?: AbortSignal;
    onStdout?: (t: string) => void;
    onStderr?: (t: string) => void;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { cwd: opts.cwd, windowsHide: true });
    } catch (err) {
      resolve({ stdout, stderr: String(err), code: null });
      return;
    }
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, KILL_GRACE_MS).unref();
    };
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const timer = setTimeout(() => {
      stop();
      finish({
        stdout,
        stderr: `${stderr}\nStopped after ${Math.round(timeoutMs / 1000)} s (time limit).`,
        code: null,
        timedOut: true,
      });
    }, timeoutMs);
    const onAbort = () => {
      stop();
      finish({ stdout, stderr: `${stderr}\nCancelled.`, code: null });
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort);
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
      opts.onStdout?.(d);
    });
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
      opts.onStderr?.(d);
    });
    child.on('error', (err) => finish({ stdout, stderr: stderr + String(err), code: null }));
    child.on('close', (code) => finish({ stdout, stderr, code }));
  });
}

export const nodeHost: ProbeHost = {
  run(file, args, opts) {
    return runWithTimeout(file, args, { timeoutMs: opts?.timeoutMs });
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
