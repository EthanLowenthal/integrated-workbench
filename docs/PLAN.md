# Integrated Workbench plan

Integrated Workbench is a VS Code workspace for microcontroller development that **knows what board is
plugged in** and gives you a smooth **code -> build -> flash -> serial monitor** loop, whatever you
write in: Arduino (`.ino` / `.cpp`), embedded Rust, MicroPython / CircuitPython, and more later.

The shared parts work the same for every language:

- board detection (with "why isn't it showing up" diagnosis)
- the status bar
- the serial monitor and plotter
- board and library suggestions

Each language plugs in as a **toolchain adapter**.

## Architecture

```
src/
  core/                 # no vscode import. USB/serial detection + diagnosis (built, 67 tests)
  toolchains/
    types.ts            # Toolchain interface (below)
    arduino/            # arduino-cli
    rust/               # cargo + espflash / probe-rs
    micropython/        # mpremote (CircuitPython: copy to the CIRCUITPY drive)
  monitor/              # serial monitor + plotter webview (shared by all toolchains)
  ui/                   # status bar, board picker, board/library manager views
  extension.ts
```

Toolchain interface (sketch):

```ts
interface Toolchain {
  id: 'arduino' | 'rust' | 'micropython' | ...;
  /** Does this folder look like one of our projects? (.ino, Cargo.toml with embedded target, main.py/boot.py) */
  detectProject(folder): Promise<ProjectInfo | undefined>;
  /** Is the CLI installed? Offer to install if not. */
  ensureInstalled(): Promise<ToolStatus>;
  /** Which boards this toolchain can target, matched against plugged-in USB devices. */
  matchBoards(devices: UsbDevice[]): BoardMatch[];
  build?(project, board): Promise<BuildResult>;     // diagnostics -> Problems panel
  flash(project, board, port): Promise<FlashResult>;
  /** Packages: Arduino cores/libs, Rust crates/targets, MicroPython packages (mip). */
  packages?: PackageManager;
  /** How to talk to the REPL / serial (MicroPython needs raw-REPL aware handling). */
  monitorProfile?: MonitorProfile;
}
```

## Toolchains

| Toolchain                      | Build / flash                                                            | Packages                               | Notes                                                                            |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------- |
| Arduino (`.ino` + `.cpp`/`.h`) | `arduino-cli compile` / `upload`                                         | cores + libraries via arduino-cli      | IntelliSense: `arduino-language-server` + `clangd`                               |
| Embedded Rust                  | `cargo build`; flash with `espflash` (ESP32) or `probe-rs` (ARM, RISC-V) | crates via cargo; targets via `rustup` | rust-analyzer does IntelliSense; we add board/target awareness and flash/monitor |
| MicroPython                    | no build; sync files + run with `mpremote`                               | `mip` packages                         | REPL in the monitor; firmware flashing (`esptool` / UF2) as a guided step        |
| CircuitPython                  | copy files to the `CIRCUITPY` drive                                      | `circup`                               | Board shows up as a USB drive + serial REPL                                      |
| Later                          | PlatformIO projects, ESP-IDF, Zephyr, Pico SDK                           |                                        | Only if people ask                                                               |

## Shared features

1. **Board-aware status bar.** Shows board + port + toolchain, e.g. "ESP32-S3 · /dev/cu.usbmodem1101 · Rust". Picks the plugged-in board automatically and updates on plug/unplug. Click to change. Warning icon opens Board Doctor.
2. **Build / Flash buttons** in the editor title bar. Errors go to the Problems panel; progress shows in a notification.
3. **Serial monitor panel** (a webview, not a terminal). Shared by all toolchains.
   - Baud and line-ending pickers, send box with history
   - Timestamps, ASCII / hex view, autoscroll lock, search/filter, save log
   - Pauses automatically during flash and reconnects afterwards
   - Plotter tab for numeric lines
   - REPL mode for MicroPython / CircuitPython
4. **Board management.** "You plugged in an ESP32 and don't have support installed: set it up for Arduino / Rust / MicroPython?" Installs the core, target or firmware.
5. **Package suggestions.**
   - An unresolved `#include` or `use` suggests the library or crate that provides it
   - "Popular for this board" list
6. **Board Doctor.** Plain-English diagnosis when nothing shows up. Already built.

## Build order

Arduino first: it has the biggest audience and the most mature CLI. The Toolchain interface is in from day one, so Rust and MicroPython slot in without rewrites.

| Step | What you can do when it's done                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| S1   | Toolchain interface + Arduino adapter. Status bar shows the plugged-in board; Build and Upload work; errors land in Problems. |
| S2   | Serial monitor panel (shared), with pause/reconnect around uploads.                                                           |
| S3   | MicroPython adapter (no build step, so quick to add; proves the abstraction). REPL mode in the monitor.                       |
| S4   | Rust adapter (cargo + espflash / probe-rs).                                                                                   |
| S5   | Board manager + "set up support for this board" suggestions, across toolchains.                                               |
| S6   | Package manager + suggestions from unresolved includes/imports.                                                               |
| S7   | Arduino IntelliSense via language server, plotter, polish, Marketplace + Open VSX.                                            |

## Defaults chosen (change any before we build on them)

- **Serial transport:** one shared backend for every toolchain. `arduino-cli monitor` would tie Rust and MicroPython users to arduino-cli, so we'll probably need the native `serialport` module after all. That means per-platform VSIX builds, which the Marketplace supports. Decide at S2.
- **Toolchain CLIs:** use them from PATH. If one is missing, offer to install it, and always ask before downloading.

## Open questions

- **Name:** the "Integrated Workbench – for Arduino" Marketplace title undersells a multi-language tool. Drop the "for Arduino" suffix? (Keep using "Arduino" only referentially in the description.)
- **Arduino + `.cpp`:** only `.cpp`/`.h` next to a `.ino` (standard), or also projects with just `main.cpp`? The second needs a small `.ino` wrapper.

## Rules carried over from the original spec

- Never "Arduino" in the product name, ID or logo.
- `src/core` never imports `vscode`.
- `execFile` with argument arrays only.
- Never run elevated commands automatically.
- No telemetry by default.
