import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';

const sourceDir = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw new Error('Pass the disposable output directory');
await build({
  configFile: false,
  logLevel: 'warn',
  root: sourceDir,
  plugins: [vanillaExtractPlugin()],
  esbuild: { target: 'es2022' },
  resolve: { dedupe: ['yjs', 'lit', '@lit/reactive-element', 'lit-html'] },
  build: {
    outDir: resolve(process.argv[2]), emptyOutDir: true, target: 'es2022',
    rollupOptions: { input: { editor: join(sourceDir, 'index.html'), monitor: join(sourceDir, 'monitor.html') } },
  },
});
