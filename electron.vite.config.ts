import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'es' } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: 'es', entryFileNames: '[name].mjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve('src/renderer/src') } },
  },
});
