# Test fixtures

Raw probe output, one file per OS and scenario. Parsers and `diagnose()` are tested against these.

- `*.real.*`: captured from a real machine (identifying fields such as serial numbers and container
  IDs replaced with `REDACTED`).
- `*.synth.*`: hand-written to match the documented output format. **Replace each with a real capture
  when you have the hardware**, keeping the same file name minus `.synth`.

| OS | File | Scenario | Source |
|---|---|---|---|
| macOS | `macos/ioreg-no-boards.real.txt` | `ioreg -r -c IOUSBHostDevice -l -w0`, hubs/dock/receivers, no boards | real (macOS 26.3) |
| macOS | `macos/sp-usbhost-no-boards.real.json` | `system_profiler SPUSBHostDataType -json` | real (macOS 26.3) |
| macOS | `macos/ioreg-ch340.synth.txt` | CH340 clone on built-in driver, `/dev/cu.usbserial-110` | synth |
| macOS | `macos/ioreg-ch340-no-port.synth.txt` | CH340 present, no driver bound | synth |
| macOS | `macos/ioreg-cp2102.synth.txt` | CP2102 | synth |
| macOS | `macos/ioreg-esp32s3.synth.txt` | ESP32-S3 native USB-Serial-JTAG | synth |
| macOS | `macos/ioreg-two-boards.synth.txt` | CH340 + CP2102 | synth |
| macOS | `macos/sp-usb-legacy-ch340.synth.json` | legacy `SPUSBDataType` format | synth |
| macOS | `macos/lsof-in-use.synth.txt` | `lsof -F pc` with `screen` holding the port | synth |
| Windows | `windows/nothing-connected.synth.json` | COM1, root hub, mouse receiver | synth |
| Windows | `windows/ch340-driver-ok.synth.json` | CH340 on COM5 | synth |
| Windows | `windows/ch340-no-driver.synth.json` | CH340, ConfigManagerErrorCode 28 | synth |
| Windows | `windows/ch340-no-driver.get-pnpdevice.synth.json` | same, `Get-PnpDevice` shape | synth |
| Windows | `windows/uno-genuine.synth.json` | genuine Uno R3 (16U2) on COM3 | synth |
| Windows | `windows/ftdi.synth.json` | FT232R: USB node + FTDIBUS port node | synth |
| Windows | `windows/leonardo-composite.synth.json` | composite native USB, port on MI_00 | synth |
| Windows | `windows/cp2102-single-object.synth.json` | ConvertTo-Json single-object output | synth |
| Linux | `linux/ch340-brltty.synth.json` | CH340 claimed by brltty (usbfs), no tty | synth |
| Linux | `linux/ch340-ok.synth.json` | CH340 on ttyUSB0 | synth |
| Linux | `linux/uno-acm.synth.json` | Uno on ttyACM0 | synth |
| arduino-cli | `arduino/*.real.*` | arduino-cli 1.5.1: version, board list (nothing plugged in), listall (no cores), compile with core missing | real (macOS 26.3) |
| arduino-cli | `arduino/*.synth.*` | board list with boards (1.x and 0.x shapes), compiler errors (macOS, Windows) | synth |
| Linux | `linux/*.txt` | `systemctl`, `id -nG`, `/etc/group`, `lsof`, `lsusb` output | synth |

To capture a real Linux sysfs fixture, run `readLinuxSysfs(nodeHost)` from `src/core` and
`JSON.stringify` the result.
