/**
 * Runs inside a real VS Code (see scripts/e2e.mjs). Plain assertions, no test framework:
 * throwing fails the run.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, get: () => T | undefined, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(200);
  }
}

export async function run(): Promise<void> {
  const log = (s: string) => console.log(`[e2e] ${s}`);
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace folder open');

  const ext = vscode.extensions.getExtension<TestApi>('integrated-workbench.integrated-workbench');
  assert.ok(ext, 'extension found');
  const t0 = Date.now();
  const api = await ext.activate();
  const ms = Date.now() - t0;
  log(`activated in ${ms} ms`);
  // Activation must not wait on arduino-cli or the network.
  assert.ok(ms < 3000, `activation took ${ms} ms`);

  // Registry: built-in one loaded cleanly.
  const src = api.registry.registry.sources[0];
  assert.equal(src?.builtin, true);
  assert.deepEqual(src?.errors, []);
  assert.ok(api.registry.toolProviding('arduino-cli'), 'arduino-cli package in registry');
  log(
    `registry: ${api.registry.registry.packages.length} packages, ${api.registry.registry.usb.length} USB IDs`,
  );

  // Commands registered.
  const cmds = await vscode.commands.getCommands(true);
  for (const c of [
    'build',
    'upload',
    'selectBoard',
    'selectPort',
    'showSketch',
    'showTools',
    'boardDoctor',
    'reloadRegistries',
  ]) {
    assert.ok(cmds.includes(`integratedWorkbench.${c}`), `command ${c}`);
  }

  // Opening a .ino finds the sketch.
  const ino = vscode.Uri.joinPath(folder.uri, 'Blink', 'Blink.ino');
  await vscode.window.showTextDocument(ino);
  const project = await until('sketch detected', () => api.session.project);
  assert.equal(project.name, 'Blink');
  log(`sketch: ${project.name}, engine ready: ${api.session.toolReady}`);

  // Both sidebar views open (webviews resolve) without throwing.
  await vscode.commands.executeCommand('integratedWorkbench.showSketch');
  await vscode.commands.executeCommand('integratedWorkbench.showTools');
  await until('build engine recommended', () =>
    api.tools.state.recommended.find((i) => i.id === 'arduino-cli'),
  );
  const recommended = api.tools.state.recommended.map((i) => i.id);
  log(`recommended: ${recommended.join(', ')}`);
  assert.ok(recommended.includes('arduino-cli'), 'build engine recommended for a workspace with .ino files');

  // Verify with no engine opens setup instead of failing.
  if (!api.session.toolReady) {
    const ok = await api.runs.build();
    assert.equal(ok, false);
    assert.match(api.runs.state.blocked ?? '', /build engine/i);
    log(`verify without engine -> "${api.runs.state.blocked}"`);
  }

  // Picking a board writes sketch.yaml.
  await api.session.setTarget({ id: 'arduino:avr:uno', name: 'Arduino Uno' });
  const yaml = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, 'Blink', 'sketch.yaml')),
  );
  assert.match(yaml, /^default_fqbn: arduino:avr:uno$/m);
  await until('recommendation from sketch board', () =>
    api.tools.state.recommended.find(
      (i) => i.id === 'arduino:avr' && i.reasons.some((r) => r.includes('Blink targets')),
    ),
  );
  log('sketch.yaml written; arduino:avr recommended for Blink');
  log('PASS');
}
