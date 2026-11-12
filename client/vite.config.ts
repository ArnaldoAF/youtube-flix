import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

/** Shared with the dev server (server/src/dev.ts), so the proxy always points at it. */
const ports = JSON.parse(readFileSync(new URL('../dev-ports.json', import.meta.url), 'utf8')) as {
  ui: number;
  api: number;
  preview: number;
};

// The regular app (`npm start`) keeps port 4000; dev and preview stay clear of it and of 3000/4173/5173.
const APP_PORT = 4000;

/**
 * changeOrigin stays off: the API must see the browser's own Host (127.0.0.1:6480) so it matches the
 * page's Origin, or the server's cross-site check rejects every save. (Vite's string shorthand turns
 * changeOrigin on, which is why this is spelled out.)
 */
const api = (port: number) => ({ target: `http://127.0.0.1:${port}`, changeOrigin: false });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: ports.ui,
    // Fail loudly instead of quietly moving to another port that might belong to something else.
    strictPort: true,
    proxy: { '/api': api(ports.api) },
  },
  preview: {
    host: '127.0.0.1',
    port: ports.preview,
    strictPort: true,
    proxy: { '/api': api(APP_PORT) },
  },
});
