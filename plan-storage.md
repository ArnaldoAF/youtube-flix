# youtube-flix — Downloads Page and Storage Manager Plan

STATUS: APPROVED (2026-11-05)

Make it easy to see what is using disk space and free it up. Today the library holds 58 files
(5.21 GB) across 11 titles, and one series alone uses 2.44 GB.

## Decisions

| Topic | Decision |
|---|---|
| Where it lives | A second tab on the Downloads page: **Downloads** (`/downloads`) and **Storage** (`/downloads/storage`) |
| What delete removes | The MP4 only. The title stays in the catalog, keeps its watch progress, and plays through YouTube again |
| Coming back | Deleted files don't return by themselves: "refresh" only queues new videos. The download button fetches one again, unless the video has left YouTube |
| Confirmation | Every delete asks first, naming the item and the space it frees |
| Other devices | They see the charts and totals, but not the delete buttons. Deleting stays PC-only, as it is today |
| Shared files | One video can belong to several titles but is one file. It counts once in the total |

## Design

### 1. Downloads tab
- **File size:** finished rows show the size as a large, bold, right-aligned figure instead of small
  grey text. Duration stays in the small detail line.
- **Series link:** the existing `Series name · S1` text becomes a link that opens that series.
  Only series rows change; movie rows keep their plain text.
- **Stay on the page:** the new link opens the title over the Downloads page (`?t=<id>`), so closing it
  returns here. The episode name link currently jumps to Home first; it changes to match, so two
  links on one row don't behave differently.

### 2. Storage tab (top to bottom)
- **Total:** a large figure (`5.21 GB`) with the file count.
- **Split:** a thin bar divided into series and movies, with a legend giving each amount.
- **Largest series, Largest movies, Largest files:** ranked horizontal bars, largest first. Each row has
  the name (linking to the title), bar, size, share of the total, and a delete button.
  Each list shows the top 10, with "Show all" when there are more.
- **Empty state:** a short message when nothing is downloaded.
- **Refreshing:** totals update after a delete and when a download finishes.

### 3. Chart rules
- Bars are one blue (`#3987e5`). The split uses blue and orange (`#3987e5`, `#d95926`), which pass the
  colorblind and contrast checks on this page's `#181818` background.
- No chart library: plain HTML bars are enough and add no dependency.
- Every value is also printed as text, so nothing depends on color or on hovering. Hovering a bar
  highlights its row and shows the exact size and share.

### 4. Server
- `GET /api/downloads/storage` (household, read-only) returns the total, the split, titles and files.
  It never returns file paths.
- `DELETE /api/downloads/files` with `{ episodeIds }` (PC-only, at most 5000 ids) calls the existing
  `queue.deleteFile` for each id.
- **A title's row** frees only files no other title uses, and its delete button states that amount. It
  also cancels that title's queued, paused and active downloads, so the space doesn't fill up again.
- **A file's row** removes the file from every title using it, because that is the only way to free the
  space. The confirmation names the other titles when there are any.
- Sizes come from the catalog. They currently match the disk exactly: no missing files, no files
  the catalog doesn't know about, no size mismatches.

## Non-goals
- Free-space or quota display for the drive, automatic cleanup, and deleting whole seasons.
- Finding files on disk that the catalog doesn't know about.
- Removing titles from the catalog (the title detail view already does this).

## Rollout / rollback
- No schema change, and existing routes stay as they are.
- **Code rollback:** revert the commit.
- **Deleted files cannot be restored**, only downloaded again, which is why each delete asks first.

## Phases
1. Server: storage summary, bulk delete, tests.
2. Downloads tab: size emphasis and series link.
3. Storage tab: total, split, ranked lists, delete buttons.

## Acceptance
- The total equals the sum of distinct files, and a file shared by two titles counts once.
- A title's "frees X" excludes files another title still uses, and those files stay on disk.
- Deleting a file's row removes it from every title and from disk, whatever order the ids arrive in.
- Deleted episodes still exist in the catalog with status `none`, and keep their watch progress.
- Deleting a title's downloads also cancels its pending ones.
- Another device gets 200 on the summary and 403 on the bulk delete, and sees no delete buttons.
- The summary response contains no file paths.
- Invalid bodies return 400; unknown ids are ignored.
- Checked in the browser against the real library, without deleting real files unless you ask.
- Review: two independent lanes (correctness, destructive-data safety), both APPROVE.
