import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { createChipDb, defaultChipDb, type ChipDb } from './core/chips.js';
import { createDriverDb, defaultDriverDb, type DriverDb } from './core/drivers.js';
import { nodeRegistryIO } from './registry/io.js';
import { loadRegistry, mergeRegistries, REGISTRY_FOLDER } from './registry/load.js';
import type { ArduinoCorePackage, FirmwarePackage, Registry, ToolPackage } from './registry/types.js';

/**
 * Loads the built-in registry (shipped inside the extension) plus the user's extra registries
 * from the `integratedWorkbench.registries` setting, and exposes the merged data.
 */
export class RegistryService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Registry>();
  readonly onDidChange = this.changed.event;

  registry: Registry = { sources: [], packages: [], usb: [], drivers: [], recipes: [], warnings: [] };
  chips: ChipDb = defaultChipDb;
  drivers: DriverDb = defaultDriverDb;

  constructor(
    private readonly extensionPath: string,
    private readonly output: vscode.OutputChannel,
  ) {}

  private generation = 0;

  /**
   * Loads the built-in registry (local, fast) and publishes it, then the user's extra registries
   * (network, time-limited). Pass waitForExtras: false to return as soon as the built-in one is in.
   */
  async reload(opts: { waitForExtras?: boolean } = {}): Promise<Registry> {
    const gen = ++this.generation;
    const builtin = await loadRegistry(join(this.extensionPath, REGISTRY_FOLDER), nodeRegistryIO, {
      builtin: true,
    });
    this.publish([builtin]);
    const specs = vscode.workspace
      .getConfiguration('integratedWorkbench')
      .get<string[]>('registries', [])
      .filter((s) => s.trim());
    if (!specs.length) return this.registry;
    const extras = Promise.all(
      specs.map((spec) => loadRegistry(spec, nodeRegistryIO, { home: homedir() })),
    ).then((loaded) => {
      // A newer reload started meanwhile; its result wins.
      if (gen === this.generation) this.publish([builtin, ...loaded]);
      return this.registry;
    });
    return opts.waitForExtras === false ? this.registry : extras;
  }

  private publish(loaded: Awaited<ReturnType<typeof loadRegistry>>[]): void {
    this.registry = mergeRegistries(loaded);
    this.chips = createChipDb(this.registry.usb);
    this.drivers = createDriverDb(this.registry.drivers);
    for (const s of this.registry.sources) {
      for (const e of s.errors) this.output.appendLine(`[registry] ${s.name}: ${e}`);
    }
    for (const w of this.registry.warnings) this.output.appendLine(`[registry] ${w}`);
    this.changed.fire(this.registry);
  }

  /** The tool package providing a command, e.g. "arduino-cli". */
  toolProviding(command: string): ToolPackage | undefined {
    return this.registry.packages.find(
      (p): p is ToolPackage & { origin: never } => p.kind === 'tool' && p.provides.includes(command),
    );
  }

  get firmware(): FirmwarePackage[] {
    return this.registry.packages.filter(
      (p): p is FirmwarePackage & { origin: never } => p.kind === 'firmware',
    );
  }

  get arduinoCores(): ArduinoCorePackage[] {
    return this.registry.packages.filter(
      (p): p is ArduinoCorePackage & { origin: never } => p.kind === 'arduino-core',
    );
  }

  /** Extra board package index URLs for arduino-cli. */
  get boardIndexes(): string[] {
    return [...new Set(this.arduinoCores.map((c) => c.boardIndex).filter((u): u is string => !!u))];
  }

  dispose(): void {
    this.changed.dispose();
  }
}
