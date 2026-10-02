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
