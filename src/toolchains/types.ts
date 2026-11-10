/**
 * The contract every language toolchain (Arduino, Rust, MicroPython, ...) implements.
 * No `vscode` import: adapters stay testable with plain fakes.
 * Kept deliberately small; it grows when the second adapter shows what's really shared.
 */

export interface Project {
  /** Folder that is the unit of build/flash (Arduino sketch folder, Cargo root, ...). */
  root: string;
  /** Display name, e.g. the sketch name. */
  name: string;
}

/** A board the toolchain can build for, e.g. Arduino FQBN "arduino:avr:uno". */
export interface BuildTarget {
  id: string;
  name: string;
}

/** A plugged-in board as the toolchain sees it. */
export interface DetectedBoard {
  port: string;
  /** Present when the toolchain recognized the board. */
  target?: BuildTarget;
  /** Other plausible targets (e.g. several boards share one VID:PID). */
  candidates: BuildTarget[];
  vid?: string;
  pid?: string;
  serialNumber?: string;
}

export interface BoardOptionValue {
  id: string;
  label: string;
}

/** A board menu, e.g. ESP32 "Flash Size" or Nano "Processor". */
export interface BoardOption {
  id: string;
  label: string;
  values: BoardOptionValue[];
  /** Used when the board ID doesn't set this option. */
  defaultValue: string;
}

export type BuildSeverity = 'error' | 'warning' | 'info';

export interface BuildDiagnostic {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based; undefined when the compiler didn't say. */
  column?: number;
  severity: BuildSeverity;
  message: string;
}

export interface RunContext {
  project: Project;
  target: BuildTarget;
  /** Live output for the output channel. */
  onOutput: (text: string) => void;
  signal?: AbortSignal;
}

export interface BuildResult {
  success: boolean;
  diagnostics: BuildDiagnostic[];
  /** A known, fixable cause, e.g. the board's core isn't installed. */
  fix?: SuggestedFix;
  /** Why it stopped, when it isn't a compiler error (e.g. hit its time limit). */
  error?: string;
}

export interface FlashResult {
  success: boolean;
  /** Why it stopped, when known (e.g. hit its time limit). */
  error?: string;
  fix?: SuggestedFix;
}

/** A fix the UI offers as a button. Only ever run after the user clicks it. */
export interface SuggestedFix {
  /** Plain-English explanation. */
  message: string;
  /** Button label. */
  label: string;
  /** Runs the fix; output goes to onOutput. */
  apply: (onOutput: (text: string) => void, signal?: AbortSignal) => Promise<boolean>;
}

export type ToolStatus =
  { installed: true; path: string; version: string } | { installed: false; reason: string };

export interface Toolchain {
  readonly id: string;
  readonly label: string;
  /** If this file belongs to one of our projects, return it. */
  findProject(filePath: string): Promise<Project | undefined>;
  checkInstalled(): Promise<ToolStatus>;
  listBoards(): Promise<DetectedBoard[]>;
  /** Every target the user could pick (installed cores' boards, Rust targets, ...). */
  listTargets(): Promise<BuildTarget[]>;
  /** Board menus for a target (without options in its id). Empty if the board has none. */
  boardOptions?(targetId: string): Promise<BoardOption[]>;
  build(ctx: RunContext): Promise<BuildResult>;
  flash(ctx: RunContext & { port: string }): Promise<FlashResult>;
}
