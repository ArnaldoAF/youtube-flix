# youtube-flix

A Netflix-style catalog for the movies and series you watch on YouTube. Paste a video or playlist
link, mark it as a movie or series, and it shows up with thumbnail, duration and episodes. Titles
are downloaded as MP4 automatically and play from disk; anything not downloaded yet plays through
the YouTube player.

By default it runs only on this PC (`http://127.0.0.1:4000`), no login. It can also be opened from
other devices on your home network (see below).

## Run

```bash
npm install        # also fetches yt-dlp.exe (server/bin) and ffmpeg (ffmpeg-static)
npm run build      # builds the UI once
npm start          # http://127.0.0.1:4000
```

Or double-click `youtube-flix.bat`, which builds if needed, starts the server and opens the browser.

Development with hot reload: `npm run dev` (UI on http://127.0.0.1:5173, API on :4000).

## Adding titles

| Link | Choose | Result |
|---|---|---|
| Video | Movie | One movie |
| Playlist | Movie | A movie in parts |
| Playlist | Series → "One season" | One season (pick the number) |
| Playlist | Series → "The whole series" | Split into seasons from titles like `S01E02`, `T1E2`, `1x02`, `Temporada 1 Episódio 2`; otherwise Season 1 |
| Playlist | Series → "Add to: New season of X" | Next season of an existing series |

The refresh button in a title's detail view picks up new videos added to its playlist.
Tags you add in "Edit" become rows on the home page.

## Home network (phone, TV, other computers)

1. On the PC, open **Settings → Home network**, set a household password, and switch it on.
2. If Windows asks whether to allow Node.js through the firewall, allow **Private networks** only.
3. On the other device, open one of the addresses shown there (for example `http://192.168.0.4:4000`)
   and sign in.

Other devices can watch, add and edit titles and manage the download queue. Settings, deleting
titles or files, and updating yt-dlp only work on the PC. The PC itself never needs the password.
Everyone shares one "Continue watching". The connection is plain HTTP, so use it only on a network
you trust. Changing the password or "Sign out all other devices" logs every device out. Switching
it off returns to "this PC only" immediately.

The PC must be on and youtube-flix running for other devices to connect.

## Where things live

- Catalog: `data/youtube-flix.db` (SQLite)
- Videos: `data/media/<youtubeId>.mp4` (configurable in Settings)

## Moving to another computer

The code goes through git. The catalog (titles, seasons, episodes, tags and watch progress) travels as
one file:

1. On this PC, run the command below. It's safe while youtube-flix is open. It writes
   `youtube-flix-catalog.db` in the project folder, or pass a path: `npm run export-catalog -- D:\catalog.db`.

   ```bash
   npm run export-catalog
   ```

2. Copy that file to the other computer, set the project up there (`npm install`, `npm run build`),
   quit youtube-flix if it is running, and import:

   ```bash
   npm run import-catalog -- D:\catalog.db
   ```

   If that computer already has titles or a household password, add `--replace`. The previous
   catalog is kept as `data/youtube-flix.db.backup-<date>-<time>`. Import refuses to run while
   youtube-flix has the catalog open.

Not included: downloaded videos (episodes play from YouTube until you download them again), the
household password, and this PC's download folder, home-network and browser-cookie settings.
Quality, simultaneous downloads and auto-download do carry over.

## Troubleshooting

- Imports or downloads suddenly fail: Settings → **Update yt-dlp** (YouTube changes things often).
- Private or age-restricted videos: Settings → "Use cookies from browser".
- Downloads prefer H.264 (plays everywhere). Above 1080p YouTube only offers VP9/AV1.

## Tests

```bash
npm test
```
