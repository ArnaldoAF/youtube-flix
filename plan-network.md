# youtube-flix — Home Network Plan

STATUS: APPROVED (2026-11-01)

Open youtube-flix from other devices in the house (phone, TV, laptop) at
`http://<pc-address>:4000`, protected by one household password. The PC keeps doing all the work:
catalog, downloads, streaming.

## Decisions

| Topic | Decision |
|---|---|
| Default | Off. "This PC only" stays the behaviour until switched on in Settings |
| Password on the PC itself | No. Requests from the PC (loopback) never need to log in |
| What other devices can do | Watch, add titles, edit titles, manage the download queue. **Settings, deleting titles/files, updating yt-dlp and the network/password controls are PC-only** |
| Profiles | Later. Everyone shares one "Continue watching" |
| HTTPS | No. Plain HTTP on the home network (the password crosses the Wi-Fi unencrypted; TVs and phones reject self-signed certificates) |

## Design

### 1. Listening
- New setting `network: 'local' | 'home'` (default `local`).
- `local` listens on `127.0.0.1:4000` (today). `home` listens on `0.0.0.0:4000`.
- Switching re-binds in-process (close server, drop open connections, listen again). No restart needed.
- `home` cannot be switched on until a password exists.
- Windows asks once to allow Node through the firewall. The README says to pick **Private networks** only.

### 2. Who is "the PC"
- A request is **local** when its socket address is loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
  The PC opening `http://192.168.0.4:4000` counts as remote and logs in like any other device.
- `X-Forwarded-For` is never trusted (Express `trust proxy` stays off).
- The check is injectable in `createApp` so tests can simulate remote devices. The production
  default is the loopback check.

### 3. Host guard (DNS rebinding)
- Local requests: Host must be `localhost` / `127.0.0.1` (today's rule).
- Remote requests: Host must be an IP literal or this PC's name (`os.hostname()`, optionally with
  `.local` / `.lan` / `.home`). A rebinding attacker controls DNS for their own domain, so their
  Host header never passes this check.
- The existing Origin check (CSRF) stays as is.

### 4. Password and sessions
- Set and changed only on the PC (Settings → Home network). Minimum 8 characters.
- Stored as a `scrypt` hash with a random salt in a new `auth` table. It is **never** part of
  `GET /api/settings`.
- `POST /api/auth/login` checks with `timingSafeEqual`. After 5 wrong attempts from one address it
  locks that address for 15 minutes. A global cap of 50 failures per 15 minutes protects against
  attempts from many addresses.
- A successful login creates a random 32-byte token. The token is stored only as a SHA-256 hash in
  a `sessions` table, and sent as cookie `ytf_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`,
  90-day sliding expiry).
- Changing the password and "Sign out all devices" delete every session.
- `POST /api/auth/logout` deletes the current session.
- `GET /api/auth/me` returns `{ local, authenticated, network }` so the client knows what to show.

### 5. Remote access is default-deny
- Every `/api` route is PC-only unless it is explicitly marked **household**. New routes are safe
  by default.
- Household routes:
  - Catalog: list, detail, play, preview, import, refresh, edit (PATCH).
  - Episodes: context, stream, progress, continue watching.
  - Downloads: list, events (SSE), enqueue, pause, resume, cancel.
  - Read-only: `GET /settings`, `GET /system`.
  - `/auth/login`, `/auth/logout`, `/auth/me`.
- PC-only routes:
  - `PUT /settings`, `POST /system/update-ytdlp`.
  - `DELETE /titles/:id`, `DELETE /episodes/:id/file`.
  - Password, network mode and "sign out all devices".
- Remote and not logged in: every `/api` route except `/auth/*` returns 401. The static app
  bundle stays public (it holds no data) and shows the login page.
- Remote and logged in, calling a PC-only route: returns 403 "Only available on the PC".

### 6. Client
- **Login page:** shown when `/auth/me` says remote and not authenticated, or when any call
  returns 401.
- **Remote devices** don't see the Settings link, the delete buttons, or "Update yt-dlp". They get
  a "Sign out" item instead.
- **Settings → Home network (PC only):**
  - Set or change the password.
  - The on/off switch.
  - The addresses to type on other devices (non-internal IPv4 addresses, plus `http://<pc-name>:4000`).
  - "Sign out all devices".

## Rollout / rollback
- Additive schema only (`auth`, `sessions` tables, one new setting). Old data is untouched.
- **Rollback:** switch the network back to "This PC only". The server returns to listening only on
  `127.0.0.1`. Deleting the two tables restores the exact pre-feature state.

## Phases
1. Server: auth module (hash, sessions, rate limit), route classification, host guard, re-bind,
   plus tests.
2. Client: login page, `/auth/me` gating, Home network section in Settings, hiding PC-only actions.
3. README: how to turn it on, the firewall prompt, the addresses.

## Acceptance
- Off by default: nothing listens beyond `127.0.0.1` (checked with `netstat`).
- Tests cover these cases:
  - Remote with no cookie: 401 on data routes; the static app still loads.
  - Remote, wrong password ×5: locked out.
  - Remote, logged in: can browse, stream (Range 206), add and queue downloads.
  - Remote, logged in: gets 403 on settings, delete and update-ytdlp.
  - Remote with a foreign Host header: 403.
  - Changing the password invalidates existing cookies.
  - `GET /settings` never contains the hash.
  - The PC (loopback) needs no login.
- Manual check by you: a phone on the Wi-Fi opens the address, logs in, and plays a downloaded
  episode and a YouTube-only one.
- Review: two independent lanes (correctness, runtime security), both APPROVE.
