import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { DownloadStatus } from '../catalog/repo.js';
import type { DB } from '../db.js';
import { cookieArgs, getSettings } from '../settings.js';
import { ffmpegPath, jsRuntimeArgs, killTree, ytDlpPath } from '../tools.js';
import { videoUrl } from '../youtube/url.js';
import { formatFor, isMergeLine, isNewStreamLine, parseProgressLine, PROGRESS_TEMPLATE } from './progress.js';
import * as store from './store.js';

export interface DownloadUpdate {
  episodeId: number;
  status: DownloadStatus;
  percent: number | null;
  speed: number | null;
  eta: number | null;
  /** 1 = video stream, 2 = audio stream, 'merging' while ffmpeg joins them. */
  stage: number | 'merging' | null;
  error: string | null;
}

interface Active {
  proc: ChildProcess;
  youtubeId: string;
  stopReason: 'pause' | 'cancel' | null;
  update: DownloadUpdate;
}

export type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args, { windowsHide: true });

export class DownloadQueue extends EventEmitter {
  private readonly active = new Map<number, Active>();

  constructor(
    private readonly db: DB,
    private readonly spawnFn: SpawnFn = defaultSpawn,
  ) {
    super();
  }

  /** Call once at startup. */
  restore(): void {
    store.requeueInterrupted(this.db);
    this.pump();
  }

  /** True while this video is downloading or waiting, under any episode. */
  private isPending(youtubeId: string): boolean {
    return [...this.active.values()].some((a) => a.youtubeId === youtubeId) || store.hasPending(this.db, youtubeId);
  }

  snapshot(): DownloadUpdate[] {
    return [...this.active.values()].map((a) => a.update);
  }

  enqueue(episodeIds: number[]): void {
    episodeIds.forEach((id) => {
      const row = store.getDownloadRow(this.db, id);
      if (!row || ['done', 'downloading', 'queued'].includes(row.status)) return;
      if (this.reuseExisting(row.youtubeId)) return;
      store.setStatus(this.db, id, 'queued');
      this.emitStatus(id, 'queued');
    });
    this.pump();
  }

  pause(id: number): void {
    const active = this.active.get(id);
    if (active) return this.stop(active, 'pause');
    const row = store.getDownloadRow(this.db, id);
    if (row?.status === 'queued') {
      store.setStatus(this.db, id, 'paused');
      this.emitStatus(id, 'paused');
    }
  }

  resume(id: number): void {
    const row = store.getDownloadRow(this.db, id);
    if (row && ['paused', 'error'].includes(row.status)) {
      store.setStatus(this.db, id, 'none');
      this.enqueue([id]);
    }
  }

  cancel(id: number): void {
    const active = this.active.get(id);
    if (active) return this.stop(active, 'cancel');
    const row = store.getDownloadRow(this.db, id);
    if (!row || row.status === 'done' || row.status === 'none') return;
    store.clearFile(this.db, id);
    this.removePartials(row.youtubeId);
    this.emitStatus(id, 'none');
  }

  /** Removes the local MP4 for an episode; the file stays if another episode still uses it. */
  deleteFile(id: number): void {
    this.cancel(id);
    const row = store.getDownloadRow(this.db, id);
    if (!row?.localPath) return;
    const shared = store.pathInUse(this.db, row.localPath, [id]);
    store.clearFile(this.db, id);
    if (!shared) safeUnlink(row.localPath);
    this.emitStatus(id, 'none');
  }

  private reuseExisting(youtubeId: string): boolean {
    const existing = store.existingFile(this.db, youtubeId);
    if (!existing || !existsSync(existing.localPath)) return false;
    store.markDone(this.db, youtubeId, existing.localPath, existing.fileSize).forEach((id) => this.emitStatus(id, 'done'));
    return true;
  }

  private pump(): void {
    const { concurrency } = getSettings(this.db);
    const busy = new Set([...this.active.values()].map((a) => a.youtubeId));
    for (const row of store.queuedRows(this.db)) {
      if (this.active.size >= concurrency) break;
      if (busy.has(row.youtubeId)) continue;
      busy.add(row.youtubeId);
      // One bad row (e.g. an unplugged download drive) must never throw out of an event handler.
      try {
        this.start(row.id, row.youtubeId);
      } catch (err) {
        const message = `Could not start download: ${(err as Error).message}`;
        store.setStatus(this.db, row.id, 'error', message);
        this.emitStatus(row.id, 'error', message);
      }
    }
  }

