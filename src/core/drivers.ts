/**
 * Official vendor driver download pages. All in one place so they're easy to update.
 * We link to vendors; we never bundle or redistribute their drivers.
 * Verify every URL before release.
 */
export type DriverKey = 'wch-ch34x' | 'wch-ch9102' | 'silabs-cp210x' | 'ftdi-vcp';

export interface DriverLink {
  vendor: string;
  /** Short name used in messages, e.g. "CH340 driver". */
  name: string;
  windows: string;
  macos: string;
  linux?: string;
}

export const DRIVER_LINKS: Record<DriverKey, DriverLink> = {
  'wch-ch34x': {
    vendor: 'WCH',
    name: 'WCH CH340/CH341 driver',
    windows: 'https://www.wch-ic.com/downloads/CH341SER_EXE.html', // TODO verify
    macos: 'https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html', // TODO verify
  },
  'wch-ch9102': {
    vendor: 'WCH',
    name: 'WCH CH343/CH9102 driver',
    windows: 'https://www.wch-ic.com/downloads/CH343SER_EXE.html', // TODO verify
    macos: 'https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html', // TODO verify
  },
  'silabs-cp210x': {
    vendor: 'Silicon Labs',
    name: 'Silicon Labs CP210x VCP driver',
    windows: 'https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers', // TODO verify
    macos: 'https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers', // TODO verify
  },
  'ftdi-vcp': {
    vendor: 'FTDI',
    name: 'FTDI VCP driver',
    windows: 'https://ftdichip.com/drivers/vcp-drivers/', // TODO verify
    macos: 'https://ftdichip.com/drivers/vcp-drivers/', // TODO verify
  },
};

/** Where to report devices we don't recognize. */
export const ISSUE_URL = 'https://github.com/sketchdesk/sketchdesk/issues/new?template=unknown-device.md'; // TODO verify (repo not created yet)
