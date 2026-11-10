import type { Package, Rule } from './types.js';

/** What the workspace looks like right now. Gathered by the caller (VS Code side). */
export interface RecommendContext {
  /** Globs from rules' `files` that matched at least one workspace file. */
  matchedGlobs: ReadonlySet<string>;
  /** Plugged-in USB devices, with a display name for ${device}. */
  usb: { vid: string; pid: string; name: string }[];
  /** Projects in the workspace and the board each builds for. */
  sketches: { name: string; fqbn?: string; boardName?: string }[];
}

export interface Recommendation<P extends Package = Package> {
  pkg: P;
  /** Plain-English reasons, de-duplicated, e.g. "ESP32-S3 plugged in". */
  reasons: string[];
}

/** Every `files` glob used by any rule, so the caller knows what to search for. */
export function globsToCheck(packages: readonly Package[]): string[] {
  return [...new Set(packages.flatMap((p) => (p.recommendWhen ?? []).flatMap((r) => r.files ?? [])))];
}

function wildcard(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );
}

function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\$\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Returns the reasons a rule matches (one per matching device/sketch), or [] if it doesn't. */
function evaluate(rule: Rule, ctx: RecommendContext): string[] {
  if (rule.files && !rule.files.some((g) => ctx.matchedGlobs.has(g))) return [];

  let devices: (RecommendContext['usb'][number] | undefined)[] = [undefined];
  if (rule.usb) {
    const pats = rule.usb.map((u) => u.split(':') as [string, string]);
    devices = ctx.usb.filter((d) => pats.some(([v, p]) => d.vid === v && (p === '*' || d.pid === p)));
    if (!devices.length) return [];
  }

  let sketches: (RecommendContext['sketches'][number] | undefined)[] = [undefined];
  if (rule.fqbn) {
    const pats = rule.fqbn.map(wildcard);
    sketches = ctx.sketches.filter((s) => s.fqbn && pats.some((re) => re.test(s.fqbn!)));
    if (!sketches.length) return [];
  }

  return devices.flatMap((d) =>
    sketches.map((s) =>
      fill(rule.reason, { device: d?.name, sketch: s?.name, board: s?.boardName ?? s?.fqbn }),
    ),
  );
}

/** Packages recommended for this workspace, in registry order, each with its reasons. */
export function recommend<P extends Package>(
  packages: readonly P[],
  ctx: RecommendContext,
): Recommendation<P>[] {
  const out: Recommendation<P>[] = [];
  for (const pkg of packages) {
    const reasons = [...new Set((pkg.recommendWhen ?? []).flatMap((r) => evaluate(r, ctx)))];
    if (reasons.length) out.push({ pkg, reasons });
  }
  return out;
}
