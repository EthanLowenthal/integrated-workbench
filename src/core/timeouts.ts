/**
 * Every time limit in one place. Anything that waits on another program, the network or the
 * file system has one, so nothing can hang the sidebar or the extension host.
 */
export const TIMEOUTS = {
  /** OS probes: ioreg, lsof, fuser, systemctl, id, lsusb. */
  probeMs: 10_000,
  /** Windows device query (PowerShell + CIM can be slow on first run). */
  windowsProbeMs: 20_000,
  /** macOS system_profiler fallback. */
  systemProfilerMs: 30_000,
  /** `arduino-cli version` while looking for the binary. */
  cliVersionMs: 10_000,
  /** `arduino-cli board list` / `board listall`. */
  cliListMs: 30_000,
  /** `arduino-cli core search`. */
  cliSearchMs: 60_000,
  /** `arduino-cli core update-index` (downloads small index files). */
  updateIndexMs: 2 * 60_000,
  /** Compiling. First ESP32/STM32 builds can take several minutes. */
  compileMs: 15 * 60_000,
  /** Uploading. */
  uploadMs: 5 * 60_000,
  /** Installing a board package (toolchains can be hundreds of MB). */
  coreInstallMs: 30 * 60_000,
  coreUninstallMs: 2 * 60_000,
  /** Tool downloads: give up if no bytes arrive for this long... */
  downloadStallMs: 30_000,
  /** ...or if the whole download takes longer than this. */
  downloadTotalMs: 15 * 60_000,
  /** Unpacking a downloaded archive. */
  unpackMs: 2 * 60_000,
  /** Fetching a registry file. */
  registryFetchMs: 15_000,
  /** Searching the workspace for files (recommendation rules, sketch list). */
  findFilesMs: 5_000,
  /** Grace period between asking a timed-out process to stop and force-killing it. */
  killGraceMs: 3_000,
};

export function describeTimeout(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
}
