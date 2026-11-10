import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

/**
 * Turns arduino-cli's compile_commands.json (from `compile --only-compilation-database`) into
 * IntelliSense settings for the files the user actually edits:
 * - all .ino files of a sketch are compiled as one generated `<build>/sketch/<Name>.ino.cpp`, so
 *   each .ino gets that entry's flags plus a forced `#include <Arduino.h>` (which arduino-cli adds);
 * - .cpp/.c files are compiled from copies under `<build>/sketch/`, so map them back to the sketch;
 * - headers in the sketch get the sketch's C++ flags.
 */

export interface CompileDbEntry {
  directory: string;
  file: string;
  arguments?: string[];
  command?: string;
}

export interface FileConfig {
  includePath: string[];
  defines: string[];
  standard?: string;
  compilerPath?: string;
  /** Target flags the C/C++ extension passes when it queries the compiler (e.g. -mmcu=atmega328p). */
  compilerArgs: string[];
  forcedInclude: string[];
}

export interface SketchIntelliSense {
  /** Absolute file path -> settings, for files in the sketch. */
  files: Map<string, FileConfig>;
  /** Settings for any other file in the sketch folder (headers, new files). */
  fallback?: FileConfig;
  /** Union of include folders, for the C/C++ extension's symbol browsing. */
  browsePath: string[];
  compilerPath?: string;
  standard?: string;
}

/** Splits a shell-style command line (only used when an entry has `command` instead of `arguments`). */
function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** Flags that describe the target CPU/ABI; the C/C++ extension needs them to ask the compiler for its defaults. */
const TARGET_FLAG =
  /^-(m\S+|f(no-)?(exceptions|rtti|threadsafe-statics|short-enums|signed-char|unsigned-char)|nostdlib)$/;

export function configFromArgs(args: string[], directory: string, forcedInclude: string[] = []): FileConfig {
  const includePath: string[] = [];
  const defines: string[] = [];
  const compilerArgs: string[] = [];
  let standard: string | undefined;
  const abs = (p: string) => (isAbsolute(p) ? p : join(directory, p));
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-I' || a === '-isystem' || a === '-iquote') includePath.push(abs(args[++i] ?? ''));
    else if (a.startsWith('-I')) includePath.push(abs(a.slice(2)));
    else if (a.startsWith('-isystem')) includePath.push(abs(a.slice(8)));
    else if (a === '-D') defines.push(args[++i] ?? '');
    else if (a.startsWith('-D')) defines.push(a.slice(2));
    else if (a.startsWith('-std=')) standard = a.slice(5);
    else if (TARGET_FLAG.test(a)) compilerArgs.push(a);
    else if (a === '-include') forcedInclude = [...forcedInclude, abs(args[++i] ?? '')];
  }
  return { includePath, defines, standard, compilerPath: args[0], compilerArgs, forcedInclude };
}

