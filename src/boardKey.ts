import { isAbsolute, relative, sep } from 'node:path';

/**
 * Key for a sketch in the `integratedWorkbench.boards` setting: the sketch folder relative to its
 * workspace folder in posix form ("Blink", "sketches/Blink"), "." for the workspace folder itself, or
 * the absolute path for sketches outside any workspace folder.
 */
export function boardKey(sketchRoot: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return sketchRoot;
  const rel = relative(workspaceRoot, sketchRoot);
  if (!rel) return '.';
  if (rel.startsWith('..') || isAbsolute(rel)) return sketchRoot;
  return rel.split(sep).join('/');
}
