# youtube-flix — Implementation Plan

STATUS: APPROVED (2026-11-01)

A Netflix-style catalog for movies and series that live on YouTube. Paste a video or playlist
link, and it becomes a title with metadata pulled by `yt-dlp`. Downloaded MP4s play locally;
anything not downloaded plays through the YouTube embedded player.

## Decisions

| Topic | Decision |
|---|---|
| Where it runs | Only on this PC (`127.0.0.1`), no login. Home network + password is a later phase |
| Series structure | Per import: a playlist is either **one season** or **the whole series**. Whole-series imports auto-split into seasons when titles contain `S01E02`, `T1E2`, `1x02`, `Temporada 1 Episódio 2`, ... A playlist can also be added as a new season of an existing series |
| Downloads | Start automatically when a title is added (toggle in Settings / on the add form) |
| Quality | 1080p default, configurable |
| Location | `C:\Git\youtube-flix` |

## Architecture

```
youtube-flix/
├── client/   React + Vite + TypeScript + Tailwind
└── server/   Node + Express + TypeScript
              ├── yt-dlp   metadata (-J / --flat-playlist) + downloads (server/bin, fetched on install)
              ├── ffmpeg   stream merge (ffmpeg-static)
              ├── SQLite   catalog (better-sqlite3), data/youtube-flix.db
              └── data/media/<youtubeId>.mp4, served with HTTP Range
```

## Phases

1. Skeleton and tooling: monorepo, one `npm run dev`, tool check, SQLite schema
2. Metadata import: preview/import/refresh, URL allow-list, canonical URLs only reach yt-dlp
3. Netflix-style UI: hero, rows, hover cards, detail modal, seasons/episodes, add page, edit/tags, search
4. Player: local `<video>` or YouTube iframe fallback, progress every 10s, resume, next episode
5. Downloads: queue (1–3 concurrent), SSE progress, pause/resume/cancel/delete, auto-download, settings, update yt-dlp
6. Later: TMDB posters, TV-friendly navigation, home network + password

## Acceptance

- Adding a video or playlist link creates a title with name, thumbnail, durations and episodes
- Whole-series playlists with SxxEyy titles are split into seasons
- Downloads start automatically, show live progress, and the player uses the local MP4 once done
- Progress is saved and "Continue watching" resumes where you stopped
- Server listens on 127.0.0.1 only; user input never reaches a shell
