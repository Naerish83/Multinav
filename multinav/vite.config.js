import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: '',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173
  }
});
