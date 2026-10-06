import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "raw");
const CUSTOM_FILE = path.join(ROOT, "custom", "custom-dubs.json");

const SCHEDULE_URL =
  process.env.SEADUB_SCHEDULE_SOURCE ||
  "https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/dub-schedule.json";

const FEED_URL =
  process.env.SEADUB_FEED_SOURCE ||
  "https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/dub-episode-feed.json";

const HISTORY_DAYS = Number(process.env.SEADUB_HISTORY_DAYS || 180);
const FUTURE_DAYS = Number(process.env.SEADUB_FUTURE_DAYS || 90);
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SCHEDULE_ROWS = 5;
const MIN_FEED_ROWS = 50;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "SeaDub/1.1" }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return response.json();
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function itemKey(item) {
  return `${item.mediaId}-${item.episodeNumber}`;
}

function normalizeSchedule(item) {
  const media = item?.media?.media || {};
  const total = Number(item?.episodes || media?.episodes || 0);

  const releaseTime = item?.episodeDate;
  const sameTimeEpisodes = (media?.airingSchedule?.nodes || [])
    .filter((node) => node?.airingAt === releaseTime)
    .map((node) => Number(node?.episode))
    .filter((episode) => Number.isFinite(episode) && episode > 0)
    .sort((a, b) => a - b);

  const uniqueEpisodes = [...new Set(sameTimeEpisodes)];
  const hasConsecutiveBatch =
    uniqueEpisodes.length > 1 &&
    uniqueEpisodes.every(
      (episode, index) =>
        index === 0 || episode === uniqueEpisodes[index - 1] + 1
    );

  const batchStartEpisode =
    hasConsecutiveBatch ? uniqueEpisodes[0] : null;
  const batchEndEpisode =
    hasConsecutiveBatch ? uniqueEpisodes[uniqueEpisodes.length - 1] : null;

  return {
    mediaId: Number(media.id),
    idMal: media.idMal == null ? null : Number(media.idMal),
    title:
      media?.title?.userPreferred ||
      media?.title?.english ||
      media?.title?.romaji ||
      item?.title ||
      "Unknown",
    episodeNumber: Number(item?.episodeNumber),
    episodeDate: item?.episodeDate,
    totalEpisodes: Number.isFinite(total) && total > 0 ? total : null,
    format: media?.format || null,
    image: media?.coverImage?.large || media?.coverImage?.medium || null,
    delayed: Boolean(item?.delayedIndefinitely),
    delayedIndefinitely: Boolean(item?.delayedIndefinitely),
    delayedText: item?.delayedText || null,
    verified: item?.verified !== false,
    dateType: "confirmed",
    projected: false,
    batchRelease: hasConsecutiveBatch,
    batchStartEpisode,
    batchEndEpisode,
    episodeRangeLabel:
      hasConsecutiveBatch
        ? `${batchStartEpisode}–${batchEndEpisode}`
        : null,
    source: "RockinChaos/AniSchedule"
  };
}

function normalizeFeed(item) {
  return {
    mediaId: Number(item?.id),
    idMal: item?.idMal == null ? null : Number(item.idMal),
    title: null,
    format: item?.format || null,
    duration: item?.duration == null ? null : Number(item.duration),
    episodeNumber: Number(item?.episode?.aired),
    episodeDate: item?.episode?.airedAt,
    addedAt: item?.episode?.addedAt || null,
    dateType: "historical",
    projected: false,
    source: "RockinChaos/AniSchedule"
  };
}

function normalizeCustom(item) {
  const total = Number(item?.totalEpisodes || item?.episodes || 0);

  return {
    mediaId: Number(item.mediaId),
    idMal: item.idMal == null ? null : Number(item.idMal),
    title: item.title || "Unknown",
    episodeNumber: Number(item.episodeNumber),
    episodeDate: item.episodeDate,
    totalEpisodes: Number.isFinite(total) && total > 0 ? total : null,
    format: item.format || null,
    image: item.image || null,
    delayed: Boolean(item.delayed),
    delayedIndefinitely: Boolean(item.delayedIndefinitely),
    delayedText: item.delayedText || null,
    verified: item.verified !== false,
    dateType: item.dateType || "confirmed",
    projected: item.dateType === "projected" || Boolean(item.projected),
    batchRelease: Boolean(item.batchRelease),
    batchStartEpisode: item.batchStartEpisode == null ? null : Number(item.batchStartEpisode),
    batchEndEpisode: item.batchEndEpisode == null ? null : Number(item.batchEndEpisode),
    episodeRangeLabel: item.episodeRangeLabel || null,
    source: "SeaDub/custom"
  };
}