  private start(id: number, youtubeId: string): void {
    if (this.reuseExisting(youtubeId)) return;
    const settings = getSettings(this.db);
    mkdirSync(settings.mediaDir, { recursive: true });
    const args = [
      '--newline',
      '--no-warnings',
      '--no-playlist',
      '--continue',
      '--no-mtime',
      '-f',
      formatFor(settings.maxHeight),
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      ffmpegPath(),
      '-o',
      path.join(settings.mediaDir, '%(id)s.%(ext)s'),
      '--progress-template',
      PROGRESS_TEMPLATE,
      ...jsRuntimeArgs(),
      ...cookieArgs(settings),
      videoUrl(youtubeId),
    ];
    const proc = this.spawnFn(ytDlpPath(), args);
    const active: Active = {
      proc,
      youtubeId,
      stopReason: null,
      update: { episodeId: id, status: 'downloading', percent: 0, speed: null, eta: null, stage: null, error: null },
    };
    this.active.set(id, active);
    store.setStatus(this.db, id, 'downloading');
    this.emit('update', active.update);
    this.wire(active, settings.mediaDir);
  }

  private wire(active: Active, mediaDir: string): void {
    let stderr = '';
    let buffer = '';
    let streams = 0;
    active.proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach((line) => {
        if (isNewStreamLine(line)) streams += 1;
        const tick = parseProgressLine(line);
        const stage = isMergeLine(line) ? 'merging' : tick ? Math.max(streams, 1) : null;
        if (!tick && stage !== 'merging') return;
        active.update = {
          ...active.update,
          stage: stage ?? active.update.stage,
          ...(tick ? { percent: tick.percent, speed: tick.speed, eta: tick.eta } : {}),
        };
        this.emit('update', active.update);
      });
    });
    active.proc.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    active.proc.on('error', (err) => this.finish(active, mediaDir, -1, `Could not start yt-dlp: ${err.message}`));
    active.proc.on('close', (code) => this.finish(active, mediaDir, code ?? -1, stderr));
  }

  private finish(active: Active, mediaDir: string, code: number, stderr: string): void {
    const id = active.update.episodeId;
    if (!this.active.has(id)) return;
    this.active.delete(id);
    const file = path.join(mediaDir, `${active.youtubeId}.mp4`);

    if (active.stopReason === 'pause') {
      store.setStatus(this.db, id, 'paused');
      this.emitStatus(id, 'paused');
    } else if (active.stopReason === 'cancel') {
      // taskkill returns before the file handles close; give Windows a moment before deleting.
      setTimeout(() => this.removePartials(active.youtubeId, mediaDir), 1500);
      store.clearFile(this.db, id);
      this.emitStatus(id, 'none');
    } else if (code === 0 && existsSync(file)) {
      store.markDone(this.db, active.youtubeId, file, statSync(file).size).forEach((d) => this.emitStatus(d, 'done'));
    } else {
      const message = lastError(stderr) ?? `yt-dlp exited with code ${code}`;
      store.setStatus(this.db, id, 'error', message);
      this.emitStatus(id, 'error', message);
    }
    this.pump();
  }

  private stop(active: Active, reason: 'pause' | 'cancel'): void {
    active.stopReason = reason;
    killTree(active.proc.pid);
  }

  private removePartials(youtubeId: string, mediaDir = getSettings(this.db).mediaDir): void {
    // Partials belong to whoever downloads this video next; only clean up when nobody does.
    if (this.isPending(youtubeId) || store.existingFile(this.db, youtubeId) || !existsSync(mediaDir)) return;
    readdirSync(mediaDir)
      .filter((f) => f.startsWith(`${youtubeId}.`))
      .forEach((f) => safeUnlink(path.join(mediaDir, f)));
  }

  private emitStatus(episodeId: number, status: DownloadStatus, error: string | null = null): void {
    const update: DownloadUpdate = { episodeId, status, percent: status === 'done' ? 100 : null, speed: null, eta: null, stage: null, error };
    this.emit('update', update);
  }
}

function lastError(stderr: string): string | null {
  const line = stderr.split(/\r?\n/).filter((l) => l.includes('ERROR')).pop();
  return line ? line.replace(/^ERROR:\s*/, '').slice(0, 500) : null;
}

function safeUnlink(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone or still locked; nothing else to do
  }
}
