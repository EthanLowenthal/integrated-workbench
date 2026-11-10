import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeHost } from '../src/core/probes/host.js';
import type { ToolPackage } from '../src/registry/types.js';
import { ArduinoToolchain } from '../src/toolchains/arduino/index.js';
import { installTool, toolBinPath, toolDir, type Fetcher } from '../src/tools.js';
import { fakeHost, ok } from './helpers.js';

const isWindows = process.platform === 'win32';
const key = `${process.platform}-${process.arch}`;

function makeArchive(dir: string): Buffer {
  const src = join(dir, 'src');
  execFileSync('mkdir', ['-p', src]);
  writeFileSync(join(src, 'arduino-cli'), '#!/bin/sh\necho \'{"VersionString":"1.5.1"}\'\n');
  const archive = join(dir, 'a.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', src, 'arduino-cli']);
  return readFileSync(archive);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function pkgFor(url: string, bytes: Buffer, bin = 'arduino-cli'): ToolPackage {
  return {
    id: 'arduino-cli',
    kind: 'tool',
    name: 'Arduino build engine',
    version: '1.5.1',
    provides: ['arduino-cli'],
    downloads: { [key]: { url, sha256: sha(bytes), size: bytes.length, bin } },
  };
}

const fetchBytes =
  (bytes: Buffer, status = 200): Fetcher =>
  async () =>
    new Response(status === 200 ? new Uint8Array(bytes) : null, {
      status,
      headers: { 'content-length': String(bytes.length) },
    });

describe('installTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'iw-tool-'));
  });
  afterEach(() => execFileSync('rm', ['-rf', dir]));

  it.skipIf(isWindows)('downloads, verifies, unpacks an archive and marks it executable', async () => {
    const bytes = makeArchive(dir);
    const pkg = pkgFor('https://example.test/arduino-cli_1.5.1.tar.gz', bytes);
    const progress: number[] = [];
    const storage = join(dir, 'storage');
    const path = await installTool({
      storageDir: storage,
      pkg,
      host: nodeHost,
      fetch: fetchBytes(bytes),
      onProgress: (f) => progress.push(f),
    });
    expect(path).toBe(toolBinPath(storage, pkg));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(progress.at(-1)).toBe(1);
    // The Arduino toolchain finds it through the registry package.
    const tc = new ArduinoToolchain({
      host: nodeHost,
      buildRoot: dir,
      toolsDir: storage,
      cliPackage: () => pkg,
      cliPath: () => '',
    });
    expect(await tc.checkInstalled()).toEqual({ installed: true, path, version: '1.5.1' });
  });

  it.skipIf(isWindows)('installs a bare binary (not an archive)', async () => {
    const bytes = Buffer.from('#!/bin/sh\necho hi\n');
    const pkg = pkgFor('https://example.test/espflash', bytes, 'espflash');
    const path = await installTool({ storageDir: dir, pkg, host: nodeHost, fetch: fetchBytes(bytes) });
    expect(readFileSync(path, 'utf8')).toContain('echo hi');
  });

  it('rejects a download that fails the checksum, and leaves nothing behind', async () => {
    const pkg = pkgFor('https://example.test/a.tar.gz', Buffer.from('the real thing'));
    await expect(
      installTool({ storageDir: dir, pkg, host: nodeHost, fetch: fetchBytes(Buffer.from('something else')) }),
    ).rejects.toThrow(/integrity check/);
    expect(existsSync(toolDir(dir, pkg))).toBe(false);
    expect(existsSync(`${toolDir(dir, pkg)}.partial`)).toBe(false);
  });

  it('reports HTTP errors, missing binaries and unsupported platforms', async () => {
    const bytes = Buffer.from('x');
    await expect(
      installTool({
        storageDir: dir,
        pkg: pkgFor('https://e.test/a', bytes),
        host: nodeHost,
        fetch: fetchBytes(bytes, 404),
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      installTool({
        storageDir: dir,
        pkg: pkgFor('https://e.test/a', bytes),
        host: nodeHost,
        platform: 'aix',
      }),
    ).rejects.toThrow(/no download for aix/);
  });

  it('prefers the managed copy over one on PATH, but the user setting wins over both', async () => {
    const pkg = pkgFor('https://e.test/a.tar.gz', Buffer.from('x'));
    const pkgMac = { ...pkg, downloads: { [`darwin-${process.arch}`]: pkg.downloads[key]! } };
    const managed = toolBinPath('/store', pkgMac, 'darwin', process.arch);
    const host = fakeHost({ run: () => ok('{"VersionString":"1.5.1"}') });
    const tc = new ArduinoToolchain({
      host,
      buildRoot: '/b',
      toolsDir: '/store',
      cliPackage: () => pkgMac,
      platform: 'darwin',
    });
    expect(await tc.checkInstalled()).toMatchObject({ path: managed });
    const custom = new ArduinoToolchain({
      host,
      buildRoot: '/b',
      toolsDir: '/store',
      cliPackage: () => pkgMac,
      platform: 'darwin',
      cliPath: () => '/mine',
    });
    expect(await custom.checkInstalled()).toMatchObject({ path: '/mine' });
  });
});
