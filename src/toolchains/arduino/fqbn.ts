/**
 * Arduino board IDs (FQBN): "vendor:arch:board" plus optional board options,
 * "esp32:esp32:esp32s3:FlashSize=8M,PSRAM=opi". This is what sketch.yaml's default_fqbn holds.
 */

export interface Fqbn {
  /** "vendor:arch:board" */
  base: string;
  /** Option id -> value id, in written order. */
  options: Record<string, string>;
}

export function parseFqbn(fqbn: string): Fqbn {
  const parts = fqbn.trim().split(':');
  const base = parts.slice(0, 3).join(':');
  const options: Record<string, string> = {};
  for (const pair of (parts[3] ?? '').split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) options[k] = v;
  }
  return { base, options };
}

export function formatFqbn(base: string, options: Record<string, string>): string {
  const opts = Object.entries(options)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return opts ? `${base}:${opts}` : base;
}

/** "vendor:arch" of a board ID, e.g. "esp32:esp32". */
export function platformOf(fqbn: string): string {
  return fqbn.split(':').slice(0, 2).join(':');
}
