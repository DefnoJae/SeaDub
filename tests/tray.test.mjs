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
    return { store, events, render, collect, titles, event, nextCalls, trayOptions };
}

const episode = (title, dateTime, episodeNumber = 1) => ({ mediaId: title === "Slime Isekai" ? 1 : 2, title, dateTime, episodeNumber });

test("empty search includes every today's sub and dub, with no two-row limit", async () => {
    const app = await setup({
        subs: [episode("Morning sub", "2026-10-02T08:00:00Z"), episode("Evening sub", "2026-10-02T20:00:00Z"), episode("Tomorrow", "2026-10-03T00:00:00Z")],
        dubs: [episode("Slime Isekai", "2026-10-02T16:00:00Z"), episode("Other dub", "2026-10-02T18:00:00Z"), episode("Yesterday", "2026-10-01T23:59:00Z")],
        filter: "dub",
    });
    assert.deepEqual(app.titles(), ["Morning sub", "Slime Isekai", "Other dub", "Evening sub"]);
    assert.equal(app.nextCalls, 1);
    assert.equal(app.event.items.length, 3); // Calendar mode still controls calendar rows.
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
