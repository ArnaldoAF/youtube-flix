import { spawn } from 'node:child_process';
import { YtDlpError } from '../errors.js';
import { ytDlpPath } from '../tools.js';
import { mapPlaylist, mapVideo, type PlaylistMeta, type VideoMeta } from './mapper.js';
import { playlistUrl, videoUrl } from './url.js';

const METADATA_TIMEOUT_MS = 120_000;

/** Runs yt-dlp without a shell; arguments are passed as an array. */
export function runYtDlp(args: string[], timeoutMs = METADATA_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath(), args, { windowsHide: true });
    const stdout: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new YtDlpError('yt-dlp took too long to answer'));
    }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => stdout.push(d));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new YtDlpError(`Could not start yt-dlp (${err.message}). Is it installed?`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      const lastError = stderr.split(/\r?\n/).filter((l) => l.includes('ERROR')).pop();
      reject(new YtDlpError(lastError?.replace(/^ERROR:\s*/, '') ?? `yt-dlp exited with code ${code}`));
    });
  });
}

export interface Fetcher {
  fetchVideo(id: string): Promise<VideoMeta>;
  fetchPlaylist(id: string): Promise<PlaylistMeta>;
}

export function createYtDlpFetcher(extraArgs: () => string[] = () => []): Fetcher {
  return {
    async fetchVideo(id) {
      const json = await runYtDlp(['-J', '--no-warnings', '--no-playlist', ...extraArgs(), videoUrl(id)]);
      return mapVideo(JSON.parse(json));
    },
    async fetchPlaylist(id) {
      const json = await runYtDlp(['-J', '--flat-playlist', '--no-warnings', ...extraArgs(), playlistUrl(id)]);
      return mapPlaylist(JSON.parse(json));
    },
  };
}
