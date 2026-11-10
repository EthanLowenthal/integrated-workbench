import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { lookupChip } from './core/chips.js';
import { nodeHost } from './core/probes/host.js';
import { deviceKey } from './core/watch.js';
import type { BoardDoctor } from './doctor.js';
import { globsToCheck, recommend } from './registry/recommend.js';
import type { Package, ToolPackage, WithOrigin } from './registry/types.js';
import type { RegistryService } from './registryService.js';
import type { Session } from './session.js';
import { text } from './text.js';
import type { ArduinoToolchain } from './toolchains/arduino/index.js';
import type { CoreInfo } from './toolchains/arduino/parse.js';
import { installTool, toolBinPath, toolDownload } from './tools.js';

export type ItemState = 'installed' | 'update' | 'available' | 'unavailable';

/** One row in the Boards and tools view. */
export interface ToolItem {
  id: string;
  kind: 'tool' | 'arduino-core' | 'soon';
  icon: string;
  name: string;
  detail: string;
  state: ItemState;
  installedVersion?: string;
  latestVersion?: string;
  sizeMb?: number;
  reasons: string[];
  /** Registry name when it isn't the built-in one. */
  source?: string;
  unverified?: boolean;
  /** Why it can't be installed right now, e.g. needs the build engine first. */
  note?: string;
}

export interface ToolsState {
  engineReady: boolean;
  loading: boolean;
  error?: string;
  recommended: ToolItem[];
  installed: ToolItem[];
  available: ToolItem[];
  soon: ToolItem[];
  busy: Record<string, { label: string; fraction?: number }>;
  registries: { name: string; spec: string; builtin: boolean; errors: string[] }[];
  /** Ids of recommended items that aren't installed (for the Sketch view's banner). */
  missingRecommended: string[];
}

const TRUSTED_KEY = 'integratedWorkbench.trustedRegistries';

/** Placeholders until those toolchains land, so the roadmap is visible where people look for it. */
const SOON: ToolItem[] = [
  {
    id: 'soon:micropython',
    kind: 'soon',
    icon: 'symbol-namespace',
    name: 'MicroPython Tools',
    detail: 'Firmware flashing, REPL, and package management for MicroPython and CircuitPython.',
    state: 'unavailable',
    reasons: [],
  },
  {
    id: 'soon:rust',
    kind: 'soon',
    icon: 'gear',
    name: 'Embedded Rust Tools',
    detail: 'Build and flash with cargo, espflash, and probe-rs.',
    state: 'unavailable',
    reasons: [],
  },
];

