# SeaDub

SeaDub is a small, stable English-dub anime schedule feed intended for Seanime extensions and other clients that only need clean AniList IDs, episode numbers, and release times.

## Endpoints

- `raw/dub-schedule.json` — current/upcoming dubbed episodes
- `raw/dub-episode-feed.json` — recent dubbed episode history (180 days)
- `raw/health.json` — update status and item counts
- `Manifest.json` — feed metadata and schema version

Raw URLs:

```text
https://raw.githubusercontent.com/DefnoJae/SeaDub/main/raw/dub-schedule.json
https://raw.githubusercontent.com/DefnoJae/SeaDub/main/raw/dub-episode-feed.json
https://raw.githubusercontent.com/DefnoJae/SeaDub/main/raw/health.json
```

## Schedule schema

```json
{
  "mediaId": 178789,
  "idMal": 56789,
  "title": "Example Anime",
  "episodeNumber": 13,
  "episodeDate": "2026-10-04T15:00:00Z",
  "format": "TV",
  "image": "https://...",
  "delayed": false,
  "delayedText": null,
  "verified": true,
  "source": "RockinChaos/AniSchedule"
}
```

## Custom corrections

Add manual entries to `custom/custom-dubs.json`. A custom entry replaces an automatically fetched entry when both use the same `mediaId` and `episodeNumber`.

## Updating

GitHub Actions runs `src/update.mjs` every 30 minutes and commits only when generated data changes.

### Bootstrap source

SeaDub v1 currently normalizes the maintained public JSON from `RockinChaos/AniSchedule`. The fetch layer is intentionally isolated in `src/update.mjs` so we can replace it later with our own independent collector without changing the SeaDub public endpoint/schema.

## Safety checks

The updater refuses to overwrite healthy data if the source unexpectedly returns fewer than 5 schedule rows or 50 feed rows.
