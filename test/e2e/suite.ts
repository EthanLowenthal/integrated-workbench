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
  // Serial Monitor: without its engine it says so instead of hanging.
  await vscode.commands.executeCommand('integratedWorkbench.openMonitor');
  if (!api.monitor.state.engineReady) {
    assert.equal(api.monitor.state.status, 'error');
    assert.match(api.monitor.state.message ?? '', /Serial Monitor Engine not installed/);
    log(`monitor without engine -> "${api.monitor.state.message}"`);
    // Install the engine through Boards and Tools (real download from GitHub, sha256-checked).
    await api.tools.install('serial-monitor');
    await until('monitor engine installed', () => (api.monitor.state.engineReady ? true : undefined), 60000);
    log('Serial Monitor Engine installed');
  }

  // A real serial device on macOS: the Bluetooth serial port. Open it, change baud live, close.
  const btPort = '/dev/cu.Bluetooth-Incoming-Port';
  if (
    process.platform === 'darwin' &&
    (await vscode.workspace.fs.stat(vscode.Uri.file(btPort)).then(
      () => true,
      () => false,
    ))
  ) {
    await api.monitor.connect(btPort);
    assert.equal(api.monitor.state.status, 'connected', api.monitor.state.message);
    assert.ok(api.monitor.state.bauds.length > 5, 'baud list from the port');
    await api.monitor.setBaud('9600');
    assert.equal(api.monitor.state.baud, '9600');
    await api.monitor.disconnect();
    assert.equal(api.monitor.state.status, 'idle');
    log(`monitor: opened ${btPort}, ${api.monitor.state.bauds.length} baud rates, changed baud live, closed`);
  }
  // Sketch Settings page and IntelliSense status (no C/C++ extension in the throwaway profile).
  await vscode.commands.executeCommand('integratedWorkbench.openSketchSettings');
  await until('settings page tab', () =>
    vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label.startsWith('Sketch Settings')),
  );
  log(`intellisense status without C/C++ extension: ${api.intellisense.status}`);
  assert.equal(api.intellisense.status, 'needsExtension');

  // Real toolchain (optional): board options, writing them to sketch.yaml, and a real compile.
  if (process.env.E2E_CLI) {
    await vscode.workspace
      .getConfiguration('integratedWorkbench')
      .update('arduinoCliPath', process.env.E2E_CLI, vscode.ConfigurationTarget.Global);
    await until(
      'engine ready',
      () => (api.session.toolReady && api.session.targets.length ? true : undefined),
      30000,
    );
    await api.session.setTarget({ id: 'arduino:avr:nano', name: 'Arduino Nano' });
    const cpu = await until(
      'board options',
      () => api.session.boardOptions.find((o) => o.id === 'cpu'),
      30000,
    );
    assert.equal(cpu.defaultValue, 'atmega328');
    await api.session.setOption('cpu', 'atmega328old');
    const y = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, 'Blink', 'sketch.yaml')),
    );
    assert.match(y, /^default_fqbn: arduino:avr:nano:cpu=atmega328old$/m);
    await api.session.setOption('cpu', 'atmega328');
    assert.equal(api.session.fqbn, 'arduino:avr:nano', 'default values are left out of the board ID');
    const ok = await api.runs.build();
    assert.equal(ok, true, api.runs.state.last?.summary);
    log(
      `real toolchain: nano options loaded, sketch.yaml updated, ${api.runs.state.last?.summary} in ${api.runs.state.last?.durationMs} ms`,
    );
  }
  log('PASS');
}
