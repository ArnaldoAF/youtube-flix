# youtube-flix — Genre pages, mobile player, editing series episodes

STATUS: APPROVED (2026-11-25)

Three changes, built and reviewed one after the other on `feat/episodes`.

## 1. Genre pages (from a title's tags)
- The **Genres** in a title's detail become small clickable chips (today they are plain text).
- Clicking one opens a new page, **`/genre/<name>`**, like the channel page: title, then **Series** and
  **Movies** in a grid. Same look as the channel page; no server change.
- Matching ignores upper/lower case ("Horror" and "horror" are the same genre).

## 2. Mobile player
- **Smaller controls on phones:** icons go from ~42 px to ~26 px below the `md` width (tablet/PC stay as
  today), with tighter spacing so the bar fits on one line.
- **A tap on a button never pauses any more.** Cause: after 3 s the controls hide, and a tap where a
  button was lands on the "tap to pause" layer underneath. New rule on touch screens:
    - controls hidden → the tap only **shows the controls** (nothing pauses);
    - controls visible → buttons do their job; a tap on an empty area pauses/plays, as today;
    - any touch keeps the controls awake for another 3 s.
- **Landscape automatically:** on a phone, opening the player goes full screen and turns to landscape.
  Browsers only allow this right after a tap, so if the first try is blocked, it happens on the first
  tap inside the player. Leaving full screen unlocks the rotation.
    - **Limit:** iPhone Safari does not allow web pages to go full screen or lock rotation. On iPhone the
      player stays as it is (the user turns the phone). Android Chrome works.

## 3. Editing a series' episodes
A new **Edit episodes** mode in a series' detail window (next to Edit).

| # | Topic | Proposal |
|---|---|---|
| 1 | Reorder | **"Reverse order"** button per season (for playlists that come newest-first), plus **↑ / ↓** buttons on each episode for small fixes |
| 2 | Keeping the order | Today "Check playlist for new videos" rewrites the order from YouTube. Each season gets an order mode: **playlist** (as today), **reversed** (YouTube's order, upside down, new videos land in the right place) or **manual** (your order is kept; new videos are added at the end) |
| 3 | Edit an episode | Name and description |
| 4 | Delete an episode | Removes it from the series, with its watch progress, and asks (like deleting a title) whether to also delete its downloaded file. A file another title still uses is never deleted |
| 5 | Deleted stays deleted | The removed video is remembered for that season, so "Check playlist for new videos" does not bring it back. Edit episodes lists the removed videos with **Restore**: it comes back on the next check |
| 6 | Who can do what | Reorder and edit: any household device (like editing a title today). Delete and restore: this PC only (like deleting a title) |
| 7 | Numbering | Episode numbers shown (1, 2, 3…) follow the new order; "next episode", Continue watching and Play follow it too |

### Data
- `seasons.order_mode` (`playlist` default, `reversed`, `manual`) — added to existing libraries automatically.
- New table `removed_videos` (season, YouTube id): videos deleted from a season.
- Catalog export/import carries both. Merge keeps this PC's order and adds removals from the file only
  for seasons it is merging into; replace takes the file's.
- No existing data changes until you use the new buttons.

### Not included
- Drag-and-drop reordering (↑ / ↓ and Reverse cover it; drag can come later).
- Moving an episode to another season.

## Verification
- Tests first for: order modes surviving a playlist check, deleted videos not returning, restore,
  file kept when shared, progress removed, numbering/next episode after reorder, access (delete PC-only),
  export/import of the new data.
- Browser check on a throwaway copy of the library, including a phone-sized window for the player.
- Two independent reviews (correctness; data safety and access), since episodes and files get deleted.
