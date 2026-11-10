/**
 * TypeScript view of workbench-registry/schema.json. The schema is the source of truth;
 * test/registry.test.ts checks the bundled registry against both.
 */
import type { UsbEntry } from '../core/chips.js';
import type { DriverEntry } from '../core/drivers.js';

export type { DriverEntry, UsbEntry };

export interface Rule {
  files?: string[];
  usb?: string[];
  fqbn?: string[];
  reason: string;
}

interface PackageBase {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  license?: string;
  verified?: boolean;
  recommendWhen?: Rule[];
}

export interface Download {
  url: string;
  sha256: string;
  size?: number;
  bin: string;
}

export interface ToolPackage extends PackageBase {
  kind: 'tool';
  version: string;
  provides: string[];
  /** Keyed by `${process.platform}-${process.arch}`. */
  downloads: Record<string, Download>;
}

export interface ArduinoCorePackage extends PackageBase {
  kind: 'arduino-core';
  platform: string;
  boardIndex?: string;
  boards?: string[];
}

/** Firmware to put on a board (e.g. MicroPython), copied or flashed by the extension. */
export interface FirmwarePackage extends PackageBase {
  kind: 'firmware';
  runtime: 'micropython';
  version: string;
  /** "uf2": copy to the bootloader drive (RP2040/RP2350). "esptool": erase and write over serial. */
  method: 'uf2' | 'esptool';
  /** uf2: Board-ID values in the drive's INFO_UF2.TXT this firmware fits ("RPI-RP2", "RP2350"). */
  uf2BoardIds?: string[];
  /** esptool: --chip value ("esp32", "esp32s3") and flash offset ("0x1000"). */
  chip?: string;
  address?: string;
  /** USB IDs ("vid:pid") of the board's bootloader, to offer this firmware first. */
  bootloaderUsb?: string[];
  file: { url: string; sha256: string; size?: number };
}

export type Package = ToolPackage | ArduinoCorePackage | FirmwarePackage;

export interface Command {
  run: string[];
  errors?: 'gcc' | 'rustc' | 'python';
}

export interface Recipe {
  id: string;
  name: string;
  adapter?: string;
  detect: { files?: string[]; sketchFolder?: string };
  needs?: string[];
  build?: Command;
  flash?: Command;
  monitor?: { baud?: number };
  verified?: boolean;
}

export interface RegistryFile {
  $schema?: string;
  schema: 1;
  name?: string;
  description?: string;
  homepage?: string;
  include?: string[];
  packages?: Package[];
  usb?: UsbEntry[];
  drivers?: DriverEntry[];
  recipes?: Recipe[];
}

/** Where an entry came from, for the UI and for trust decisions. */
export interface Origin {
  registry: string;
  /** The built-in default registry (trusted without asking). */
  builtin: boolean;
}

export type WithOrigin<T> = T & { origin: Origin };

/** All registries merged. Earlier registries win on duplicate ids. */
export interface Registry {
  sources: { name: string; spec: string; builtin: boolean; errors: string[]; files: number }[];
  packages: WithOrigin<Package>[];
  usb: WithOrigin<UsbEntry>[];
  drivers: WithOrigin<DriverEntry>[];
  recipes: WithOrigin<Recipe>[];
  warnings: string[];
}
