import * as vscode from 'vscode';
import { lookupChip, type ChipDb } from './core/index.js';
import type { Session } from './session.js';
import { shortPort } from './statusBar.js';
import { text } from './text.js';
import type { BuildTarget } from './toolchains/types.js';

type TargetItem = vscode.QuickPickItem & {
  target?: BuildTarget;
  /** A board from a package that isn't installed yet. */
  available?: { packageId: string; board: string };
  openTools?: boolean;
};

export interface BoardPickerDeps {
  openTools: () => Promise<void>;
  /** Boards in packages that aren't installed (name only). */
  availableBoards: () => Promise<{ packageId: string; packageName: string; board: string }[]>;
  /** Installs a package and returns the board's target once installed. */
  installFor: (packageId: string, board: string) => Promise<BuildTarget | undefined>;
}

/**
 * Board picker: connected boards, then installed boards, then every board in packages that
 * aren't installed (selecting one installs its package first).
 */
export async function pickBoard(session: Session, deps: BoardPickerDeps): Promise<BuildTarget | undefined> {
  const qp = vscode.window.createQuickPick<TargetItem>();
  qp.placeholder = text.pickBoard;
  qp.matchOnDescription = true;
  qp.busy = true;
  qp.show();

  const detected: TargetItem[] = session.boards.flatMap((b) =>
    b.candidates.map((t) => ({ label: t.name, description: `${t.id} · ${shortPort(b.port)}`, target: t })),
  );
  const head: TargetItem[] = detected.length
    ? [{ label: text.detectedSection, kind: vscode.QuickPickItemKind.Separator }, ...detected]
    : [];
  qp.items = [...head, { label: text.loadingBoards, alwaysShow: true }];

  let installed: BuildTarget[] = [];
  let error: string | undefined;
  try {
    installed = await session.toolchain.listTargets();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  let available: Awaited<ReturnType<BoardPickerDeps['availableBoards']>> = [];
  try {
    available = await deps.availableBoards();
  } catch {
    // Installed boards still work without the index.
  }
  qp.busy = false;

  const items: TargetItem[] = [...head];
  if (error) items.push({ label: `$(warning) ${text.listBoardsFailed(error)}`, alwaysShow: true });
  if (installed.length) {
    items.push({ label: text.allBoardsSection, kind: vscode.QuickPickItemKind.Separator });
    items.push(...installed.map((t) => ({ label: t.name, description: t.id, target: t })));
  }
  if (available.length) {
    items.push({ label: text.availableSection, kind: vscode.QuickPickItemKind.Separator });
    items.push(
      ...available.map((a) => ({
        label: a.board,
        description: text.notInstalled(a.packageName),
        iconPath: new vscode.ThemeIcon('cloud-download'),
        available: { packageId: a.packageId, board: a.board },
      })),
    );
  }
  if (!installed.length && !available.length) {
    items.push({ label: text.noBoardPackages, kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: `$(package) ${text.openTools}`, alwaysShow: true, openTools: true });
  }
  qp.items = items;
  if (!installed.length && available.length) qp.title = text.installsPackage;

  const picked = await new Promise<TargetItem | undefined>((resolve) => {
    qp.onDidAccept(() => resolve(qp.selectedItems[0]));
    qp.onDidHide(() => resolve(undefined));
  });
  qp.dispose();
  if (picked?.openTools) await deps.openTools();
  if (picked?.available) return deps.installFor(picked.available.packageId, picked.available.board);
  return picked?.target;
}

type PortItem = vscode.QuickPickItem & { port?: string; doctor?: boolean };

/** Port picker: plugged-in boards with their name (or chip, for clones arduino-cli can't name). */
export async function pickPort(session: Session, chips: ChipDb): Promise<string | undefined> {
  await session.refreshBoards();
  const items: PortItem[] = session.boards.map((b) => ({
    label: `$(plug) ${b.port}`,
    description: b.target?.name ?? lookupChip(b.vid, b.pid, chips).chip?.name ?? text.unknownBoard,
    port: b.port,
  }));
  if (items.length === 0) items.push({ label: text.noPortsFound, alwaysShow: true });
  items.push({ label: `$(question) ${text.openBoardDoctor}`, doctor: true, alwaysShow: true });
  const picked = await vscode.window.showQuickPick(items, { placeHolder: text.pickPort });
  if (picked?.doctor) {
    await vscode.commands.executeCommand('integratedWorkbench.boardDoctor');
    return undefined;
  }
  return picked?.port;
}
