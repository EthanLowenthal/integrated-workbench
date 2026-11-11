# Integrated Workbench

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version-short/ethml.integrated-workbench.svg?style=flat-square&label=Marketplace&color=1B5E7A)](https://marketplace.visualstudio.com/items?itemName=ethml.integrated-workbench)
[![Installs](https://vsmarketplacebadges.dev/installs-short/ethml.integrated-workbench.svg?style=flat-square&label=installs&color=1B5E7A)](https://marketplace.visualstudio.com/items?itemName=ethml.integrated-workbench)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/ethml/integrated-workbench?style=flat-square&label=Open%20VSX%20downloads&color=1B5E7A)](https://open-vsx.org/extension/ethml/integrated-workbench)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/EthanLowenthal/integrated-workbench/blob/HEAD/LICENSE)

Plug in a board and it works. If it doesn't, Integrated Workbench tells you why.

Build, upload, and monitor Arduino sketches in VS Code from a sidebar that knows which board is
connected. There is nothing to install first and nothing added to your sketch folder, and
sketches from Arduino IDE open as they are. It works with AVR, ESP32, STM32, Raspberry Pi Pico,
and any other board package in the Arduino ecosystem, and with MicroPython.

<!-- Hero screenshot goes here: images/sidebar.png (Sketch view, Serial Monitor plot, Build tab),
     referenced as https://github.com/EthanLowenthal/integrated-workbench/raw/HEAD/images/sidebar.png -->

## Install

In the Extensions view, search for Integrated Workbench, or install it from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=ethml.integrated-workbench) or
[Open VSX](https://open-vsx.org/extension/ethml/integrated-workbench). The **Get Started**
walkthrough opens on first run.

To upload your first sketch, do the following:

1. Open a sketch folder, or run **Integrated Workbench: New Sketch...**.
1. In the Integrated Workbench sidebar, click **Install** next to "Build engine not installed."
   The engine is about 17 MB and installs once.
1. Connect the board. Its port appears within a couple of seconds.
1. Click **Select Board...** and choose your board. If its board package isn't installed, the
   package installs first.
1. Click **Upload**.

## Features

Integrated Workbench includes the following features:

- **Board detection**. Connected boards appear within a couple of seconds. A board that
  identifies itself over USB is selected for you; a board with a USB-serial chip such as a CH340,
  CP210x, or FTDI shows the chip.
- **Problems explained**. When a board doesn't appear, the sidebar names the likely cause: a
  charge-only cable, a missing CH340 or CP210x driver, a port held by another program, or Linux
  permissions, with a link to the driver or a command to copy. When an upload fails, it says what
  the uploader's error means.
- **One-click fixes**. A Nano that doesn't answer gets a button that switches the bootloader option
  and uploads again. A compile that fails on a missing `#include` offers to install the library
  that provides it.
- **Serial Monitor and plotter**. Timestamps, hex view, filter, save, line endings, and send
  history. The Plot tab graphs values such as `temp=21.5 humidity=40`. During uploads, the monitor
  lets go of the port and reconnects afterward.
- **Build output**. The Build panel tab shows compiler and upload output as it arrives. After a
  compile, the sidebar shows flash and RAM use.
- **Board packages and libraries**. Install, update, and remove them from the sidebar. The ones your
  sketch and connected boards need are listed first, with the reason.
- **Board options**. Flash size, CPU speed, upload method, and the other options for your board are
  on one Sketch Settings page.
- **IntelliSense**. Autocomplete and error squiggles use the selected board's compiler, defines,
  include paths, and libraries.
- **MicroPython**. Run a file on the board, upload changed files, use the REPL, and install
  MicroPython on a Raspberry Pi Pico or an ESP32. You don't need to install Python.

## Use the sidebar

The Integrated Workbench sidebar has the following views:

- **Sketch**: the open sketch, its board and port, the **Verify**, **Upload**, and **Monitor**
  buttons, results, and notifications
- **Boards and Tools**: the build engine, the Serial Monitor engine, and board packages
- **Libraries**: libraries the sketch uses, installed libraries, and search

The sketch is whichever sketch folder contains the file open in the editor. A sketch is a folder
with an `.ino` file of the same name, such as `Blink/Blink.ino`.

### Notifications

Anything that needs attention is listed at the top of the Sketch view: a tool to install, a board
problem, a library the sketch is missing, or an available update. The Integrated Workbench icon in
the activity bar shows how many need attention. To see the explanation for a notification, hold
the pointer over it.

### Board and port

To choose the board, click **Select Board...**. The list shows connected boards first, then
installed boards, then boards from packages that aren't installed yet.

The board and its options are saved in the workspace settings (`.vscode/settings.json`), so
nothing is added to the sketch folder. A sketch from Arduino IDE 2 opens with the board in its
`sketch.yaml`; that file is read, never changed. The port is remembered on each computer.

If the board doesn't appear, click **Detect Board...** under the port, then connect the board while
Integrated Workbench watches USB. It reports what changed.

### Board options

To change options such as flash size or the Nano bootloader, open Sketch Settings: in the Sketch
view title bar, click **More Actions** > **Open Sketch Settings**. Only options that differ from
the board's defaults are saved.

## Use the Serial Monitor

To open the Serial Monitor, in the Sketch view, click **Monitor**. The Serial Monitor opens in the
panel area, next to Terminal. In the Serial Monitor, you can do the following:

- Set the baud rate to match `Serial.begin()` in the sketch. The baud rate is remembered for each
  sketch.
- To graph values, click the **Plot** tab. Lines such as `temp=21.5 humidity=40` or `21.5,40` are
  plotted, one series for each value.
- To upload and then watch the output, run **Upload and Open Serial Monitor**.

## Use MicroPython

A folder with a `boot.py` file is a MicroPython project. To use another folder, right-click it in
the Explorer and select **Use Folder as MicroPython Project**.

The Sketch view has the following buttons for a MicroPython project:

- **Run** runs the open `.py` file, or `main.py`, on the board without saving it there. Output
  appears in the Serial Monitor, and **Stop** interrupts it. If the program raises an exception,
  the line is marked in the editor.
- **Upload** copies the files that changed to the board, then restarts it to run `main.py`. Files
  on the board that aren't in the project are left alone.
- **REPL** opens the Serial Monitor, with **Interrupt (Ctrl-C)** and **Soft Reset (Ctrl-D)**
  buttons.

To see the files on the board, click **List Files** under **Files on Board**. To open a read-only
copy of a file, click it.

### Install MicroPython on a board

To put MicroPython on a board, run **Integrated Workbench: Install MicroPython on Board...**,
choose the board, and then do one of the following:

- For a Raspberry Pi Pico, hold the BOOTSEL button while you connect the board. The firmware is
  copied to the board's drive, and the board restarts with MicroPython.
- For an ESP32, select its port first. The board is erased, and `esptool` writes MicroPython. The
  first time, `esptool` downloads (about 60 MB).

## IntelliSense

In VS Code, IntelliSense for sketches uses the
[C/C++ extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools). If it
isn't installed, the Sketch view offers to install it.

The C/C++ extension isn't available in other editors built on VS Code, such as Cursor and
VSCodium. In those editors, in the Sketch view, click **Set Up clangd**. It installs the clangd
extension and writes a `compile_commands.json` file into the sketch folder, which is updated when
the board changes.

## Requirements

You don't need to install anything first. After you choose to install them, Integrated Workbench
downloads the following tools:

| Tool                                                        | Purpose                                       | Size        |
| ----------------------------------------------------------- | --------------------------------------------- | ----------- |
| [arduino-cli](https://github.com/arduino/arduino-cli)       | Compiles, uploads, and manages board packages | About 17 MB |
| [serial-monitor](https://github.com/arduino/serial-monitor) | Connects the Serial Monitor to serial ports   | About 2 MB  |
| [esptool](https://github.com/espressif/esptool)             | Installs MicroPython on ESP32 boards          | About 60 MB |

Each tool is pinned to a version and checked against a SHA-256 checksum before use. The tools are
kept in VS Code's extension storage and aren't added to your `PATH`. Board packages install into
the standard Arduino data folder, so packages that Arduino IDE already installed are reused.

Integrated Workbench runs only in trusted workspaces, because compiling a sketch can run code from
it.

## Keyboard shortcuts

| Command                                         | Windows and Linux  | macOS             |
| ----------------------------------------------- | ------------------ | ----------------- |
| Verify (in a MicroPython project: Run on Board) | `Ctrl+Alt+R`       | `Cmd+Alt+R`       |
| Upload                                          | `Ctrl+Alt+U`       | `Cmd+Alt+U`       |
| Open Serial Monitor                             | `Ctrl+Alt+M`       | `Cmd+Alt+M`       |
| Upload and Open Serial Monitor                  | `Ctrl+Alt+Shift+U` | `Cmd+Alt+Shift+U` |

## Commands

| Command                                                          | Action                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| **Integrated Workbench: New Sketch...**                          | Create a sketch folder with an `.ino` file            |
| **Integrated Workbench: Verify**                                 | Compile the sketch                                    |
| **Integrated Workbench: Upload**                                 | Compile and upload the sketch                         |
| **Integrated Workbench: Upload and Open Serial Monitor**         | Upload, then connect the Serial Monitor               |
| **Integrated Workbench: Select Board...**                        | Choose the board for the sketch                       |
| **Integrated Workbench: Select Port...**                         | Choose the port                                       |
| **Integrated Workbench: Detect Board...**                        | Watch USB while you connect a board                   |
| **Integrated Workbench: Open Serial Monitor**                    | Open and connect the Serial Monitor                   |
| **Integrated Workbench: Show Build Output**                      | Open the Build panel tab                              |
| **Integrated Workbench: Open Sketch Settings**                   | Open board options, port, and Serial Monitor defaults |
| **Integrated Workbench: Run on Board**                           | Run the open MicroPython file on the board            |
| **Integrated Workbench: Install MicroPython on Board...**        | Install MicroPython on a Pico or an ESP32             |
| **Integrated Workbench: Use Folder as MicroPython Project**      | Treat a folder as a MicroPython project               |
| **Integrated Workbench: Write compile_commands.json for clangd** | Write the sketch's compilation database               |
| **Integrated Workbench: Get Started**                            | Open the walkthrough                                  |

## Settings

| Setting                                    | Default | Effect                                                              |
| ------------------------------------------ | ------- | ------------------------------------------------------------------- |
| `integratedWorkbench.arduinoCliPath`       | `""`    | Path to an `arduino-cli` that you installed. User settings only.    |
| `integratedWorkbench.pollIntervalMs`       | `2000`  | How often to check for connected boards, in milliseconds            |
| `integratedWorkbench.registries`           | `[]`    | Extra registries of boards, tools, and USB IDs. User settings only. |
| `integratedWorkbench.boards`               | `{}`    | The board for each sketch. Set from the Sketch view.                |
| `integratedWorkbench.micropython.projects` | `[]`    | Folders treated as MicroPython projects                             |

Everything that Integrated Workbench knows about boards, tools, firmware, and USB IDs is data in a
registry. To add your own, see
[Build a registry](https://github.com/EthanLowenthal/integrated-workbench/blob/HEAD/docs/REGISTRY.md).

## Privacy

Integrated Workbench collects no telemetry. It connects to the network only to download tools,
board packages, libraries, and firmware that you choose to install, to refresh package indexes,
and to read registries that you add.

## Known limitations

Integrated Workbench has the following known limitations:

- In `.ino` files, IntelliSense includes the function prototypes that `arduino-cli` generates,
  except for functions whose signatures use types defined in the sketch. Calling one of those
  functions before its definition can show an error in the editor even though the sketch compiles.
- Uploads to STM32 boards other than Nucleo and Discovery, for example over SWD or DFU, need
  STMicroelectronics' STM32CubeProgrammer, which you install separately.

## Release notes

For release notes, see
[CHANGELOG.md](https://github.com/EthanLowenthal/integrated-workbench/blob/HEAD/CHANGELOG.md). For
build instructions, see
[DEVELOPING.md](https://github.com/EthanLowenthal/integrated-workbench/blob/HEAD/DEVELOPING.md).

## License

MIT. Integrated Workbench downloads `arduino-cli` and `serial-monitor` (GPL-3.0) and `esptool`
(GPL-2.0), which run as separate programs. For bundled third-party code, see
[THIRD_PARTY_NOTICES.md](https://github.com/EthanLowenthal/integrated-workbench/blob/HEAD/THIRD_PARTY_NOTICES.md).

Integrated Workbench builds and uploads sketches that are compatible with Arduino. It isn't
affiliated with or endorsed by Arduino.
