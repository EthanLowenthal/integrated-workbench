/**
 * Runs inside a real VS Code (see scripts/e2e.mjs). Plain assertions, no test framework:
 * throwing fails the run.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import { text } from '../../src/text.js';
import { MicroPythonBoard } from '../../src/toolchains/micropython/board.js';

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

  // Picking a board saves it in the workspace settings, not in the sketch folder.
  const exists = (u: vscode.Uri) =>
    vscode.workspace.fs.stat(u).then(
      () => true,
      () => false,
    );
  const boardsInSettings = async () =>
    JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, '.vscode', 'settings.json')),
      ),
    )['integratedWorkbench.boards'] as Record<string, string>;
  await api.session.setTarget({ id: 'arduino:avr:uno', name: 'Arduino Uno' });
  assert.equal((await boardsInSettings())['Blink'], 'arduino:avr:uno');
  assert.equal(
    await exists(vscode.Uri.joinPath(folder.uri, 'Blink', 'sketch.yaml')),
    false,
    'no sketch.yaml created',
  );
  await until('recommendation from sketch board', () =>
    api.tools.state.recommended.find(
      (i) => i.id === 'arduino:avr' && i.reasons.some((r) => r.includes('Blink targets')),
    ),
  );
  log('board saved to .vscode/settings.json (no sketch.yaml); arduino:avr recommended for Blink');

  // A sketch.yaml from Arduino IDE 2 is the starting point, and is never changed.
  const ideYaml = vscode.Uri.joinPath(folder.uri, 'FromArduinoIde', 'sketch.yaml');
  const before = new TextDecoder().decode(await vscode.workspace.fs.readFile(ideYaml));
  await vscode.window.showTextDocument(
    vscode.Uri.joinPath(folder.uri, 'FromArduinoIde', 'FromArduinoIde.ino'),
  );
  await until('FromArduinoIde sketch', () =>
    api.session.project?.name === 'FromArduinoIde' ? true : undefined,
  );
  await until('board taken from sketch.yaml', () =>
    api.session.fqbn === 'arduino:avr:leonardo' ? true : undefined,
  );
  await api.session.setTarget({ id: 'arduino:avr:uno', name: 'Arduino Uno' });
  assert.equal((await boardsInSettings())['FromArduinoIde'], 'arduino:avr:uno');
  assert.equal(
    new TextDecoder().decode(await vscode.workspace.fs.readFile(ideYaml)),
    before,
    'sketch.yaml unchanged',
  );
  assert.equal((await boardsInSettings())['Blink'], 'arduino:avr:uno', 'other sketches kept');
  log(
    'sketch.yaml from Arduino IDE: used as the starting board, left unchanged; new choice saved to settings',
  );
  await vscode.window.showTextDocument(ino);
  await until('back to Blink', () => (api.session.project?.name === 'Blink' ? true : undefined));
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

  // Real toolchain (optional): board options, saving them to settings, and a real compile.
  if (process.env.E2E_CLI) {
    await vscode.workspace
      .getConfiguration('integratedWorkbench')
      .update('arduinoCliPath', process.env.E2E_CLI, vscode.ConfigurationTarget.Global);
    await until('engine ready', () => (api.session.toolReady ? true : undefined), 30000);
    // Fresh data folder: no board packages. The picker offers boards from packages that aren't installed.
    assert.equal(api.session.targets.length, 0, 'no board packages installed yet');
    const available = await api.tools.availableBoards();
    const nano = available.find((b) => b.board === 'Arduino Nano');
    assert.ok(nano, 'Arduino Nano offered as available to install');
    log(
      `board picker without packages: ${available.length} boards available to install (Nano from "${nano.packageName}")`,
    );
    // Picking it installs the package (from the seeded download cache), then selects the board.
    const picked = await api.installBoard(nano.packageId, nano.board);
    assert.equal(picked?.id, 'arduino:avr:nano');
    assert.ok(
      api.session.targets.some((t) => t.id === 'arduino:avr:uno'),
      'installed boards now listed',
    );
    log(`picked Nano -> installed ${nano.packageId}, ${api.session.targets.length} installed boards`);
    await api.session.setTarget(picked);
    const cpu = await until(
      'board options',
      () => api.session.boardOptions.find((o) => o.id === 'cpu'),
      30000,
    );
    assert.equal(cpu.defaultValue, 'atmega328');
    await api.session.setOption('cpu', 'atmega328old');
    assert.equal((await boardsInSettings())['Blink'], 'arduino:avr:nano:cpu=atmega328old');
    await api.session.setOption('cpu', 'atmega328');
    assert.equal(api.session.fqbn, 'arduino:avr:nano', 'default values are left out of the board ID');
    const ok = await api.runs.build();
    assert.equal(ok, true, api.runs.state.last?.summary);
    log(
      `real toolchain: nano options loaded and saved to settings, ${api.runs.state.last?.summary} in ${api.runs.state.last?.durationMs} ms`,
    );
    const mem = api.runs.state.last?.memory;
    assert.ok(mem?.flash?.used && mem.flash.max === 30720, `flash use reported: ${JSON.stringify(mem)}`);
    assert.ok(mem?.ram?.max === 2048, 'RAM use reported');
    log(`build result: flash ${mem.flash.used}/${mem.flash.max} B, RAM ${mem.ram?.used}/${mem.ram?.max} B`);
  }
  // Detect Board: starts waiting for a board, and cancels cleanly.
  const detecting = api.doctor.detect();
  await until('detect waiting', () => (api.doctor.state.detect?.phase === 'waiting' ? true : undefined));
  api.doctor.cancelDetect();
  await detecting;
  assert.equal(api.doctor.state.detect, undefined);
  log('detect board: waited, cancelled cleanly');

  // MicroPython: boot.py makes a project; a plain main.py doesn't until marked.
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, 'Pico', 'main.py'));
  await until('Pico project', () => (api.session.project?.kind === 'micropython' ? true : undefined));
  assert.equal(api.session.project?.name, 'Pico');
  assert.equal(api.session.target?.name, 'MicroPython');
  assert.equal(api.session.fqbn, undefined, 'no Arduino board for MicroPython');
  // Without a board, Run asks for a port (a quick pick); close it as a user would.
  const running = api.runs.run();
  await until('Run blocked', () => api.runs.state.blocked);
  await new Promise((r) => setTimeout(r, 300));
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  assert.equal(await running, false);
  assert.ok(
    api.runs.state.blocked === text.needPort || api.runs.state.blocked === text.needSerialEngine,
    `Run without a board is blocked: ${api.runs.state.blocked}`,
  );
  log(`micropython: Pico detected (boot.py), Run without a board -> "${api.runs.state.blocked}"`);
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, 'PlainPython', 'main.py'));
  await new Promise((r) => setTimeout(r, 500));
  assert.notEqual(api.session.project?.name, 'PlainPython', 'a plain main.py is not a project');
  await vscode.commands.executeCommand('integratedWorkbench.useAsMicroPython');
  await until('marked project', () => (api.session.project?.name === 'PlainPython' ? true : undefined));
  const marked = vscode.workspace
    .getConfiguration('integratedWorkbench', folder.uri)
    .get<string[]>('micropython.projects');
  assert.deepEqual(marked, ['PlainPython']);
  log('micropython: plain main.py ignored; Use Folder as MicroPython Project marks it (saved to settings)');
  if (process.platform === 'darwin' && api.monitor.state.engineReady) {
    // Real serial tool, a port with no MicroPython behind it: fails within the limit, port released.
    const started = Date.now();
    const err = await api.monitor
      .exclusive('/dev/cu.Bluetooth-Incoming-Port', async (link) => {
        const board = new MicroPythonBoard(link, 1500);
        try {
          return await board.info();
        } finally {
          board.close();
        }
      })
      .catch((e: Error) => e);
    assert.ok(err instanceof Error && /raw REPL/.test(err.message), String(err));
    assert.equal(api.monitor.busy, false, 'port released');
    log(`micropython: non-MicroPython port -> "${err.message}" after ${Date.now() - started} ms`);
  }

  if (process.env.E2E_CLI) {
    // Libraries: a sketch that includes <Servo.h> lists Servo as required; installing it makes it compile.
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, 'UsesServo', 'UsesServo.ino'));
    await until('UsesServo sketch', () => (api.session.project?.name === 'UsesServo' ? true : undefined));
    await api.session.setTarget({ id: 'arduino:avr:uno', name: 'Arduino Uno' });
    await api.libraries.activate();
    const req = await until(
      'Servo required',
      () => api.libraries.state.required.find((r) => r.header === 'Servo.h'),
      60000,
    );
    assert.equal(req.library?.name, 'Servo', 'the official Servo, not a lookalike');
    log(`libraries: UsesServo requires Servo.h -> ${req.library?.name} ${req.library?.latestVersion}`);
    assert.equal(await api.libraries.install('Servo@1.2.0'), true);
    assert.deepEqual(
      api.libraries.state.updates.map((u) => `${u.name} ${u.installed} -> ${u.latest}`),
      [`Servo 1.2.0 -> ${req.library?.latestVersion}`],
      'an older Servo shows an update',
    );
    log(`updates: ${api.libraries.state.updates.map((u) => `${u.name} ${u.installed} -> ${u.latest}`)}`);
    assert.equal(await api.libraries.install('Servo'), true);
    assert.equal(api.libraries.state.updates.length, 0, 'updating clears the notice');
    assert.ok(api.libraries.state.installed.some((l) => l.name === 'Servo'));
    assert.equal(api.libraries.state.required.length, 0);
    assert.equal(await api.runs.build(), true, api.runs.state.last?.summary);
    log(`libraries: installed Servo; UsesServo ${api.runs.state.last?.summary}`);
    await api.libraries.search('servo');
    assert.ok(api.libraries.state.results.length > 3);
    log(`libraries: search "servo" -> ${api.libraries.state.results.length} results`);

    // Missing #include: the failed compile offers to install the library.
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, 'NeedsLib', 'NeedsLib.ino'));
    await until('NeedsLib sketch', () => (api.session.project?.name === 'NeedsLib' ? true : undefined));
    await api.session.setTarget({ id: 'arduino:avr:uno', name: 'Arduino Uno' });
    assert.equal(await api.runs.build(), false);
    assert.equal(api.runs.state.last?.fix?.label, 'Install FastLED');
    log(`missing include: "${api.runs.state.last?.fix?.message}" [${api.runs.state.last?.fix?.label}]`);
  }
  log('PASS');
}
