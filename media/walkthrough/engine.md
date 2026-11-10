# Build engine

Integrated Workbench compiles and uploads with **arduino-cli**, Arduino's official command-line tool. It downloads a pinned version once (about 17 MB), verifies its checksum, and keeps it in VS Code's extension storage. Nothing is added to your PATH.

Board packages, such as compilers for AVR, ESP32, STM32, or RP2040 boards, are installed from **Boards and Tools** when you need them. They are stored in the standard Arduino data folder, so anything Arduino IDE has already installed is reused.

To use an arduino-cli you installed yourself, set **integratedWorkbench.arduinoCliPath**.
