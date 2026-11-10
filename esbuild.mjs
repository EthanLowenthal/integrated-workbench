import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

// Codicons for the sidebar webviews (VS Code's own icon font).
mkdirSync('dist/codicons', { recursive: true });
for (const f of ['codicon.css', 'codicon.ttf']) cpSync(`node_modules/@vscode/codicons/dist/${f}`, `dist/codicons/${f}`);

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
