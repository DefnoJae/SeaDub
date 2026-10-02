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
const MIN_SCHEDULE_ROWS = 5;
const MIN_FEED_ROWS = 50;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SeaDub/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return response.json();
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeSchedule(item) {
  const media = item?.media?.media || {};

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
    format: media?.format || null,
    image: media?.coverImage?.large || media?.coverImage?.medium || null,
    delayed: Boolean(item?.delayedIndefinitely || item?.delayedText),
    delayedText: item?.delayedText || null,
    verified: item?.verified !== false,
    source: "RockinChaos/AniSchedule"
  };
}

function normalizeFeed(item) {
  return {
    mediaId: Number(item?.id),
    idMal: item?.idMal == null ? null : Number(item.idMal),
    format: item?.format || null,
    duration: item?.duration == null ? null : Number(item.duration),
    episodeNumber: Number(item?.episode?.aired),
    episodeDate: item?.episode?.airedAt,
    addedAt: item?.episode?.addedAt || null,
    source: "RockinChaos/AniSchedule"
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

function itemKey(item) {
  return `${item.mediaId}-${item.episodeNumber}`;
}

async function loadCustomDubs() {
  try {
    const parsed = JSON.parse(await readFile(CUSTOM_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCustom(item) {
  return {
    mediaId: Number(item.mediaId),
    idMal: item.idMal == null ? null : Number(item.idMal),
    title: item.title || "Unknown",
    episodeNumber: Number(item.episodeNumber),
    episodeDate: item.episodeDate,
    format: item.format || null,
    image: item.image || null,
    delayed: Boolean(item.delayed),
    delayedText: item.delayedText || null,
    verified: item.verified !== false,
    source: "SeaDub/custom"
  };
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

  const scheduleMap = new Map();

  for (const row of sourceSchedule.map(normalizeSchedule).filter(isValidScheduleItem)) {
    scheduleMap.set(itemKey(row), row);
  }

  for (const row of customRaw.map(normalizeCustom).filter(isValidScheduleItem)) {
    scheduleMap.set(itemKey(row), row);
  }

  const schedule = [...scheduleMap.values()].sort(
    (a, b) => Date.parse(a.episodeDate) - Date.parse(b.episodeDate)
  );

  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
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

  // Custom episodes that have already aired also become part of the history feed.
  for (const row of customRaw.map(normalizeCustom).filter(isValidScheduleItem)) {
    if (Date.parse(row.episodeDate) <= Date.now() && Date.parse(row.episodeDate) >= cutoff) {
      feedMap.set(itemKey(row), {
        mediaId: row.mediaId,
        idMal: row.idMal,
        format: row.format,
        duration: null,
        episodeNumber: row.episodeNumber,
        episodeDate: row.episodeDate,
        addedAt: null,
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

  const health = {
    status: "ok",
    updatedAt: new Date().toISOString(),
    scheduleItems: schedule.length,
    feedItems: feed.length,
    historyDays: HISTORY_DAYS,
    source: "RockinChaos/AniSchedule",
    schemaVersion: 1
  };

  await Promise.all([
    writeFile(
      path.join(RAW_DIR, "dub-schedule.json"),
      JSON.stringify(schedule, null, 2) + "\n"
    ),
    writeFile(
      path.join(RAW_DIR, "dub-episode-feed.json"),
      JSON.stringify(feed, null, 2) + "\n"
    ),
    writeFile(
      path.join(RAW_DIR, "health.json"),
      JSON.stringify(health, null, 2) + "\n"
    )
  ]);

  console.log(
    `SeaDub updated: ${schedule.length} schedule entries, ${feed.length} feed entries`
  );
}

main().catch((error) => {
  console.error("SeaDub update failed:", error);
  process.exit(1);
});
