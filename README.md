# Integrated Workbench

A VS Code workspace for microcontroller projects that knows which board is plugged in.

- Status bar shows the plugged-in board and port, picked automatically.
- Verify and Upload Arduino sketches (`.ino` plus `.cpp`/`.h`), with compiler errors in the Problems panel.
- Boards and Tools manager with recommendations for this workspace: Arduino AVR, UNO R4, ESP32, Raspberry Pi Pico and STM32 (Nucleo, Discovery and generic) out of the box, plus every other package in Arduino's index.
- Everything it knows comes from registries anyone can publish. See [docs/REGISTRY.md](docs/REGISTRY.md).
- Board not showing up? Board Doctor explains why in plain English (missing CH340/CP210x driver, charge-only cable, port in use, Linux permissions).
- No setup: Integrated Workbench downloads its own pinned copy of [arduino-cli](https://github.com/arduino/arduino-cli) (GPL-3.0) the first time you build, after asking. Or point `integratedWorkbench.arduinoCliPath` at your own.

Coming: serial monitor and plotter, board and library manager, MicroPython and embedded Rust. See [docs/PLAN.md](docs/PLAN.md).

Integrated Workbench builds and uploads sketches compatible with Arduino via arduino-cli. It is not affiliated with Arduino.
