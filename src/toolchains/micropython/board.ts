import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  BOARD_INFO,
  decodeFile,
  getFileCode,
  hashFilesCode,
  listFilesCode,
  mkdirsCode,
  parseFileList,
  parseHashes,
  putFileCodes,
  RawRepl,
  removeCode,
  type BoardFile,
  type ByteLink,
  type ExecOptions,
} from './rawRepl.js';

/** A project file to put on the board: its path on the board ("/main.py") and contents. */
export interface LocalFile {
  boardPath: string;
  data: Uint8Array;
}

export interface SyncResult {
  uploaded: string[];
  unchanged: string[];
}

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Files whose contents differ from the board's (or are missing there). */
export function filesToUpload(files: LocalFile[], boardHashes: Map<string, string>): LocalFile[] {
  return files.filter((f) => boardHashes.get(f.boardPath) !== sha256(f.data));
}

/** File operations and program runs on a MicroPython board. Each call enters and leaves raw REPL. */
export class MicroPythonBoard {
  private readonly repl: RawRepl;

  constructor(link: ByteLink, commandTimeoutMs = 10000) {
    this.repl = new RawRepl(link, { commandTimeoutMs });
  }

  close(): void {
    this.repl.close();
  }

  /** Enters raw REPL, runs `work`, and always returns to the normal REPL. */
  private async session<T>(work: (repl: RawRepl) => Promise<T>): Promise<T> {
    await this.repl.enter();
    try {
      return await work(this.repl);
    } finally {
      this.repl.exit();
    }
  }

  /** "micropython 1.24.1; Raspberry Pi Pico with RP2040". */
  info(): Promise<string> {
    return this.session(async (r) => (await r.exec(BOARD_INFO)).trim());
  }

  list(): Promise<BoardFile[]> {
    return this.session(async (r) => parseFileList(await r.exec(listFilesCode())));
  }

  read(path: string): Promise<Uint8Array> {
    return this.session(async (r) => decodeFile(await r.exec(getFileCode(path))));
  }

  remove(path: string, dir: boolean): Promise<void> {
    return this.session(async (r) => {
      await r.exec(removeCode(path, dir));
    });
  }

  /**
   * Uploads files that changed (by SHA-256). Never deletes anything on the board.
   * `onFile` is called before each upload.
   */
  sync(
    files: LocalFile[],
    onFile?: (path: string, index: number, total: number) => void,
  ): Promise<SyncResult> {
    return this.session(async (r) => {
      const hashes = parseHashes(await r.exec(hashFilesCode(files.map((f) => f.boardPath))));
      const changed = filesToUpload(files, hashes);
      const dirs = new Set(changed.map((f) => posix.dirname(f.boardPath)).filter((d) => d !== '/'));
      for (const d of dirs) await r.exec(mkdirsCode(d));
      for (const [i, f] of changed.entries()) {
        onFile?.(f.boardPath, i, changed.length);
        for (const code of putFileCodes(f.boardPath, f.data)) await r.exec(code);
      }
      return {
        uploaded: changed.map((f) => f.boardPath),
        unchanged: files.filter((f) => !changed.includes(f)).map((f) => f.boardPath),
      };
    });
  }

  /** Runs code without saving it on the board; output streams to `onStdout`. Stop with `signal`. */
  run(code: string, o: ExecOptions): Promise<string> {
    return this.session((r) => r.exec(code, o));
  }

  /** Soft-resets the board so it runs boot.py and main.py. */
  softReset(): void {
    this.repl.softReset();
  }
}
