# youtube-flix — Browsing: Channels, Hero Carousel, Grid View, Recommendations, Filters

STATUS: APPROVED (2026-11-25)

Five browsing improvements. Movie sequels are discussed separately at the end (options only, not
built in this plan).

## What the catalog has today
- No genre field. Titles have free-form **tags**, which the user sets in Edit, and each tag is already a row
  on Home. Real catalog: 16 titles, 5 tagged, one tag in use ("Analog Horror").
- Every title has a **channel** from YouTube. Real catalog: 13 channels, and 12 of them have one title.
- Everything below can be worked out from the title list the app already loads, so no server API or
  database change is needed (unless "Genres" becomes a separate field, see decision 1).

## Decisions
| # | Topic | Proposal |
|---|---|---|
| 1 | What a "genre" is | **Decided: tags are the genres.** No new field; the UI calls them "Genres" |
| 2 | Hero choice | 2 random series and 2 random movies, drawn again on each visit. Titles marked "Feature on home" are always among the 4. On the Series and Movies pages: 4 random titles of that type |
| 3 | Grid or carousel | One toggle (two icons) at the top of Home, applying to every row. Remembered in this browser. Carousel stays the default and is unchanged |
| 4 | Recommendations | Titles sharing a genre or the channel, best matches first (more shared genres, then same channel), up to 12, never the title itself |
| 5 | Filter results | Always a grid, as requested |

## 1. Channel page
- **Link:** the channel name becomes a link in the title detail and the hover card. It opens
  `/channel/<name>`.
- **Page:** the channel name, how many series and movies it has, then a **Series** section and a
  **Movies** section, each in a grid. An empty section is hidden.
- **Unknown channel:** a short message and a link home.

## 2. Hero carousel
Simplified by the owner (2026-11-25) after three review rounds found ways for the pause-on-focus
logic to freeze it.
- **Rotation:** 4 slides (see decision 2) change every **10 s**. Nothing pauses it: not the mouse,
  keyboard focus or a hidden tab.
- **Arrows:** left and right arrows at the sides go back and forward, and restart the 10 s count.
- **Position:** small dots show which slide is showing. They are indicators only and can't be clicked
  for now.
- **Fewer titles:** shows what exists, with no arrows or dots for a single title.

## 3. Grid view
- **Toggle:** carousel or grid, at the top of Home (see decision 3).
- **Grid:** every row shows all its cards wrapped in lines, with the same cards and hover behaviour.
  "Continue watching" keeps its own card style.

## 4. Recommended (title detail)
- **Placement:** a **Recommended** section under the episodes or parts, using the same cards. It opens
  the chosen title in place of the current one.
- **Nothing in common:** the section is hidden.

## 5. Filters on Series and Movies
- **Selects:** two selects at the top right, **Genre** and **Channel**, each with "All". They combine.
- **Results:** a grid of the matching titles, plus a "no matches" message. With both on "All" the page
  stays as it is today.
- **Shareable:** the choice is kept in the address (`?genre=&channel=`), so it can be shared and survives a
  reload.

## Movie sequels (options only, decision later)
Decided: **collections**, an ordered group of separate movies (Part 1, Part 2). Planned and built separately; nothing for sequels is built here.

## Non-goals
- Editing genres in bulk, or importing genres from YouTube.
- Server-side search or filtering.

## Acceptance
- **Channel page:** clicking a channel opens its page with series and movies in grids.
- **Hero:** 4 slides (2 + 2 when available) change every 10 s whatever the mouse or keyboard is
  doing, the arrows work and restart the count, and the dots only show the position.
- **Grid view:** the toggle switches every Home row between carousel and grid, and the choice is remembered.
- **Recommended:** matches share a genre or the channel, never include the title itself, and the
  section is hidden when there are none.
- **Filters:** on Series and Movies, genre and channel filter a grid, they combine, they live in the
  URL, and "All/All" shows today's page.
- **Layout:** works at phone width with no sideways page scroll.
- **Checks:** typecheck and build pass, and everything is checked in the browser on a copy of the
  library. One independent review approves.
