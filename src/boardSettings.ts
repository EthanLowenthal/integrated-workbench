import * as vscode from 'vscode';
import { boardKey } from './boardKey.js';

export { boardKey };

/**
 * Where a sketch's board (with options) is stored: the `integratedWorkbench.boards` setting in the
 * workspace's .vscode/settings.json, keyed by the sketch folder relative to its workspace folder
 * ("Blink", "sketches/Blink", or "." for the folder itself). Sketches outside any workspace folder
 * are keyed by absolute path in user settings.
 */
export const BOARDS_SETTING = 'boards';

function locate(sketchRoot: string) {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sketchRoot));
  const key = boardKey(sketchRoot, folder?.uri.fsPath);
  const config = vscode.workspace.getConfiguration('integratedWorkbench', folder?.uri);
  return { folder, key, config };
}

export function readBoard(sketchRoot: string): string | undefined {
  const { key, config } = locate(sketchRoot);
  const value = config.get<Record<string, string>>(BOARDS_SETTING, {})[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Writes (or with undefined, removes) the sketch's board, keeping every other sketch's entry. */
export async function writeBoard(sketchRoot: string, fqbn: string | undefined): Promise<void> {
  const { folder, key, config } = locate(sketchRoot);
  const target = folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
  const inspected = config.inspect<Record<string, string>>(BOARDS_SETTING);
  const current = { ...((folder ? inspected?.workspaceFolderValue : inspected?.globalValue) ?? {}) };
  if (fqbn) current[key] = fqbn;
  else delete current[key];
  await config.update(BOARDS_SETTING, Object.keys(current).length ? current : undefined, target);
}

/** The settings file a sketch's board is written to, for "Open Settings File". */
export function settingsFileFor(sketchRoot: string): vscode.Uri | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sketchRoot));
  return folder ? vscode.Uri.joinPath(folder.uri, '.vscode', 'settings.json') : undefined;
}
