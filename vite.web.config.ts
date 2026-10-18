import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/renderer',
  cacheDir: '../../node_modules/.vite-web',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
