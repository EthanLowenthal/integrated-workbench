import * as vscode from 'vscode';
import { TIMEOUTS } from './core/timeouts.js';

/** workspace.findFiles with a time limit (huge workspaces can take a long time). Returns what it has. */
export async function findFilesLimited(include: string, max: number): Promise<vscode.Uri[]> {
  const cts = new vscode.CancellationTokenSource();
  const timer = setTimeout(() => cts.cancel(), TIMEOUTS.findFilesMs);
  try {
    return await vscode.workspace.findFiles(include, '{**/node_modules/**,**/.git/**}', max, cts.token);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    cts.dispose();
  }
}
