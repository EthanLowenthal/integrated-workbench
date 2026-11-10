import * as vscode from 'vscode';
import type { BoardDoctor } from './doctor.js';
import type { Session } from './session.js';
import { text } from './text.js';
import type { BuildDiagnostic, BuildResult, BuildTarget, Project } from './toolchains/types.js';

export interface FlowDeps {
  session: Session;
  doctor: BoardDoctor;
  output: vscode.OutputChannel;
  problems: vscode.DiagnosticCollection;
  /** Asks the user for a board; undefined if they cancel. */
  chooseBoard: () => Promise<BuildTarget | undefined>;
  chooseSerialPort: () => Promise<string | undefined>;
  /** Shown when the toolchain CLI is missing. */
  promptInstallCli: () => Promise<void>;
}

const severityMap = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

function publish(problems: vscode.DiagnosticCollection, diags: BuildDiagnostic[]): void {
  problems.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of diags) {
    const line = Math.max(0, d.line - 1);
    const col = Math.max(0, (d.column ?? 1) - 1);
    // Without an end column, underline to the end of the line (VS Code clamps it).
    const range = new vscode.Range(line, col, line, d.column ? col + 1 : Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(range, d.message, severityMap[d.severity]);
    diag.source = 'arduino-cli';
    byFile.set(d.file, [...(byFile.get(d.file) ?? []), diag]);
  }
  for (const [file, list] of byFile) problems.set(vscode.Uri.file(file), list);
}

/** Make sure we have a project, the CLI, and a board. Undefined = stop (the user was told why). */
async function prepare(deps: FlowDeps): Promise<{ project: Project; target: BuildTarget } | undefined> {
  const { session } = deps;
  if (!session.project) {
    void vscode.window.showWarningMessage(text.notInSketch);
    return undefined;
  }
  const status = await session.toolchain.checkInstalled();
  if (!status.installed) {
    await deps.promptInstallCli();
    return undefined;
  }
  let target = session.selection.target;
  if (!target) {
    target = await deps.chooseBoard();
    if (!target) return undefined;
    await session.setSelection({ target });
  }
  // Compile what's on screen, not what's on disk.
  await vscode.workspace.saveAll(false);
  return { project: session.project, target };
}

async function compile(
  deps: FlowDeps,
  project: Project,
  target: BuildTarget,
): Promise<BuildResult | undefined> {
  const { output } = deps;
  output.clear();
  output.show(true);
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: text.building(project.name, target.name),
      cancellable: true,
    },
    (_progress, token) => {
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      return deps.session.toolchain.build({
        project,
        target,
        onOutput: (t) => output.append(t),
        signal: ac.signal,
      });
    },
  );
  publish(deps.problems, result.diagnostics);
  if (result.success) return result;

  if (result.fix) {
    const choice = await vscode.window.showErrorMessage(result.fix.message, result.fix.label);
    if (choice === result.fix.label) {
      const fixed = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: result.fix.label, cancellable: true },
        (_p, token) => {
          const ac = new AbortController();
          token.onCancellationRequested(() => ac.abort());
          return result.fix!.apply((t) => output.append(t), ac.signal);
        },
      );
      if (fixed) return compile(deps, project, target);
    }
    return undefined;
  }

  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const choice = await vscode.window.showErrorMessage(text.buildFailed(errors), text.showOutput);
  if (choice) output.show();
  return undefined;
}

export async function runBuild(deps: FlowDeps): Promise<boolean> {
  const ready = await prepare(deps);
  if (!ready) return false;
  const ok = await compile(deps, ready.project, ready.target);
  if (ok) vscode.window.setStatusBarMessage(text.buildOk(ready.project.name), 5000);
  return !!ok;
}

export async function runUpload(deps: FlowDeps): Promise<boolean> {
  const ready = await prepare(deps);
  if (!ready) return false;
  const { project, target } = ready;
  const { session, output } = deps;

  let port = session.selectedBoard ? session.selection.port : undefined;
  if (!port) {
    port = await deps.chooseSerialPort();
    if (!port) {
      void vscode.window.showWarningMessage(text.needPort);
      return false;
    }
    await session.setSelection({ port });
  }

  if (!(await compile(deps, project, target))) return false;

  const res = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: text.uploading(project.name, port),
      cancellable: true,
    },
    (_p, token) => {
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      return session.toolchain.flash({
        project,
        target,
        port: port!,
        onOutput: (t) => output.append(t),
        signal: ac.signal,
      });
    },
  );
  if (res.success) {
    vscode.window.setStatusBarMessage(text.uploadOk(project.name, port), 5000);
    return true;
  }

  // Ask Board Doctor whether it knows why (port held by another app, permissions, ...).
  const state = await deps.doctor.refresh();
  const known = state.diagnoses.find(
    (d) => d.port?.path === port && (d.severity === 'error' || d.severity === 'warning'),
  );
  const choice = await vscode.window.showErrorMessage(
    known ? `${text.uploadFailed(port)} ${known.title}.` : text.uploadFailed(port),
    ...(known ? [text.doctorTitle] : []),
    text.showOutput,
  );
  if (choice === text.doctorTitle) await vscode.commands.executeCommand('sketchdesk.boardDoctor');
  else if (choice === text.showOutput) output.show();
  return false;
}
