import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ProbeHost } from '../../core/probes/host.js';

/**
 * SketchDesk's own copy of arduino-cli, so users never install it themselves.
 * Pinned version, official GitHub release, SHA-256 checked against values baked in here
 * (from the release's checksums file). arduino-cli is GPL-3.0 and runs as a separate program.
 */
export const ARDUINO_CLI_VERSION = '1.5.1';

export interface CliAsset {
  file: string;
  sha256: string;
  /** Download size in bytes, for the consent prompt. */
  size: number;
}

/** Keyed by `${process.platform}-${process.arch}`. */
export const CLI_ASSETS: Record<string, CliAsset> = {
  'darwin-arm64': {
    file: 'arduino-cli_1.5.1_macOS_ARM64.tar.gz',
    sha256: 'cb952e8c1621c95ef5f1d17831c945e3d0ec5973f89c557a7ec8feb9c4f7d4c9',
    size: 17_370_016,
  },
  'darwin-x64': {
    file: 'arduino-cli_1.5.1_macOS_64bit.tar.gz',
    sha256: 'c982e940027996bea9901050e95fae99c59c1dcfee54beedecaf28141e7bf2e7',
    size: 19_355_892,
  },
  'linux-x64': {
    file: 'arduino-cli_1.5.1_Linux_64bit.tar.gz',
    sha256: '28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b',
    size: 17_630_765,
  },
  'linux-arm64': {
    file: 'arduino-cli_1.5.1_Linux_ARM64.tar.gz',
    sha256: '1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62',
    size: 16_155_457,
  },
  'linux-arm': {
    file: 'arduino-cli_1.5.1_Linux_ARMv7.tar.gz',
    sha256: '890af36e9873606e4dfa743534846186621b9f3a339175ea3ec481adecf07143',
    size: 16_434_757,
  },
  'win32-x64': {
    file: 'arduino-cli_1.5.1_Windows_64bit.zip',
    sha256: 'fabe42e0eb04d00e776a66178299ff95a46c623dbc260f997e58fd514853dd40',
    size: 17_965_819,
  },
  // 32-bit Windows build also runs on Windows on ARM (x64 emulation needs Windows 11).
  'win32-ia32': {
    file: 'arduino-cli_1.5.1_Windows_32bit.zip',
    sha256: '885e491c7c7fb8b396151c09daa5c4c56d8b60697d172a5cfe72c939eed50fe3',
    size: 17_468_455,
  },
  'win32-arm64': {
    file: 'arduino-cli_1.5.1_Windows_32bit.zip',
    sha256: '885e491c7c7fb8b396151c09daa5c4c56d8b60697d172a5cfe72c939eed50fe3',
    size: 17_468_455,
  },
};

export function releaseUrl(file: string, version = ARDUINO_CLI_VERSION): string {
  return `https://github.com/arduino/arduino-cli/releases/download/v${version}/${file}`;
}

export function assetFor(platform: NodeJS.Platform, arch: string): CliAsset | undefined {
  return CLI_ASSETS[`${platform}-${arch}`];
}

/** Where the managed binary lives: <storage>/arduino-cli/<version>/arduino-cli[.exe]. */
export function managedCliPath(
  storageDir: string,
  platform: NodeJS.Platform,
  version = ARDUINO_CLI_VERSION,
): string {
  return join(storageDir, 'arduino-cli', version, platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli');
}

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface InstallOptions {
  storageDir: string;
  host: ProbeHost;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: Fetcher;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Tests only. */
  assetOverride?: CliAsset;
  urlOverride?: string;
}

/** Downloads, verifies and unpacks arduino-cli. Returns the binary path. Throws with a readable message. */
export async function installManagedCli(opts: InstallOptions): Promise<string> {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const asset = opts.assetOverride ?? assetFor(platform, arch);
  if (!asset) throw new Error(`No arduino-cli build for ${platform} ${arch}.`);

  const dest = managedCliPath(opts.storageDir, platform);
  const versionDir = join(dest, '..');
  const staging = `${versionDir}.partial`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  try {
    const res = await (opts.fetch ?? fetch)(opts.urlOverride ?? releaseUrl(asset.file), {
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || asset.size;
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
      opts.onProgress?.(Math.min(1, received / total));
    }
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) {
      throw new Error(
        `Downloaded file failed its integrity check (expected ${asset.sha256}, got ${digest}).`,
      );
    }

    const archive = join(staging, asset.file);
    await fsp.writeFile(archive, Buffer.concat(chunks));
    // bsdtar ships with macOS, Linux and Windows 10+ (System32\tar.exe) and reads both .tar.gz and .zip.
    const tar =
      platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const unpack = await opts.host.run(tar, ['-xf', archive, '-C', staging], { timeoutMs: 60_000 });
    if (unpack.code !== 0)
      throw new Error(`Couldn't unpack arduino-cli: ${unpack.stderr.trim() || `exit ${unpack.code}`}`);
    await fsp.rm(archive);

    const exe = platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
    await fsp.access(join(staging, exe));
    if (platform !== 'win32') await fsp.chmod(join(staging, exe), 0o755);

    // Swap in atomically-ish: a half-finished download never looks installed.
    await fsp.rm(versionDir, { recursive: true, force: true });
    await fsp.rename(staging, versionDir);
    return dest;
  } catch (err) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw err;
  }
}
