import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeHost } from '../src/core/probes/host.js';
import { ArduinoToolchain } from '../src/toolchains/arduino/index.js';
import {
  CLI_ASSETS,
  assetFor,
  installManagedCli,
  managedCliPath,
  releaseUrl,
  type Fetcher,
} from '../src/toolchains/arduino/managedCli.js';
import { fakeHost, ok } from './helpers.js';

const isWindows = process.platform === 'win32';

/** A real .tar.gz containing a fake arduino-cli, like the official release archives. */
function makeArchive(dir: string): { bytes: Buffer; sha256: string } {
  const src = join(dir, 'src');
  execFileSync('mkdir', ['-p', src]);
  writeFileSync(join(src, 'arduino-cli'), '#!/bin/sh\necho \'{"VersionString":"1.5.1"}\'\n');
  writeFileSync(join(src, 'LICENSE.txt'), 'GPL-3.0');
  const archive = join(dir, 'a.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', src, 'arduino-cli', 'LICENSE.txt']);
  const bytes = readFileSync(archive);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const fetchBytes =
  (bytes: Buffer, status = 200): Fetcher =>
  async () =>
    new Response(status === 200 ? new Uint8Array(bytes) : null, {
      status,
      headers: { 'content-length': String(bytes.length) },
    });

describe('managed arduino-cli', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sd-cli-'));
  });
  afterEach(() => execFileSync('rm', ['-rf', dir]));

  it('has a pinned asset for every common OS/CPU, with a sha256', () => {
    for (const key of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']) {
      expect(CLI_ASSETS[key]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(assetFor('darwin', 'arm64')?.file).toBe('arduino-cli_1.5.1_macOS_ARM64.tar.gz');
    expect(assetFor('aix', 'ppc64')).toBeUndefined();
    expect(releaseUrl('x.tar.gz')).toBe(
      'https://github.com/arduino/arduino-cli/releases/download/v1.5.1/x.tar.gz',
    );
  });

  it.skipIf(isWindows)('downloads, verifies, unpacks and marks executable', async () => {
    const { bytes, sha256 } = makeArchive(dir);
    const progress: number[] = [];
    const storage = join(dir, 'storage');
    const path = await installManagedCli({
      storageDir: storage,
      host: nodeHost,
      fetch: fetchBytes(bytes),
      onProgress: (f) => progress.push(f),
      assetOverride: { file: 'a.tar.gz', sha256, size: bytes.length },
    });
    expect(path).toBe(managedCliPath(storage, process.platform));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(existsSync(join(storage, 'arduino-cli', '1.5.1', 'a.tar.gz'))).toBe(false); // archive removed
    expect(progress.at(-1)).toBe(1);
    // And the toolchain now finds and prefers it.
    const tc = new ArduinoToolchain({
      host: nodeHost,
      buildRoot: dir,
      managedDir: storage,
      cliPath: () => '',
    });
    expect(await tc.checkInstalled()).toEqual({ installed: true, path, version: '1.5.1' });
  });

  it('rejects a download that fails the checksum, and leaves nothing behind', async () => {
    const storage = join(dir, 'storage');
    await expect(
      installManagedCli({
        storageDir: storage,
        host: nodeHost,
        fetch: fetchBytes(Buffer.from('not the real thing')),
        assetOverride: { file: 'a.tar.gz', sha256: '0'.repeat(64), size: 10 },
      }),
    ).rejects.toThrow(/integrity check/);
    expect(existsSync(join(storage, 'arduino-cli', '1.5.1'))).toBe(false);
    expect(existsSync(join(storage, 'arduino-cli', '1.5.1.partial'))).toBe(false);
  });

  it('reports HTTP errors and unsupported platforms', async () => {
    await expect(
      installManagedCli({
        storageDir: dir,
        host: nodeHost,
        fetch: fetchBytes(Buffer.alloc(0), 404),
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      installManagedCli({ storageDir: dir, host: nodeHost, platform: 'aix', arch: 'ppc64' }),
    ).rejects.toThrow(/No arduino-cli build/);
  });

  it('prefers the managed copy over one on PATH, but the user setting wins over both', async () => {
    const managed = managedCliPath('/store', 'darwin');
    const host = fakeHost({ run: () => ok('{"VersionString":"1.5.1"}') });
    const tc = new ArduinoToolchain({ host, buildRoot: '/b', managedDir: '/store', platform: 'darwin' });
    expect(await tc.checkInstalled()).toMatchObject({ path: managed });
    const custom = new ArduinoToolchain({
      host,
      buildRoot: '/b',
      managedDir: '/store',
      platform: 'darwin',
      cliPath: () => '/mine',
    });
    expect(await custom.checkInstalled()).toMatchObject({ path: '/mine' });
  });
});
