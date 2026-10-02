function init() {
    // SeaDub is applied after downstream schedule plugins for All/Sub/Prefer Dub.
    // Dubs Only can stop the downstream chain because no sub schedule rows are needed.
    $app.onAnimeScheduleItems((e) => {
        try {
            const filter = $store.get("seadub-filter") || "all";
            const dubFormat = $store.get("seadub-format") || "icon";
            const rawDubItems = $store.get("seadub-items") || [];
            const searchQuery = String(
                $store.get("seadub-search") || "",
            )
                .trim()
                .toLowerCase();

            const matchesSearch = (item) => {
                if (!searchQuery) return true;

                return String(item?.title || "")
                    .toLowerCase()
                    .includes(searchQuery);
            };

            let dubPrefix = "🎙️Dub - ";
            if (dubFormat === "bracket") {
                dubPrefix = "[DUB] ";
            } else if (dubFormat === "icon-only") {
                dubPrefix = "🎙️ - ";
            }

            const prefixes = ["🎙️Dub - ", "🎙️ - ", "[DUB] "];

            const dubItems = rawDubItems
                .filter(matchesSearch)
                .map((item) => ({
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
                    `SeaDub: applied schedule filter=dub search="${searchQuery}" dubs=${dubItems.length} final=${e.items?.length || 0}`,
                );

                // Intentionally do not call e.next().
                // Dubs Only does not need rows from downstream schedule plugins.
                return;
            }

            // Let other schedule plugins finish before applying SeaDub's final filter.
            e.next();

            const subItems = (e.items || [])
                .filter((item) => {
                    const title = item?.title || "";
                    return !prefixes.some((prefix) =>
                        title.startsWith(prefix),
                    );
                })
                .filter(matchesSearch);

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
                `SeaDub: applied schedule filter=${filter} search="${searchQuery}" dubs=${dubItems.length} subs=${subItems.length} final=${e.items?.length || 0}`,
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

        const savedSearch =
            $storage.get("seadub-search") || "";

        const searchState =
            ctx.state(savedSearch);

        $store.set(
            "seadub-search",
            savedSearch,
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
            width: "600px",
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

        const setSearch = (value) => {
            const nextValue = String(value || "");

            if (searchState.get() === nextValue) {
                return;
            }

            searchState.set(nextValue);
            $storage.set("seadub-search", nextValue);
            $store.set("seadub-search", nextValue);

            // Uses the same debounce as the other controls so typing
            // several characters does not rebuild the schedule each time.
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

        ctx.registerEventHandler(
            "seadub-search-clear",
            () => setSearch(""),
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

                                // UI-only metadata. Seanime ignores these extra
                                // properties when rendering schedule items.
                                dateType:
                                    row?.dateType ||
                                    (row?.projected
                                        ? "projected"
                                        : "confirmed"),

                                projected:
                                    Boolean(
                                        row?.projected ||
                                        row?.dateType ===
                                            "projected",
                                    ),
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

            const currentSearch =
                searchState.get();

            const allDubItems =
                $store.get(
                    "seadub-items",
                ) || [];

            const normalizedSearch =
                String(
                    currentSearch || "",
                )
                    .trim()
                    .toLowerCase();

            const searchMatches = (item) =>
                !normalizedSearch ||
                String(
                    item?.title || "",
                )
                    .toLowerCase()
                    .includes(
                        normalizedSearch,
                    );

            const matchedDubItems =
                allDubItems.filter(
                    searchMatches,
                );

            const now =
                new Date();

            const nowMs =
                now.getTime();

            const weekStart =
                new Date(now);

            weekStart.setHours(
                0,
                0,
                0,
                0,
            );

            weekStart.setDate(
                weekStart.getDate() -
                    weekStart.getDay(),
            );

            const weekEnd =
                new Date(
                    weekStart.getTime() +
                        7 *
                            24 *
                            60 *
                            60 *
                            1000,
                );

            const futureItems =
                matchedDubItems.filter(
                    (item) =>
                        new Date(
                            item?.dateTime,
                        ).getTime() >=
                        nowMs,
                );

            const thisWeekCount =
                matchedDubItems.filter(
                    (item) => {
                        const time =
                            new Date(
                                item?.dateTime,
                            ).getTime();

                        return (
                            time >=
                                weekStart.getTime() &&
                            time <
                                weekEnd.getTime()
                        );
                    },
                ).length;

            const confirmedCount =
                futureItems.filter(
                    (item) =>
                        !item?.projected,
                ).length;

            const projectedCount =
                futureItems.filter(
                    (item) =>
                        Boolean(
                            item?.projected,
                        ),
                ).length;

            const upcomingHighlights =
                futureItems
                    .slice()
                    .sort(
                        (a, b) =>
                            new Date(
                                a.dateTime,
                            ).getTime() -
                            new Date(
                                b.dateTime,
                            ).getTime(),
                    )
                    .slice(0, 2);

            const formatShortDate =
                (value) => {
                    const date =
                        new Date(value);

                    const months = [
                        "Jan",
                        "Feb",
                        "Mar",
                        "Apr",
                        "May",
                        "Jun",
                        "Jul",
                        "Aug",
                        "Sep",
                        "Oct",
                        "Nov",
                        "Dec",
                    ];

                    return `${months[
                        date.getMonth()
                    ]} ${date.getDate()}`;
                };

            const statCard = (
                icon,
                label,
                value,
                toneClass,
            ) =>
                tray.div(
                    [
                        tray.flex({
                            gap: 2,
                            items: [
                                tray.span(
                                    icon,
                                    {
                                        className:
                                            "seadub-stat-icon",
                                    },
                                ),
                                tray.text(
                                    label,
                                    {
                                        className:
                                            "seadub-stat-label",
                                    },
                                ),
                            ],
                        }),

                        tray.text(
                            String(value),
                            {
                                className:
                                    `seadub-stat-value ${toneClass}`,
                            },
                        ),
                    ],
                    {
                        className:
                            "seadub-stat-card",
                    },
                );

            const modeButton = (
                label,
                value,
            ) =>
                tray.button(
                    label,
                    {
                        intent:
                            currentFilter ===
                            value
                                ? "primary"
                                : "gray-subtle",

                        className:
                            `seadub-mode-button ${currentFilter === value ? "is-active" : ""}`,

                        onClick:
                            value === "all"
                                ? "seadub-filter-all"
                                : value ===
                                    "prefer-dub"
                                  ? "seadub-filter-prefer"
                                  : value ===
                                      "dub"
                                    ? "seadub-filter-dub"
                                    : "seadub-filter-sub",
                    },
                );

            const formatButton = (
                label,
                value,
                event,
            ) =>
                tray.button(
                    label,
                    {
                        intent:
                            currentFormat ===
                            value
                                ? "primary"
                                : "gray-subtle",

                        className:
                            `seadub-format-button ${currentFormat === value ? "is-active" : ""}`,

                        onClick:
                            event,
                    },
                );

            const highlightRows =
                upcomingHighlights.length
                    ? upcomingHighlights.map(
                          (
                              item,
                              index,
                          ) =>
                              tray.div(
                                  [
                                      tray.flex({
                                          gap: 3,
                                          items: [
                                              item?.image
                                                  ? tray.img({
                                                        src:
                                                            item.image,
                                                        alt:
                                                            item.title ||
                                                            "Anime",
                                                        width:
                                                            "46px",
                                                        height:
                                                            "62px",
                                                        className:
                                                            "seadub-highlight-poster",
                                                    })
                                                  : tray.div(
                                                        [
                                                            tray.text(
                                                                "S",
                                                                {
                                                                    className:
                                                                        "seadub-poster-fallback-letter",
                                                                },
                                                            ),
                                                        ],
                                                        {
                                                            className:
                                                                "seadub-highlight-poster seadub-poster-fallback",
                                                        },
                                                    ),

                                              tray.div(
                                                  [
                                                      tray.flex({
                                                          gap: 2,
                                                          items: [
                                                              tray.text(
                                                                  item?.title ||
                                                                      "Unknown",
                                                                  {
                                                                      className:
                                                                          "seadub-highlight-title",
                                                                  },
                                                              ),

                                                              tray.span(
                                                                  "🎙  Dub",
                                                                  {
                                                                      className:
                                                                          "seadub-dub-badge",
                                                                  },
                                                              ),
                                                          ],
                                                      }),

                                                      tray.text(
                                                          item?.projected
                                                              ? "Projected release"
                                                              : "Confirmed release",
                                                          {
                                                              className:
                                                                  "seadub-highlight-meta",
                                                          },
                                                      ),
                                                  ],
                                                  {
                                                      className:
                                                          "seadub-highlight-info",
                                                  },
                                              ),

                                              tray.div(
                                                  [
                                                      tray.text(
                                                          `Ep. ${item?.episodeNumber || 1}`,
                                                          {
                                                              className:
                                                                  "seadub-highlight-episode",
                                                          },
                                                      ),

                                                      tray.text(
                                                          formatShortDate(
                                                              item?.dateTime,
                                                          ),
                                                          {
                                                              className:
                                                                  "seadub-highlight-date",
                                                          },
                                                      ),

                                                      tray.text(
                                                          item?.time ||
                                                              "",
                                                          {
                                                              className:
                                                                  "seadub-highlight-time",
                                                          },
                                                      ),
                                                  ],
                                                  {
                                                      className:
                                                          "seadub-highlight-right",
                                                  },
                                              ),
                                          ],
                                      }),
                                  ],
                                  {
                                      className:
                                          `seadub-highlight-row ${index === upcomingHighlights.length - 1 ? "is-last" : ""}`,
                                  },
                              ),
                      )
                    : [
                          tray.div(
                              [
                                  tray.text(
                                      normalizedSearch
                                          ? "No upcoming dub releases match this search."
                                          : "No upcoming dub releases are available yet.",
                                      {
                                          className:
                                              "seadub-empty-text",
                                      },
                                  ),
                              ],
                              {
                                  className:
                                      "seadub-empty-state",
                              },
                          ),
                      ];

            return tray.div(
                [

                    tray.css(`
                        .seadub-shell {
                            position: relative;
                            overflow: hidden;
                            border-radius: 22px;
                            border: 1px solid rgba(139, 92, 246, 0.42);
                            background:
                                radial-gradient(circle at 12% -5%, rgba(124, 58, 237, 0.26), transparent 38%),
                                radial-gradient(circle at 90% 10%, rgba(79, 70, 229, 0.18), transparent 32%),
                                linear-gradient(155deg, rgba(20, 18, 33, 0.98), rgba(10, 10, 18, 0.985));
                            box-shadow:
                                0 26px 70px rgba(0, 0, 0, 0.5),
                                inset 0 1px 0 rgba(255,255,255,0.04);
                            color: #f7f5ff;
                        }

                        .seadub-shell::before {
                            content: "";
                            position: absolute;
                            inset: 0;
                            pointer-events: none;
                            background:
                                linear-gradient(120deg, rgba(167, 139, 250, 0.07), transparent 32%),
                                radial-gradient(circle at 72% 0%, rgba(109, 40, 217, 0.12), transparent 30%);
                        }

                        .seadub-content {
                            position: relative;
                            z-index: 1;
                            padding: 14px;
                            max-height: min(650px, 76vh);
                            overflow-y: auto;
                        }

                        .seadub-header {
                            align-items: center;
                            justify-content: space-between;
                            margin-bottom: 12px;
                        }

                        .seadub-brand {
                            align-items: center;
                        }

                        .seadub-logo {
                            width: 48px;
                            height: 48px;
                            min-width: 48px;
                            border-radius: 14px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 24px;
                            font-weight: 900;
                            font-style: italic;
                            color: white;
                            border: 1px solid rgba(196, 181, 253, 0.58);
                            background:
                                radial-gradient(circle at 30% 20%, rgba(196, 181, 253, 0.95), transparent 30%),
                                linear-gradient(145deg, #7c3aed 0%, #4f46e5 52%, #24185e 100%);
                            box-shadow:
                                0 8px 25px rgba(124, 58, 237, 0.35),
                                inset 0 1px 0 rgba(255,255,255,0.18);
                        }

                        .seadub-logo-letter {
                            font-size: 24px;
                            line-height: 1;
                            font-weight: 900;
                            font-style: italic;
                            color: white;
                        }

                        .seadub-title {
                            font-size: 22px;
                            line-height: 1;
                            font-weight: 800;
                            letter-spacing: -0.03em;
                            color: #fff;
                        }

                        .seadub-subtitle {
                            margin-top: 4px;
                            font-size: 12px;
                            color: rgba(221, 214, 254, 0.7);
                        }

                        .seadub-sync-pill {
                            align-items: center;
                            gap: 7px;
                            padding: 7px 10px;
                            border-radius: 999px;
                            border: 1px solid rgba(52, 211, 153, 0.2);
                            background: rgba(16, 185, 129, 0.10);
                            color: #6ee7b7;
                            font-size: 10px;
                            font-weight: 700;
                        }

                        .seadub-sync-dot {
                            color: #34d399;
                            font-size: 10px;
                            filter: drop-shadow(0 0 5px rgba(52, 211, 153, 0.8));
                        }

                        .seadub-search-wrap {
                            margin-bottom: 10px;
                            padding: 2px;
                            border-radius: 14px;
                            border: 1px solid rgba(139, 92, 246, 0.52);
                            background: rgba(17, 16, 30, 0.86);
                            box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.08), 0 8px 26px rgba(0,0,0,0.18);
                        }

                        .seadub-search-wrap input {
                            min-height: 38px;
                            border: 0 !important;
                            background: transparent !important;
                            box-shadow: none !important;
                            font-size: 14px;
                        }

                        .seadub-clear-search {
                            width: 62px;
                            min-width: 62px;
                            border-radius: 10px !important;
                        }

                        .seadub-stats {
                            display: grid !important;
                            grid-template-columns: repeat(4, minmax(0, 1fr));
                            gap: 7px !important;
                            margin-bottom: 12px;
                        }

                        .seadub-stat-card {
                            min-width: 0;
                            padding: 7px 8px;
                            border-radius: 12px;
                            border: 1px solid rgba(255,255,255,0.075);
                            background: linear-gradient(160deg, rgba(255,255,255,0.065), rgba(255,255,255,0.025));
                            box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
                        }

                        .seadub-stat-icon {
                            font-size: 13px;
                        }

                        .seadub-stat-label {
                            font-size: 11px;
                            color: rgba(226, 232, 240, 0.64);
                            white-space: nowrap;
                        }

                        .seadub-stat-value {
                            margin-top: 4px;
                            font-size: 18px;
                            line-height: 1;
                            font-weight: 800;
                            color: #f8fafc;
                        }

                        .seadub-tone-green { color: #6ee7b7; }
                        .seadub-tone-amber { color: #fdba74; }
                        .seadub-tone-violet { color: #a78bfa; }

                        .seadub-section {
                            margin-top: 11px;
                        }

                        .seadub-section-header {
                            align-items: end;
                            justify-content: space-between;
                            margin-bottom: 6px;
                        }

                        .seadub-section-title {
                            font-size: 12px;
                            font-weight: 800;
                            color: #f8fafc;
                        }

                        .seadub-section-help {
                            font-size: 10px;
                            color: rgba(203, 213, 225, 0.48);
                            text-align: right;
                        }

                        .seadub-mode-grid {
                            display: grid !important;
                            grid-template-columns: repeat(4, minmax(0, 1fr));
                            gap: 8px !important;
                        }

                        .seadub-mode-button,
                        .seadub-format-button {
                            min-height: 36px;
                            border-radius: 10px !important;
                            font-weight: 700 !important;
                            border: 1px solid rgba(255,255,255,0.075) !important;
                            background: rgba(255,255,255,0.045) !important;
                        }

                        .seadub-mode-button.is-active,
                        .seadub-format-button.is-active {
                            border-color: rgba(167, 139, 250, 0.86) !important;
                            background: linear-gradient(135deg, rgba(124, 58, 237, 0.88), rgba(99, 102, 241, 0.86)) !important;
                            box-shadow: 0 7px 22px rgba(124, 58, 237, 0.26), inset 0 1px 0 rgba(255,255,255,0.15) !important;
                        }

                        .seadub-format-grid {
                            display: grid !important;
                            grid-template-columns: repeat(3, minmax(0, 1fr));
                            gap: 8px !important;
                        }

                        .seadub-divider {
                            height: 1px;
                            margin: 12px 0 9px;
                            background: linear-gradient(90deg, transparent, rgba(167,139,250,0.18), rgba(255,255,255,0.08), transparent);
                        }

                        .seadub-highlights-head {
                            align-items: center;
                            justify-content: space-between;
                            margin-bottom: 5px;
                        }

                        .seadub-highlights-label {
                            font-size: 13px;
                            font-weight: 800;
                        }

                        .seadub-highlights-note {
                            font-size: 10px;
                            color: #a78bfa;
                        }

                        .seadub-highlights-list {
                            border-radius: 12px;
                            overflow: hidden;
                            border: 1px solid rgba(255,255,255,0.065);
                            background: rgba(8, 8, 15, 0.34);
                        }

                        .seadub-highlight-row {
                            padding: 9px 10px;
                            border-bottom: 1px solid rgba(255,255,255,0.055);
                        }

                        .seadub-highlight-row.is-last {
                            border-bottom: 0;
                        }

                        .seadub-highlight-row > div {
                            align-items: center;
                        }

                        .seadub-highlight-poster {
                            width: 40px !important;
                            height: 54px !important;
                            min-width: 40px;
                            border-radius: 8px;
                            object-fit: cover;
                            border: 1px solid rgba(255,255,255,0.11);
                            background: #161525;
                        }

                        .seadub-poster-fallback {
                            align-items: center;
                            justify-content: center;
                            display: flex;
                            background: linear-gradient(145deg, #7c3aed, #312e81);
                        }

                        .seadub-poster-fallback-letter {
                            font-weight: 900;
                            font-size: 21px;
                        }

                        .seadub-highlight-info {
                            flex: 1;
                            min-width: 0;
                        }

                        .seadub-highlight-info > div {
                            align-items: center;
                        }

                        .seadub-highlight-title {
                            max-width: 205px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            font-size: 13px;
                            font-weight: 750;
                            color: #f8fafc;
                        }

                        .seadub-dub-badge {
                            flex: none;
                            padding: 3px 7px;
                            border-radius: 999px;
                            font-size: 9px;
                            font-weight: 800;
                            color: #c4b5fd;
                            background: rgba(124, 58, 237, 0.18);
                            border: 1px solid rgba(167, 139, 250, 0.16);
                        }

                        .seadub-highlight-meta {
                            margin-top: 4px;
                            font-size: 10px;
                            color: rgba(203, 213, 225, 0.47);
                        }

                        .seadub-highlight-right {
                            min-width: 72px;
                            align-items: flex-end;
                            text-align: right;
                        }

                        .seadub-highlight-episode {
                            font-size: 12px;
                            font-weight: 800;
                            color: #e9e7ff;
                        }

                        .seadub-highlight-date {
                            margin-top: 3px;
                            font-size: 10px;
                            color: rgba(226,232,240,0.66);
                        }

                        .seadub-highlight-time {
                            font-size: 9px;
                            color: rgba(167,139,250,0.72);
                        }

                        .seadub-empty-state {
                            padding: 22px;
                            text-align: center;
                        }

                        .seadub-empty-text {
                            font-size: 11px;
                            color: rgba(203, 213, 225, 0.52);
                        }

                        .seadub-footer {
                            display: grid !important;
                            grid-template-columns: 1.35fr 1fr;
                            gap: 9px !important;
                            margin-top: 9px;
                        }

                        .seadub-refresh {
                            min-height: 42px;
                            border-radius: 11px !important;
                            font-weight: 800 !important;
                            border: 1px solid rgba(167,139,250,0.72) !important;
                            background: linear-gradient(135deg, rgba(109,40,217,0.8), rgba(79,70,229,0.72)) !important;
                            box-shadow: 0 9px 26px rgba(76,29,149,0.22);
                        }

                        .seadub-secondary-action {
                            min-height: 42px;
                            border-radius: 11px !important;
                        }

                        .seadub-projection-note {
                            margin-top: 7px;
                            font-size: 9px;
                            line-height: 1.45;
                            color: rgba(203,213,225,0.42);
                            text-align: center;
                        }

                        @media (max-width: 640px) {
                            .seadub-stats {
                                grid-template-columns: repeat(2, minmax(0, 1fr));
                            }

                            .seadub-mode-grid {
                                grid-template-columns: repeat(2, minmax(0, 1fr));
                            }

                            .seadub-highlight-title {
                                max-width: 150px;
                            }
                        }
                    `),

                    tray.flex({
                        gap: 3,
                        className:
                            "seadub-header",
                        items: [
                            tray.flex({
                                gap: 3,
                                className:
                                    "seadub-brand",
                                items: [
                                    tray.div(
                                        [
                                            tray.text(
                                                "S",
                                                {
                                                    className:
                                                        "seadub-logo-letter",
                                                },
                                            ),
                                        ],
                                        {
                                            className:
                                                "seadub-logo",
                                        },
                                    ),

                                    tray.div(
                                        [
                                            tray.text(
                                                "SeaDub",
                                                {
                                                    className:
                                                        "seadub-title",
                                                },
                                            ),

                                            tray.text(
                                                "Dub Calendar Control Center",
                                                {
                                                    className:
                                                        "seadub-subtitle",
                                                },
                                            ),
                                        ],
                                    ),
                                ],
                            }),

                            tray.flex({
                                gap: 1,
                                className:
                                    "seadub-sync-pill",
                                items: [
                                    tray.span(
                                        "●",
                                        {
                                            className:
                                                "seadub-sync-dot",
                                        },
                                    ),

                                    tray.span(
                                        "Synced",
                                    ),
                                ],
                            }),
                        ],
                    }),

                    tray.div(
                        [
                            tray.flex({
                                gap: 2,
                                items: [
                                    tray.input({
                                        placeholder:
                                            "Search anime titles...",
                                        value:
                                            currentSearch,
                                        onChange:
                                            ctx.eventHandler(
                                                "seadub-search-change",
                                                (
                                                    event,
                                                ) =>
                                                    setSearch(
                                                        event?.value ||
                                                            "",
                                                    ),
                                            ),
                                        className:
                                            "seadub-search-input",
                                        style: {
                                            width:
                                                "100%",
                                        },
                                    }),

                                    tray.button(
                                        "Clear",
                                        {
                                            intent:
                                                "gray-subtle",
                                            disabled:
                                                !currentSearch,
                                            className:
                                                "seadub-clear-search",
                                            onClick:
                                                "seadub-search-clear",
                                        },
                                    ),
                                ],
                            }),
                        ],
                        {
                            className:
                                "seadub-search-wrap",
                        },
                    ),

                    tray.div(
                        [
                            statCard(
                                "◫",
                                "This Week",
                                thisWeekCount,
                                "",
                            ),

                            statCard(
                                "✓",
                                "Confirmed",
                                confirmedCount,
                                "seadub-tone-green",
                            ),

                            statCard(
                                "◷",
                                "Projected",
                                projectedCount,
                                "seadub-tone-amber",
                            ),

                            statCard(
                                "★",
                                "Matches",
                                matchedDubItems.length,
                                "seadub-tone-violet",
                            ),
                        ],
                        {
                            className:
                                "seadub-stats",
                        },
                    ),

                    tray.div(
                        [
                            tray.flex({
                                gap: 2,
                                items: [
                                    tray.text(
                                        "Schedule Mode",
                                        {
                                            className:
                                                "seadub-section-title",
                                        },
                                    ),

                                    normalizedSearch
                                        ? tray.text(
                                              `Filtering “${currentSearch}”`,
                                              {
                                                  className:
                                                      "seadub-section-help",
                                              },
                                          )
                                        : [],
                                ],
                                className:
                                    "seadub-section-header",
                            }),

                            tray.div(
                                [
                                    modeButton(
                                        "All",
                                        "all",
                                    ),

                                    modeButton(
                                        "★ Prefer Dubs",
                                        "prefer-dub",
                                    ),

                                    modeButton(
                                        "Dubs Only",
                                        "dub",
                                    ),

                                    modeButton(
                                        "Subs Only",
                                        "sub",
                                    ),
                                ],
                                {
                                    className:
                                        "seadub-mode-grid",
                                },
                            ),
                        ],
                        {
                            className:
                                "seadub-section",
                        },
                    ),

                    tray.div(
                        [
                            tray.flex({
                                gap: 2,
                                items: [
                                    tray.text(
                                        "Dub Label Format",
                                        {
                                            className:
                                                "seadub-section-title",
                                        },
                                    ),

                                    [],
                                ],
                                className:
                                    "seadub-section-header",
                            }),

                            tray.div(
                                [
                                    formatButton(
                                        "🎙 Dub",
                                        "icon",
                                        "seadub-format-icon",
                                    ),

                                    formatButton(
                                        "🎙",
                                        "icon-only",
                                        "seadub-format-icon-only",
                                    ),

                                    formatButton(
                                        "[DUB]",
                                        "bracket",
                                        "seadub-format-bracket",
                                    ),
                                ],
                                {
                                    className:
                                        "seadub-format-grid",
                                },
                            ),
                        ],
                        {
                            className:
                                "seadub-section",
                        },
                    ),

                    tray.div([], {
                        className:
                            "seadub-divider",
                    }),

                    tray.flex({
                        gap: 2,
                        items: [
                            tray.text(
                                "✦ Upcoming Highlights",
                                {
                                    className:
                                        "seadub-highlights-label",
                                },
                            ),

                            tray.text(
                                `${futureItems.length} upcoming`,
                                {
                                    className:
                                        "seadub-highlights-note",
                                },
                            ),
                        ],
                        className:
                            "seadub-highlights-head",
                    }),

                    tray.div(
                        highlightRows,
                        {
                            className:
                                "seadub-highlights-list",
                        },
                    ),

                    tray.div(
                        [
                            tray.button(
                                "↻  Refresh Feed",
                                {
                                    intent:
                                        "primary",
                                    className:
                                        "seadub-refresh",
                                    onClick:
                                        "seadub-refresh",
                                },
                            ),

                            tray.button(
                                currentSearch
                                    ? "✕  Clear Search"
                                    : "✓  Feed Synced",
                                {
                                    intent:
                                        "gray-subtle",
                                    disabled:
                                        !currentSearch,
                                    className:
                                        "seadub-secondary-action",
                                    onClick:
                                        "seadub-search-clear",
                                },
                            ),
                        ],
                        {
                            className:
                                "seadub-footer",
                        },
                    ),

                    tray.text(
                        "Projected dates are weekly estimates until a confirmed SeaDub update replaces them.",
                        {
                            className:
                                "seadub-projection-note",
                        },
                    ),

                ],
                {
                    className:
                        "seadub-shell seadub-content",
                },
            );
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
