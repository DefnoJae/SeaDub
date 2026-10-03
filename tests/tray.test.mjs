import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

process.env.TZ = "UTC";

const source = readFileSync(new URL("../src/SeaDub.ts", import.meta.url), "utf8");

async function setup({ now = "2026-10-02T12:00:00Z", search = "", filter = "all", subs = [], dubs = [] } = {}) {
    const store = new Map([["seadub-items", dubs]]);
    const storage = new Map([["seadub-items", dubs], ["seadub-search", search], ["seadub-filter", filter]]);
    const events = new Map();
    const fields = [];
    let hook, register, render, trayOptions;
    const node = (type, children, props = {}) => ({ type, children, props });
    const tray = new Proxy({}, {
        get: (_, type) => {
            if (type === "render") return callback => { render = callback; };
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
    return { store, storage, fields, events, render, collect, titles, event, nextCalls, trayOptions };
}

const episode = (title, dateTime, episodeNumber = 1) => ({ mediaId: title, title, dateTime, episodeNumber });

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
