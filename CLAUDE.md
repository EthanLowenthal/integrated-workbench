# SketchDesk

Product plan and current direction: [docs/PLAN.md](docs/PLAN.md). Read it before changing scope or UX. Focus: board-aware code -> build -> flash -> serial monitor loop for Arduino, embedded Rust and MicroPython via toolchain adapters; Board Doctor is a supporting feature.

## Hard rules

- Display name `SketchDesk`; machine name `sketchdesk`. Never put "Arduino" in a product name, ID, logo or domain. Referential use only, with "Arduino" last ("SketchDesk - for Arduino").
- `src/core` never imports `vscode` (enforced by eslint).
- Run commands with `execFile` + argument arrays via `ProbeHost.run`; never `exec` or shell strings built from device data (enforced by eslint).
- Never run elevated or destructive commands automatically. Surface them as `runCommand` / `copyCommand` actions the user confirms.
- User-facing text: diagnosis text in `src/core/messages.ts`, VS Code UI text in `src/text.ts`. Driver URLs live in `src/core/drivers.ts`.
- Mark any VID:PID or URL not verified against a primary source with `// TODO verify`.
- Single VS Code extension project. Board detection/diagnosis engine lives in `src/core/` and may be extracted later.

## Layout
- `src/extension.ts` wires everything up. `session.ts` tracks the open project, plugged-in boards and the selected board/port; `statusBar.ts`, `pickers.ts`, `buildFlow.ts` (Verify/Upload, Problems panel), `doctor.ts` (Board Doctor UI).
- `src/toolchains/types.ts` is the Toolchain interface; `src/toolchains/arduino/` wraps arduino-cli (parsers in `parse.ts` are pure and tested). `managedCli.ts` downloads SketchDesk's own pinned arduino-cli (version + per-platform SHA-256 baked in; bump both together from the release's checksums file) into extension global storage after a one-time consent prompt. Lookup order: `sketchdesk.arduinoCliPath` setting, managed copy, system install.
- `src/core/` (no vscode): `probes/*` collect, `parse/*` parse, `diagnose.ts` decides, `watch.ts` diffs snapshots.
- Fixtures: `test/fixtures/` (`*.real.*` captured, `*.synth.*` hand-written; see its README).
- Test kit: `~/Downloads/sketchdesk-test` (README with numbered checks + sample sketches + `SketchDesk-dev.vsix`). Refresh the VSIX there with `npm run package` after changes.
- Run the extension: F5 ("Run SketchDesk" in `.vscode/launch.json`).

## Commands

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (esbuild -> dist/extension.js), `npm run package` (dev .vsix), `npm run format`

## Notes

- macOS: `system_profiler SPUSBDataType` returns an empty list on current macOS (seen on 26.x); the probe uses `ioreg -r -c IOUSBHostDevice -l -w0`, which also links `/dev/cu.*` ports to their USB device. `SPUSBHostDataType` / `SPUSBDataType` are fallbacks.
- Windows: probe uses `Get-CimInstance Win32_PnPEntity` (numeric `ConfigManagerErrorCode`); the parser also accepts `Get-PnpDevice` output.

## Git
- Personal project: commit as Ethan Lowenthal <ethanmlowenthal@gmail.com> (repo-local config), no Co-Authored-By or AI attribution, no employer content. Remote is a private repo on the personal GitHub account.
