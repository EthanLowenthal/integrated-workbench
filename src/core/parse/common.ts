/** Parsers shared by macOS and Linux. */

export interface ProcessRef {
  pid: number;
  name: string;
}

/**
 * Parses `lsof -F pc <path>` output: one `p<pid>` line followed by a `c<command>` line per process.
 * lsof exits 1 with empty output when nobody has the file open.
 */
export function parseLsofF(text: string): ProcessRef[] {
  const out: ProcessRef[] = [];
  let cur: ProcessRef | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('p')) {
      const pid = Number(line.slice(1));
      if (!Number.isInteger(pid)) continue;
      cur = { pid, name: `process ${pid}` };
      out.push(cur);
    } else if (line.startsWith('c') && cur) {
      cur.name = line.slice(1);
    }
  }
  return out;
}

/** Parses `fuser <path>` stdout, which is just the PIDs (the path label goes to stderr). */
export function parseFuserPids(stdout: string): number[] {
  return stdout
    .replace(/^[^:]*:/, '')
    .split(/\s+/)
    .map((t) => Number(t.replace(/[a-z]+$/i, '')))
    .filter((n) => Number.isInteger(n) && n > 0);
}
