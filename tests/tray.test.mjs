import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

process.env.TZ = "UTC";

const source = readFileSync(new URL("../src/SeaDub.ts", import.meta.url), "utf8");

async function setup({ now = "2026-10-02T12:00:00Z", search = "", filter = "all", subs = [], dubs = [], screen = { pathname: "/", searchParams: {} }, getEntry = async () => null } = {}) {
    const store = new Map([["seadub-items", dubs]]);
    const storage = new Map([["seadub-items", dubs], ["seadub-search", search], ["seadub-filter", filter]]);
    const events = new Map();
    const fields = [];
    let hook, register, render, trayOptions, onOpen, onClose;
    const node = (type, children, props = {}) => ({ type, children, props });
    const tray = new Proxy({}, {
        get: (_, type) => {
            if (type === "render") return callback => { render = callback; };
            if (type === "onOpen") return callback => { onOpen = callback; };
            if (type === "onClose") return callback => { onClose = callback; };
            if (["flex", "input", "img"].includes(type)) return props => node(type, props.items || [], props);
            return (children, props) => node(type, children, props);
        },
    });
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
    }
    vm.runInNewContext(source + "\ninit();", {
        Date: Clock, console: { log() {}, error() {} },
        $store: { get: key => store.get(key), set: (key, value) => store.set(key, value) },
        $storage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value) },
        $app: { onAnimeScheduleItems: callback => { hook = callback; }, invalidateClientQuery() {} },
        $ui: { register: callback => { register = callback; } },
    });
    await register({
        screen: { state: () => ({ get: () => screen }) },
        anime: { getAnimeEntry: getEntry },
        fieldRef: initial => {
            const field = { current: initial, displayedValue: initial, updates: [],
                setValue(value) { this.current = value; this.displayedValue = value; this.updates.push(value); },
            };
            fields.push(field);
            return field;
        },
        state: initial => { let value = initial; return { get: () => value, set: next => { value = next; } }; },
        newTray: options => { trayOptions = options; return tray; },
        registerEventHandler: (name, callback) => events.set(name, callback),
        eventHandler: (name, callback) => { events.set(name, callback); return name; },
        setTimeout: () => () => {}, setInterval() {},
        fetch: () => new Promise(() => {}),
    });
    let nextCalls = 0;
    const event = { items: [], next() { nextCalls++; this.items = subs; } };
    hook(event);
    const collect = (tree, predicate) => {
        if (!tree || typeof tree !== "object") return [];
        if (Array.isArray(tree)) return tree.flatMap(child => collect(child, predicate));
        return [...(predicate(tree) ? [tree] : []), ...collect(tree.children, predicate)];
    };
    const highlights = () => collect(render(), item => item.props?.className?.startsWith("seadub-highlight-row"));
    const titles = () => highlights().flatMap(row => collect(row, item => item.props?.className === "seadub-highlight-title").map(item => item.children));
    return { store, storage, fields, events, render, collect, titles, event, nextCalls, trayOptions,
        open: () => onOpen(), close: () => onClose(), navigate: next => { screen = next; },
        schedule: () => { const event = { items: [], next() { this.items = subs; } }; hook(event); return event.items; },
    };
}

const episode = (title, dateTime, episodeNumber = 1) => ({ mediaId: title, title, dateTime, episodeNumber });

test("opening on an anime page fills the visible search and finds upcoming releases by ID", async () => {
    const app = await setup({ search: "Previous search", filter: "dub",
        screen: { pathname: "/entry", searchParams: { id: "123" } },
        getEntry: async id => { assert.equal(id, 123); return { media: { title: { userPreferred: "The Elusive Samurai" } } }; },
        subs: [{ ...episode("Nige Jouzu no Wakagimi", "2026-10-06T16:00:00Z", 12), mediaId: 123 }],
        dubs: [{ ...episode("Elusive Samurai", "2026-10-06T18:00:00Z", 5), mediaId: 123 },
            { ...episode("The Elusive Samurai 2", "2026-10-06T19:00:00Z"), mediaId: 456 }],
    });
    await app.open();
    assert.equal(app.fields[0].displayedValue, "The Elusive Samurai");
    assert.equal(app.store.get("seadub-search-media-id"), 123);
    assert.deepEqual(app.titles(), ["Elusive Samurai"]);
    assert.equal(app.schedule().length, 1);
    // The client's field-ref echo must retain the automatic ID search.
    app.events.get("seadub-search-change")({ value: "The Elusive Samurai" });
    assert.equal(app.store.get("seadub-search-media-id"), 123);
    app.events.get("seadub-filter-all")();
    assert.deepEqual(app.titles(), ["Nige Jouzu no Wakagimi", "Elusive Samurai"]);
    app.events.get("seadub-search-change")({ value: "Samurai 2" });
    assert.equal(app.store.get("seadub-search-media-id"), null);
    assert.deepEqual(app.titles(), ["The Elusive Samurai 2"]);
    app.events.get("seadub-search-clear")();
    assert.equal(app.fields[0].displayedValue, "");
    assert.equal(app.store.get("seadub-search-media-id"), null);
});

