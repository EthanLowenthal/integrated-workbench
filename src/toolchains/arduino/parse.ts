import type { BoardOption, BuildDiagnostic, BuildTarget, DetectedBoard } from '../types.js';

/** Pure parsers for arduino-cli output. Formats checked against arduino-cli 1.x; 0.x shapes accepted too. */

function hex4(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(?:0x)?([0-9a-f]{1,4})$/i.exec(v.trim());
  return m?.[1]?.toLowerCase().padStart(4, '0');
}

/** `arduino-cli version --format json` -> "1.1.1". */
export function parseVersion(json: string): string | undefined {
  try {
    const v = (JSON.parse(json) as { VersionString?: unknown }).VersionString;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

interface RawBoard {
  name?: string;
  fqbn?: string;
}

interface RawDetectedPort {
  matching_boards?: RawBoard[];
  port?: {
    address?: string;
    protocol?: string;
    properties?: Record<string, string>;
  };
}

function toTargets(boards: RawBoard[] | undefined): BuildTarget[] {
  return (boards ?? [])
    .filter((b): b is Required<RawBoard> => typeof b.fqbn === 'string' && typeof b.name === 'string')
    .map((b) => ({ id: b.fqbn, name: b.name }));
}

/**
 * `arduino-cli board list --format json`.
 * 1.x: `{ "detected_ports": [ { "matching_boards": [...], "port": {...} } ] }`
 * 0.x: a bare array of the same entries.
 * Only serial ports are returned (network/DFU ports can't be monitored and are rare for our users).
 */
export function parseBoardList(json: string): DetectedBoard[] {
  const parsed: unknown = JSON.parse(json || '{}');
  const entries: RawDetectedPort[] = Array.isArray(parsed)
    ? (parsed as RawDetectedPort[])
    : ((parsed as { detected_ports?: RawDetectedPort[] }).detected_ports ?? []);
  const out: DetectedBoard[] = [];
  for (const e of entries) {
    const address = e.port?.address;
    if (!address || (e.port?.protocol && e.port.protocol !== 'serial')) continue;
    const candidates = toTargets(e.matching_boards);
    const props = e.port?.properties ?? {};
    out.push({
      port: address,
      target: candidates.length === 1 ? candidates[0] : undefined,
      candidates,
      vid: hex4(props['vid']),
      pid: hex4(props['pid']),
      serialNumber: props['serialNumber'] || undefined,
    });
  }
  return out;
}

/** `arduino-cli board listall --format json` -> `{ "boards": [ { "name", "fqbn" } ] }`. Sorted by name. */
export function parseBoardListAll(json: string): BuildTarget[] {
  const parsed = JSON.parse(json || '{}') as { boards?: RawBoard[] };
  return toTargets(parsed.boards).sort((a, b) => a.name.localeCompare(b.name));
}

const GCC_LINE = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.*)$/;

export interface DiagnosticPathMap {
  /** --build-path passed to compile. arduino-cli copies .cpp/.h sketch files to <buildPath>/sketch/. */
  buildPath: string;
  /** The real sketch folder those copies came from. */
  sketchRoot: string;
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * gcc-style diagnostics from compile output, e.g.
 *   /Users/me/Blink/Blink.ino:7:3: error: 'foo' was not declared in this scope
 *   C:\Users\me\Blink\helper.cpp:12:1: warning: unused variable 'x' [-Wunused-variable]
 * .ino errors already point at the original file (arduino-cli emits #line directives); copied
 * .cpp/.h files point into the build folder, so we map them back to the sketch.
 */
export function parseCompilerDiagnostics(output: string, map?: DiagnosticPathMap): BuildDiagnostic[] {
  const seen = new Set<string>();
  const out: BuildDiagnostic[] = [];
  const buildSketch = map ? `${normalizeSlashes(map.buildPath).replace(/\/$/, '')}/sketch/` : undefined;
  for (const raw of output.split(/\r?\n/)) {
    const m = GCC_LINE.exec(raw.trim());
    if (!m || !m[1] || !m[2] || !m[5]) continue;
    let file = m[1];
    if (map && buildSketch && normalizeSlashes(file).startsWith(buildSketch)) {
      const rel = normalizeSlashes(file)
        .slice(buildSketch.length)
        .replace(/\.ino\.cpp$/, '.ino');
      file = `${map.sketchRoot.replace(/[\\/]$/, '')}/${rel}`;
    }
    const d: BuildDiagnostic = {
      file,
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : undefined,
      severity: m[4] === 'warning' ? 'warning' : 'error',
      message: m[5],
    };
    const key = `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * The core (platform) for this board isn't installed. arduino-cli 1.x says e.g.
 *   Error during build: Platform 'arduino:avr' not found: platform not installed
 * Returns the platform ID ("arduino:avr") or undefined.
 */
export function parseMissingPlatform(output: string, fqbn?: string): string | undefined {
  const m = /Platform '([^']+)' not found/i.exec(output);
  if (m?.[1]) return m[1];
  if (/platform not installed/i.test(output) && fqbn) return fqbn.split(':').slice(0, 2).join(':');
  return undefined;
}

/** A missing #include, e.g. "fatal error: Servo.h: No such file or directory". Hook for library suggestions. */
export function parseMissingHeaders(output: string): string[] {
  const out = new Set<string>();
  for (const m of output.matchAll(/fatal error: ([\w./+-]+\.h(?:pp)?): No such file or directory/g)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/** A board package ("core"/"platform") from `core search` / `core list`. */
export interface CoreInfo {
  /** "arduino:avr" */
  id: string;
  /** "Arduino AVR Boards" */
  name: string;
  maintainer?: string;
  latestVersion?: string;
  installedVersion?: string;
  /** Board names in the latest release (search results don't include FQBNs). */
  boards: string[];
}

interface RawPlatform {
  id?: string;
  maintainer?: string;
  deprecated?: boolean;
  installed_version?: string;
  latest_version?: string;
  releases?: Record<string, { name?: string; boards?: { name?: string }[] }>;
}

/**
 * `arduino-cli core search --format json` and `core list --format json` (1.x):
 * `{ "platforms": [ { id, maintainer, releases: { "<ver>": { name, boards: [{ name }] } }, installed_version, latest_version } ] }`.
 * Deprecated platforms (e.g. arduino:mbed, replaced by standalone packages) are dropped.
 */
export function parseCoreSearch(json: string): CoreInfo[] {
  const parsed = JSON.parse(json || '{}') as { platforms?: RawPlatform[] };
  const out: CoreInfo[] = [];
  for (const p of parsed.platforms ?? []) {
    if (!p.id || p.deprecated) continue;
    const version = p.installed_version || p.latest_version;
    const release = (version && p.releases?.[version]) || Object.values(p.releases ?? {})[0];
    out.push({
      id: p.id,
      name: release?.name ?? p.id,
      maintainer: p.maintainer,
      latestVersion: p.latest_version || undefined,
      installedVersion: p.installed_version || undefined,
      boards: (release?.boards ?? []).map((b) => b.name).filter((n): n is string => !!n),
    });
  }
  return out;
}

interface RawConfigOption {
  option?: string;
  option_label?: string;
  values?: { value?: string; value_label?: string; selected?: boolean }[];
}

/**
 * `arduino-cli board details -b <base fqbn> --format json` -> board options.
 * Query with the base FQBN so `selected` marks each option's default. Boards without options
 * (e.g. Uno) have no config_options field.
 */
export function parseBoardDetails(json: string): BoardOption[] {
  const parsed = JSON.parse(json || '{}') as { config_options?: RawConfigOption[] };
  const out: BoardOption[] = [];
  for (const o of parsed.config_options ?? []) {
    if (!o.option) continue;
    const values = (o.values ?? [])
      .filter((v): v is { value: string; value_label?: string; selected?: boolean } => !!v.value)
      .map((v) => ({ id: v.value, label: v.value_label || v.value, selected: !!v.selected }));
    if (!values.length) continue;
    out.push({
      id: o.option,
      label: o.option_label || o.option,
      values: values.map(({ id, label }) => ({ id, label })),
      defaultValue: (values.find((v) => v.selected) ?? values[0]!).id,
    });
  }
  return out;
}
