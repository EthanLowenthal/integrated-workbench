import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { ProbeHost } from '../../core/probes/host.js';
import { streamProcess, type StreamRunner } from '../process.js';
import type {
  BuildResult,
  BuildTarget,
  DetectedBoard,
  FlashResult,
  Project,
  RunContext,
  SuggestedFix,
  Toolchain,
  ToolStatus,
} from '../types.js';
import {
  parseBoardList,
  parseBoardListAll,
  parseCompilerDiagnostics,
  parseMissingPlatform,
  parseVersion,
} from './parse.js';

export interface ArduinoOptions {
  host: ProbeHost;
  /** Folder for build output (extension global storage). One subfolder per sketch. */
  buildRoot: string;
  /** User setting `sketchdesk.arduinoCliPath`; empty = search. */
  cliPath?: () => string | undefined;
  stream?: StreamRunner;
  platform?: NodeJS.Platform;
}

const SKETCH_FILE_EXTS = new Set(['.ino', '.pde', '.cpp', '.c', '.h', '.hpp', '.hh', '.S']);

/** Places arduino-cli lives when it isn't on VS Code's PATH (a Dock-launched VS Code on macOS often lacks Homebrew's). */
export function cliCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    return [
      'arduino-cli.exe',
      join(
        home,
        'AppData',
        'Local',
        'Programs',
        'arduino-ide',
        'resources',
        'app',
        'lib',
        'backend',
        'resources',
        'arduino-cli.exe',
      ), // TODO verify
    ];
  }
  if (platform === 'darwin') {
    return [
      'arduino-cli',
      '/opt/homebrew/bin/arduino-cli',
      '/usr/local/bin/arduino-cli',
      join(home, 'bin', 'arduino-cli'),
      '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli', // TODO verify
    ];
  }
  return [
    'arduino-cli',
    join(home, 'bin', 'arduino-cli'),
    join(home, '.local', 'bin', 'arduino-cli'),
    '/usr/local/bin/arduino-cli',
  ];
}

export class ArduinoToolchain implements Toolchain {
  readonly id = 'arduino';
  readonly label = 'Arduino';

  private resolved?: { path: string; version: string };
  private readonly stream: StreamRunner;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly opts: ArduinoOptions) {
    this.stream = opts.stream ?? streamProcess;
    this.platform = opts.platform ?? process.platform;
  }

  /**
   * An Arduino sketch is a folder containing `<folder>.ino`. Files may also sit in the sketch's
   * `src/` subtree, so walk up a few levels.
   */
  async findProject(filePath: string): Promise<Project | undefined> {
    if (!SKETCH_FILE_EXTS.has(extname(filePath))) return undefined;
    let dir = dirname(filePath);
    for (let i = 0; i < 4; i++) {
      const name = basename(dir);
      const entries = await this.opts.host.readdir(dir);
      if (entries.includes(`${name}.ino`) || entries.includes(`${name}.pde`)) return { root: dir, name };
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  }

  /** Forget the cached binary (e.g. after the user changes the path setting). */
  resetCli(): void {
    this.resolved = undefined;
  }

  async checkInstalled(): Promise<ToolStatus> {
    if (this.resolved) return { installed: true, ...this.resolved };
    const configured = this.opts.cliPath?.()?.trim();
    const candidates = configured ? [configured] : cliCandidates(this.platform, homedir());
    for (const path of candidates) {
      const res = await this.opts.host.run(path, ['version', '--format', 'json'], { timeoutMs: 10_000 });
      const version = res.code === 0 ? parseVersion(res.stdout) : undefined;
      if (version) {
        this.resolved = { path, version };
        return { installed: true, path, version };
      }
    }
    return {
      installed: false,
      reason: configured ? `arduino-cli not found at ${configured}` : 'arduino-cli not found',
    };
  }

  private async cli(): Promise<string> {
    const status = await this.checkInstalled();
    if (!status.installed) throw new Error(status.reason);
    return status.path;
  }

  async listBoards(): Promise<DetectedBoard[]> {
    const res = await this.opts.host.run(await this.cli(), ['board', 'list', '--format', 'json'], {
      timeoutMs: 20_000,
    });
    if (res.code !== 0) throw new Error(res.stderr.trim() || `arduino-cli board list failed (${res.code})`);
    return parseBoardList(res.stdout);
  }

  async listTargets(): Promise<BuildTarget[]> {
    const res = await this.opts.host.run(await this.cli(), ['board', 'listall', '--format', 'json'], {
      timeoutMs: 30_000,
    });
    if (res.code !== 0)
      throw new Error(res.stderr.trim() || `arduino-cli board listall failed (${res.code})`);
    return parseBoardListAll(res.stdout);
  }

  buildPath(project: Project): string {
    const hash = createHash('sha1').update(project.root).digest('hex').slice(0, 12);
    return join(this.opts.buildRoot, `${project.name}-${hash}`);
  }

  async build(ctx: RunContext): Promise<BuildResult> {
    const cli = await this.cli();
    const buildPath = this.buildPath(ctx.project);
    const args = ['compile', '--fqbn', ctx.target.id, '--build-path', buildPath, ctx.project.root];
    ctx.onOutput(`$ arduino-cli ${args.join(' ')}\n`);
    const res = await this.stream(cli, args, {
      onStdout: ctx.onOutput,
      onStderr: ctx.onOutput,
      signal: ctx.signal,
    });
    const all = `${res.stdout}\n${res.stderr}`;
    return {
      success: res.code === 0,
      diagnostics: parseCompilerDiagnostics(all, { buildPath, sketchRoot: ctx.project.root }),
      fix: res.code === 0 ? undefined : this.platformFix(all, ctx.target.id),
    };
  }

  /** Uploads the last build. Call build() first. */
  async flash(ctx: RunContext & { port: string }): Promise<FlashResult> {
    const cli = await this.cli();
    const args = [
      'upload',
      '-p',
      ctx.port,
      '--fqbn',
      ctx.target.id,
      '--input-dir',
      this.buildPath(ctx.project),
      ctx.project.root,
    ];
    ctx.onOutput(`$ arduino-cli ${args.join(' ')}\n`);
    const res = await this.stream(cli, args, {
      onStdout: ctx.onOutput,
      onStderr: ctx.onOutput,
      signal: ctx.signal,
    });
    return { success: res.code === 0 };
  }

  /** Installs a core (platform), e.g. "arduino:avr". Only call after the user asked for it. */
  async installCore(platform: string, onOutput: (t: string) => void, signal?: AbortSignal): Promise<boolean> {
    const cli = await this.cli();
    for (const args of [
      ['core', 'update-index'],
      ['core', 'install', platform],
    ]) {
      onOutput(`$ arduino-cli ${args.join(' ')}\n`);
      const res = await this.stream(cli, args, { onStdout: onOutput, onStderr: onOutput, signal });
      if (res.code !== 0) return false;
    }
    return true;
  }

  private platformFix(output: string, fqbn: string): SuggestedFix | undefined {
    const platform = parseMissingPlatform(output, fqbn);
    if (!platform) return undefined;
    return {
      message: `Support for this board (${platform}) isn't installed yet.`,
      label: `Install ${platform}`,
      apply: (onOutput, signal) => this.installCore(platform, onOutput, signal),
    };
  }
}
