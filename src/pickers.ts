import * as vscode from 'vscode';
import { lookupChip, type ChipDb } from './core/index.js';
import type { Session } from './session.js';
import { shortPort } from './statusBar.js';
import { text } from './text.js';
import type { BuildTarget } from './toolchains/types.js';

type TargetItem = vscode.QuickPickItem & { target?: BuildTarget };

/** Board picker: plugged-in boards first, then every board from installed cores. */
export async function pickBoard(
  session: Session,
  openTools: () => Promise<void>,
): Promise<BuildTarget | undefined> {
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

  let all: BuildTarget[] = [];
  try {
    all = await session.toolchain.listTargets();
  } catch {
    // Shown below as "no boards installed".
  }
  qp.busy = false;

  const empty: TargetItem[] = all.length
    ? []
    : [
        { label: text.noBoardPackages, kind: vscode.QuickPickItemKind.Separator },
        { label: `$(package) ${text.openTools}`, alwaysShow: true, target: undefined, detail: '' },
      ];

  qp.items = [
    ...head,
    ...(all.length ? [{ label: text.allBoardsSection, kind: vscode.QuickPickItemKind.Separator }] : []),
    ...all.map((t) => ({ label: t.name, description: t.id, target: t })),
    ...empty,
  ];
  const picked = await new Promise<TargetItem | undefined>((resolve) => {
    qp.onDidAccept(() => resolve(qp.selectedItems[0]));
    qp.onDidHide(() => resolve(undefined));
  });
  qp.dispose();
  if (picked && !picked.target && picked.label.includes(text.openTools)) await openTools();
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
