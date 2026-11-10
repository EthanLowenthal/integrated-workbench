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
import { CPPTOOLS_ID, IntelliSense } from './intellisense.js';
import { MonitorController } from './monitor/controller.js';
import { ToolsModel } from './toolsModel.js';
import { MONITOR_VIEW, MonitorView } from './views/monitorView.js';
import { SettingsPage } from './views/settingsPage.js';
import { SKETCH_VIEW, SketchView } from './views/sketchView.js';
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
  const session = new Session(arduino, doctor, context.globalState, () =>
    config().get<number>('pollIntervalMs', 2000),
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
  const chooseBoard = async () => {
    const target = await pickBoard(session, () => toolsView.focus());
    if (target) await session.setTarget(target);
    return target;
  };

  const runs = new Runs(session, doctor, output, problems, async (what) => {
    // Something's missing: open the sidebar where it gets fixed. No popups.
    if (what === 'engine') return toolsView.focus(engineId());
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
  const intellisense = new IntelliSense(context.extension.id, session, arduino, output);
  sketchView.intellisense = intellisense;
  const settingsPage = new SettingsPage(context.extensionUri, session, monitor, intellisense, registry);
  // The monitor gives the port back for uploads and takes it again once the board is back.
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
    intellisense,
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
    tools.onDidChange(() => monitor.refresh()),
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
    vscode.commands.registerCommand('integratedWorkbench.showTools', (id?: string) =>
      toolsView.focus(id === 'engine' ? engineId() : id),
    ),
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
      if (e.affectsConfiguration('integratedWorkbench.registries')) {
        void vscode.commands.executeCommand('integratedWorkbench.reloadRegistries');
      }
      if (e.affectsConfiguration('integratedWorkbench.arduinoCliPath')) {
        arduino.resetCli();
        void session.recheckTool();
        void tools.refresh();
        void intellisense.start();
        // First run: open the Get Started walkthrough once.
        if (!context.globalState.get<boolean>('integratedWorkbench.welcomed')) {
          void context.globalState.update('integratedWorkbench.welcomed', true);
          void vscode.commands.executeCommand('integratedWorkbench.getStarted');
        }
      }
    }),
  );

  // Background: these talk to arduino-cli and the network, which can be slow.
  void session.start();
  void tools.refresh();
  return { session, tools, registry, runs, monitor, intellisense };
}

export function deactivate(): void {}
