# youtube-flix — Catalog Export and Import in Settings

STATUS: APPROVED (2026-11-11)

Export and import the catalog from Settings, without the terminal. Import can **merge** into the
current catalog or **replace** it. The terminal commands (`npm run export-catalog` / `import-catalog`)
stay as they are.

## Decisions

| Topic | Decision |
|---|---|
| Where | A new **Catalog** section in Settings, between Home network and System. PC only, like the rest of Settings |
| Export | One button. The browser downloads `youtube-flix-catalog-<date>.db`, the same portable file the terminal command makes |
| Import | Choose a file, then one checkbox: **Merge with my current catalog**, ticked by default because it never removes anything. Untick it to replace instead. A preview of what will happen, then confirm |
| Both modes keep | This PC's household password, signed-in devices, download folder, home-network and browser-cookie settings |
| Downloaded videos on this PC | Never deleted. A video in the result that this PC already has stays linked and plays locally |
| Safety net | Before either mode changes anything, a full backup is saved as `data/youtube-flix.db.backup-<date>-<time>`, and its path is shown |
| All or nothing | Each import runs in one transaction: everything changes or nothing does |

### Merge (default)
Adds what is new and keeps everything you have.

| What | Recognised as the same when | Result |
|---|---|---|
| Title | Same type and same source link (the playlist or video URL) | One title. Your name, description, thumbnail and featured flag stay. Tags from both are combined |
| Season | Same number within that title | One season; episodes are merged into it |
| Episode | Same YouTube video within that season | Kept once. Your download state stays |
| Watch progress | Same episode | The most recently watched position wins |
| Anything not matched | — | Added as new, with new internal ids |

- Settings are not touched in merge mode: this PC's quality and download choices stay.
- It works while downloads are running, since nothing is removed or renumbered.
- **Preview** example: "Adds 4 new titles and 23 episodes to 2 existing titles, and updates watch
  progress for 5 episodes. Nothing is removed."

### Replace
The catalog becomes exactly the imported one.

- Titles, seasons, episodes, tags and watch progress are replaced. Quality, simultaneous downloads and
  auto-download come from the file.
- Downloaded videos not in the imported catalog stay in the media folder but are no longer listed.
  The result says how many and how much space they take.
- It refuses while anything is downloading or queued ("Pause or cancel downloads first"), because
  renumbered episodes could otherwise receive a running download.
- **Preview** example: "16 titles, 160 episodes, watch progress for 1 episode. This replaces your
  current 12 titles."

## Why it differs from the terminal import
The running app keeps the catalog file open, so it cannot swap the file. Instead it changes the
catalog's contents inside the open database, in one transaction.

## Design

### Server (PC-only routes)
- `GET /api/catalog/export`: builds the portable file with the existing `exportCatalog` and sends it
  as a download. The temp copy is deleted afterwards.
- `POST /api/catalog/inspect?mode=merge|replace` (raw file body, at most 50 MB): checks the file is a
  youtube-flix catalog and returns the preview counts for that mode. Nothing changes.
- `POST /api/catalog/import?mode=merge|replace` (same body): takes the backup, then merges or
  replaces in one transaction. Returns the counts, the backup path, and in replace mode the unlinked
  downloads.
- After an import, open pages reload, the same way they do after a download finishes.

### Client (Settings → Catalog)
- **Export catalog** button.
- **Import catalog**:
    1. Pick a file.
    2. Tick or untick the merge checkbox; the preview follows it.
    3. Confirm with **Merge into catalog** or **Replace catalog**, or cancel.
- A result line with the backup path, plus the unlinked downloads in replace mode.

## Known risk, accepted (2026-11-11)
The safety review blocked twice on the same finding: a deliberately crafted catalog file can freeze
the server while it is being read. Round 1 used triggers, which are now dropped. Round 2 used the
file's own `CHECK` constraints and generated columns.

The fix proposed after round 2 was to accept only files whose schema matches the app's exactly. The
owner chose to accept the risk instead and document it ("only import catalog files you exported
yourself"). Exposure:
- **Who:** only the PC user, importing a file someone crafted on purpose.
- **Effect:** the app stops responding until it is restarted.
- **Data:** none is changed, because the freeze happens before the import touches the catalog.

## Non-goals
- Choosing titles one by one, and two-way sync between computers.
- Moving downloaded videos between computers.
- Doing this from other devices on the network.

## Rollout / rollback
- No schema change. The new routes are PC-only by default.
- **Rollback:** revert the commit. Undoing an import means quitting the app and copying the backup file
  over `data/youtube-flix.db` (to be written in the README).

## Acceptance
- Export downloads a file that the terminal import and both Settings modes accept, with no password,
  sessions, paths or machine settings in it.
- **Merge:**
    - Importing the same file twice changes nothing the second time.
    - Matching titles gain only their new seasons and episodes, and your edits, tags and downloads stay.
    - The newer watch progress wins.
    - Settings, password and sessions are untouched.
    - It works while a download is running.
- **Replace:** titles and progress become the file's. This PC's password, sessions and machine
  settings stay, and the backup is kept.
- In both modes, a video already downloaded here that is present in the result still plays locally.
- Both modes refuse a non-catalog file and an oversized body, and replace refuses active downloads.
  Each refusal changes nothing.
- A failure part-way leaves the old catalog exactly as it was.
- The preview counts match what the import then does.
- Another device gets 403 on all three routes.
- Checked in the browser on a copy of the library, never the real one.
- Review: two independent lanes (correctness, destructive-data safety), both APPROVE.
