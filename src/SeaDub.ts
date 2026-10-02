function init() {
    // SeaDub is applied after downstream schedule plugins for All/Sub/Prefer Dub.
    // Dubs Only can stop the downstream chain because no sub schedule rows are needed.
    $app.onAnimeScheduleItems((e) => {
        try {
            const filter = $store.get("seadub-filter") || "all";
            const dubFormat = $store.get("seadub-format") || "icon";
            const rawDubItems = $store.get("seadub-items") || [];

            let dubPrefix = "🎙️Dub - ";
            if (dubFormat === "bracket") {
                dubPrefix = "[DUB] ";
            } else if (dubFormat === "icon-only") {
                dubPrefix = "🎙️ - ";
            }

            const prefixes = ["🎙️Dub - ", "🎙️ - ", "[DUB] "];

            const dubItems = rawDubItems.map((item) => ({
                ...item,
                title: `${dubPrefix}${item.title}`,
            }));

            if (filter === "dub") {
                e.items = dubItems;

                e.items?.sort(
                    (a, b) =>
                        new Date(a.dateTime).getTime() -
                        new Date(b.dateTime).getTime(),
                );

                console.log(
                    `SeaDub: applied schedule filter=dub dubs=${dubItems.length} final=${e.items?.length || 0}`,
                );

                // Intentionally do not call e.next().
                // Dubs Only does not need rows from downstream schedule plugins.
                return;
            }

            // Let other schedule plugins finish before applying SeaDub's final filter.
            e.next();

            const subItems = (e.items || []).filter((item) => {
                const title = item?.title || "";
                return !prefixes.some((prefix) => title.startsWith(prefix));
            });

            if (filter === "sub") {
                e.items = subItems;
            } else if (filter === "prefer-dub") {
                const merged = new Map();

                for (const item of subItems) {
                    merged.set(
                        `${item.mediaId}-${item.episodeNumber}`,
                        item,
                    );
                }

                for (const item of dubItems) {
                    merged.set(
                        `${item.mediaId}-${item.episodeNumber}`,
                        item,
                    );
                }

                e.items = Array.from(merged.values());
            } else {
                const merged = new Map();

                for (const item of subItems) {
                    merged.set(
                        `${item.mediaId}-${item.episodeNumber}-sub`,
                        item,
                    );
                }

                for (const item of dubItems) {
                    merged.set(
                        `${item.mediaId}-${item.episodeNumber}-dub`,
                        item,
                    );
                }

                e.items = Array.from(merged.values());
            }

            e.items?.sort(
                (a, b) =>
                    new Date(a.dateTime).getTime() -
                    new Date(b.dateTime).getTime(),
            );

            console.log(
                `SeaDub: applied schedule filter=${filter} dubs=${dubItems.length} subs=${subItems.length} final=${e.items?.length || 0}`,
            );
        } catch (error) {
            console.error("SeaDub: schedule hook error", error);

            try {
                e.next();
            } catch (_) {}
        }
    });

    $ui.register(async (ctx) => {
        const SCHEDULE_QUERY_KEY =
            "ANIME-COLLECTION-get-anime-collection-schedule";

        const CALENDAR_URL =
            "https://raw.githubusercontent.com/DefnoJae/SeaDub/refs/heads/main/raw/calendar.json";

        const invalidateSchedule = () => {
            try {
                $app.invalidateClientQuery([
                    SCHEDULE_QUERY_KEY,
                ]);
            } catch (error) {
                console.error(
                    "SeaDub: failed to invalidate schedule query",
                    error,
                );
            }
        };

        const savedFilter =
            $storage.get("seadub-filter") || "all";

        const filterState =
            ctx.state(savedFilter);

        $store.set(
            "seadub-filter",
            savedFilter,
        );

        const savedFormat =
            $storage.get("seadub-format") || "icon";

        const formatState =
            ctx.state(savedFormat);

        $store.set(
            "seadub-format",
            savedFormat,
        );

        const cachedItems =
            $storage.get("seadub-items") || [];

        if (cachedItems.length > 0) {
            $store.set(
                "seadub-items",
                cachedItems,
            );
        }

        const tray = ctx.newTray({
            tooltipText: "SeaDub Schedule",
            withContent: true,
        });

        let pendingRebuildCancel = null;
        let rebuildInFlight = false;
        let rebuildQueued = false;

        const rebuildScheduleCache =
            async (showToast = false) => {
                if (rebuildInFlight) {
                    rebuildQueued = true;
                    return;
                }

                rebuildInFlight = true;

                try {
                    console.log(
                        "SeaDub: clearing Seanime schedule cache",
                    );

                    // Seanime exposes a dedicated schedule-cache API to plugins.
                    // This avoids refreshing the entire AniList collection just
                    // to make a SeaDub filter/format change take effect.
                    ctx.anime.clearScheduleCache();

                    // Ask the React client to refetch /library/schedule.
                    // The AniList collection and platform caches remain intact,
                    // so this should normally complete almost immediately.
                    invalidateSchedule();

                    if (showToast) {
                        ctx.toast.info(
                            "SeaDub calendar updated.",
                        );
                    }
                } catch (error) {
                    console.error(
                        "SeaDub: schedule cache clear failed",
                        error,
                    );

                    invalidateSchedule();
                } finally {
                    rebuildInFlight = false;

                    if (rebuildQueued) {
                        rebuildQueued = false;
                        queueScheduleRebuild(false);
                    }
                }
            };

        const queueScheduleRebuild =
            (showToast = false) => {
                if (pendingRebuildCancel) {
                    pendingRebuildCancel();
                    pendingRebuildCancel = null;
                }

                pendingRebuildCancel =
                    ctx.setTimeout(() => {
                        pendingRebuildCancel = null;
                        rebuildScheduleCache(showToast);
                    }, 350);
            };

        const setFilter = (value) => {
            if (filterState.get() === value) {
                return;
            }

            filterState.set(value);
            $storage.set("seadub-filter", value);
            $store.set("seadub-filter", value);

            queueScheduleRebuild(false);
        };

        const setFormat = (value) => {
            if (formatState.get() === value) {
                return;
            }

            formatState.set(value);
            $storage.set("seadub-format", value);
            $store.set("seadub-format", value);

            queueScheduleRebuild(false);
        };

        ctx.registerEventHandler(
            "seadub-filter-all",
            () => setFilter("all"),
        );

        ctx.registerEventHandler(
            "seadub-filter-dub",
            () => setFilter("dub"),
        );

        ctx.registerEventHandler(
            "seadub-filter-sub",
            () => setFilter("sub"),
        );

        ctx.registerEventHandler(
            "seadub-filter-prefer",
            () => setFilter("prefer-dub"),
        );

        ctx.registerEventHandler(
            "seadub-format-icon",
            () => setFormat("icon"),
        );

        ctx.registerEventHandler(
            "seadub-format-icon-only",
            () => setFormat("icon-only"),
        );

        ctx.registerEventHandler(
            "seadub-format-bracket",
            () => setFormat("bracket"),
        );

        let retryCount = 0;
        const MAX_RETRIES = 4;

        const makeSignature = (items) => {
            if (!Array.isArray(items) || items.length === 0) {
                return "0";
            }

            const first = items[0];
            const last = items[items.length - 1];

            return [
                items.length,
                first?.mediaId,
                first?.episodeNumber,
                first?.dateTime,
                last?.mediaId,
                last?.episodeNumber,
                last?.dateTime,
            ].join("|");
        };

        const loadSeaDub =
            async (
                showToast = false,
                rebuildIfChanged = false,
            ) => {
                try {
                    console.log(
                        "SeaDub: fetching optimized calendar feed",
                    );

                    const response =
                        await ctx.fetch(
                            CALENDAR_URL,
                        );

                    if (!response.ok) {
                        throw new Error(
                            `SeaDub HTTP failure: ${response.status}`,
                        );
                    }

                    const calendar =
                        response.json();

                    if (!Array.isArray(calendar)) {
                        throw new Error(
                            "SeaDub calendar response was not an array",
                        );
                    }

                    let collection =
                        null;

                    try {
                        collection =
                            await $anilist.getAnimeCollection(
                                false,
                            );
                    } catch (error) {
                        console.error(
                            "SeaDub: cached AniList collection unavailable",
                            error,
                        );
                    }

                    if (!collection) {
                        collection =
                            await $anilist.getAnimeCollection(
                                true,
                            );
                    }

                    if (
                        !collection
                            ?.MediaListCollection
                            ?.lists
                    ) {
                        throw new Error(
                            "AniList collection unavailable",
                        );
                    }

                    const mediaMap =
                        new Map();

                    for (
                        const list of
                        collection
                            .MediaListCollection
                            .lists || []
                    ) {
                        for (
                            const entry of
                            list?.entries || []
                        ) {
                            if (
                                !entry?.media?.id ||
                                entry?.status ===
                                    "DROPPED"
                            ) {
                                continue;
                            }

                            mediaMap.set(
                                Number(
                                    entry.media.id,
                                ),
                                entry.media,
                            );
                        }
                    }

                    const byEpisode =
                        new Map();

                    for (
                        const row of calendar
                    ) {
                        const mediaId =
                            Number(
                                row?.mediaId,
                            );

                        const episodeNumber =
                            Number(
                                row?.episodeNumber,
                            );

                        if (
                            !Number.isFinite(
                                mediaId,
                            ) ||
                            !Number.isFinite(
                                episodeNumber,
                            ) ||
                            episodeNumber <= 0 ||
                            !row?.episodeDate
                        ) {
                            continue;
                        }

                        const media =
                            mediaMap.get(
                                mediaId,
                            );

                        if (!media) {
                            continue;
                        }

                        const date =
                            new Date(
                                row.episodeDate,
                            );

                        if (
                            Number.isNaN(
                                date.getTime(),
                            )
                        ) {
                            continue;
                        }

                        const totalEpisodes =
                            Number(
                                row
                                    ?.totalEpisodes ||
                                    media
                                        ?.episodes ||
                                    0,
                            );

                        byEpisode.set(
                            `${mediaId}-${episodeNumber}`,
                            {
                                mediaId,

                                title:
                                    row?.title ||
                                    media
                                        ?.title
                                        ?.userPreferred ||
                                    media
                                        ?.title
                                        ?.english ||
                                    media
                                        ?.title
                                        ?.romaji ||
                                    "Unknown",

                                time:
                                    `${String(
                                        date.getUTCHours(),
                                    ).padStart(
                                        2,
                                        "0",
                                    )}:${String(
                                        date.getUTCMinutes(),
                                    ).padStart(
                                        2,
                                        "0",
                                    )}`,

                                dateTime:
                                    date.toISOString(),

                                image:
                                    row?.image ||
                                    media
                                        ?.coverImage
                                        ?.large ||
                                    media
                                        ?.coverImage
                                        ?.medium ||
                                    "",

                                episodeNumber,

                                isMovie:
                                    media
                                        ?.format ===
                                    "MOVIE",

                                isSeasonFinale:
                                    totalEpisodes >
                                        0 &&
                                    episodeNumber ===
                                        totalEpisodes,
                            },
                        );
                    }

                    const items =
                        Array.from(
                            byEpisode.values(),
                        ).sort(
                            (a, b) =>
                                new Date(
                                    a.dateTime,
                                ).getTime() -
                                new Date(
                                    b.dateTime,
                                ).getTime(),
                        );

                    const oldItems =
                        $store.get(
                            "seadub-items",
                        ) || [];

                    const changed =
                        makeSignature(
                            oldItems,
                        ) !==
                        makeSignature(items);

                    $store.set(
                        "seadub-items",
                        items,
                    );

                    $storage.set(
                        "seadub-items",
                        items,
                    );

                    retryCount = 0;

                    console.log(
                        `SeaDub: loaded ${items.length} matching calendar entries from ${calendar.length} feed rows`,
                    );

                    if (
                        rebuildIfChanged &&
                        changed
                    ) {
                        queueScheduleRebuild(
                            false,
                        );
                    } else {
                        invalidateSchedule();
                    }

                    if (showToast) {
                        ctx.toast.info(
                            `SeaDub loaded ${items.length} calendar entries.`,
                        );
                    }
                } catch (error) {
                    console.error(
                        "SeaDub: load failed",
                        error,
                    );

                    if (
                        retryCount <
                        MAX_RETRIES
                    ) {
                        retryCount += 1;

                        ctx.setTimeout(
                            () =>
                                loadSeaDub(
                                    false,
                                    false,
                                ),
                            retryCount *
                                4000,
                        );
                    } else if (showToast) {
                        ctx.toast.error(
                            "SeaDub could not load schedule data.",
                        );
                    }
                }
            };

        ctx.registerEventHandler(
            "seadub-refresh",
            async () => {
                retryCount = 0;

                ctx.toast.info(
                    "Refreshing SeaDub...",
                );

                await loadSeaDub(
                    true,
                    true,
                );
            },
        );

        tray.render(() => {
            const currentFilter =
                filterState.get();

            const currentFormat =
                formatState.get();

            return tray.stack({
                gap: 2,

                items: [
                    tray.text(
                        "SeaDub Schedule",
                    ),

                    tray.button(
                        "All (Subs & Dubs)",
                        {
                            intent:
                                currentFilter ===
                                "all"
                                    ? "primary"
                                    : "gray-subtle",
                            onClick:
                                "seadub-filter-all",
                        },
                    ),

                    tray.button(
                        "Prefer Dubs",
                        {
                            intent:
                                currentFilter ===
                                "prefer-dub"
                                    ? "primary"
                                    : "gray-subtle",
                            onClick:
                                "seadub-filter-prefer",
                        },
                    ),

                    tray.button(
                        "Dubs Only",
                        {
                            intent:
                                currentFilter ===
                                "dub"
                                    ? "primary"
                                    : "gray-subtle",
                            onClick:
                                "seadub-filter-dub",
                        },
                    ),

                    tray.button(
                        "Subs Only",
                        {
                            intent:
                                currentFilter ===
                                "sub"
                                    ? "primary"
                                    : "gray-subtle",
                            onClick:
                                "seadub-filter-sub",
                        },
                    ),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor:
                                "rgba(255,255,255,0.1)",
                            margin: "8px 0",
                        },
                    }),

                    tray.text(
                        "Dub Title Format",
                    ),

                    tray.flex({
                        gap: 2,

                        items: [
                            tray.button(
                                "🎙️Dub",
                                {
                                    intent:
                                        currentFormat ===
                                        "icon"
                                            ? "primary"
                                            : "gray-subtle",
                                    onClick:
                                        "seadub-format-icon",
                                },
                            ),

                            tray.button(
                                "🎙️",
                                {
                                    intent:
                                        currentFormat ===
                                        "icon-only"
                                            ? "primary"
                                            : "gray-subtle",
                                    onClick:
                                        "seadub-format-icon-only",
                                },
                            ),

                            tray.button(
                                "[DUB]",
                                {
                                    intent:
                                        currentFormat ===
                                        "bracket"
                                            ? "primary"
                                            : "gray-subtle",
                                    onClick:
                                        "seadub-format-bracket",
                                },
                            ),
                        ],
                    }),

                    tray.text(
                        "Later weeks can include projected weekly dub dates until a confirmed update replaces them.",
                        {
                            style: {
                                opacity: "0.65",
                                fontSize: "12px",
                            },
                        },
                    ),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor:
                                "rgba(255,255,255,0.1)",
                            margin: "8px 0",
                        },
                    }),

                    tray.button(
                        "🔄 Refresh SeaDub",
                        {
                            intent:
                                "gray-subtle",
                            onClick:
                                "seadub-refresh",
                        },
                    ),
                ],
            });
        });

        // Cached rows are available immediately. Refresh the one-file feed in
        // the background and only rebuild Seanime's server schedule if it changed.
        loadSeaDub(false, true);

        ctx.setInterval(
            () =>
                loadSeaDub(
                    false,
                    true,
                ),
            30 * 60 * 1000,
        );
    });
}
