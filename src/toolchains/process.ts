import { spawn } from 'node:child_process';

export interface StreamResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface StreamOptions {
  cwd?: string;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  signal?: AbortSignal;
}

/** Signature of streamProcess, so adapters can take a fake in tests. */
export type StreamRunner = (file: string, args: string[], opts?: StreamOptions) => Promise<StreamResult>;

/**
 * Runs a long-lived program (compile, upload) with an argument array, streaming its output.
 * Never uses a shell. Resolves (never rejects) with code null if the program couldn't start.
 */
export const streamProcess: StreamRunner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(file, args, { cwd: opts.cwd, signal: opts.signal, windowsHide: true });
    child.stdout.setEncoding('utf8').on('data', (t: string) => {
      stdout += t;
      opts.onStdout?.(t);
    });
    child.stderr.setEncoding('utf8').on('data', (t: string) => {
      stderr += t;
      opts.onStderr?.(t);
    });
    child.on('error', (err) => resolve({ code: null, stdout, stderr: stderr + String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
