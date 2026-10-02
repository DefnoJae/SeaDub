function init() {
    // Inject SeaDub entries into Seanime's schedule response.
    $app.onAnimeScheduleItems((e) => {
        try {
            const dubFormat = $store.get("seadub-format") || "icon";
            let dubPrefix = "🎙️Dub - ";

            if (dubFormat === "bracket") {
                dubPrefix = "[DUB] ";
            } else if (dubFormat === "icon-only") {
                dubPrefix = "🎙️ - ";
            }

            const prefixes = ["🎙️Dub - ", "🎙️ - ", "[DUB] "];

            // Remove previously injected SeaDub rows before rebuilding.
            const subItems = (e.items || []).filter((item) => {
                const title = item?.title || "";
                return !prefixes.some((prefix) => title.startsWith(prefix));
            });

            const filter = $store.get("seadub-filter") || "all";
            const rawDubItems = $store.get("seadub-items") || [];

            const dubItems = rawDubItems.map((item) => ({
                ...item,
                title: `${dubPrefix}${item.title}`,
            }));

            if (filter === "dub") {
                e.items = dubItems;
            } else if (filter === "sub") {
                e.items = subItems;
            } else if (filter === "prefer-dub") {
                const merged = new Map();

                for (const item of subItems) {
                    merged.set(`${item.mediaId}-${item.episodeNumber}`, item);
                }

                for (const item of dubItems) {
                    // Dub replaces sub when both represent the same media + episode.
                    merged.set(`${item.mediaId}-${item.episodeNumber}`, item);
                }

                e.items = Array.from(merged.values());
            } else {
                // Keep subs and dubs side by side.
                const merged = new Map();

                for (const item of subItems) {
                    merged.set(`${item.mediaId}-${item.episodeNumber}-sub`, item);
                }

                for (const item of dubItems) {
                    merged.set(`${item.mediaId}-${item.episodeNumber}-dub`, item);
                }

                e.items = Array.from(merged.values());
            }

            e.items?.sort((a, b) => {
                const aTime = a?.dateTime ? new Date(a.dateTime).getTime() : 0;
                const bTime = b?.dateTime ? new Date(b.dateTime).getTime() : 0;
                return aTime - bTime;
            });
        } catch (error) {
            console.error("SeaDub: schedule hook error", error);
        } finally {
            e.next();
        }
    });

    $ui.register(async (ctx) => {
        // IMPORTANT: Seanime evaluates the UI callback in its own runtime.
        // Values declared outside $ui.register are not captured reliably,
        // so keep all UI-only constants/helpers inside this callback.
        const SCHEDULE_QUERY_KEY = "ANIME-COLLECTION-get-anime-collection-schedule";
        const SCHEDULE_URL = "https://raw.githubusercontent.com/DefnoJae/SeaDub/refs/heads/main/raw/dub-schedule.json";
        const FEED_URL = "https://raw.githubusercontent.com/DefnoJae/SeaDub/refs/heads/main/raw/dub-episode-feed.json";

        const invalidateSchedule = () => {
            try {
                $app.invalidateClientQuery([SCHEDULE_QUERY_KEY]);
            } catch (error) {
                console.error("SeaDub: failed to invalidate schedule query", error);
            }
        };

        const savedFilter = $storage.get("seadub-filter") || "all";
        const filterState = ctx.state(savedFilter);
        $store.set("seadub-filter", savedFilter);

        const savedFormat = $storage.get("seadub-format") || "icon";
        const formatState = ctx.state(savedFormat);
        $store.set("seadub-format", savedFormat);

        const cachedItems = $storage.get("seadub-items") || [];
        if (cachedItems.length > 0) {
            $store.set("seadub-items", cachedItems);
            invalidateSchedule();
        }

        const tray = ctx.newTray({
            tooltipText: "SeaDub Schedule",
            withContent: true,
        });

        ctx.registerEventHandler("seadub-filter-all", () => filterState.set("all"));
        ctx.registerEventHandler("seadub-filter-dub", () => filterState.set("dub"));
        ctx.registerEventHandler("seadub-filter-sub", () => filterState.set("sub"));
        ctx.registerEventHandler("seadub-filter-prefer", () => filterState.set("prefer-dub"));

        ctx.registerEventHandler("seadub-format-icon", () => formatState.set("icon"));
        ctx.registerEventHandler("seadub-format-icon-only", () => formatState.set("icon-only"));
        ctx.registerEventHandler("seadub-format-bracket", () => formatState.set("bracket"));

        let retryCount = 0;
        const MAX_RETRIES = 5;

        const loadSeaDub = async (showToast = false) => {
            try {
                console.log("SeaDub: fetching schedule data");

                const [scheduleResponse, feedResponse] = await Promise.all([
                    ctx.fetch(SCHEDULE_URL),
                    ctx.fetch(FEED_URL),
                ]);

                if (!scheduleResponse.ok || !feedResponse.ok) {
                    throw new Error(
                        `SeaDub HTTP failure: schedule=${scheduleResponse.status}, feed=${feedResponse.status}`,
                    );
                }

                const currentSchedule = scheduleResponse.json();
                const historyFeed = feedResponse.json();

                if (!Array.isArray(currentSchedule) || !Array.isArray(historyFeed)) {
                    throw new Error("SeaDub returned invalid JSON");
                }

                let collection = null;

                try {
                    collection = await $anilist.getAnimeCollection(false);
                } catch (error) {
                    console.error("SeaDub: cached AniList collection unavailable", error);
                }

                if (!collection) {
                    try {
                        collection = await $anilist.getAnimeCollection(true);
                    } catch (error) {
                        console.error("SeaDub: fresh AniList collection unavailable", error);
                    }
                }

                if (!collection?.MediaListCollection?.lists) {
                    throw new Error("AniList collection unavailable");
                }

                const mediaMap = new Map();

                for (const list of collection.MediaListCollection.lists || []) {
                    for (const entry of list?.entries || []) {
                        if (!entry?.media?.id || entry?.status === "DROPPED") continue;
                        mediaMap.set(Number(entry.media.id), entry.media);
                    }
                }

                const byEpisode = new Map();

                const addItem = (row) => {
                    const mediaId = Number(row?.mediaId);
                    const episodeNumber = Number(row?.episodeNumber);

                    if (
                        !Number.isFinite(mediaId) ||
                        !Number.isFinite(episodeNumber) ||
                        episodeNumber <= 0 ||
                        !row?.episodeDate
                    ) {
                        return;
                    }

                    const media = mediaMap.get(mediaId);
                    if (!media) return;

                    const date = new Date(row.episodeDate);
                    if (Number.isNaN(date.getTime())) return;

                    const totalEpisodes = Number(media?.episodes || 0);

                    byEpisode.set(`${mediaId}-${episodeNumber}`, {
                        mediaId,
                        title:
                            row?.title ||
                            media?.title?.userPreferred ||
                            media?.title?.english ||
                            media?.title?.romaji ||
                            "Unknown",
                        time: `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`,
                        dateTime: date.toISOString(),
                        image:
                            row?.image ||
                            media?.coverImage?.large ||
                            media?.coverImage?.medium ||
                            "",
                        episodeNumber,
                        isMovie: media?.format === "MOVIE",
                        isSeasonFinale:
                            totalEpisodes > 0 && episodeNumber === totalEpisodes,
                    });
                };

                // Historical feed first, current schedule second so current corrections win.
                for (const row of historyFeed) addItem(row);
                for (const row of currentSchedule) addItem(row);

                const items = Array.from(byEpisode.values()).sort(
                    (a, b) =>
                        new Date(a.dateTime).getTime() -
                        new Date(b.dateTime).getTime(),
                );

                $store.set("seadub-items", items);
                $storage.set("seadub-items", items);

                retryCount = 0;
                invalidateSchedule();

                console.log(
                    `SeaDub: loaded ${items.length} matching calendar entries from ${currentSchedule.length} current + ${historyFeed.length} historical rows`,
                );

                if (showToast) {
                    ctx.toast.info(`SeaDub loaded ${items.length} calendar entries.`);
                }
            } catch (error) {
                console.error("SeaDub: load failed", error);

                if (retryCount < MAX_RETRIES) {
                    retryCount += 1;
                    const delay = retryCount * 5000;
                    ctx.setTimeout(() => loadSeaDub(false), delay);
                } else if (showToast) {
                    ctx.toast.error("SeaDub could not load schedule data.");
                }
            }
        };

        ctx.registerEventHandler("seadub-refresh", async () => {
            retryCount = 0;
            ctx.toast.info("Refreshing SeaDub...");
            await loadSeaDub(true);
        });

        ctx.effect(() => {
            const value = filterState.get();
            $storage.set("seadub-filter", value);
            $store.set("seadub-filter", value);
            invalidateSchedule();
        }, [filterState]);

        ctx.effect(() => {
            const value = formatState.get();
            $storage.set("seadub-format", value);
            $store.set("seadub-format", value);
            invalidateSchedule();
        }, [formatState]);

        tray.render(() => {
            const currentFilter = filterState.get();
            const currentFormat = formatState.get();

            return tray.stack({
                gap: 2,
                items: [
                    tray.text("SeaDub Schedule"),
                    tray.button("All (Subs & Dubs)", {
                        intent: currentFilter === "all" ? "primary" : "gray-subtle",
                        onClick: "seadub-filter-all",
                    }),
                    tray.button("Prefer Dubs", {
                        intent: currentFilter === "prefer-dub" ? "primary" : "gray-subtle",
                        onClick: "seadub-filter-prefer",
                    }),
                    tray.button("Dubs Only", {
                        intent: currentFilter === "dub" ? "primary" : "gray-subtle",
                        onClick: "seadub-filter-dub",
                    }),
                    tray.button("Subs Only", {
                        intent: currentFilter === "sub" ? "primary" : "gray-subtle",
                        onClick: "seadub-filter-sub",
                    }),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor: "rgba(255,255,255,0.1)",
                            margin: "8px 0",
                        },
                    }),

                    tray.text("Dub Title Format"),
                    tray.flex({
                        gap: 2,
                        items: [
                            tray.button("🎙️Dub", {
                                intent: currentFormat === "icon" ? "primary" : "gray-subtle",
                                onClick: "seadub-format-icon",
                            }),
                            tray.button("🎙️", {
                                intent: currentFormat === "icon-only" ? "primary" : "gray-subtle",
                                onClick: "seadub-format-icon-only",
                            }),
                            tray.button("[DUB]", {
                                intent: currentFormat === "bracket" ? "primary" : "gray-subtle",
                                onClick: "seadub-format-bracket",
                            }),
                        ],
                    }),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor: "rgba(255,255,255,0.1)",
                            margin: "8px 0",
                        },
                    }),

                    tray.button("🔄 Refresh SeaDub", {
                        intent: "gray-subtle",
                        onClick: "seadub-refresh",
                    }),
                ],
            });
        });

        loadSeaDub(false);
        ctx.setInterval(() => loadSeaDub(false), 30 * 60 * 1000);
    });
}
