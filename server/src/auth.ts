import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import type { DB } from './db.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'ytf_session';
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** last_seen is written at most this often, so streaming a video doesn't write on every Range request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// --- Password ---

export function hasPassword(db: DB): boolean {
  return db.prepare('SELECT 1 FROM auth WHERE id = 1').get() !== undefined;
}

/** Replaces the household password and signs every device out. */
export async function setPassword(db: DB, password: string): Promise<void> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  const stored = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  db.transaction(() => {
    db.prepare(
      'INSERT INTO auth (id, password_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash',
    ).run(stored);
    db.prepare('DELETE FROM sessions').run();
  })();
}

export async function verifyPassword(db: DB, password: string): Promise<boolean> {
  const row = db.prepare('SELECT password_hash FROM auth WHERE id = 1').get() as { password_hash: string } | undefined;
  const [scheme, saltHex, hashHex] = row?.password_hash.split('$') ?? [];
  // Fail closed on anything malformed: an empty hash would make timingSafeEqual compare two empty buffers.
  if (scheme !== 'scrypt' || !/^[0-9a-f]{32}$/.test(saltHex ?? '') || !/^[0-9a-f]{128}$/.test(hashHex ?? '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// --- Sessions (only the SHA-256 of the token is stored) ---

export function createSession(db: DB, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, created_at, last_seen) VALUES (?, ?, ?)').run(sha256(token), now, now);
  return token;
}

/** Valid sessions slide forward; returns whether the cookie should be re-issued. */
export function checkSession(db: DB, token: string | undefined, now = Date.now()): { valid: boolean; refresh: boolean } {
  if (!token) return { valid: false, refresh: false };
  const hash = sha256(token);
  const row = db.prepare('SELECT last_seen FROM sessions WHERE token_hash = ?').get(hash) as { last_seen: number } | undefined;
  if (!row) return { valid: false, refresh: false };
  if (now - row.last_seen > SESSION_MAX_AGE_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return { valid: false, refresh: false };
  }
  if (now - row.last_seen < TOUCH_INTERVAL_MS) return { valid: true, refresh: false };
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, hash);
  return { valid: true, refresh: true };
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteAllSessions(db: DB): void {
  db.prepare('DELETE FROM sessions').run();
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// --- Login rate limit ---

export const MAX_FAILURES_PER_ADDRESS = 5;
export const MAX_FAILURES_GLOBAL = 50;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

/**
 * 5 wrong passwords lock one address for 15 minutes; 50 from anywhere lock logins for everyone.
 * Every attempt is counted as a failure *before* the slow password check, so a burst of parallel
 * requests cannot all slip past the limit while their checks are still running.
 */
export class LoginLimiter {
  private byAddress = new Map<string, number[]>();
  private global: number[] = [];

  constructor(private now: () => number = Date.now) {}

  private prune(): void {
    const cutoff = this.now() - LOCK_WINDOW_MS;
    const recent = (times: number[]) => times.filter((t) => t > cutoff);
    this.global = recent(this.global);
    this.byAddress = new Map(
      [...this.byAddress].map(([a, times]) => [a, recent(times)] as const).filter(([, times]) => times.length > 0),
    );
  }

  /** Returns false when locked; otherwise records the attempt as a failure until succeed() clears it. */
  tryAttempt(address: string): boolean {
    this.prune();
    const mine = this.byAddress.get(address) ?? [];
    if (mine.length >= MAX_FAILURES_PER_ADDRESS || this.global.length >= MAX_FAILURES_GLOBAL) return false;
    const t = this.now();
    this.byAddress.set(address, [...mine, t]);
    this.global = [...this.global, t];
    return true;
  }

  /** The right password: forget this address's failures and give back the attempt's global slot. */
  succeed(address: string): void {
    const mine = this.byAddress.get(address) ?? [];
    const last = mine.at(-1);
    this.byAddress.delete(address);
    const i = last === undefined ? -1 : this.global.lastIndexOf(last);
    if (i >= 0) this.global = [...this.global.slice(0, i), ...this.global.slice(i + 1)];
  }
}

// --- Network ---

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (address: string | undefined) => LOOPBACK.has(address ?? '');

/** Virtual adapters (WSL, Hyper-V, VMs, Docker) are unreachable from other devices. */
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker/i;

export function lanAddresses(): { name: string; address: string }[] {
  return Object.entries(networkInterfaces()).flatMap(([name, infos]) =>
    VIRTUAL_ADAPTER.test(name)
      ? []
      : (infos ?? [])
          .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
          .map((i) => ({ name, address: i.address })),
  );
}