function within(file: string, folder: string): string | undefined {
  const rel = relative(folder, file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : undefined;
}

/**
 * @param entries parsed compile_commands.json
 * @param buildPath the --build-path used
 * @param sketchRoot the sketch folder
 * @param inoFiles absolute paths of the sketch's .ino files
 * @param findArduinoH resolves Arduino.h from include folders (injected so tests don't need a real core)
 */
export function sketchIntelliSense(
  entries: CompileDbEntry[],
  buildPath: string,
  sketchRoot: string,
  inoFiles: string[],
  findArduinoH: (includePath: string[]) => string | undefined,
): SketchIntelliSense {
  const files = new Map<string, FileConfig>();
  const sketchCopy = join(buildPath, 'sketch');
  const browse = new Set<string>();
  let fallback: FileConfig | undefined;
  let compilerPath: string | undefined;
  let standard: string | undefined;

  for (const e of entries) {
    const args = e.arguments ?? (e.command ? splitCommand(e.command) : []);
    if (!args.length) continue;
    const file = isAbsolute(e.file) ? e.file : join(e.directory, e.file);
    const config = configFromArgs(args, e.directory);
    for (const p of config.includePath) browse.add(p);

    const rel = within(file, sketchCopy);
    if (rel === undefined) {
      // A core or library file. If it's actually inside the sketch (arduino-cli sometimes compiles in place), use it.
      if (within(file, sketchRoot) !== undefined) files.set(file, config);
      continue;
    }
    if (rel.endsWith('.ino.cpp') && !rel.includes(sep) && !rel.includes('/')) {
      const arduinoH = findArduinoH(config.includePath);
      const inoConfig = { ...config, forcedInclude: arduinoH ? [arduinoH] : [] };
      for (const ino of inoFiles) files.set(ino, inoConfig);
      fallback = config;
      compilerPath = config.compilerPath;
      standard = config.standard;
    } else {
      files.set(join(sketchRoot, rel), config);
    }
  }
  return { files, fallback, browsePath: [...browse], compilerPath, standard };
}

/** For writing a clangd-friendly compile_commands.json next to the sketch (opt-in command). */
export function rewriteForSketch(
  entries: CompileDbEntry[],
  buildPath: string,
  sketchRoot: string,
  inoFiles: string[],
): CompileDbEntry[] {
  const sketchCopy = join(buildPath, 'sketch');
  const out: CompileDbEntry[] = [];
  for (const e of entries) {
    const file = isAbsolute(e.file) ? e.file : join(e.directory, e.file);
    const rel = within(file, sketchCopy);
    if (rel === undefined) {
      out.push(e);
      continue;
    }
    const args = e.arguments ?? (e.command ? splitCommand(e.command) : []);
    if (rel.endsWith('.ino.cpp')) {
      for (const ino of inoFiles) {
        const a = args.map((x) => (x === file ? ino : x));
        // .ino isn't a C++ extension to clang; say so, and add the include arduino-cli generates.
        out.push({
          directory: dirname(ino),
          file: ino,
          arguments: [a[0]!, '-x', 'c++', '-include', 'Arduino.h', ...a.slice(1)],
        });
      }
    } else {
      const real = join(sketchRoot, rel);
      out.push({ directory: dirname(real), file: real, arguments: args.map((x) => (x === file ? real : x)) });
    }
  }
  return out;
}

export const COMPILE_DB = 'compile_commands.json';
export const isIno = (f: string) => /\.(ino|pde)$/i.test(basename(f));

/** Types a prototype may use and still be safe to declare before anything in the sketch. */
const KNOWN_TYPES = new Set([
  'void',
  'bool',
  'boolean',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  'byte',
  'word',
  'size_t',
  'String',
  'const',
  'static',
  'inline',
  'volatile',
  'extern',
  'struct',
]);
const isKnownType = (id: string) => KNOWN_TYPES.has(id) || /^u?int(8|16|32|64)_t$/.test(id);

/**
 * Prototypes arduino-cli generated for a sketch (each follows a `#line` marker in `<Name>.ino.cpp`,
 * before the first function body). Keeps only prototypes whose types are built-in or Arduino types,
 * so they can be force-included ahead of the sketch without referring to types it defines later.
 */
export function extractPrototypes(generated: string): string[] {
  const lines = generated.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i - 1]!.startsWith('#line ')) continue;
    const line = lines[i]!.trim();
    // A declaration ends with ");" and has no body; the first definition after the prototype block ends the list.
    if (/\)\s*\{?\s*$/.test(line) && !line.endsWith(';')) break;
    if (!/^[A-Za-z_][\w\s*&:,<>()\[\]]*\(.*\)\s*;$/.test(line)) continue;
    if (protoTypesKnown(line)) out.push(line);
  }
  return [...new Set(out)];
}

function protoTypesKnown(proto: string): boolean {
  const open = proto.indexOf('(');
  const head = proto
    .slice(0, open)
    .trim()
    .split(/[\s*&]+/)
    .filter(Boolean);
  head.pop(); // function name
  const params = proto
    .slice(open + 1, proto.lastIndexOf(')'))
    .split(',')
    .map((p) => p.split('=')[0]!.trim())
    .filter((p) => p && p !== 'void');
  const typeIds = [...head];
  for (const p of params) {
    const ids = p
      .replace(/\[[^\]]*\]/g, '')
      .split(/[\s*&]+/)
      .filter(Boolean);
    if (ids.length > 1) ids.pop(); // parameter name
    typeIds.push(...ids);
  }
  return typeIds.every(isKnownType);
}

/** Header text for the forced include. */
export function prototypesHeader(prototypes: string[]): string {
  return [
    '// Generated by Integrated Workbench from arduino-cli prototypes, for IntelliSense only.',
    '#pragma once',
    '#include <Arduino.h>',
    ...prototypes,
    '',
  ].join('\n');
}
