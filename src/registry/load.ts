import Ajv, { type ErrorObject } from 'ajv';
import { pathsFor } from '../core/paths.js';
import schema from '../../workbench-registry/schema.json';
import type { Origin, Registry, RegistryFile, WithOrigin } from './types.js';

/** Where a registry's index.json lives. */
export type RegistryLocation = { kind: 'url'; url: string } | { kind: 'file'; path: string };

/** Reads text from a URL or a local file. Injected so tests and the CLI check can fake it. */
export interface RegistryIO {
  read(location: RegistryLocation): Promise<string>;
}

export const REGISTRY_FOLDER = 'workbench-registry';
const MAX_FILES = 200;

/**
 * Turns what a user types in settings into a location:
 * - `owner/repo` or `owner/repo@ref`  -> GitHub raw `workbench-registry/index.json` (ref defaults to HEAD)
 * - `https://github.com/owner/repo`    -> same as owner/repo
 * - `https://.../something.json`       -> that file
 * - an absolute local path (folder or .json), `~/...`, or `file://...` -> local files
 */
export function parseRegistrySpec(spec: string, home?: string): RegistryLocation | { error: string } {
  const s = spec.trim();
  const gh =
    /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:@([A-Za-z0-9._/-]+))?\/?$/.exec(
      s,
    );
  if (gh && !s.startsWith('/') && !s.startsWith('~')) {
    const [, owner, repo, ref] = gh;
    return {
      kind: 'url',
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? 'HEAD'}/${REGISTRY_FOLDER}/index.json`,
    };
  }
  if (s.startsWith('https://')) {
    return s.endsWith('.json')
      ? { kind: 'url', url: s }
      : { error: `Registry URL must point at a .json file: ${s}` };
  }
  if (s.startsWith('http://')) return { error: `Registries must use https: ${s}` };
  let path = s.startsWith('file://') ? decodeURIComponent(new URL(s).pathname) : s;
  const { join, isAbsolute } = pathsFor(path, home);
  if (path.startsWith('~/') && home) path = join(home, path.slice(2));
  if (!isAbsolute(path))
    return { error: `Not a GitHub repo (owner/repo), https URL, or absolute path: ${s}` };
  return { kind: 'file', path: path.endsWith('.json') ? path : join(path, 'index.json') };
}

function relative(base: RegistryLocation, rel: string): RegistryLocation {
  return base.kind === 'url'
    ? { kind: 'url', url: new URL(rel, base.url).toString() }
    : { kind: 'file', path: pathsFor(base.path).resolve(pathsFor(base.path).dirname(base.path), rel) };
}

function describe(loc: RegistryLocation): string {
  return loc.kind === 'url' ? loc.url : loc.path;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFile = ajv.compile<RegistryFile>(schema);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? [])
    .filter((e) => e.keyword !== 'if') // "must match then schema" duplicates the real error
    .map(
      (e) =>
        `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${e.params && 'allowedValues' in e.params ? ` (${(e.params.allowedValues as unknown[]).join(', ')})` : ''}`,
    );
}

/** Validates one parsed registry file. Returns error strings (empty = valid). */
export function validateRegistryFile(data: unknown): string[] {
  return validateFile(data) ? [] : formatErrors(validateFile.errors);
}

export interface LoadedRegistry {
  spec: string;
  name: string;
  builtin: boolean;
  files: { location: string; data: RegistryFile }[];
  errors: string[];
}

/** Reads a registry's index.json and every file it includes (recursively, once each). Never throws. */
export async function loadRegistry(
  spec: string,
  io: RegistryIO,
  opts: { builtin?: boolean; home?: string } = {},
): Promise<LoadedRegistry> {
  const out: LoadedRegistry = { spec, name: spec, builtin: !!opts.builtin, files: [], errors: [] };
  const root = parseRegistrySpec(spec, opts.home);
  if ('error' in root) {
    out.errors.push(root.error);
    return out;
  }
  const seen = new Set<string>();
  const queue: RegistryLocation[] = [root];
  while (queue.length) {
    const loc = queue.shift()!;
    const key = describe(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_FILES) {
      out.errors.push(`More than ${MAX_FILES} files; stopped.`);
      break;
    }
    let data: unknown;
    try {
      data = JSON.parse(await io.read(loc));
    } catch (err) {
      out.errors.push(
        `${key}: ${err instanceof SyntaxError ? 'not valid JSON' : 'could not be read'} (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
    const problems = validateRegistryFile(data);
    if (problems.length) {
      out.errors.push(...problems.map((p) => `${key}: ${p}`));
      continue;
    }
    const file = data as RegistryFile;
    if (loc === root && file.name) out.name = file.name;
    out.files.push({ location: key, data: file });
    // Includes are always relative to index.json, so files can't reach outside the registry folder.
    for (const inc of file.include ?? []) queue.push(relative(root, inc));
  }
  return out;
}

/**
 * Merges registries in order. The first registry to define an id wins, so a later (user-added)
 * registry can add entries but can't silently replace the built-in ones.
 */
export function mergeRegistries(loaded: LoadedRegistry[]): Registry {
  const reg: Registry = { sources: [], packages: [], usb: [], drivers: [], recipes: [], warnings: [] };
  const taken = {
    packages: new Map<string, string>(),
    usb: new Map<string, string>(),
    drivers: new Map<string, string>(),
    recipes: new Map<string, string>(),
  };

  const add = <T>(list: WithOrigin<T>[], kind: keyof typeof taken, key: string, item: T, origin: Origin) => {
    const owner = taken[kind].get(key);
    if (owner) {
      if (owner !== origin.registry)
        reg.warnings.push(`${origin.registry}: ${kind} "${key}" is already defined by ${owner}; ignored.`);
      return;
    }
    taken[kind].set(key, origin.registry);
    list.push({ ...item, origin });
  };

  for (const l of loaded) {
    reg.sources.push({
      name: l.name,
      spec: l.spec,
      builtin: l.builtin,
      errors: l.errors,
      files: l.files.length,
    });
    const origin: Origin = { registry: l.name, builtin: l.builtin };
    for (const { data } of l.files) {
      for (const p of data.packages ?? []) add(reg.packages, 'packages', p.id, p, origin);
      for (const u of data.usb ?? []) add(reg.usb, 'usb', `${u.vid}:${u.pid ?? '*'}`, u, origin);
      for (const d of data.drivers ?? []) add(reg.drivers, 'drivers', d.id, d, origin);
      for (const r of data.recipes ?? []) add(reg.recipes, 'recipes', r.id, r, origin);
    }
  }
  return reg;
}
