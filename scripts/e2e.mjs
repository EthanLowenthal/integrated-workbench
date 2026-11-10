// In-editor smoke test: builds test/e2e/suite.ts, makes a throwaway workspace with a sketch, and runs it
// in VS Code with a fresh, temporary profile. Uses VSCODE_PATH, or the usual macOS install locations.
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
await esbuild.build({
  entryPoints: ['test/e2e/suite.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/e2e/suite.js',
  external: ['vscode'],
  logLevel: 'warning',
});

const candidates = [
  process.env.VSCODE_PATH,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code/Visual Studio Code.app/Contents/MacOS/Code',
].filter(Boolean);
const vscodeExecutablePath = candidates.find((p) => existsSync(p));

const tmp = mkdtempSync(join(tmpdir(), 'iw-e2e-'));
const ws = join(tmp, 'workspace');
mkdirSync(join(ws, 'Blink'), { recursive: true });
writeFileSync(join(ws, 'Blink', 'Blink.ino'), 'void setup() {}\nvoid loop() {}\n');

try {
  await runTests({
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/e2e/suite.js'),
    launchArgs: [
      ws,
      '--user-data-dir',
      join(tmp, 'user'),
      '--extensions-dir',
      join(tmp, 'ext'),
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
