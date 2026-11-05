import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { BIN_DIR } from './config.js';

const isWindows = process.platform === 'win32';

/** Bundled yt-dlp (server/bin) wins; otherwise rely on PATH. */
export function ytDlpPath(): string {
  const bundled = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
  return existsSync(bundled) ? bundled : 'yt-dlp';
}

export function ffmpegPath(): string {
  const bundled = ffmpegStatic as unknown as string | null;
  return bundled && existsSync(bundled) ? bundled : 'ffmpeg';
}

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's challenges; without one, logged-in
 * (cookie) requests often get no real formats ("Requested format is not available").
 * It only enables Deno by default, so point it at the Node that runs this server.
 */
export function jsRuntimeArgs(): string[] {
  return ['--js-runtimes', `node:${process.execPath}`];
}

export interface ToolInfo {
  ok: boolean;
  path: string;
  version: string | null;
}

function firstLineOf(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() : null));
  });
}

export async function toolStatus(): Promise<{ ytDlp: ToolInfo; ffmpeg: ToolInfo }> {
  const [ytVersion, ffLine] = await Promise.all([
    firstLineOf(ytDlpPath(), ['--version']),
    firstLineOf(ffmpegPath(), ['-version']),
  ]);
  return {
    ytDlp: { ok: ytVersion !== null, path: ytDlpPath(), version: ytVersion },
    ffmpeg: {
      ok: ffLine !== null,
      path: ffmpegPath(),
      version: ffLine?.match(/ffmpeg version (\S+)/)?.[1] ?? ffLine,
    },
  };
}

/** Kills a process and its children (yt-dlp spawns ffmpeg while merging). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}
