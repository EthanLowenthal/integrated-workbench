# Changelog

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
