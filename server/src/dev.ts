// Entry point for `npm run dev`. Dev mode runs next to the regular app (`npm start`, port 4000), so its
// server takes the API port from dev-ports.json, the same file the Vite proxy reads. config.ts reads
// PORT when it is first imported, so only built-in modules are imported before PORT is set.
import { readFileSync } from 'node:fs';

const ports = JSON.parse(readFileSync(new URL('../../dev-ports.json', import.meta.url), 'utf8')) as { ui: number; api: number };
process.env.PORT ??= String(ports.api);
// Marks dev mode: the server answers only /api, sends page requests to Vite, and stays on this PC.
process.env.YTF_DEV_UI_URL ??= `http://127.0.0.1:${ports.ui}`;

await import('./index.js');
