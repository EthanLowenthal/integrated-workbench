import { runWithTimeout, type RunResult } from '../core/probes/host.js';

export type StreamResult = RunResult;

export interface StreamOptions {
  cwd?: string;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  signal?: AbortSignal;
  /** Required: long-running commands always get an explicit limit (see src/timeouts.ts). */
  timeoutMs: number;
}

/** Signature of streamProcess, so adapters can take a fake in tests. */
export type StreamRunner = (file: string, args: string[], opts: StreamOptions) => Promise<StreamResult>;

/**
 * Runs a long-lived program (compile, upload, install) with an argument array, streaming its output.
 * Never uses a shell. Always resolves: on exit, on cancel, or at the time limit (then force-killed).
 */
export const streamProcess: StreamRunner = (file, args, opts) => runWithTimeout(file, args, opts);
