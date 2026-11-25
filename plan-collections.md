# youtube-flix — Movie Collections (Sequels)

STATUS: APPROVED (2026-11-25)

Connect movies that belong together, like *1 FOR ALL: THE EXORCISM OF NIXIE – Part 1* and *Part 2
(Finale)*, without turning them into a series. Each movie keeps its own card. The collection gives
them an order and a "next movie". The app also suggests collections it detects on its own.

## Decisions
| # | Topic | Proposal |
|---|---|---|
| 1 | Starting point | Built on top of the browsing work (`feat/browsing`), which should be committed and merged first, because both change the title detail and the Home rows |
| 2 | What can be in a collection | Movies only. Series already have seasons |
| 3 | How many collections per movie | One. The order is a position (1, 2, 3…) |
| 4 | Creating one | Two ways: (a) from a suggestion the app detected, with one click; (b) by hand, in a movie's **Edit** form ("Collection": none / an existing one / a new name, plus its position) |
| 5 | Detection | Only suggests, never groups on its own. See "Detection" below |
| 6 | When the last movie but one leaves | A collection with a single movie left is removed automatically |

## Data
- **New tables (additive):**
    - `collections`: id and name.
    - `collection_items`: collection, movie (title id, unique) and position.
- **Deletes:** deleting a movie removes it from its collection (cascade). Its files and the other movies
  are untouched.
- **API:** the title list and detail gain `collection: { id, name, position, size } | null`.
- **New routes:** list collections, create, rename, reorder, add or remove a movie, delete a
  collection, and list the suggestions. Adding and editing collections is household (like editing
  titles); deleting a whole collection is PC-only (like other deletes).

## What it looks like
- **Movie detail:**
    - Under the description: "Part of **Nixie** · 2 movies", with the movies in order, the current one
      marked and each linking to its own detail.
    - If there is a following movie, a **Next: Part 2** button beside Play.
- **Player:**
    - When the last part of a movie ends, "Next episode" becomes **Next movie** and opens the next movie
      in the collection.
    - The server's existing "next" logic already drives this, so "Continue watching" also moves on to
      Part 2 after Part 1 is finished.
- **Card:** a small "1/2" badge on cards of movies in a collection.
- **Home:** one row per collection, named after it, in order. It follows the same grid/carousel toggle.
- **Collection page:** `/collection/<id>`, with the name and the movies in order (a grid), reachable
  from the detail.

## Detection
The suggestions follow these rules:
- **Candidates:** movies only, not already in a collection.
- **Same channel:** the movies must come from the same channel.
- **Same name once the part marker is removed:** markers are `Part 1`/`Pt. 2`/`Parte 2`,
  `Chapter 2`/`Capítulo 2`, a trailing Roman numeral (`II`, `III`), or a trailing number (`2`). Text in
  brackets and words such as "(Finale)" are ignored. The comparison ignores case and accents.
- **Order:** by the detected number.
- **Proposed name:** the shared part of the titles, for example "1 FOR ALL: THE EXORCISM OF NIXIE".
- **Where it appears:**
    - in the detail of a detected movie: "These look like parts of one story. Create the collection
      **1 FOR ALL: THE EXORCISM OF NIXIE** with 2 movies?", with **Create** and **Not now**;
    - and as a short list on the Movies page.
- **Dismissing:** "Not now" hides that suggestion in this browser.

## Catalog export and import
- **Export:** collections travel in the portable catalog file. They hold no private data.
- **Replace:** imports them as they are.
- **Merge:** a collection is matched by name.
    - Its movies are matched the way titles already are (type and YouTube link).
    - Movies already in another collection on this PC stay where they are.
- **Cleaning step:** it keeps only collection rows whose movies exist, with sane positions.

## Non-goals
- Series in collections, collections of collections, and a movie in two collections.
- Automatic grouping without confirmation.
- Collection artwork. The first movie's thumbnail is used.

## Rollout / rollback
- **Schema:** additive only (two new tables). Older catalogs simply have no collections.
- **Rollback:** revert the commits. The two tables can stay; they are ignored without the code.

## Acceptance
- **Creating:** the two Nixie movies can be put in one collection, from the suggestion or by hand. Each
  keeps its own card with a "1/2" or "2/2" badge.
- **Detail:** shows the collection in order, and "Next: Part 2" on Part 1.
- **Player and Continue watching:** finishing Part 1 offers **Next movie**, and Continue watching moves
  on to Part 2.
- **Home and collection page:** Home shows a row for the collection, and its page lists the movies in
  order.
- **Detection:** it finds the Nixie pair in the real catalog, and suggests nothing for unrelated
  movies or movies from different channels.
- **Deleting:** removing a movie removes it from its collection, and a collection left with one movie
  disappears.
- **Transfer:** export and import (merge and replace) keep collections, and the cleaning step drops
  broken ones.
- **Access:** another device can view and edit collections but gets 403 on deleting one.
- **Checks:** server tests cover the data, the rules, detection and transfer. Checked in the browser on a
  copy of the library.
- **Review:** two independent lanes (correctness, data safety), both APPROVE.
