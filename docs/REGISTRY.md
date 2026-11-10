# Building a registry

Everything Integrated Workbench knows lives in **registries**:

- the tools it can download
- the board packages it suggests
- the USB IDs it recognizes
- the driver pages Board Doctor links to
- the kinds of projects it can build

The built-in one is [`workbench-registry/`](../workbench-registry) in this repo. Anyone can publish another, and users add it in settings. If your board, tool or toolchain isn't supported, you can add it yourself without waiting for a new release.

## Quick start

1. In any GitHub repo (yours, or your board's), make a folder `workbench-registry/` with an `index.json`:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/EthanLowenthal/sketchdesk/HEAD/workbench-registry/schema.json",
     "schema": 1,
     "name": "My boards",
     "usb": [{ "vid": "cafe", "pid": "0001", "name": "My Dev Board", "kind": "native" }]
   }
   ```

2. Add it in VS Code: Settings > `integratedWorkbench.registries` > Add item > `your-name/your-repo`.

   Plug in the board: the status bar and Board Doctor now call it "My Dev Board".

3. While you work on it, point the setting at the local folder instead (`/Users/you/your-repo/workbench-registry`). Run **Integrated Workbench: Reload Registries** after each change. Problems show in the **Integrated Workbench** output panel.

## Where registries can live

What you type in `integratedWorkbench.registries`:

| Entry                                     | Reads                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `owner/repo`                              | `https://raw.githubusercontent.com/owner/repo/HEAD/workbench-registry/index.json` |
| `owner/repo@v2`                           | same, from the `v2` branch or tag                                                 |
| `https://github.com/owner/repo`           | same as `owner/repo`                                                              |
| `https://example.com/anything/index.json` | that file (https only)                                                            |
| `/abs/path/to/folder` or `~/folder`       | `index.json` in that folder                                                       |

The built-in registry always comes first. Yours are added after it, in the order listed.

## Files

A registry is an `index.json` plus any files it lists in `include`. Every file has the same format and may contain any of the sections below, so split it however you like:

```json
{
  "$schema": "https://raw.githubusercontent.com/EthanLowenthal/sketchdesk/HEAD/workbench-registry/schema.json",
  "schema": 1,
  "name": "My boards",
  "include": ["usb.json", "packages/tools.json"],
  "packages": [],
  "usb": [],
  "drivers": [],
  "recipes": []
}
```

- **`schema`** is always `1` for now.
- **`name`** is only read from `index.json`.
- **`include`** paths are relative to `index.json`. No globs and no `..`, so a registry works from any static host and can't reach outside its folder.

With the `$schema` line, VS Code checks your files and autocompletes fields as you type. With Integrated Workbench installed, any `workbench-registry/*.json` is checked even without it.

The full format is [`workbench-registry/schema.json`](../workbench-registry/schema.json). The sections:

### `usb`: recognize boards and chips

```json
{ "vid": "1a86", "pid": "7523", "name": "CH340", "kind": "bridge", "family": "ch34x", "driver": "wch-ch34x" }
{ "vid": "303a", "name": "Espressif", "kind": "native" }
```

- **`vid` / `pid`:** lowercase 4-digit hex. Leave out `pid` for a whole vendor. Exact `vid:pid` matches win over vendor-only ones.
- **`kind`:**
  - `bridge`: a USB-to-serial chip next to the microcontroller (CH340, CP210x, FTDI)
  - `native`: the microcontroller does USB itself (ESP32-S3, RP2040, Leonardo)
- **`family`:** lets Board Doctor apply chip-specific advice. For example, `ch34x` triggers the Linux `brltty` check.
- **`driver`:** the `id` of a `drivers` entry, offered when the chip has no driver.
- **`bootloader`:** this ID is the board's bootloader mode.
- **`noSerialPort`:** the board never creates a serial port in this mode (RP2040 BOOTSEL is a USB drive).

### `drivers`: where to get a driver

```json
{
  "id": "wch-ch34x",
  "vendor": "WCH",
  "name": "WCH CH340/CH341 driver",
  "urls": { "windows": "https://...", "macos": "https://..." }
}
```

Link to the vendor's official page. Registries never host drivers.

### `packages`: things users can install

Two kinds so far.

**`tool`**: a command-line program Integrated Workbench downloads and manages for the user:

```json
{
  "id": "espflash",
  "kind": "tool",
  "name": "espflash",
  "description": "Flashes ESP32 chips.",
  "license": "MIT OR Apache-2.0",
  "version": "4.0.1",
  "provides": ["espflash"],
  "downloads": {
    "darwin-arm64": {
      "url": "https://github.com/esp-rs/espflash/releases/download/v4.0.1/espflash-aarch64-apple-darwin.zip",
      "sha256": "...",
      "size": 3145728,
      "bin": "espflash"
    }
  }
}
```

