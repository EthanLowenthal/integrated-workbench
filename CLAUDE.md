# Integrated Workbench

Product plan and current direction: [docs/PLAN.md](docs/PLAN.md). Read it before changing scope or UX. Focus: board-aware code -> build -> flash -> serial monitor loop for Arduino, embedded Rust and MicroPython via toolchain adapters; Board Doctor is a supporting feature.

## Hard rules

- Display name `Integrated Workbench`; extension name `integrated-workbench`; command/setting/context prefix `integratedWorkbench.` (never `workbench.`, which is VS Code's own). Never put "Arduino" in a product name, ID, logo or domain. Referential use only, with "Arduino" last ("Integrated Workbench - for Arduino").
- `src/core` never imports `vscode` (enforced by eslint).
- Run commands with `execFile` + argument arrays via `ProbeHost.run`; never `exec` or shell strings built from device data (enforced by eslint).
- Never run elevated or destructive commands automatically. Surface them as `runCommand` / `copyCommand` actions the user confirms.
- User-facing text: diagnosis text in `src/core/messages.ts`, VS Code UI text (including every string the webviews render) in `src/text.ts`. Style matches VS Code: Title Case for buttons, links, commands and view names; short neutral sentence-case messages; no chatty phrasing. Driver URLs live in `src/core/drivers.ts`.
- Mark any VID:PID or URL not verified against a primary source with `// TODO verify`.
- Single VS Code extension project. Board detection/diagnosis engine lives in `src/core/` and may be extracted later.

## Layout

- `src/extension.ts` wires everything up. `session.ts` tracks the open project, plugged-in boards and the selected board/port; `statusBar.ts`, `pickers.ts`, `buildFlow.ts` (Verify/Upload, Problems panel), `doctor.ts` (Board Doctor UI).
- `src/toolchains/types.ts` is the Toolchain interface; `src/toolchains/arduino/` wraps arduino-cli (parsers in `parse.ts` are pure and tested). `managedCli.ts` downloads Integrated Workbench's own pinned arduino-cli (version + per-platform SHA-256 baked in; bump both together from the release's checksums file) into extension global storage after a one-time consent prompt. Lookup order: `integratedWorkbench.arduinoCliPath` setting, managed copy, system install.
- `src/core/` (no vscode): `probes/*` collect, `parse/*` parse, `diagnose.ts` decides, `watch.ts` diffs snapshots.
- Fixtures: `test/fixtures/` (`*.real.*` captured, `*.synth.*` hand-written; see its README).
- Test kit: `~/Downloads/integrated-workbench-test` (README with numbered checks + sample sketches + `IntegratedWorkbench-<version>.vsix`). Refresh the VSIX there with `npm run package` after changes.
- Run the extension: F5 ("Run Integrated Workbench" in `.vscode/launch.json`).

## Registry

- All knowledge is data in registries, not code: tools to download (with per-platform sha256), Arduino board packages, USB IDs, driver pages, recipes, recommendation rules. Built-in one: `workbench-registry/` (format: `schema.json`; author guide: `docs/REGISTRY.md`).
- Loader `src/registry/load.ts` (no vscode): parses specs (`owner/repo[@ref]`, https URL, local path), validates with ajv, merges (first registry wins on duplicate ids). `src/registryService.ts` loads built-in + `integratedWorkbench.registries` setting.
- `src/core` defaults to the bundled `usb.json` / `drivers.json` so it still works standalone; the extension passes merged dbs.
- Unverified entries carry `"verified": false` (replaces `// TODO verify` for data). `npm run registry:check [-- spec] [--downloads]` validates and lists them.

## UI

- Sidebar (Activity Bar container `integratedWorkbench`): webview views `integratedWorkbench.sketch` (src/views/sketchView.ts + media/sketch.js) and `integratedWorkbench.tools` (src/views/toolsView.ts + media/tools.js), shared media/sidebar.css using only VS Code theme variables, codicons copied into dist/ by esbuild.mjs.
- No notification toasts for normal flow: progress/results live in the sidebar (Runs in src/runs.ts, ToolsModel in src/toolsModel.ts) plus one status bar item. Only modals kept: third-party registry trust, run-as-admin.
- Board (with options) stored in the `integratedWorkbench.boards` workspace setting (.vscode/settings.json), keyed by sketch folder relative to the workspace folder (`src/boardSettings.ts`). An existing sketch.yaml is only a starting point when there is no setting, and is never written. Port per machine in globalState.
- `npm run test:e2e` runs test/e2e/suite.ts inside the installed VS Code with a throwaway profile.

