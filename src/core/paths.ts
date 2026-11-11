import { posix, win32 } from 'node:path';

/**
 * Path functions for the style of the given paths, not of the computer running the code: Windows
 * style if any of them looks like "C:\..." or "\\server\...", POSIX otherwise. Pure modules use this
 * so they treat a path the same way on every OS (and tests with captured paths pass everywhere).
 */
export function pathsFor(...samples: (string | undefined)[]): typeof posix {
  return samples.some((s) => !!s && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(s)) ? win32 : posix;
}
