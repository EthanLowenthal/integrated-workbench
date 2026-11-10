# Connecting a board

Connect the board with a USB data cable. The port appears in the **Sketch** view within a couple of seconds.

If it does not appear, run **Detect Board** (in the Sketch view's Diagnostics, or the Command Palette) and connect the board while it watches USB. It reports what it saw, and **Diagnostics** explains why. Common causes:

- **Charge-only cable.** Many USB cables carry power but no data. Try a cable known to transfer files.
- **Missing driver.** CH340 and CP210x chips need a vendor driver on some systems. Diagnostics links to the vendor's download page.
- **Port in use.** Another program, such as a terminal or another serial monitor, has the port open.
- **Linux permissions.** The user must be in the `dialout` (or `uucp`) group.
