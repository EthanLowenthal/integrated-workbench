import * as vscode from 'vscode';
import { nodeHost } from './core/index.js';
import { BoardDoctor } from './doctor.js';
import { newSketch } from './newSketch.js';
import { pickBoard, pickPort } from './pickers.js';
import { RegistryService } from './registryService.js';
import { Runs } from './runs.js';
import { Session } from './session.js';
import { StatusBar } from './statusBar.js';
import { text } from './text.js';
import { ArduinoToolchain } from './toolchains/arduino/index.js';
import { MicroPythonToolchain } from './toolchains/micropython/index.js';
import { boardKey } from './boardKey.js';
import { toolBinPath } from './tools.js';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { BoardFiles } from './boardFiles.js';
import { CPPTOOLS_ID, IntelliSense } from './intellisense.js';
import { MonitorController } from './monitor/controller.js';
import type { BuildTarget } from './toolchains/types.js';
import { ToolsModel } from './toolsModel.js';
import { LibrariesModel } from './librariesModel.js';
import { LIBRARIES_VIEW, LibrariesView } from './views/librariesView.js';
import { MONITOR_VIEW, MonitorView } from './views/monitorView.js';
import { SettingsPage } from './views/settingsPage.js';
import { SKETCH_VIEW, SketchView } from './views/sketchView.js';
import { BUILD_VIEW, BuildView } from './views/buildView.js';
import { BuildLog } from './buildLog.js';
import { TOOLS_VIEW, ToolsView } from './views/toolsView.js';

const config = () => vscode.workspace.getConfiguration('integratedWorkbench');

/** Returned from activate() so the in-editor smoke test can look inside. */
export interface TestApi {
  session: Session;
  tools: ToolsModel;
  registry: RegistryService;
  runs: Runs;
  monitor: MonitorController;
  intellisense: IntelliSense;
  /** The board picker's install-then-select path. */
  installBoard: (packageId: string, board: string) => Promise<BuildTarget | undefined>;
  libraries: LibrariesModel;
  doctor: BoardDoctor;
}