test("detail-page search shows the empty state when no future releases are available", async () => {
    const app = await setup({ screen: { pathname: "/entry", searchParams: { id: "123" } },
        getEntry: async () => ({ media: { title: { english: "Finished Anime" } } }),
    });
    await app.open();
    assert.equal(app.fields[0].displayedValue, "Finished Anime");
    assert.equal(app.collect(app.render(), node => node.props?.className === "seadub-empty-text")[0].children, "No upcoming episodes match this search.");
});

test("opening outside an anime detail page preserves manual search without a lookup", async () => {
    for (const screen of [{ pathname: "/", searchParams: {} }, { pathname: "/manga/entry", searchParams: { id: "123" } }, { pathname: "/entry", searchParams: { id: "invalid" } }]) {
        const app = await setup({ screen, search: "My search", getEntry: async () => { assert.fail("Unexpected anime lookup"); } });
        await app.open();
        assert.equal(app.fields[0].displayedValue, "My search");
        assert.equal(app.store.get("seadub-search"), "My search");
    }
});

test("cached release title is used if detail-page lookup fails", async () => {
    const app = await setup({ screen: { pathname: "/entry", searchParams: { id: "123" } },
        getEntry: async () => { throw new Error("Unavailable"); },
        dubs: [{ ...episode("Cached Anime", "2026-10-06T18:00:00Z"), mediaId: 123 }],
    });
    await app.open();
    assert.equal(app.fields[0].displayedValue, "Cached Anime");
    assert.deepEqual(app.titles(), ["Cached Anime"]);
});

test("a late title lookup cannot replace edits, Clear, navigation, or a closed tray", async () => {
    for (const action of ["type", "clear", "navigate", "close"]) {
        let resolve;
        const app = await setup({ screen: { pathname: "/entry", searchParams: { id: "123" } },
            getEntry: () => new Promise(done => { resolve = done; }),
        });
        app.render();
        const pending = app.open();
        if (action === "type") app.events.get("seadub-search-change")({ value: "Manual" });
        if (action === "clear") app.events.get("seadub-search-clear")();
        if (action === "navigate") app.navigate({ pathname: "/entry", searchParams: { id: "456" } });
        if (action === "close") app.close();
        resolve({ media: { title: { userPreferred: "Late title" } } });
        await pending;
        assert.equal(app.store.get("seadub-search"), action === "type" ? "Manual" : "");
        assert.equal(app.store.get("seadub-search-media-id"), null);
        assert.ok(!app.fields[0].updates.includes("Late title"));
    }
});

test("search flags known final episodes for both sub and dub, following the selected mode", async () => {
    const title = "The Elusive Samurai";
    const app = await setup({ search: title,
        subs: [{ ...episode(title, "2026-10-06T16:00:00Z", 12), isSeasonFinale: true }],
        dubs: [episode(title, "2026-10-06T18:00:00Z", 5),
            { ...episode(title, "2026-11-24T18:00:00Z", 12), isSeasonFinale: true, projected: true }],
    });
    const flaggedEpisodes = () => app.collect(app.render(), node => node.props?.className?.startsWith("seadub-highlight-row"))
        .filter(row => app.collect(row, node => node.props?.className === "seadub-finale-badge").length)
        .map(row => app.collect(row, node => node.props?.className === "seadub-highlight-episode")[0].children);
    assert.deepEqual(flaggedEpisodes(), ["Ep. 12", "Ep. 12"]);
    app.events.get("seadub-filter-dub")();
    assert.deepEqual(flaggedEpisodes(), ["Ep. 12"]);
    app.events.get("seadub-filter-sub")();
    assert.deepEqual(flaggedEpisodes(), ["Ep. 12"]);
});

test("the last available search result is not treated as a finale without metadata", async () => {
    const app = await setup({ search: "Samurai", dubs: [
        episode("Samurai", "2026-10-06T18:00:00Z", 5),
        { ...episode("Samurai Movie", "2026-10-07T18:00:00Z"), isMovie: true, isSeasonFinale: true },
    ] });
    assert.equal(app.collect(app.render(), node => node.props?.className === "seadub-finale-badge").length, 0);
});

test("both Clear buttons reset the visible field and stored search, including pending text", async () => {
    for (const className of ["seadub-clear-search", "seadub-secondary-action"]) {
        const app = await setup({ search: "Slime" });
        const tree = app.render();
        const input = app.collect(tree, node => node.type === "input")[0];
        const button = app.collect(tree, node => node.props?.className === className)[0];
        assert.equal(input.props.fieldRef, app.fields[0]);
        assert.equal(input.props.fieldRef.displayedValue, "Slime");
        app.events.get(button.props.onClick)();
        assert.equal(input.props.fieldRef.displayedValue, "");
        assert.equal(app.store.get("seadub-search"), "");
        assert.equal(app.storage.get("seadub-search"), "");
        assert.equal(app.collect(app.render(), node => node.type === "input")[0].props.value, "");
        // New text can still be local to the input before its debounce fires.
        input.props.fieldRef.displayedValue = "Samurai";
        app.events.get(button.props.onClick)();
        assert.equal(input.props.fieldRef.displayedValue, "");
        assert.deepEqual(input.props.fieldRef.updates, ["", ""]);
    }
});

