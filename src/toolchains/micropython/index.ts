import { promises as fsp } from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';
import type { SerialPort } from '../../core/types.js';
import type { ProbeHost } from '../../core/probes/host.js';
import type {
  BuildResult,
  BuildTarget,
  DetectedBoard,
  FlashResult,
  Project,
  ToolStatus,
  Toolchain,
} from '../types.js';
import type { LocalFile } from './board.js';

export const MICROPYTHON_TARGET: BuildTarget = { id: 'micropython', name: 'MicroPython' };

/** Folders and files never copied to the board. */
const SKIP_DIRS = new Set([
  '__pycache__',
  'node_modules',
  'venv',
  '.venv',
  'env',
  'typings',
  'build',
  'dist',
]);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

export interface MicroPythonOptions {
  host: Pick<ProbeHost, 'readdir'>;
  /** Workspace folders, so project detection doesn't walk above them. */
  workspaceRoots: () => string[];
  /** Folders the user marked with "Use Folder as MicroPython Project". */
  isMarked: (root: string) => boolean;
  /** Path of the serial-monitor tool, if installed. All board access goes through it. */
  serialMonitorPath: () => string | undefined;
  /** Serial ports from the core USB probe (no arduino-cli needed). */
  ports: () => SerialPort[];
}

/**
 * MicroPython projects: a folder with boot.py, or one the user marked. No build step; Run and
 * Upload talk to the board over the raw REPL (see board.ts), so nothing but the serial-monitor tool
 * is needed on the computer.
 */
export class MicroPythonToolchain implements Toolchain {
  readonly id = 'micropython';
  readonly label = 'MicroPython';

  constructor(private readonly opts: MicroPythonOptions) {}

  async findProject(filePath: string): Promise<Project | undefined> {
    const roots = this.opts.workspaceRoots();
    const within = roots.find((r) => filePath.startsWith(r + sep) || filePath === r);
    let dir = dirname(filePath);
    for (let i = 0; i < 5; i++) {
      if (this.opts.isMarked(dir)) return { root: dir, name: basename(dir), kind: 'micropython' };
      const entries = await this.opts.host.readdir(dir).catch(() => [] as string[]);
      if (entries.includes('boot.py')) return { root: dir, name: basename(dir), kind: 'micropython' };
      // Stay inside the workspace folder (or 5 levels when the file is outside any).
      if (within && dir === within) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  }

  async checkInstalled(): Promise<ToolStatus> {
    const path = this.opts.serialMonitorPath();
    return path
      ? { installed: true, path, version: '' }
      : { installed: false, reason: 'The Serial Monitor Engine is not installed.' };
  }

  /** USB serial ports. MicroPython boards don't identify themselves beyond their USB IDs. */
  async listBoards(): Promise<DetectedBoard[]> {
    return this.opts
      .ports()
      .filter((p) => p.vid)
      .map((p) => ({ port: p.path, vid: p.vid, pid: p.pid, candidates: [] }));
  }

  async listTargets(): Promise<BuildTarget[]> {
    return [MICROPYTHON_TARGET];
  }

  /** Nothing to compile; Run and Upload are handled by MicroPythonBoard. */
  async build(): Promise<BuildResult> {
    return { success: true, diagnostics: [] };
  }

  async flash(): Promise<FlashResult> {
    return { success: false, error: 'Use Upload for MicroPython projects.' };
  }
}

/**
 * The project's files as they go on the board: "/main.py", "/lib/util.py", ... Skips hidden files and
 * folders, caches and virtual environments, and files over 1 MB.
 */
export async function projectFiles(root: string): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < 6) await walk(p, depth + 1);
      } else if (e.isFile() && !e.name.endsWith('.pyi')) {
        const stat = await fsp.stat(p);
        if (stat.size > MAX_FILE_BYTES) continue;
        out.push({ boardPath: toBoardPath(root, p), data: await fsp.readFile(p) });
      }
    }
  };
  await walk(root, 0);
  return out;
}

export function toBoardPath(root: string, file: string): string {
  return '/' + relative(root, file).split(sep).join(posix.sep);
}

/**
 * Maps a traceback from code sent over the REPL ("File \"<stdin>\", line 7") back to the file it
 * came from. Returns the innermost <stdin> frame and the error line.
 */
export function tracebackLocation(traceback: string): { line: number; message: string } | undefined {
  const frames = [...traceback.matchAll(/File "<stdin>", line (\d+)/g)];
  const last = frames.pop();
  if (!last) return undefined;
  const message =
    traceback
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .pop() ?? '';
  return { line: Number(last[1]), message: message.trim() };
}
