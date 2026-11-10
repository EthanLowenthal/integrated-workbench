# Serial Monitor

The Serial Monitor shows what the board prints with `Serial.print()` and sends text to it. It opens in the panel area, next to Terminal.

- Set the **baud rate** to match `Serial.begin()` in the sketch. It is remembered per sketch.
- Turn on **timestamps** or the **hex** view from the toolbar. Filter, clear, or save the output.
- The **Plot** tab graphs numbers in the output, such as `temp=21.5 humidity=40` or `21.5,40`.
- During an upload the monitor releases the port and reconnects afterwards.

Shortcut: `Ctrl+Alt+M` (macOS `Cmd+Alt+M`).
