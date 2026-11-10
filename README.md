# Integrated Workbench

Build, upload, and monitor microcontroller projects in VS Code, with a sidebar that knows which board is connected.

Integrated Workbench compiles and uploads Arduino sketches (`.ino`, `.cpp`, `.h`) for AVR, ESP32, STM32, Raspberry Pi Pico, and any other board package in the Arduino ecosystem. It sets up its own tools, explains why a board is not detected, and includes a Serial Monitor with a live plotter.

## Features

- **Sidebar.** The Sketch view shows the sketch, its board, and the connected port, with Verify, Upload, and Monitor. Progress and compiler errors appear inline, and select-to-open takes you to the line.
- **Board detection.** Connected boards are detected within a couple of seconds. Boards that identify themselves over USB are selected automatically; boards with a USB-serial chip (CH340, CP210x, FTDI) show the chip.
- **Boards and Tools.** Install, update, and remove board packages. Packages recommended for the current workspace and connected boards are listed first, each with the reason.
- **Serial Monitor.** Live output with timestamps, hex view, filter, and save. Send text with a choice of line ending and history. The Plot tab graphs values such as `temp=21.5 humidity=40`. The monitor releases the port during uploads and reconnects afterwards.
- **Sketch Settings.** Board, board options (flash size, CPU speed, upload method, and others), port, and Serial Monitor defaults in one page. The board and its options are stored in `sketch.yaml`, which arduino-cli and Arduino IDE 2 also read.
- **IntelliSense.** With the C/C++ extension installed, autocomplete and error squiggles use the selected board's compiler, defines, include paths, and libraries. clangd users can write a `compile_commands.json`.
- **Diagnostics.** When a board does not appear, the Sketch view explains why: a charge-only cable, a missing CH340 or CP210x driver, a port held by another program, or Linux permissions. Fixes come with links to vendor driver pages or commands to copy.
- **Registries.** Everything Integrated Workbench knows about boards, tools, and USB IDs comes from registries. Add your own in `integratedWorkbench.registries`.

## Getting started

1. Install Integrated Workbench. The **Get Started** walkthrough opens automatically; it is also under **Help > Welcome** and the command **Integrated Workbench: Get Started**.
2. Open a sketch, or run **Integrated Workbench: New Sketch...**.
3. In **Boards and Tools**, install the build engine (about 17 MB, once) and the package for your board.
4. Connect the board, then select **Upload**.
5. Select **Monitor** to open the Serial Monitor.

## Requirements

None to install beforehand. Integrated Workbench downloads what it needs, after you choose to install it:

| Tool                                                        | Purpose                                       | Size        |
| ----------------------------------------------------------- | --------------------------------------------- | ----------- |
| [arduino-cli](https://github.com/arduino/arduino-cli)       | Compiles, uploads, and manages board packages | about 17 MB |
| [serial-monitor](https://github.com/arduino/serial-monitor) | Connects the Serial Monitor to serial ports   | about 2 MB  |

Both are official Arduino tools, pinned to a version and verified against a SHA-256 checksum before use. They are stored in VS Code's extension storage and are not added to your PATH. Board packages are installed by arduino-cli into the standard Arduino data folder, so packages already installed by Arduino IDE are reused.

For IntelliSense, install the [C/C++ extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) (or clangd).

## Settings

| Setting                              | Description                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `integratedWorkbench.arduinoCliPath` | Use an arduino-cli you installed instead of the managed copy.                                               |
| `integratedWorkbench.registries`     | Additional registries of boards, tools, and USB IDs (GitHub `owner/repo`, an https URL, or a local folder). |
| `integratedWorkbench.pollIntervalMs` | How often to check for connected boards while a sketch is open.                                             |

## Keyboard shortcuts

| Command             | Windows / Linux | macOS       |
| ------------------- | --------------- | ----------- |
| Verify              | `Ctrl+Alt+R`    | `Cmd+Alt+R` |
| Upload              | `Ctrl+Alt+U`    | `Cmd+Alt+U` |
| Open Serial Monitor | `Ctrl+Alt+M`    | `Cmd+Alt+M` |

## Privacy

Integrated Workbench collects no telemetry. It connects to the network only to download tools and board packages you choose to install, to refresh board package indexes, and to read registries you add.

## Known limitations

- Arduino sketches are supported today. MicroPython and embedded Rust are planned.
- IntelliSense for `.ino` files does not generate function prototypes, so a function used before its definition can show an error in the editor even though it compiles.
- Uploads to STM32 boards other than Nucleo and Discovery (for example over SWD or DFU) need STMicroelectronics' STM32CubeProgrammer, which is installed separately.

## License

MIT. Integrated Workbench downloads arduino-cli and serial-monitor, which are licensed under the GPL-3.0 and run as separate programs.

Integrated Workbench builds and uploads sketches compatible with Arduino. It is not affiliated with or endorsed by Arduino.
