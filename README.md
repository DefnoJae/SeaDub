# SeaDub

SeaDub is a stable English-dub anime schedule feed and Seanime plugin.

## Seanime install

Use this manifest URL:

```text
https://raw.githubusercontent.com/DefnoJae/SeaDub/refs/heads/main/Manifest.json
```

## Feed endpoints

- `raw/calendar.json` — optimized combined calendar feed used by the Seanime plugin
- `raw/dub-schedule.json` — confirmed/current rows plus conservative future projections
- `raw/dub-episode-feed.json` — recent dubbed episode history
- `raw/health.json` — update status and item counts
- `feed-manifest.json` — feed metadata/schema

Raw calendar URL:

```text
https://raw.githubusercontent.com/DefnoJae/SeaDub/main/raw/calendar.json
```

## Confirmed vs projected dates

The upstream timetable normally exposes only the current/next dubbed episode for an active series. SeaDub keeps that row as `dateType: "confirmed"`.

To keep later calendar weeks useful, SeaDub adds `dateType: "projected"` rows only when all of these are true:

- the source entry is verified;
- it is not indefinitely delayed;
- the total episode count is known;
- the series is still airing;
- the anchor release is current/recent.

Projected episodes use a seven-day cadence and stop at the known season finale or the 90-day future horizon. A confirmed or custom row always replaces a projection with the same `mediaId + episodeNumber`.

## Custom corrections

Add manual entries to `custom/custom-dubs.json`. A custom entry overrides automatic/projected data when both use the same `mediaId` and `episodeNumber`.

## Updating

GitHub Actions runs `src/update.mjs` every 30 minutes and commits only when generated data changes.

## Bootstrap source

SeaDub currently normalizes the maintained public dub data from `RockinChaos/AniSchedule`. The public SeaDub schema is isolated from that source so the collector can be replaced later without breaking Seanime clients.

## Safety

The updater refuses to overwrite healthy data when the source unexpectedly returns too few schedule/feed rows.


## Search

SeaDub's tray includes a case-insensitive title search. It works together with **All**, **Prefer Dubs**, **Dubs Only**, and **Subs Only**. The query is debounced before Seanime's schedule cache is rebuilt, so typing a title does not trigger a refresh for every individual keystroke. Use **Clear** to return to the full calendar.


## Control Center redesign

SeaDub 1.3 introduces a redesigned tray control center with a wider glass-style dashboard, quick schedule statistics, segmented schedule/label controls, title search, upcoming dub highlights, and the existing refresh controls. The schedule feed, filtering rules, projection behavior, search behavior, and cache logic remain unchanged.


## Daily highlights

With an empty search box, the SeaDub tray shows every scheduled episode for the current day. When a title search is active, Highlights switches to the complete upcoming episode list matching that anime. Both lists follow the selected schedule mode: Dubs Only shows dubs, Subs Only shows subs, All keeps both, and Prefer Dubs replaces sub rows only when a dub of the same anime and episode exists in the list. A newer sub episode and an earlier dub episode remain separate, with their own badges and release dates.

SeaDub 1.4 also uses the calendar artwork in `assets/seadub.png` for the collapsed tray, pop-out header, and extension icon.

SeaDub 1.4.1 installs the supplied calendar artwork, refreshes its icon URL, and aligns the search and footer Clear buttons. Daily highlights use local calendar-day boundaries, including daylight-saving transitions.

Run `npm test` to check daily highlights, complete upcoming search results, clearing search, and shared icon references.

SeaDub 1.4.2 applies schedule modes to daily highlights and search results. The shared icon uses `assets/seadub-calendar.png` without a query suffix so Seanime accepts it on the extension page and collapsed tray.

SeaDub 1.4.3 clears the search field's visible text through Seanime's field-reference API when either Clear button is used.

SeaDub 1.4.4 marks known season finales with a “⚑ Final episode” badge in pop-out search results, for both sub and dub releases. The last available row is not marked unless it is the actual final episode. Projected finale dates retain their projected-release label.

SeaDub 1.5.0 automatically fills the search with the current anime's title when opened from its detail page. Upcoming results match that anime by ID and follow the selected sub/dub mode, even when release titles differ. You can edit or clear the search as usual. Opening SeaDub from other pages preserves your current search.