- **Platform keys** use Node's names: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-arm`, `win32-x64`, `win32-ia32`, `win32-arm64`.
- **Download format:** `.tar.gz`, `.tgz`, `.tar.xz`, `.tar.bz2` and `.zip` are unpacked; anything else is treated as the program itself.
- **`bin`** is the program's path inside the archive.
- **`sha256` is required.** A download that doesn't match is rejected. Get it from the project's published checksums, or with `shasum -a 256 file`.
- **`provides`** lists the command names recipes can ask for in `needs`.

**`arduino-core`**: an Arduino board package, installed through arduino-cli:

```json
{
  "id": "esp32:esp32",
  "kind": "arduino-core",
  "platform": "esp32:esp32",
  "name": "ESP32 boards",
  "boards": ["ESP32", "ESP32-S3", "ESP32-C3"],
  "boardIndex": "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
}
```

- **`boardIndex`** is only needed for packages that aren't in Arduino's default index.
- **Search covers everything:** every package arduino-cli can find shows up in search either way. An entry here adds a friendly name, headline boards and recommendation rules.

### `recommendWhen`: "Recommended for this workspace"

Any package can recommend itself:

```json
"recommendWhen": [
  { "usb": ["303a:*"], "reason": "${device} plugged in" },
  { "fqbn": ["esp32:esp32:*"], "reason": "${sketch} builds for ${board}" },
  { "files": ["**/Cargo.toml"], "reason": "Rust project" }
]
```

- **`files`:** glob patterns. Matches if any workspace file matches.
- **`usb`:** `vid:pid`, with `*` allowed for the pid. Matches if any plugged-in device matches.
- **`fqbn`:** Arduino board IDs a sketch builds for, with `*` wildcards.
- **`reason`:** shown next to the recommendation. `${device}`, `${sketch}` and `${board}` are filled in.
- **Combining rules:** conditions within one rule must all match; a package is recommended if any of its rules match.

### `recipes`: how a kind of project is built and flashed

```json
{
  "id": "rust-esp32",
  "name": "Rust on ESP32",
  "detect": { "files": ["Cargo.toml"] },
  "needs": ["espflash"],
  "build": { "run": ["cargo", "build", "--release"], "errors": "rustc" },
  "flash": { "run": ["espflash", "flash", "--port", "${port}", "${artifact}"] },
  "monitor": { "baud": 115200 }
}
```

- **`run`** is a program plus its arguments. It is never run through a shell.
- **Placeholders:** `${port}`, `${project}`, `${artifact}`, `${board}`.
- **`errors`** picks how the output is read into the Problems panel: `gcc`, `rustc` or `python`.
- **`adapter`** names built-in code that implements the recipe instead (`"adapter": "arduino"` for Arduino sketches).

**Status:** the format is final for schema 1. But today only built-in `adapter` recipes run; command-based recipes are the next step.

### `verified`

Set `"verified": false` on anything you haven't checked against a primary source (a datasheet, the vendor's site, a real device). The UI can flag it, and `registry:check` lists it, so nothing guessed hides in the data.

## Rules for merging

- The built-in registry comes first, then yours in the order listed.
- The **first** registry to define an id wins. Ids are package `id`, usb `vid:pid`, driver `id` and recipe `id`. A later registry can add entries but can't replace built-in ones. Conflicts are reported in the output panel.
- A file that fails validation is skipped as a whole, with the error and the field that's wrong. The rest of the registry still loads.

## Safety

A registry can point at programs to download and commands to run, so adding one is trusting its author:

- **Fingerprints:** downloads must match their `sha256`. Enforced today.
- **No shell:** recipes are argument lists, never shell strings. Enforced by the schema today.
- **Nothing installs or runs without a click.** Coming with the Boards and tools view.
- **Third-party confirmation:** the first time a package or recipe from a non-built-in registry installs or runs, Integrated Workbench shows where it comes from and what it will do, and asks first. Coming with the Boards and tools view.

One thing happens automatically today: board index URLs (`boardIndex`) from every registry are passed to arduino-cli when it refreshes its board list. That downloads the index (a list of packages), never a package itself.

## Checking a registry

From a clone of this repo:

```bash
npm run registry:check -- your-name/your-repo
```

```bash
npm run registry:check -- /path/to/workbench-registry --downloads
```

- It validates every file, shows conflicts with the built-in registry, and lists `"verified": false` entries.
- With `--downloads`, it also downloads every tool and checks its `sha256` and size, and checks that board index URLs respond.
- It exits 1 on any error, so you can run it in CI.

## Contributing to the built-in registry

Pull requests to [`workbench-registry/`](../workbench-registry) are welcome: new boards' USB IDs, driver pages, packages and recipes. Run `npm run registry:check -- --downloads` first, and mark anything you couldn't verify with `"verified": false`.
