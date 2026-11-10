/**
 * Board package indexes beyond Arduino's own, passed to arduino-cli with --additional-urls so
 * ESP32 and Raspberry Pi Pico boards show up in the manager without the user editing any config.
 * Both checked working with arduino-cli 1.5.1 on 2026-11-09.
 */
export const EXTRA_BOARD_INDEXES = [
  'https://espressif.github.io/arduino-esp32/package_esp32_index.json',
  'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json',
];
