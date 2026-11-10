# Sketches

A sketch is a folder that contains an `.ino` file with the same name, for example `Blink/Blink.ino`. It can also contain `.cpp` and `.h` files, which are compiled with it.

Integrated Workbench works with the sketch of whichever file is open in the editor. Its board and board options are saved in the workspace settings (`.vscode/settings.json`), so nothing is added to the sketch folder. A sketch made in Arduino IDE 2 opens with the board from its `sketch.yaml`; that file is never changed.
