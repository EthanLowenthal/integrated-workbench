/**
 * Arduino libraries: parsers for `arduino-cli lib search/list --format json` (1.x) and the logic that
 * picks the right library for a missing #include. Pure; no vscode, no processes.
 */

export interface LibraryInfo {
  name: string;
  /** Latest version in the index. */
  version: string;
  author?: string;
  maintainer?: string;
  sentence?: string;
  website?: string;
  category?: string;
  /** "*" means any architecture. */
  architectures: string[];
  /** Headers the index says it provides. Often missing for older libraries (e.g. Arduino's Servo). */
  providesIncludes: string[];
}

export interface InstalledLibrary {
  name: string;
  version: string;
  /** "user" (installed by the user), "platform" (bundled with the board package), "ide" ... */
  location: string;
  providesIncludes: string[];
  sentence?: string;
  author?: string;
}

interface RawIndexLib {
  name?: string;
  latest?: {
    version?: string;
    author?: string;
    maintainer?: string;
    sentence?: string;
    website?: string;
    category?: string;
    architectures?: string[];
    provides_includes?: string[];
  };
}

export function parseLibSearch(json: string): LibraryInfo[] {
  const parsed = JSON.parse(json || '{}') as { libraries?: RawIndexLib[] };
  return (parsed.libraries ?? [])
    .filter((l) => l.name && l.latest?.version)
    .map((l) => ({
      name: l.name!,
      version: l.latest!.version!,
      author: l.latest!.author,
      maintainer: l.latest!.maintainer,
      sentence: l.latest!.sentence,
      website: l.latest!.website,
      category: l.latest!.category,
      architectures: l.latest!.architectures ?? ['*'],
      providesIncludes: l.latest!.provides_includes ?? [],
    }));
}

interface RawInstalled {
  library?: {
    name?: string;
    version?: string;
    location?: string;
    provides_includes?: string[];
    sentence?: string;
    author?: string;
  };
}

export function parseLibList(json: string): InstalledLibrary[] {
  const parsed = JSON.parse(json || '{}') as { installed_libraries?: RawInstalled[] };
  return (parsed.installed_libraries ?? [])
    .filter((e) => e.library?.name)
    .map((e) => ({
      name: e.library!.name!,
      version: e.library!.version ?? '',
      location: e.library!.location ?? 'user',
      providesIncludes: e.library!.provides_includes ?? [],
      sentence: e.library!.sentence,
      author: e.library!.author,
    }));
}

export interface LibraryUpdate {
  name: string;
  installed: string;
  latest: string;
}

/** `lib list --updatable --format json`: installed libraries with a newer release in the index. */
export function parseLibUpdatable(json: string): LibraryUpdate[] {
  const parsed = JSON.parse(json || '{}') as {
    installed_libraries?: (RawInstalled & { release?: { version?: string } })[];
  };
  return (parsed.installed_libraries ?? [])
    .filter((e) => e.library?.name && e.release?.version && e.release.version !== e.library.version)
    .map((e) => ({
      name: e.library!.name!,
      installed: e.library!.version ?? '',
      latest: e.release!.version!,
    }));
}

/** "esp32:esp32:esp32s3" -> "esp32"; "arduino:avr:uno" -> "avr". */
export function architectureOf(fqbn: string | undefined): string | undefined {
  return fqbn?.split(':')[1];
}

function supports(lib: LibraryInfo, arch: string | undefined): boolean {
  if (!arch) return true;
  return lib.architectures.some((a) => a === '*' || a.toLowerCase() === arch.toLowerCase());
}

/**
 * Picks the library to offer for a missing header, from `name=<base>` and `provides=<header>` searches.
 * Order: libraries that support the board's architecture; exact name match ("Servo.h" -> "Servo")
 * before header-only matches (the index often lacks provides_includes for the official library,
 * while lookalikes declare it); Arduino-maintained before others.
 */
export function libraryForHeader(
  header: string,
  candidates: LibraryInfo[],
  arch?: string,
): LibraryInfo | undefined {
  const base = header.replace(/\.(h|hpp|hh)$/i, '').toLowerCase();
  const seen = new Set<string>();
  const unique = candidates.filter((c) => !seen.has(c.name) && seen.add(c.name));
  const score = (l: LibraryInfo) =>
    (l.name.toLowerCase() === base ? 4 : 0) +
    (l.providesIncludes.some((p) => p.toLowerCase() === header.toLowerCase()) ? 2 : 0) +
    (/arduino/i.test(l.maintainer ?? '') ? 1 : 0);
  return unique
    .filter((l) => supports(l, arch))
    .filter(
      (l) =>
        l.name.toLowerCase() === base ||
        l.providesIncludes.some((p) => p.toLowerCase() === header.toLowerCase()),
    )
    .sort((a, b) => score(b) - score(a))[0];
}

/** Headers from the C and C++ standard libraries and the core: never offered as libraries. */
const NOT_LIBRARIES = new Set(
  [
    'Arduino.h',
    'WProgram.h',
    'assert.h',
    'ctype.h',
    'errno.h',
    'float.h',
    'limits.h',
    'math.h',
    'setjmp.h',
    'signal.h',
    'stdarg.h',
    'stdbool.h',
    'stddef.h',
    'stdint.h',
    'stdio.h',
    'stdlib.h',
    'string.h',
    'time.h',
    'inttypes.h',
    'iso646.h',
    'algorithm',
    'array',
    'atomic',
    'cmath',
    'cstdint',
    'cstdio',
    'cstdlib',
    'cstring',
    'functional',
    'map',
    'memory',
    'new',
    'queue',
    'set',
    'string',
    'utility',
    'vector',
    'Print.h',
    'Stream.h',
    'WString.h',
    'HardwareSerial.h',
  ].map((h) => h.toLowerCase()),
);

/** `#include <X.h>` / `#include "X.h"` headers in source text. */
export function includesIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)) if (m[1]) out.push(m[1].trim());
  return out;
}

/**
 * Headers a sketch includes that no installed library (user or bundled with the board package)
 * provides and that aren't files in the sketch, the standard library, or core headers.
 */
export function unresolvedIncludes(
  includes: string[],
  installed: InstalledLibrary[],
  sketchFiles: string[],
): string[] {
  const provided = new Set(installed.flatMap((l) => l.providesIncludes.map((h) => h.toLowerCase())));
  const local = new Set(sketchFiles.map((f) => f.split(/[\\/]/).pop()!.toLowerCase()));
  return [...new Set(includes)].filter((h) => {
    const k = h.toLowerCase();
    return !h.includes('/') && !NOT_LIBRARIES.has(k) && !provided.has(k) && !local.has(k);
  });
}
