# Boards

When a board that identifies itself over USB is connected (for example a genuine Uno or an ESP32-S3), it is selected automatically.

Many boards use a separate USB chip such as a CH340, CP2102, or FTDI. These cannot report which board they are on, so select the board once; the choice is saved in the workspace settings.

Boards with settings, such as ESP32 flash size or the exact STM32 Nucleo part, have them under **Board Options** in **Sketch Settings**.
