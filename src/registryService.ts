import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { createChipDb, defaultChipDb, type ChipDb } from './core/chips.js';
import { createDriverDb, defaultDriverDb, type DriverDb } from './core/drivers.js';
import { nodeRegistryIO } from './registry/io.js';
import { loadRegistry, mergeRegistries, REGISTRY_FOLDER } from './registry/load.js';
import type { ArduinoCorePackage, Registry, ToolPackage } from './registry/types.js';

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

  async reload(): Promise<Registry> {
    const builtinPath = join(this.extensionPath, REGISTRY_FOLDER);
    const extra = vscode.workspace.getConfiguration('integratedWorkbench').get<string[]>('registries', []);
    const loaded = await Promise.all([
      loadRegistry(builtinPath, nodeRegistryIO, { builtin: true }),
      ...extra.filter((s) => s.trim()).map((spec) => loadRegistry(spec, nodeRegistryIO, { home: homedir() })),
    ]);
    this.registry = mergeRegistries(loaded);
    this.chips = createChipDb(this.registry.usb);
    this.drivers = createDriverDb(this.registry.drivers);

    for (const s of this.registry.sources) {
      for (const e of s.errors) this.output.appendLine(`[registry] ${s.name}: ${e}`);
    }
    for (const w of this.registry.warnings) this.output.appendLine(`[registry] ${w}`);
    this.changed.fire(this.registry);
    return this.registry;
  }

  /** The tool package providing a command, e.g. "arduino-cli". */
  toolProviding(command: string): ToolPackage | undefined {
    return this.registry.packages.find(
      (p): p is ToolPackage & { origin: never } => p.kind === 'tool' && p.provides.includes(command),
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
