// In-editor smoke test: builds test/e2e/suite.ts, makes a throwaway workspace with a sketch, and runs it
// in VS Code with a fresh, temporary profile. Uses VSCODE_PATH, or the usual macOS install locations.
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
mkdirSync(join(ws, 'UsesServo'), { recursive: true });
writeFileSync(
  join(ws, 'UsesServo', 'UsesServo.ino'),
  '#include <Servo.h>\nServo s;\nvoid setup() { s.attach(9); }\nvoid loop() {}\n',
);
mkdirSync(join(ws, 'NeedsLib'), { recursive: true });
writeFileSync(
  join(ws, 'NeedsLib', 'NeedsLib.ino'),
  '#include <FastLED.h>\nvoid setup() {}\nvoid loop() {}\n',
);

// With a real toolchain: start from a fresh Arduino data folder with no board packages, seeded with the
// package indexes and download cache from E2E_ARDUINO_DATA, so installs work offline.
let arduinoData;
if (process.env.E2E_ARDUINO_DATA) {
  arduinoData = join(tmp, 'arduino-data');
  mkdirSync(arduinoData, { recursive: true });
  for (const f of readdirSync(process.env.E2E_ARDUINO_DATA)) {
    if (f.endsWith('.json') || f.endsWith('.sig'))
      cpSync(join(process.env.E2E_ARDUINO_DATA, f), join(arduinoData, f));
  }
  cpSync(join(process.env.E2E_ARDUINO_DATA, 'staging'), join(arduinoData, 'staging'), { recursive: true });
}

try {
  await runTests({
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/e2e/suite.js'),
    // Optional: point at an existing arduino-cli and data folder to also test real board options and compiles.
    extensionTestsEnv: process.env.E2E_CLI
      ? { E2E_CLI: process.env.E2E_CLI, ARDUINO_DIRECTORIES_DATA: arduinoData }
      : {},
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
