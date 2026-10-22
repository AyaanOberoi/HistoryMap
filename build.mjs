import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await cp('src/index.html', 'dist/index.html');
await cp('src/styles.css', 'dist/assets/styles.css');
await cp('node_modules/us-atlas/states-albers-10m.json', 'dist/assets/states-albers-10m.json');
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2020'],
  outfile: 'dist/assets/app.js',
});
