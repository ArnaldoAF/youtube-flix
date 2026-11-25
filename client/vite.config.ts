import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
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

/**
 * The version shown in the footer, fixed when the app is built (or when dev mode starts):
 * "v0.2.0" on a release tag, "v0.2.0+3 · 6bb86c2" for commits after it, "· edited" with uncommitted
 * changes. Without Git (a copied folder) it falls back to package.json.
 */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const fallback = `v${pkg.version}`;
  try {
    const described = execFileSync('git', ['describe', '--tags', '--match', 'v*', '--long', '--dirty', '--always'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const dirty = described.endsWith('-dirty');
    const clean = dirty ? described.slice(0, -'-dirty'.length) : described;
    const m = clean.match(/^(v\d+\.\d+\.\d+.*)-(\d+)-g([0-9a-f]+)$/);
    const base = m ? (m[2] === '0' ? m[1] : `${m[1]}+${m[2]} · ${m[3]}`) : `${fallback} · ${clean}`;
    return dirty ? `${base} · edited` : base;
  } catch {
    return fallback;
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
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