## Serial Monitor

- Transport: `src/monitor/pluggableMonitor.ts` drives Arduino's `serial-monitor` tool directly over the pluggable monitor protocol (stdin commands, JSON replies, port data over a 127.0.0.1 TCP socket). Not `arduino-cli monitor`, which refuses to open ports until a board package is installed. No native modules. The tool is a registry package (`serial-monitor` in tools.json).
- `src/monitor/controller.ts` owns the connection: live baud via CONFIGURE, per-sketch baud, pause/resume around uploads (Runs.uploadHooks), reconnect for up to 60 s. Panel view: `src/views/monitorView.ts` + `media/monitor.js` (output, hex, timestamps, filter, send history, canvas plotter).
- Test without hardware: `test/fixtures/monitor/fake-monitor.mjs` speaks the protocol; on macOS the e2e test opens /dev/cu.Bluetooth-Incoming-Port with the real tool.

## Board options, IntelliSense, settings page, onboarding

- Board options: `arduino-cli board details` -> `Session.boardOptions`; only non-default values are written into `default_fqbn` (`src/toolchains/arduino/fqbn.ts`).
- IntelliSense: `src/intellisense.ts` registers a C/C++ extension custom configuration provider fed from `compile --only-compilation-database` (`compileDb.ts` maps build-folder copies back to sketch files and forces Arduino.h for .ino). Nothing is written to the sketch unless the user runs "Write compile_commands.json for clangd".
- Larger UIs open as editor-tab pages (`src/views/settingsPage.ts`, Sketch Settings). Get Started is a native walkthrough (`package.json` walkthroughs + `media/walkthrough/*.md`), opened once on first activation; steps complete via context keys set in Session.
- e2e with a real toolchain: `E2E_CLI=<arduino-cli> E2E_ARDUINO_DATA=<data dir with arduino:avr> npm run test:e2e`.

## Libraries, prototypes, Detect Board

- Libraries: `src/toolchains/arduino/libraries.ts` (pure parsers + `libraryForHeader`: name match beats header-only match, because the index often lacks provides_includes for official libraries, e.g. Servo), `src/librariesModel.ts`, `src/views/librariesView.ts`. A compile failing on a missing header gets an "Install <library>" fix.
- .ino prototypes: `extractPrototypes` reads arduino-cli's generated `<Name>.ino.cpp` and force-includes the ones using only built-in/Arduino types.
- Detect Board: `BoardDoctor.detect()` uses core `watchForDevice` and reports only what the connection changed.

## Timeouts and responsiveness

- Every external call has a limit from `src/core/timeouts.ts` (probes, arduino-cli, downloads with stall + total limits, registry fetches, workspace searches). `runWithTimeout` in `src/core/probes/host.ts` always settles: SIGTERM, then SIGKILL after a grace period, resolving immediately with `timedOut: true`. `StreamOptions.timeoutMs` is required so new long-running calls can't forget one.
- `activate()` awaits only the built-in registry (local file). Session start, tools refresh and extra registries run in the background.
- Sidebar views skip posting identical state (the 2 s board poll would otherwise redraw and close dropdowns). Session and ToolsModel drop stale or overlapping refreshes.

## Commands

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (esbuild -> dist/extension.js), `npm run package` (dev .vsix), `npm run format`

## Notes

- macOS: `system_profiler SPUSBDataType` returns an empty list on current macOS (seen on 26.x); the probe uses `ioreg -r -c IOUSBHostDevice -l -w0`, which also links `/dev/cu.*` ports to their USB device. `SPUSBHostDataType` / `SPUSBDataType` are fallbacks.
- Windows: probe uses `Get-CimInstance Win32_PnPEntity` (numeric `ConfigManagerErrorCode`); the parser also accepts `Get-PnpDevice` output.

## Git

- Personal project: commit as Ethan Lowenthal <ethanmlowenthal@gmail.com> (repo-local config), no Co-Authored-By or AI attribution, no employer content. Remote is a private repo on the personal GitHub account.
