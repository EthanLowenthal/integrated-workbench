/**
 * Minimal, lossless edits to an Arduino `sketch.yaml` (read by arduino-cli 1.x and Arduino IDE 2).
 * We only touch the top-level `default_fqbn:` line and keep everything else (profiles, comments)
 * byte for byte, so no YAML library is needed.
 */

const FQBN_LINE = /^default_fqbn:[ \t]*(.*?)[ \t]*$/m;

export function readDefaultFqbn(yaml: string | undefined): string | undefined {
  const m = yaml ? FQBN_LINE.exec(yaml) : null;
  const v = m?.[1]?.replace(/^["']|["']$/g, '').trim();
  return v || undefined;
}

/** Returns the new file text with `default_fqbn` set (or removed when fqbn is undefined). */
export function writeDefaultFqbn(yaml: string | undefined, fqbn: string | undefined): string {
  const text = yaml ?? '';
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  if (FQBN_LINE.test(text)) {
    if (fqbn) return text.replace(FQBN_LINE, `default_fqbn: ${fqbn}`);
    return text.replace(/^default_fqbn:.*(\r?\n)?/m, '');
  }
  if (!fqbn) return text;
  const line = `default_fqbn: ${fqbn}`;
  if (!text.trim()) return `${line}${nl}`;
  return `${line}${nl}${text}`;
}
