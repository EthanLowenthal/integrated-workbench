import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProbeHost } from './core/probes/host.js';
import type { Download, ToolPackage } from './registry/types.js';

/**
 * Installs `tool` packages from a registry: download, SHA-256 check against the registry entry,
 * unpack, mark executable. Tools live in <storage>/tools/<id>/<version>/.
 */

export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export function toolDownload(
  pkg: ToolPackage,
  platform?: NodeJS.Platform,
  arch?: string,
): Download | undefined {
  return pkg.downloads[platformKey(platform, arch)];
}

export function toolDir(storageDir: string, pkg: ToolPackage): string {
  return join(storageDir, 'tools', pkg.id, pkg.version);
}

/** Path of the installed executable, or undefined if this OS/CPU has no download. */
export function toolBinPath(
  storageDir: string,
  pkg: ToolPackage,
  platform?: NodeJS.Platform,
  arch?: string,
): string | undefined {
  const dl = toolDownload(pkg, platform, arch);
  return dl ? join(toolDir(storageDir, pkg), dl.bin) : undefined;
}

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface InstallOptions {
  storageDir: string;
  pkg: ToolPackage;
  host: ProbeHost;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: Fetcher;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const ARCHIVE = /\.(tar\.gz|tgz|tar\.xz|tar\.bz2|zip)$/i;

/** Downloads, verifies and unpacks a tool. Returns the executable path. Throws with a readable message. */
export async function installTool(opts: InstallOptions): Promise<string> {
  const platform = opts.platform ?? process.platform;
  const { pkg } = opts;
  const dl = toolDownload(pkg, platform, opts.arch);
  if (!dl) throw new Error(`${pkg.name} has no download for ${platformKey(platform, opts.arch)}.`);

  const finalDir = toolDir(opts.storageDir, pkg);
  const staging = `${finalDir}.partial`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  try {
    const res = await (opts.fetch ?? fetch)(dl.url, { signal: opts.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || dl.size || 0;
    const hash = createHash('sha256');
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      chunks.push(value);
      received += value.length;
      if (total) opts.onProgress?.(Math.min(1, received / total));
    }
    const digest = hash.digest('hex');
    if (digest !== dl.sha256) {
      throw new Error(`Downloaded file failed its integrity check (expected ${dl.sha256}, got ${digest}).`);
    }

    const fileName = new URL(dl.url).pathname.split('/').pop() || 'download';
    const bin = join(staging, dl.bin);
    if (ARCHIVE.test(fileName)) {
      const archive = join(staging, `.${fileName}`);
      await fsp.writeFile(archive, Buffer.concat(chunks));
      // bsdtar ships with macOS, Linux and Windows 10+ (System32\tar.exe) and reads .tar.* and .zip.
      const tar =
        platform === 'win32'
          ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
          : 'tar';
      const unpack = await opts.host.run(tar, ['-xf', archive, '-C', staging], { timeoutMs: 120_000 });
      if (unpack.code !== 0) {
        throw new Error(`Couldn't unpack ${pkg.name}: ${unpack.stderr.trim() || `exit ${unpack.code}`}`);
      }
      await fsp.rm(archive);
    } else {
      await fsp.mkdir(dirname(bin), { recursive: true });
      await fsp.writeFile(bin, Buffer.concat(chunks));
    }

    try {
      await fsp.access(bin);
    } catch {
      throw new Error(`${pkg.name}: "${dl.bin}" wasn't in the download.`);
    }
    if (platform !== 'win32') await fsp.chmod(bin, 0o755);

    // Swap in at the end: a half-finished download never looks installed.
    await fsp.rm(finalDir, { recursive: true, force: true });
    await fsp.rename(staging, finalDir);
    return join(finalDir, dl.bin);
  } catch (err) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw err;
  }
}
