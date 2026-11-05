import express, { type NextFunction, type Request, type Response } from 'express';
import { hostname } from 'node:os';
import { z } from 'zod';
import * as auth from './auth.js';
import type { DB } from './db.js';
import { getSettings } from './settings.js';

/** Whether the request comes from this PC. Injectable so tests can play a phone on the Wi-Fi. */
export type IsLocal = (req: Request) => boolean;
export const loopbackOnly: IsLocal = (req) => auth.isLoopback(req.socket.remoteAddress);

const isLocalReq = (res: Response) => res.locals.local === true;

export function markLocality(isLocal: IsLocal) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.locals.local = isLocal(req);
    next();
  };
}

function hostnameOf(header: string | undefined): string {
  const host = (header ?? '').toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.replace(/:\d+$/, '');
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;

/**
 * Blocks DNS rebinding: a page on another domain must never be able to drive this server.
 * The PC must use localhost; other devices must use an IP address or this PC's name, which an
 * attacker's DNS cannot produce in the Host header.
 */
export function hostGuard(pcName = hostname()) {
  const name = pcName.toLowerCase();
  const pcNames = new Set([name, `${name}.local`, `${name}.lan`, `${name}.home`]);
  return (req: Request, res: Response, next: NextFunction) => {
    const host = hostnameOf(req.headers.host);
    const ok = isLocalReq(res)
      ? host === 'localhost' || host === '127.0.0.1'
      : IPV4.test(host) || IPV6.test(host) || pcNames.has(host);
    if (ok) return next();
    res.status(403).json({ error: 'youtube-flix only accepts requests addressed to this PC' });
  };
}

/**
 * Blocks CSRF: any website can send a body-less POST here, and browsers always attach
 * Origin to cross-origin writes. Writes must come from the page this server (or the Vite proxy) serves.
 */
export function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin === undefined) return next();
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // "null" or malformed origin → rejected below
  }
  if (originHost && originHost === req.headers.host) return next();
  res.status(403).json({ error: 'Cross-site requests are not allowed' });
}

const sessionToken = (req: Request) => auth.readCookie(req.headers.cookie, auth.SESSION_COOKIE);

function setSessionCookie(res: Response, token: string) {
  res.cookie(auth.SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: auth.SESSION_MAX_AGE_MS });
}

/** Other devices need a valid session for everything past this point; the PC never does. */
export function requireLogin(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isLocalReq(res)) return next();
    const token = sessionToken(req);
    const { valid, refresh } = auth.checkSession(db, token);
    if (!valid) return res.status(401).json({ error: 'Please sign in' });
    if (refresh && token) setSessionCookie(res, token);
    next();
  };
}

/** Everything not explicitly shared with the household is PC-only, including routes added later. */
export function pcOnly(_req: Request, res: Response, next: NextFunction) {
  if (isLocalReq(res)) return next();
  res.status(403).json({ error: 'Only available on the PC running youtube-flix' });
}

const loginSchema = z.object({ password: z.string().min(1).max(200) });
export const passwordSchema = z.object({
  password: z.string().min(auth.MIN_PASSWORD_LENGTH, `Use at least ${auth.MIN_PASSWORD_LENGTH} characters`).max(200),
});

/** Routes reachable without a session: who am I, sign in, sign out. */
export function openAuthRoutes(db: DB, limiter: auth.LoginLimiter) {
  const router = express.Router();

  router.get('/auth/me', (req, res) => {
    const local = isLocalReq(res);
    res.json({
      local,
      authenticated: local || auth.checkSession(db, sessionToken(req)).valid,
      network: getSettings(db).network,
      hasPassword: auth.hasPassword(db),
    });
  });

  router.post('/auth/login', (req, res, next) => {
    const { password } = loginSchema.parse(req.body);
    if (isLocalReq(res)) return res.status(204).end();
    const address = req.socket.remoteAddress ?? 'unknown';
    if (!limiter.tryAttempt(address)) {
      return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
    }
    auth
      .verifyPassword(db, password)
      .then((ok) => {
        if (!ok) return res.status(401).json({ error: 'Wrong password' });
        limiter.succeed(address);
        setSessionCookie(res, auth.createSession(db));
        res.status(204).end();
      })
      .catch(next);
  });

  router.post('/auth/logout', (req, res) => {
    auth.deleteSession(db, sessionToken(req));
    res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  return router;
}