export class ToolsModel implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ToolsState>();
  readonly onDidChange = this.changed.event;

  private cores: CoreInfo[] = [];
  private coresLoaded = false;
  private indexUpdated = false;
  private loading = false;
  private error?: string;
  private engine: { ready: boolean; version?: string; managed?: boolean } = { ready: false };
  private matchedGlobs = new Set<string>();
  private usbKey = '';
  private projectRoot?: string;
  private busy: ToolsState['busy'] = {};
  state: ToolsState;
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly registry: RegistryService,
    private readonly arduino: ArduinoToolchain,
    private readonly session: Session,
    private readonly doctor: BoardDoctor,
    private readonly output: vscode.OutputChannel,
    private readonly globalState: vscode.Memento,
    private readonly toolsDir: string,
  ) {
    this.state = this.compute();
    this.subs = [
      registry.onDidChange(() => void this.refresh()),
      session.onDidChange(() => {
        // A different sketch can change which files and boards are in play.
        if (this.session.project?.root !== this.projectRoot) {
          this.projectRoot = this.session.project?.root;
          void this.refresh();
        } else {
          this.emit();
        }
      }),
      doctor.onDidChange((s) => {
        const key = (s.snapshot?.usb ?? []).map(deviceKey).sort().join('|');
        if (key !== this.usbKey) {
          this.usbKey = key;
          this.emit();
        }
      }),
    ];
  }

  private emit(): void {
    this.state = this.compute();
    this.changed.fire(this.state);
  }

  /** Re-reads engine status, installed board packages, and workspace files for recommendations. */
  async refresh(opts: { updateIndex?: boolean } = {}): Promise<void> {
    this.loading = true;
    this.error = undefined;
    this.emit();
    try {
      this.arduino.resetCli();
      const st = await this.arduino.checkInstalled();
      const managedPath = this.cliPackage ? toolBinPath(this.toolsDir, this.cliPackage) : undefined;
      this.engine = st.installed
        ? { ready: true, version: st.version, managed: st.path === managedPath }
        : { ready: false };
      this.matchedGlobs = new Set(
        (
          await Promise.all(
            globsToCheck(this.registry.registry.packages).map(async (g) =>
              (await vscode.workspace.findFiles(g, '**/node_modules/**', 1)).length ? g : undefined,
            ),
          )
        ).filter((g): g is string => !!g),
      );
      if (this.engine.ready) {
        if (!this.indexUpdated || opts.updateIndex) {
          await this.arduino
            .updateIndex()
            .catch((e: unknown) => this.output.appendLine(`[tools] ${String(e)}`));
          this.indexUpdated = true;
        }
        this.cores = await this.arduino.searchCores();
        this.coresLoaded = true;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  private get cliPackage(): ToolPackage | undefined {
    return this.registry.toolProviding('arduino-cli');
  }

  private compute(): ToolsState {
    const reg = this.registry.registry;
    const usb = (this.doctor.state.snapshot?.usb ?? []).map((d) => ({
      vid: d.vid,
      pid: d.pid,
      name: lookupChip(d.vid, d.pid, this.registry.chips).chip?.name ?? d.product ?? `${d.vid}:${d.pid}`,
    }));
    const project = this.session.project;
    const target = this.session.target;
    const recs = recommend(reg.packages, {
      matchedGlobs: this.matchedGlobs,
      usb,
      sketches: project ? [{ name: project.name, fqbn: target?.id, boardName: target?.name }] : [],
    });
    const reasons = new Map(recs.map((r) => [r.pkg.id, r.reasons]));

    const items: ToolItem[] = [];
    const seenPlatforms = new Set<string>();
    for (const p of reg.packages) {
      const item = this.itemFor(p, reasons.get(p.id) ?? []);
      if (item) items.push(item);
      if (p.kind === 'arduino-core') seenPlatforms.add(p.platform);
    }
    // Everything else arduino-cli knows about, so search covers all board packages.
    for (const c of this.cores) {
      if (seenPlatforms.has(c.id)) continue;
      items.push(this.coreItem(c.id, c.name, c.boards.slice(0, 5).join(', '), c, [], undefined));
    }

    const recommended = items.filter((i) => i.reasons.length);
    const rest = items.filter((i) => !i.reasons.length);
    return {
      engineReady: this.engine.ready,
      loading: this.loading,
      error: this.error,
      recommended,
      installed: rest.filter((i) => i.state === 'installed' || i.state === 'update'),
      available: rest.filter((i) => i.state === 'available' || i.state === 'unavailable'),
      soon: SOON,
      busy: this.busy,
      registries: reg.sources.map((s) => ({
        name: s.name,
        spec: s.spec,
        builtin: s.builtin,
        errors: s.errors,
      })),
      missingRecommended: recommended.filter((i) => i.state === 'available').map((i) => i.id),
    };
  }

  private itemFor(p: WithOrigin<Package>, reasons: string[]): ToolItem | undefined {
    const source = p.origin.builtin ? undefined : p.origin.registry;
    if (p.kind === 'tool') {
      const dl = toolDownload(p);
      const isEngine = p.provides.includes('arduino-cli');
      const bin = toolBinPath(this.toolsDir, p);
      const installed = isEngine ? this.engine.ready : !!bin && existsSync(bin);
      const version = isEngine ? this.engine.version : installed ? p.version : undefined;
      // Only offer an update for copies we manage; someone's own arduino-cli is theirs to update.
      const outdated = installed && (!isEngine || this.engine.managed) && version !== p.version;
      return {
        id: p.id,
        kind: 'tool',
        icon: 'tools',
        name: p.name,
        detail: [p.description, version && isEngine && !this.engine.managed ? text.usingYourOwn : undefined]
          .filter(Boolean)
          .join(' '),
        state: installed ? (outdated ? 'update' : 'installed') : dl ? 'available' : 'unavailable',
        installedVersion: version,
        latestVersion: p.version,
        sizeMb: dl?.size ? Math.max(1, Math.round(dl.size / 1_000_000)) : undefined,
        reasons,
        source,
        unverified: p.verified === false || undefined,
        note: dl ? undefined : text.noDownloadHere,
      };
    }
    const info = this.cores.find((c) => c.id === p.platform);
    return this.coreItem(
      p.id,
      p.name,
      (p.boards ?? info?.boards.slice(0, 5) ?? []).join(', '),
      info,
      reasons,
      source,
      p.description,
      p.verified === false,
    );
  }

  private coreItem(
    id: string,
    name: string,
    boards: string,
    info: CoreInfo | undefined,
    reasons: string[],
    source: string | undefined,
    description?: string,
    unverified?: boolean,
  ): ToolItem {
    const installed = info?.installedVersion;
    return {
      id,
      kind: 'arduino-core',
      icon: 'circuit-board',
      name,
      detail: [boards, description].filter(Boolean).join(' · '),
      state: installed
        ? info?.latestVersion && info.latestVersion !== installed
          ? 'update'
          : 'installed'
        : 'available',
      installedVersion: installed,
      latestVersion: info?.latestVersion,
      reasons,
      source,
      unverified: unverified || undefined,
      note: this.engine.ready
        ? this.coresLoaded && !info
          ? text.notInIndex
          : undefined
        : text.needsEngineFirst,
    };
  }

  private setBusy(id: string, label: string | undefined, fraction?: number): void {
    if (label) this.busy = { ...this.busy, [id]: { label, fraction } };
    else {
      const rest = { ...this.busy };
      delete rest[id];
      this.busy = rest;
    }
    this.emit();
  }

  /** First install from a registry other than the built-in one asks once which repo it comes from. */
  private async trusted(p: WithOrigin<Package> | undefined): Promise<boolean> {
    if (!p || p.origin.builtin) return true;
    const trusted = this.globalState.get<string[]>(TRUSTED_KEY, []);
    if (trusted.includes(p.origin.registry)) return true;
    const spec =
      this.registry.registry.sources.find((s) => s.name === p.origin.registry)?.spec ?? p.origin.registry;
    const ok = await vscode.window.showWarningMessage(
      text.trustRegistry(p.name, p.origin.registry),
      { modal: true, detail: text.trustRegistryDetail(spec) },
      text.trustAndInstall,
    );
    if (ok !== text.trustAndInstall) return false;
    await this.globalState.update(TRUSTED_KEY, [...trusted, p.origin.registry]);
    return true;
  }

  private packageFor(id: string): WithOrigin<Package> | undefined {
    return this.registry.registry.packages.find((p) => p.id === id);
  }

  private platformFor(id: string): string {
    const p = this.packageFor(id);
    return p?.kind === 'arduino-core' ? p.platform : id;
  }

  async install(id: string): Promise<void> {
    if (this.busy[id]) return;
    const pkg = this.packageFor(id);
    if (!(await this.trusted(pkg))) return;
    try {
      if (pkg?.kind === 'tool') {
        await this.installToolPackage(pkg);
      } else {
        if (!this.engine.ready) {
          const engine = this.cliPackage;
          if (!engine) throw new Error(text.needsEngineFirst);
          await this.installToolPackage(engine as WithOrigin<ToolPackage>);
        }
        const platform = this.platformFor(id);
        this.setBusy(id, text.installingCore(platform));
        this.output.appendLine(`Installing ${platform}`);
        const ok = await this.arduino.installCore(platform, (t) => this.output.append(t));
        if (!ok) throw new Error(text.coreInstallFailed(platform));
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.setBusy(id, undefined);
    }
    await this.afterChange();
  }

  private async installToolPackage(pkg: WithOrigin<ToolPackage>): Promise<void> {
    this.setBusy(pkg.id, text.downloading, 0);
    if (pkg.provides.includes('arduino-cli')) {
      await this.arduino.installManaged((f) => this.setBusy(pkg.id, text.downloading, f));
    } else {
      await installTool({
        storageDir: this.toolsDir,
        pkg,
        host: nodeHost,
        onProgress: (f) => this.setBusy(pkg.id, text.downloading, f),
      });
    }
    this.setBusy(pkg.id, undefined);
  }

  async uninstall(id: string): Promise<void> {
    if (this.busy[id]) return;
    const platform = this.platformFor(id);
    this.setBusy(id, text.removing);
    try {
      const ok = await this.arduino.uninstallCore(platform, (t) => this.output.append(t));
      if (!ok) throw new Error(text.coreRemoveFailed(platform));
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.setBusy(id, undefined);
    }
    await this.afterChange();
  }

  private async afterChange(): Promise<void> {
    await this.refresh();
    await this.session.recheckTool();
  }

  dispose(): void {
    this.changed.dispose();
    for (const s of this.subs) s.dispose();
  }
}
