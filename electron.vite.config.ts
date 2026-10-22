import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// On macOS, run the dev renderer inside the branded app bundle so the Dock
// reads its icon and display name from the .app resources at launch.
if (process.platform === 'darwin') {
  const appExecutables = [
    resolve('release/mac-arm64/Haus.app/Contents/MacOS/Haus'),
    resolve('release/mac-x64/Haus.app/Contents/MacOS/Haus'),
    resolve('release/mac/Haus.app/Contents/MacOS/Haus'),
  ];
  const brandedApp = appExecutables.find((path) => existsSync(path));
  if (brandedApp) process.env.ELECTRON_EXEC_PATH = brandedApp;
}

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
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          recovery: resolve('src/renderer/recovery.html'),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve('src/renderer/src') } },
  },
});
