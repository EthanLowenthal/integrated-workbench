# Changelog

## 0.6.0

- Failed uploads are explained in plain words from the uploader's output: a board that doesn't answer, an ESP32 not in upload mode, a busy port, or missing permissions. For an Arduino Nano that doesn't answer, a button switches between the old and new bootloader options and uploads again.
- In editors built on VS Code (Cursor, VSCodium, and others), where Microsoft's C/C++ extension isn't available, **Set Up clangd** installs clangd and writes the sketch's `compile_commands.json`. Once written, it is kept up to date when the board or its options change.
- Registries are listed in Boards and Tools only after you add one in `integratedWorkbench.registries`.
- Security: `integratedWorkbench.arduinoCliPath` and `integratedWorkbench.registries` can only be set in user settings, not by a workspace, and the extension runs only in trusted workspaces.
- The extension now starts in workspaces that only contain MicroPython projects.
- Fixed path handling on Windows in board-folder detection, IntelliSense mapping, and registries.

## 0.5.0

- **Install MicroPython on Board...** (Command Palette, or the Sketch view's "..." menu in a MicroPython project) installs MicroPython 1.29.0. Firmware comes from micropython.org, is checked against a SHA-256 in the registry, and is downloaded once.
  - Raspberry Pi Pico, Pico W, Pico 2 and Pico 2 W: hold BOOTSEL while connecting the board; the firmware is copied to its drive. It is checked against the chip first (RP2040 or RP2350), and the board's new port is selected when it restarts.
  - ESP32, ESP32-S3 and ESP32-C3: erases the board and writes MicroPython over the selected port with esptool (5.6.0, downloaded once, about 60 MB). It asks first, since erasing can't be undone.
- Notifications offer the install when a Raspberry Pi board is in BOOTSEL mode (outside Arduino projects) and when a board doesn't answer as MicroPython during Run or Upload.
- Registries can list firmware (`"kind": "firmware"`); `npm run registry:check -- --downloads` checks firmware files too.

## 0.4.0

- MicroPython projects. A folder with a `boot.py` is a MicroPython project; any other folder can be marked with **Use Folder as MicroPython Project** (Explorer context menu or Command Palette; saved in `integratedWorkbench.micropython.projects`).
  - **Run** (`Cmd+Alt+R` / `Ctrl+Alt+R`) runs the open `.py` file, or `main.py`, on the board without saving it there. Output appears in the Serial Monitor; **Stop** interrupts it. An exception's line is marked in the editor and the Problems panel.
  - **Upload** (`Cmd+Alt+U` / `Ctrl+Alt+U`) copies the project's changed files to the board (compared by SHA-256), creating folders as needed, then soft-resets it to run `main.py`. Nothing on the board is deleted.
  - **REPL**: the Serial Monitor sends lines with CR and has **Interrupt (Ctrl-C)** and **Soft Reset (Ctrl-D)** buttons.
  - **Files on Board** in the Sketch view lists the board's files on request. Select a file to open a read-only copy; deleting one asks first.
  - Everything goes through the Serial Monitor Engine: Python and mpremote are not needed.
  - Not yet: installing MicroPython firmware on a board, and type stubs for IntelliSense.

## 0.3.0

- Build panel: a **Build** tab next to the Serial Monitor shows compiler and upload output live, with errors in red and warnings in yellow. Select an error or warning line to open the file at that line. The last five runs are kept; **Copy Output** copies one. **Show Output** and **Show Build Output** open it.
- Memory use: after a compile, the result shows flash and RAM use as bars, yellow from 80% and red from 95%. Hover for bytes used and the limit.
- **Upload and Open Serial Monitor** (`Cmd+Alt+Shift+U` / `Ctrl+Alt+Shift+U`, also in the Sketch view's "..." menu) uploads, then opens and connects the Serial Monitor.
- Updates: notifications list available updates for installed board packages and tools, and for installed libraries (checked once the build engine is installed). They can be dismissed and don't count toward the badge.
- Fixed: the Get Started walkthrough did not open on first run, and IntelliSense did not connect to the C/C++ extension at startup (both only happened after changing `integratedWorkbench.arduinoCliPath`).
- The extension has a new Marketplace icon.

## 0.2.2

- Notifications: warnings and errors from every view (build engine or board package missing, board problems, Detect Board results, registry and library errors, missing libraries, IntelliSense) are listed in one place at the top of the Sketch view. The Integrated Workbench icon in the Activity Bar shows how many need attention.
- Less text in the sidebar: descriptions, reasons and notes show on hover (info icon) instead of as extra lines. The Sketch Settings page shows setting descriptions on hover.
- Settings moved to a collapsed **Settings** section at the bottom of Boards and Tools: Sketch Settings, Extension Settings, and registries. Sketch Settings is also in the Sketch view's "..." menu.
- Build output is easier to reach: an Output button while compiling or uploading, **Show Output** under every result, and a **Show Build Output** button in the Sketch view title bar.
- Boards and Tools and Libraries start collapsed. The "Coming Soon" entries were removed.
- Serial Monitor: pause, reconnect and error messages show in the status line (full text on hover) instead of a banner.

## 0.2.1

- The board and board options for each sketch are saved in the workspace settings (`integratedWorkbench.boards` in `.vscode/settings.json`) instead of a `sketch.yaml` in the sketch folder. A `sketch.yaml` from Arduino IDE 2 is used as the starting point when a sketch has no saved board, and is never changed.
- Sketch Settings: **Open Settings File** replaces **Open sketch.yaml**.

## 0.2.0

- Libraries view: search the Arduino library index, install, update, and uninstall libraries. "Required by This Sketch" lists headers the sketch includes that no installed library provides, with the library to install.
- A compile that fails on a missing `#include` offers to install the library that provides it, then compiles again.
- IntelliSense for `.ino` files includes the function prototypes arduino-cli generates, so calling a function before its definition is no longer flagged (except for functions that use types defined in the sketch).
- Detect Board: watches USB while you connect a board and reports what it saw, such as a board on a port, a chip without a driver, an unknown device, or nothing (usually a charge-only cable).

## 0.1.1

- Select Board lists boards from board packages that aren't installed yet. Selecting one installs its package, then selects the board.
- Board package installs are verified: an install that was interrupted (for example by reloading the window) is reported as failed instead of appearing installed.
- Select Board shows an error instead of an empty list when boards can't be listed.

## 0.1.0

First release for testing.

- Sketch view: board, port, Verify, Upload, and Monitor, with inline progress and compiler errors.
- Boards and Tools: install, update, and remove board packages, with recommendations for the workspace and connected boards. Built-in support for AVR, UNO R4, ESP32, Raspberry Pi Pico, and STM32 packages.
- Serial Monitor panel with timestamps, hex view, filter, save, send history, live plotter, and reconnect after uploads.
- Sketch Settings page with board options, stored in `sketch.yaml`.
- IntelliSense through the C/C++ extension; `compile_commands.json` for clangd.
- Diagnostics for boards that are not detected: charge-only cables, missing drivers, ports in use, Linux permissions.
- Get Started walkthrough and New Sketch command.
- Registries for boards, tools, USB IDs, and driver pages, with support for additional registries.
