// Downloads the standalone yt-dlp binary into server/bin so no global install is needed.
// Never fails `npm install`: if the download fails, the server falls back to yt-dlp on PATH.
import { createWriteStream, existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin');
const assets = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' };
const asset = assets[process.platform];
const target = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function main() {
  if (!asset) return console.warn(`[yt-dlp] no binary for ${process.platform}; install yt-dlp on PATH`);
  if (existsSync(target)) return console.log('[yt-dlp] already installed');
  mkdirSync(binDir, { recursive: true });
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  console.log(`[yt-dlp] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const tmp = `${target}.download`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
  console.log(`[yt-dlp] installed at ${target}`);
}

main().catch((err) => console.warn(`[yt-dlp] download failed (${err.message}); install yt-dlp on PATH`));
