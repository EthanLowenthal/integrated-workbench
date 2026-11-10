/**
 * Checks Integrated Workbench registries. For registry authors and CI.
 *
 *   npm run registry:check                          # the built-in registry (./workbench-registry)
 *   npm run registry:check -- me/my-boards          # a GitHub registry
 *   npm run registry:check -- /path/to/registry     # a local folder
 *   npm run registry:check -- --downloads ...       # also download every tool and check its sha256,
 *                                                   # and check board index URLs respond
 *
 * Exit code 1 if any registry has errors (or a download/URL check fails).
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { nodeRegistryIO } from '../src/registry/io.js';
import { loadRegistry, mergeRegistries } from '../src/registry/load.js';

const args = process.argv.slice(2);
const checkDownloads = args.includes('--downloads');
const specs = args.filter((a) => !a.startsWith('--'));
const builtinPath = resolve('workbench-registry');
const targets = specs.length ? specs.map((s) => (s.startsWith('.') ? resolve(s) : s)) : [builtinPath];

let failed = false;
const say = (s = '') => process.stdout.write(`${s}\n`);

const builtin = await loadRegistry(builtinPath, nodeRegistryIO, { builtin: true });

for (const spec of targets) {
  const isBuiltin = resolve(spec) === builtinPath;
  const loaded = isBuiltin ? builtin : await loadRegistry(spec, nodeRegistryIO, { home: homedir() });
  // Merge after the built-in one so conflicts show up the way users will see them.
  const reg = mergeRegistries(isBuiltin ? [loaded] : [builtin, loaded]);
  const mine = <T extends { origin: { registry: string; builtin: boolean } }>(xs: T[]) =>
    xs.filter((x) => x.origin.builtin === isBuiltin);

  say(`\n${loaded.name}  (${spec})`);
  say(
    `  ${loaded.files.length} file(s): ${mine(reg.packages).length} packages, ${mine(reg.usb).length} USB IDs, ${mine(reg.drivers).length} drivers, ${mine(reg.recipes).length} recipes`,
  );

  for (const e of loaded.errors) say(`  error    ${e}`);
  for (const w of reg.warnings) say(`  warning  ${w}`);
  if (loaded.errors.length) failed = true;

  const unverified = [
    ...mine(reg.packages)
      .filter((p) => p.verified === false)
      .map((p) => `package ${p.id}`),
    ...mine(reg.usb)
      .filter((u) => u.verified === false)
      .map((u) => `usb ${u.vid}:${u.pid ?? '*'} ${u.name}`),
    ...mine(reg.drivers)
      .filter((d) => d.verified === false)
      .map((d) => `driver ${d.id}`),
    ...mine(reg.recipes)
      .filter((r) => r.verified === false)
      .map((r) => `recipe ${r.id}`),
  ];
  if (unverified.length)
    say(
      `  ${unverified.length} entr${unverified.length === 1 ? 'y' : 'ies'} marked "verified": false:\n${unverified.map((u) => `    - ${u}`).join('\n')}`,
    );

  if (checkDownloads) {
    for (const p of mine(reg.packages)) {
      const files =
        p.kind === 'tool'
          ? Object.entries(p.downloads)
          : p.kind === 'firmware'
            ? [['firmware', p.file] as const]
            : [];
      if (files.length) {
        for (const [key, dl] of files) {
          try {
            const res = await fetch(dl.url);
            const bytes = Buffer.from(await res.arrayBuffer());
            const sha = createHash('sha256').update(bytes).digest('hex');
            const ok = res.ok && sha === dl.sha256 && (dl.size === undefined || dl.size === bytes.length);
            say(
              `  ${ok ? 'ok     ' : 'FAILED '}  ${p.id} ${key}${ok ? '' : ` (HTTP ${res.status}, sha ${sha.slice(0, 12)}..., ${bytes.length} bytes)`}`,
            );
            if (!ok) failed = true;
          } catch (err) {
            say(`  FAILED   ${p.id} ${key}: ${err instanceof Error ? err.message : String(err)}`);
            failed = true;
          }
        }
      } else if (p.kind === 'arduino-core' && p.boardIndex) {
        const res = await fetch(p.boardIndex).catch(() => undefined);
        say(`  ${res?.ok ? 'ok     ' : 'FAILED '}  ${p.id} board index`);
        if (!res?.ok) failed = true;
      }
    }
  }
  if (!loaded.errors.length) say('  valid');
}

process.exit(failed ? 1 : 0);