test("empty search includes every today's sub and dub, with no two-row limit", async () => {
    const app = await setup({
        subs: [episode("Morning sub", "2026-10-02T08:00:00Z"), episode("Evening sub", "2026-10-02T20:00:00Z"), episode("Tomorrow", "2026-10-03T00:00:00Z")],
        dubs: [episode("Slime Isekai", "2026-10-02T16:00:00Z"), episode("Other dub", "2026-10-02T18:00:00Z"), episode("Yesterday", "2026-10-01T23:59:00Z")],
        filter: "all",
    });
    assert.deepEqual(app.titles(), ["Morning sub", "Slime Isekai", "Other dub", "Evening sub"]);
    assert.equal(app.nextCalls, 1);
    assert.equal(app.event.items.length, 6);
});

test("search shows all future matching sub and dub episodes in chronological order", async () => {
    const app = await setup({ search: "  SLIME ISEKAI  ",
        subs: [episode("Slime Isekai", "2026-10-02T08:00:00Z"), episode("Slime Isekai", "2026-10-02T20:00:00Z", 2)],
        dubs: [episode("Slime Isekai", "2026-10-09T16:00:00Z", 3), episode("Slime Isekai", "2026-10-16T16:00:00Z", 4), episode("Slime Isekai", "2026-10-23T16:00:00Z", 5), episode("Other", "2026-10-02T16:00:00Z")],
    });
    assert.equal(app.titles().length, 4);
    const rows = app.collect(app.render(), item => item.props?.className === "seadub-highlight-episode");
    assert.deepEqual(rows.map(row => row.children), ["Ep. 2", "Ep. 3", "Ep. 4", "Ep. 5"]);
    app.events.get("seadub-search-clear")();
    assert.equal(app.store.get("seadub-search"), "");
    assert.deepEqual(app.titles(), ["Slime Isekai", "Other", "Slime Isekai"]);
});

test("unmatched titles and invalid dates produce an empty state", async () => {
    const app = await setup({ search: "Missing", dubs: [episode("Missing", "invalid")] });
    assert.equal(app.titles().length, 0);
    assert.equal(app.collect(app.render(), item => item.props?.className === "seadub-empty-text")[0].children, "No upcoming episodes match this search.");
});

test("manifest, collapsed tray and header share the replacement icon", async () => {
    const app = await setup();
    const manifest = JSON.parse(readFileSync(new URL("../Manifest.json", import.meta.url)));
    assert.equal(app.trayOptions.iconUrl, manifest.icon);
    assert.equal(app.collect(app.render(), item => item.props?.className === "seadub-logo")[0].props.src, manifest.icon);
    // Seanime's SeaImage rejects external URLs with a query suffix.
    assert.ok(manifest.icon.endsWith(".png"));
    const iconPath = manifest.icon.split("/main/")[1];
    assert.deepEqual(readFileSync(new URL(`../${iconPath}`, import.meta.url)), readFileSync(new URL("../assets/seadub.png", import.meta.url)));
});

test("daily and searched highlights update immediately for every schedule mode", async () => {
    for (const search of ["", "The Elusive Samurai"]) {
        const app = await setup({ search,
            subs: [episode("The Elusive Samurai", "2026-10-02T16:00:00Z", 12), episode("The Elusive Samurai", "2026-10-02T18:00:00Z", 5)],
            dubs: [episode("The Elusive Samurai", "2026-10-02T18:00:00Z", 5)],
        });
        const rows = () => app.collect(app.render(), item => item.props?.className?.startsWith("seadub-highlight-row"));
        const releases = () => rows().map(row => {
            const badge = app.collect(row, item => /seadub-(sub|dub)-badge/.test(item.props?.className))[0];
            const ep = app.collect(row, item => item.props?.className === "seadub-highlight-episode")[0];
            return [badge.children, ep.children];
        });
        assert.deepEqual(releases(), [["Sub", "Ep. 12"], ["Sub", "Ep. 5"], ["🎙  Dub", "Ep. 5"]]);
        app.events.get("seadub-filter-dub")();
        assert.deepEqual(releases(), [["🎙  Dub", "Ep. 5"]]);
        app.events.get("seadub-filter-sub")();
        assert.deepEqual(releases(), [["Sub", "Ep. 12"], ["Sub", "Ep. 5"]]);
        app.events.get("seadub-filter-prefer")();
        assert.deepEqual(releases(), [["Sub", "Ep. 12"], ["🎙  Dub", "Ep. 5"]]);
        app.events.get("seadub-filter-all")();
        assert.equal(releases().length, 3);
    }
});

test("today follows local calendar boundaries on a daylight saving transition", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
        const app = await setup({ now: "2026-11-01T12:00:00Z", subs: [
            episode("Late today", "2026-11-02T04:30:00Z"),
            episode("Tomorrow", "2026-11-02T05:00:00Z"),
        ] });
        assert.deepEqual(app.titles(), ["Late today"]);
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
});
