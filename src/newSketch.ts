import { existsSync, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Session } from './session.js';
import { text } from './text.js';
import { writeDefaultFqbn } from './toolchains/arduino/sketchYaml.js';

/** Arduino sketch names: letters, digits, underscore, dot, dash; must not start with dot or dash; max 63. */
export function validateSketchName(name: string): string | undefined {
  const n = name.trim();
  if (!n) return text.newSketch.nameRequired;
  if (n.length > 63) return text.newSketch.nameTooLong;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(n)) return text.newSketch.nameInvalid;
  return undefined;
}

export const SKETCH_TEMPLATE = `void setup() {
  // Runs once at startup.
  Serial.begin(115200);
}

void loop() {
  // Runs over and over.
}
`;

/**
 * Creates <folder>/<Name>/<Name>.ino and opens it. If a board that identifies itself is connected,
 * its board ID goes into sketch.yaml so the sketch is ready to upload.
 */
export async function newSketch(session: Session): Promise<void> {
  // Where: the workspace folder, or ask when no folder is open.
  let parent = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!parent) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: text.newSketch.chooseFolder,
    });
    parent = picked?.[0];
    if (!parent) return;
  }
  const where = parent.fsPath;

  const name = (
    await vscode.window.showInputBox({
      title: text.newSketch.title,
      prompt: text.newSketch.prompt,
      value: 'MySketch',
      ignoreFocusOut: true,
      validateInput: (v) =>
        validateSketchName(v) ??
        (existsSync(join(where, v.trim())) ? text.newSketch.exists(v.trim()) : undefined),
    })
  )?.trim();
  if (!name) return;

  const folder = join(where, name);
  await fsp.mkdir(folder);
  const ino = join(folder, `${name}.ino`);
  await fsp.writeFile(ino, SKETCH_TEMPLATE);
  const identified = session.boards.find((b) => b.target)?.target;
  if (identified)
    await fsp.writeFile(join(folder, 'sketch.yaml'), writeDefaultFqbn(undefined, identified.id));
  await vscode.window.showTextDocument(vscode.Uri.file(ino));
}
