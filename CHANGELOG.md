# Changelog

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