function isValidScheduleItem(item) {
  return (
    Number.isFinite(item.mediaId) &&
    Number.isFinite(item.episodeNumber) &&
    item.episodeNumber > 0 &&
    validDate(item.episodeDate)
  );
}

async function loadCustomDubs() {
  try {
    const parsed = JSON.parse(await readFile(CUSTOM_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readExistingJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function expandBatchRows(rows) {
  const expanded = [];

  for (const row of rows) {
    const start = Number(row?.batchStartEpisode);
    const end = Number(row?.batchEndEpisode);

    if (
      row?.batchRelease &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start > 0 &&
      end >= start
    ) {
      for (let episode = start; episode <= end; episode++) {
        expanded.push({
          ...row,
          episodeNumber: episode,
          batchMember: true
        });
      }
      continue;
    }

    expanded.push(row);
  }

  return expanded;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const [sourceSchedule, sourceFeed, customRaw] = await Promise.all([
    fetchJson(SCHEDULE_URL),
    fetchJson(FEED_URL),
    loadCustomDubs()
  ]);

  if (!Array.isArray(sourceSchedule) || sourceSchedule.length < MIN_SCHEDULE_ROWS) {
    throw new Error(
      `Source schedule failed safety check: expected at least ${MIN_SCHEDULE_ROWS} rows, got ${Array.isArray(sourceSchedule) ? sourceSchedule.length : "non-array"}`
    );
  }

  if (!Array.isArray(sourceFeed) || sourceFeed.length < MIN_FEED_ROWS) {
    throw new Error(
      `Source feed failed safety check: expected at least ${MIN_FEED_ROWS} rows, got ${Array.isArray(sourceFeed) ? sourceFeed.length : "non-array"}`
    );
  }

  const now = Date.now();
  const confirmedRows = sourceSchedule
    .map(normalizeSchedule)
    .filter(isValidScheduleItem);

  const historicalMediaIds = new Set(
    sourceFeed
      .map(normalizeFeed)
      .filter((row) => Number.isFinite(row.mediaId))
      .map((row) => row.mediaId)
  );

  for (const row of confirmedRows) {
    const isLikelyFullBatch =
      row.format === "ONA" &&
      row.totalEpisodes &&
      row.totalEpisodes > 1 &&
      row.episodeNumber === row.totalEpisodes &&
      !historicalMediaIds.has(row.mediaId);

    if (isLikelyFullBatch && !row.batchRelease) {
      row.batchRelease = true;
      row.batchStartEpisode = 1;
      row.batchEndEpisode = row.totalEpisodes;
      row.episodeRangeLabel = `1–${row.totalEpisodes}`;
    }
  }

  const scheduleMap = new Map();
  const expandedConfirmedRows = expandBatchRows(confirmedRows);

  for (const row of expandedConfirmedRows) {
    scheduleMap.set(itemKey(row), row);
  }

  // AniSchedule's current feed normally contains only the current/next dub
  // episode for each active title. Fill later calendar weeks conservatively
  // by projecting weekly releases only for verified, non-delayed titles with
  // a known total episode count. Confirmed/custom rows always override these.
  for (const row of confirmedRows) {
    const baseMs = Date.parse(row.episodeDate);

    if (!row.verified) continue;
    if (row.delayedIndefinitely) continue;
    if (row.format === "MOVIE") continue;
    if (!row.totalEpisodes || row.totalEpisodes <= row.episodeNumber) continue;
    if (baseMs < now - 21 * DAY_MS || baseMs > now + 45 * DAY_MS) continue;

    const maxEpisode = Math.min(row.totalEpisodes, row.episodeNumber + 26);

    for (let ep = row.episodeNumber + 1; ep <= maxEpisode; ep++) {
      const projectedMs = baseMs + (ep - row.episodeNumber) * 7 * DAY_MS;

      if (projectedMs > now + FUTURE_DAYS * DAY_MS) break;

      const projected = {
        ...row,
        episodeNumber: ep,
        episodeDate: new Date(projectedMs).toISOString(),
        delayed: false,
        delayedIndefinitely: false,
        delayedText: null,
        dateType: "projected",
        projected: true,
        projectionBaseEpisode: row.episodeNumber,
        projectionBaseDate: row.episodeDate,
        source: "SeaDub/projection"
      };

      if (!scheduleMap.has(itemKey(projected))) {
        scheduleMap.set(itemKey(projected), projected);
      }
    }
  }

  // Manual corrections always win.
  for (const row of customRaw.map(normalizeCustom).filter(isValidScheduleItem)) {
    scheduleMap.set(itemKey(row), row);
  }

  const schedule = [...scheduleMap.values()].sort(
    (a, b) => Date.parse(a.episodeDate) - Date.parse(b.episodeDate)
  );

  const cutoff = now - HISTORY_DAYS * DAY_MS;
  const feedMap = new Map();

  for (const row of sourceFeed.map(normalizeFeed)) {
    if (
      Number.isFinite(row.mediaId) &&
      Number.isFinite(row.episodeNumber) &&
      row.episodeNumber > 0 &&
      validDate(row.episodeDate) &&
      Date.parse(row.episodeDate) >= cutoff
    ) {
      feedMap.set(itemKey(row), row);
    }
  }

  for (const row of customRaw.map(normalizeCustom).filter(isValidScheduleItem)) {
    const ms = Date.parse(row.episodeDate);

    if (ms <= now && ms >= cutoff) {
      feedMap.set(itemKey(row), {
        mediaId: row.mediaId,
        idMal: row.idMal,
        title: row.title,
        format: row.format,
        duration: null,
        episodeNumber: row.episodeNumber,
        episodeDate: row.episodeDate,
        addedAt: null,
        dateType: "historical",
        projected: false,
        batchRelease: Boolean(row.batchRelease),
        batchStartEpisode: row.batchStartEpisode ?? null,
        batchEndEpisode: row.batchEndEpisode ?? null,
        episodeRangeLabel: row.episodeRangeLabel || null,
        source: "SeaDub/custom"
      });
    }
  }

  const feed = [...feedMap.values()].sort(
    (a, b) => Date.parse(a.episodeDate) - Date.parse(b.episodeDate)
  );

  if (schedule.length < MIN_SCHEDULE_ROWS || feed.length < MIN_FEED_ROWS) {
    throw new Error(
      `Generated data failed safety check: schedule=${schedule.length}, feed=${feed.length}`
    );
  }

  const calendarMap = new Map();

  for (const row of feed) {
    calendarMap.set(itemKey(row), row);
  }

  // Schedule/current data overrides history for the same episode.
  for (const row of schedule) {
    calendarMap.set(itemKey(row), row);
  }

  const calendar = [...calendarMap.values()]
    .filter((row) => {
      const ms = Date.parse(row.episodeDate);
      return ms >= cutoff && ms <= now + FUTURE_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(a.episodeDate) - Date.parse(b.episodeDate));

  const projectedCount = schedule.filter((row) => row.projected).length;
  const confirmedCount = schedule.length - projectedCount;

  const schedulePath = path.join(RAW_DIR, "dub-schedule.json");
  const feedPath = path.join(RAW_DIR, "dub-episode-feed.json");
  const calendarPath = path.join(RAW_DIR, "calendar.json");
  const healthPath = path.join(RAW_DIR, "health.json");

  const [existingSchedule, existingFeed, existingCalendar] = await Promise.all([
    readExistingJson(schedulePath),
    readExistingJson(feedPath),
    readExistingJson(calendarPath)
  ]);

  const scheduleChanged =
    JSON.stringify(existingSchedule) !== JSON.stringify(schedule);
  const feedChanged =
    JSON.stringify(existingFeed) !== JSON.stringify(feed);
  const calendarChanged =
    JSON.stringify(existingCalendar) !== JSON.stringify(calendar);

  if (!scheduleChanged && !feedChanged && !calendarChanged) {
    console.log(
      `SeaDub checked successfully: no data changes (${confirmedCount} confirmed, ${projectedCount} projected, ${feed.length} history)`
    );
    return;
  }

  const health = {
    status: "ok",
    updatedAt: new Date().toISOString(),
    scheduleItems: schedule.length,
    confirmedScheduleItems: confirmedCount,
    projectedScheduleItems: projectedCount,
    feedItems: feed.length,
    calendarItems: calendar.length,
    historyDays: HISTORY_DAYS,
    futureDays: FUTURE_DAYS,
    source: "RockinChaos/AniSchedule",
    schemaVersion: 2
  };

  await Promise.all([
    writeFile(schedulePath, JSON.stringify(schedule, null, 2) + "\n"),
    writeFile(feedPath, JSON.stringify(feed, null, 2) + "\n"),
    writeFile(calendarPath, JSON.stringify(calendar, null, 2) + "\n"),
    writeFile(healthPath, JSON.stringify(health, null, 2) + "\n")
  ]);

  console.log(
    `SeaDub updated: ${confirmedCount} confirmed + ${projectedCount} projected schedule entries, ${feed.length} history entries, ${calendar.length} calendar rows`
  );
}

main().catch((error) => {
  console.error("SeaDub update failed:", error);
  process.exit(1);
});
