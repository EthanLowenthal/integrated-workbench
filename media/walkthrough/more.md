# More

- **Sketch Settings** (Boards and Tools > Settings, or the Sketch view's "..." menu) holds the board, board options, port, Serial Monitor defaults, and IntelliSense status.
- **IntelliSense** works with the C/C++ extension: autocomplete and error squiggles use the selected board's compiler, defines, and libraries. clangd users can write a `compile_commands.json` from Sketch Settings.
- **Boards and Tools** lists what is recommended for this workspace, what is installed, and every available board package.
- **MicroPython**: a folder with a `boot.py` is a MicroPython project, with **Run**, **Upload**, and the REPL in the Serial Monitor. **Install MicroPython on Board** puts MicroPython on a Raspberry Pi Pico or an ESP32.
- **Registries** describe the boards, tools, and USB IDs Integrated Workbench knows about. Add your own in **integratedWorkbench.registries**.
