import { promises as fsp } from 'node:fs';
import { extname, join } from 'node:path';
import * as vscode from 'vscode';
import type { Session } from './session.js';
import { text } from './text.js';
import type { ArduinoToolchain } from './toolchains/arduino/index.js';
import {
  includesIn,
  unresolvedIncludes,
  type InstalledLibrary,
  type LibraryInfo,
} from './toolchains/arduino/libraries.js';

export interface LibItem {
  name: string;
  /** Installed version, if installed. */
  installedVersion?: string;
  /** Latest version in the index, if known. */
  latestVersion?: string;
  sentence?: string;
  author?: string;
  state: 'installed' | 'update' | 'available';
}

export interface RequiredItem {
  header: string;
  /** The library that provides it, if the index has one. */
  library?: LibItem;
}

export interface LibrariesState {
  engineReady: boolean;
  loading: boolean;
  searching: boolean;
  error?: string;
  query: string;
  results: LibItem[];
  installed: LibItem[];
  required: RequiredItem[];
  /** Installed libraries with a newer version, from the last update check. */
  updates: { name: string; installed: string; latest: string }[];
  busy: Record<string, string>;
}

const SOURCE = new Set(['.ino', '.pde', '.cpp', '.c', '.h', '.hpp', '.cc']);
const MAX_RESULTS = 100;

