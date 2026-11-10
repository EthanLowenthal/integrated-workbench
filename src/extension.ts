import * as vscode from 'vscode';
import { nodeHost } from './core/index.js';
import { runBuild, runUpload, type FlowDeps } from './buildFlow.js';
import { BoardDoctor, showBoardDoctor } from './doctor.js';
import { pickBoard, pickPort } from './pickers.js';
import { Session } from './session.js';
import { StatusBar } from './statusBar.js';
import { text } from './text.js';
import { ArduinoToolchain } from './toolchains/arduino/index.js';

const config = () => vscode.workspace.getConfiguration('sketchdesk');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('SketchDesk');
  const problems = vscode.languages.createDiagnosticCollection('sketchdesk');
  const arduino = new ArduinoToolchain({
    host: nodeHost,
    buildRoot: vscode.Uri.joinPath(context.globalStorageUri, 'build').fsPath,
    cliPath: () => config().get<string>('arduinoCliPath'),
  });
  const doctor = new BoardDoctor();
  const session = new Session(arduino, doctor, context.workspaceState, () =>
    config().get<number>('pollIntervalMs', 2000),
  );
  const statusBar = new StatusBar(session, doctor);

  const installCore = async (platform: string) => {
    output.show(true);
    const ok = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: text.installingCore(platform),
        cancellable: true,
      },
      (_p, token) => {
        const ac = new AbortController();
        token.onCancellationRequested(() => ac.abort());
        return arduino.installCore(platform, (t) => output.append(t), ac.signal);
      },
    );
    if (ok) void vscode.window.showInformationMessage(text.coreInstalled(platform));
    else void vscode.window.showErrorMessage(text.coreInstallFailed(platform));
    await session.refreshBoards();
    return ok;
  };

  const promptInstallCli = async () => {
    const buttons = [
      ...(process.platform === 'darwin' ? [text.cliCopyBrew] : []),
      text.cliGuide,
      text.cliSetPath,
    ];
    const choice = await vscode.window.showWarningMessage(text.cliMissing, ...buttons);
    if (choice === text.cliCopyBrew) {
      await vscode.env.clipboard.writeText(text.cliBrewCommand);
      void vscode.window.showInformationMessage(text.copied(text.cliBrewCommand));
    } else if (choice === text.cliGuide) {
      await vscode.env.openExternal(vscode.Uri.parse(text.cliGuideUrl));
    } else if (choice === text.cliSetPath) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'sketchdesk.arduinoCliPath');
    }
  };

  const chooseBoard = () => pickBoard(session, () => installCore('arduino:avr'));
  const deps: FlowDeps = {
    session,
    doctor,
    output,
    problems,
    chooseBoard,
    chooseSerialPort: () => pickPort(session),
    promptInstallCli,
  };
  const selectPort = async (path: string) => {
    await session.setSelection({ port: path });
    await session.refreshBoards();
  };

  context.subscriptions.push(
    output,
    problems,
    doctor,
    session,
    statusBar,
    vscode.commands.registerCommand('sketchdesk.build', () => runBuild(deps)),
    vscode.commands.registerCommand('sketchdesk.upload', () => runUpload(deps)),
    vscode.commands.registerCommand('sketchdesk.selectBoard', async () => {
      if (!(await arduino.checkInstalled()).installed) return promptInstallCli();
      const target = await chooseBoard();
      if (target) await session.setSelection({ target });
    }),
    vscode.commands.registerCommand('sketchdesk.selectPort', async () => {
      if (!(await arduino.checkInstalled()).installed) return promptInstallCli();
      const port = await pickPort(session);
      if (port) await selectPort(port);
    }),
    vscode.commands.registerCommand('sketchdesk.boardDoctor', () => showBoardDoctor(doctor, selectPort)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sketchdesk.arduinoCliPath')) {
        arduino.resetCli();
        void session.start();
      }
    }),
  );

  await session.start();
}

export function deactivate(): void {}