export async function activate(context: vscode.ExtensionContext): Promise<TestApi> {
  const output = vscode.window.createOutputChannel('Integrated Workbench');
  const problems = vscode.languages.createDiagnosticCollection('integratedWorkbench');
  const registry = new RegistryService(context.extensionPath, output);
  // Only the built-in registry (a local file) is awaited; nothing slow blocks activation.
  await registry.reload({ waitForExtras: false });

  const toolsDir = context.globalStorageUri.fsPath;
  const arduino = new ArduinoToolchain({
    host: nodeHost,
    buildRoot: vscode.Uri.joinPath(context.globalStorageUri, 'build').fsPath,
    cliPath: () => config().get<string>('arduinoCliPath'),
    toolsDir,
    cliPackage: () => registry.toolProviding('arduino-cli'),
    boardIndexes: () => registry.boardIndexes,
  });
  const doctor = new BoardDoctor(() => ({ chips: registry.chips, drivers: registry.drivers }));
  const micropython = new MicroPythonToolchain({
    host: nodeHost,
    workspaceRoots: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    isMarked: (root) => {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
      const marked = config().get<string[]>('micropython.projects', []) ?? [];
      return marked.includes(boardKey(root, folder?.uri.fsPath));
    },
    serialMonitorPath: () => {
      const pkg = registry.toolProviding('serial-monitor');
      const path = pkg ? toolBinPath(toolsDir, pkg) : undefined;
      return path && existsSync(path) ? path : undefined;
    },
    ports: () => doctor.state.snapshot?.ports ?? [],
  });
  const session = new Session(
    arduino,
    doctor,
    context.globalState,
    () => config().get<number>('pollIntervalMs', 2000),
    [micropython],
  );
  const tools = new ToolsModel(registry, arduino, session, doctor, output, context.globalState, toolsDir);
  const toolsView = new ToolsView(context.extensionUri, tools, output);

  /** Id of the Boards and tools item for the current sketch's board package. */
  const boardPackageId = () => {
    const platform = session.fqbn?.split(':').slice(0, 2).join(':');
    return registry.arduinoCores.find((c) => c.platform === platform)?.id ?? platform;
  };
  const engineId = () => registry.toolProviding('arduino-cli')?.id;
  const showSketch = () => vscode.commands.executeCommand(`${SKETCH_VIEW}.focus`);
  /** Installs a board package from the picker, then finds the chosen board in it. */
  const installFor = async (packageId: string, board: string) => {
    const platform = registry.arduinoCores.find((c) => c.id === packageId)?.platform ?? packageId;
    const ok = await vscode.window.withProgress(
      { location: { viewId: SKETCH_VIEW }, title: text.installingFor(platform) },
      () =>
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: text.installingFor(platform) },
          () => tools.install(packageId),
        ),
    );
    if (!ok) {
      await toolsView.focus(packageId);
      return undefined;
    }
    await session.refreshTargets();
    const target = session.targets.find(
      (t) => t.name === board && t.id.toLowerCase().startsWith(`${platform.toLowerCase()}:`),
    );
    if (!target) vscode.window.setStatusBarMessage(text.boardNotFoundAfterInstall(board), 6000);
    return target;
  };
  const chooseBoard = async () => {
    const target = await pickBoard(session, {
      openTools: () => toolsView.focus(),
      availableBoards: () => tools.availableBoards(),
      installFor,
    });
    if (target) await session.setTarget(target);
    return target;
  };

  const buildLog = new BuildLog(output);
  const runs = new Runs(session, doctor, buildLog, problems, async (what) => {
    // Something's missing: open the sidebar where it gets fixed. No popups.
    if (what === 'engine')
      return toolsView.focus(session.kind === 'micropython' ? monitor.engineId : engineId());
    if (what === 'boardPackage') return toolsView.focus(boardPackageId());
    await showSketch();
    if (what === 'board' && session.project) await chooseBoard();
    if (what === 'port' && session.project) {
      const port = await pickPort(session, registry.chips);
      if (port) await session.setPort(port);
    }
  });
  const sketchView = new SketchView(context.extensionUri, session, doctor, runs, tools, registry, output);
  const statusBar = new StatusBar(session, doctor, runs);
  const monitor = new MonitorController(registry, toolsDir, session, context.workspaceState, output);
  const monitorView = new MonitorView(context.extensionUri, monitor);
  const buildView = new BuildView(context.extensionUri, buildLog, runs, session);
  const intellisense = new IntelliSense(context.extension.id, session, arduino, output);
  sketchView.intellisense = intellisense;
  const libraries = new LibrariesModel(arduino, session, output, () => void intellisense.refresh());
  sketchView.libraries = libraries;
  const librariesView = new LibrariesView(context.extensionUri, libraries, output);
  const settingsPage = new SettingsPage(context.extensionUri, session, monitor, intellisense, registry);
  // The monitor gives the port back for uploads and takes it again once the board is back.
  runs.micropython = {
    exclusive: (port, work) => monitor.exclusive(port, work),
    showMonitor: async () => {
      await monitorView.reveal();
      if (monitor.state.status === 'idle' || monitor.state.status === 'error') await monitor.connect();
    },
    print: (t) => monitor.print(t),
  };
  const boardFiles = new BoardFiles(session, runs);
  sketchView.boardFiles = boardFiles;
  runs.uploadHooks = {
    before: (port) => monitor.pauseForUpload(port),
    after: () => monitor.resumeAfterUpload(),
  };

  context.subscriptions.push(
    output,
    problems,
    registry,
    doctor,
    session,
    tools,
    runs,
    toolsView,
    sketchView,
    statusBar,
    monitor,
    monitorView,
    buildLog,
    buildView,
    vscode.window.registerWebviewViewProvider(BUILD_VIEW, buildView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    intellisense,
    libraries,
    librariesView,
    vscode.window.registerWebviewViewProvider(LIBRARIES_VIEW, librariesView),
    vscode.commands.registerCommand('integratedWorkbench.showLibraries', () =>
      vscode.commands.executeCommand(`${LIBRARIES_VIEW}.focus`),
    ),
    settingsPage,
    vscode.commands.registerCommand('integratedWorkbench.openSketchSettings', () => settingsPage.open()),
    vscode.commands.registerCommand('integratedWorkbench.installCppExtension', () =>
      vscode.commands.executeCommand('extension.open', CPPTOOLS_ID),
    ),
    vscode.commands.registerCommand('integratedWorkbench.writeCompileCommands', async () => {
      const uri = await intellisense.writeCompileCommands();
      if (uri)
        vscode.window.setStatusBarMessage(
          text.intellisense.wrote(vscode.workspace.asRelativePath(uri)),
          5000,
        );
    }),
    // Keep the output when the panel is hidden.
    vscode.window.registerWebviewViewProvider(MONITOR_VIEW, monitorView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    tools.onDidChange(() => {
      monitor.refresh();
      // For MicroPython the serial tool is the engine: pick it up once installed.
      if (session.kind === 'micropython' && !session.toolReady && monitor.state.engineReady)
        void session.recheckTool();
    }),
    boardFiles,
    vscode.commands.registerCommand('integratedWorkbench.stop', () => runs.cancel()),
    vscode.commands.registerCommand('integratedWorkbench.run', () => runs.run()),
    vscode.commands.registerCommand('integratedWorkbench.useAsMicroPython', async (uri?: vscode.Uri) => {
      const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) return;
      const root =
        uri && (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory
          ? file
          : dirname(file);
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
      const cfg = vscode.workspace.getConfiguration('integratedWorkbench', folder?.uri);
      const key = boardKey(root, folder?.uri.fsPath);
      const list = cfg.get<string[]>('micropython.projects', []) ?? [];
      if (!list.includes(key))
        await cfg.update(
          'micropython.projects',
          [...list, key],
          folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global,
        );
      await session.recheckTool();
      await showSketch();
    }),
    vscode.commands.registerCommand('integratedWorkbench.openMonitor', async () => {
      await monitorView.reveal();
      if (monitor.state.status === 'idle' || monitor.state.status === 'error') await monitor.connect();
    }),
    vscode.window.registerWebviewViewProvider(SKETCH_VIEW, sketchView),
    vscode.window.registerWebviewViewProvider(TOOLS_VIEW, toolsView),
    vscode.commands.registerCommand('integratedWorkbench.newSketch', () => newSketch(session)),
    vscode.commands.registerCommand('integratedWorkbench.getStarted', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#getStarted`,
        false,
      ),
    ),
    vscode.commands.registerCommand('integratedWorkbench.build', () => runs.build()),
    vscode.commands.registerCommand('integratedWorkbench.upload', () => runs.upload()),
    vscode.commands.registerCommand('integratedWorkbench.selectBoard', async () => {
      if (!session.toolReady) return toolsView.focus(engineId());
      await chooseBoard();
    }),
    vscode.commands.registerCommand('integratedWorkbench.selectPort', async () => {
      const port = await pickPort(session, registry.chips);
      if (port) await session.setPort(port);
    }),
    vscode.commands.registerCommand('integratedWorkbench.showSketch', showSketch),
    vscode.commands.registerCommand('integratedWorkbench.showOutput', () => buildView.reveal()),
    vscode.commands.registerCommand('integratedWorkbench.uploadAndMonitor', async () => {
      if (await runs.upload()) await vscode.commands.executeCommand('integratedWorkbench.openMonitor');
    }),
    vscode.commands.registerCommand('integratedWorkbench.showTools', (id?: string) =>
      toolsView.focus(
        id === 'engine' ? (session.kind === 'micropython' ? monitor.engineId : engineId()) : id,
      ),
    ),
    vscode.commands.registerCommand('integratedWorkbench.detectBoard', async () => {
      await showSketch();
      await doctor.detect();
      await session.refreshBoards();
    }),
    vscode.commands.registerCommand('integratedWorkbench.boardDoctor', async () => {
      await showSketch();
      await doctor.refresh();
    }),
    vscode.commands.registerCommand('integratedWorkbench.reloadRegistries', () => registry.reload()),
    // Registries can change which tools and boards exist: re-check everything that depends on them.
    registry.onDidChange(() => {
      arduino.resetCli();
      void session.recheckTool();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('integratedWorkbench.micropython.projects')) void session.recheckTool();
      if (e.affectsConfiguration('integratedWorkbench.registries')) {
        void vscode.commands.executeCommand('integratedWorkbench.reloadRegistries');
      }
      if (e.affectsConfiguration('integratedWorkbench.arduinoCliPath')) {
        arduino.resetCli();
        void session.recheckTool();
        void tools.refresh();
        void intellisense.refresh();
      }
    }),
  );

  // Background: these talk to arduino-cli and the network, which can be slow.
  void session.start();
  void tools.refresh();
  void intellisense.start();
  // Library updates are checked once the build engine is ready (lib index download, time-limited).
  const checkLibs = () => {
    if (session.toolReady) {
      libUpdatesSub.dispose();
      void libraries.checkUpdates();
    }
  };
  const libUpdatesSub = session.onDidChange(checkLibs);
  context.subscriptions.push(libUpdatesSub);
  // First run: open the Get Started walkthrough once.
  if (!context.globalState.get<boolean>('integratedWorkbench.welcomed')) {
    void context.globalState.update('integratedWorkbench.welcomed', true);
    void vscode.commands.executeCommand('integratedWorkbench.getStarted');
  }
  return {
    session,
    tools,
    registry,
    runs,
    monitor,
    intellisense,
    installBoard: installFor,
    libraries,
    doctor,
  };
}

export function deactivate(): void {}