/** Library management for the current sketch's board, backed by arduino-cli. */
export class LibrariesModel implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LibrariesState>();
  readonly onDidChange = this.changed.event;
  state: LibrariesState = {
    engineReady: false,
    loading: false,
    searching: false,
    query: '',
    results: [],
    installed: [],
    required: [],
    updates: [],
    busy: {},
  };
  private latest = new Map<string, string>();
  private headerCache = new Map<string, LibraryInfo | null>();
  private active = false;
  private lastKey = '';
  private searchSeq = 0;
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly arduino: ArduinoToolchain,
    private readonly session: Session,
    private readonly output: vscode.OutputChannel,
    /** Called after libraries change, so IntelliSense picks up new include paths. */
    private readonly onLibrariesChanged: () => void,
  ) {
    this.sub = session.onDidChange(() => {
      const key = [session.project?.root, session.baseFqbn, session.toolReady].join('|');
      if (this.active && key !== this.lastKey) void this.refresh();
    });
  }

  private set(patch: Partial<LibrariesState>): void {
    this.state = { ...this.state, ...patch };
    this.changed.fire(this.state);
  }

  /** Called when the Libraries view first opens; until then nothing is downloaded or scanned. */
  async activate(): Promise<void> {
    this.active = true;
    await this.refresh();
  }

  private item(name: string, installed?: InstalledLibrary, info?: LibraryInfo): LibItem {
    const latestVersion =
      info?.version ?? this.latest.get(name) ?? this.state.updates.find((u) => u.name === name)?.latest;
    return {
      name,
      installedVersion: installed?.version,
      latestVersion,
      sentence: installed?.sentence ?? info?.sentence,
      author: installed?.author ?? info?.author,
      state: installed
        ? latestVersion && latestVersion !== installed.version
          ? 'update'
          : 'installed'
        : 'available',
    };
  }

  /** Looks for newer versions of installed libraries. Failures are ignored (offline is normal). */
  async checkUpdates(): Promise<void> {
    if (!this.session.toolReady) return;
    try {
      await this.arduino.updateLibraryIndex();
      this.set({ updates: await this.arduino.updatableLibraries() });
    } catch {
      // No network or no index: no update notice.
    }
  }

  /** Re-reads installed libraries and the sketch's includes. */
  async refresh(): Promise<void> {
    const s = this.session;
    this.lastKey = [s.project?.root, s.baseFqbn, s.toolReady].join('|');
    if (!s.toolReady) {
      this.set({ engineReady: false, installed: [], required: [] });
      return;
    }
    this.set({ engineReady: true, loading: true, error: undefined });
    try {
      await this.arduino.updateLibraryIndex();
      const all = await this.arduino.installedLibraries(s.fqbn);
      const user = all.filter((l) => l.location === 'user');
      // Latest versions for installed libraries, to offer updates.
      await Promise.all(
        user.map(async (l) => {
          const hit = (await this.arduino.searchLibraries(`name=${l.name}`).catch(() => [])).find(
            (x) => x.name === l.name,
          );
          if (hit) this.latest.set(l.name, hit.version);
        }),
      );
      const installed = user.map((l) => this.item(l.name, l)).sort((a, b) => a.name.localeCompare(b.name));
      const required = await this.requiredBySketch(all);
      this.set({ installed, required, loading: false, results: this.mark(this.state.results, all) });
    } catch (err) {
      this.set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Includes in the sketch that no installed library provides, with the library that would. */
  private async requiredBySketch(installed: InstalledLibrary[]): Promise<RequiredItem[]> {
    const root = this.session.project?.root;
    if (!root) return [];
    const files = await listSketchFiles(root);
    const includes = (await Promise.all(files.map((f) => fsp.readFile(f, 'utf8').catch(() => '')))).flatMap(
      includesIn,
    );
    const headers = unresolvedIncludes(includes, installed, files);
    return Promise.all(
      headers.map(async (header) => {
        if (!this.headerCache.has(header)) {
          this.headerCache.set(
            header,
            (await this.arduino.findLibraryForHeader(header, this.session.fqbn).catch(() => undefined)) ??
              null,
          );
        }
        const lib = this.headerCache.get(header);
        return { header, library: lib ? this.item(lib.name, undefined, lib) : undefined };
      }),
    );
  }

  private mark(items: LibItem[], installed: InstalledLibrary[]): LibItem[] {
    const byName = new Map(installed.map((l) => [l.name, l]));
    return items.map((i) =>
      this.item(i.name, byName.get(i.name), {
        ...i,
        version: i.latestVersion ?? '',
        architectures: [],
        providesIncludes: [],
      }),
    );
  }

  async search(query: string): Promise<void> {
    const q = query.trim();
    const seq = ++this.searchSeq;
    if (q.length < 2) {
      this.set({ query: q, results: [], searching: false });
      return;
    }
    this.set({ query: q, searching: true });
    try {
      const found = (await this.arduino.searchLibraries(q)).slice(0, MAX_RESULTS);
      if (seq !== this.searchSeq) return; // a newer search started
      const installed = await this.arduino.installedLibraries(this.session.fqbn).catch(() => []);
      const byName = new Map(installed.filter((l) => l.location === 'user').map((l) => [l.name, l]));
      this.set({ searching: false, results: found.map((l) => this.item(l.name, byName.get(l.name), l)) });
    } catch (err) {
      if (seq === this.searchSeq)
        this.set({ searching: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private setBusy(name: string, label?: string): void {
    const busy = { ...this.state.busy };
    if (label) busy[name] = label;
    else delete busy[name];
    this.set({ busy });
  }

  /** Installs or updates a library. Returns true on success. */
  async install(name: string): Promise<boolean> {
    if (this.state.busy[name]) return false;
    this.setBusy(name, text.libraries.installing);
    this.output.appendLine(`Installing library ${name}`);
    const ok = await this.arduino.installLibrary(name, (t) => this.output.append(t)).catch(() => false);
    this.setBusy(name);
    if (!ok) this.set({ error: text.libraries.installFailed(name) });
    this.headerCache.clear();
    await this.refresh();
    await this.checkUpdates();
    this.onLibrariesChanged();
    return ok;
  }

  async uninstall(name: string): Promise<void> {
    if (this.state.busy[name]) return;
    this.setBusy(name, text.libraries.uninstalling);
    const ok = await this.arduino.uninstallLibrary(name, (t) => this.output.append(t)).catch(() => false);
    this.setBusy(name);
    if (!ok) this.set({ error: text.libraries.uninstallFailed(name) });
    await this.refresh();
    await this.checkUpdates();
    this.onLibrariesChanged();
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }
}

/** Source files in the sketch folder and its src/ subtree (arduino-cli compiles both). */
async function listSketchFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 4 && (dir !== root || e.name === 'src')) await walk(p, depth + 1);
      else if (e.isFile() && SOURCE.has(extname(e.name).toLowerCase())) out.push(p);
    }
  };
  await walk(root, 0);
  return out;
}
