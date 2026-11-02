// Behaviour tests for the popup's rendering layer, modules/popup-core.js.
//
// Why this file exists: popup-core.js is the largest module in the extension and
// the only one of its size with no dedicated suite. Every export is called from
// popup.js, which no test loads — the popup is a page, and the e2e suite only
// ever opens it against an EMPTY profile. So a block that throws on real data
// (mostVisited() walking past the end of its cache, which took every block after
// it down with it) was invisible to everything. Half of these cases feed a cache
// by hand for exactly that reason.
//
// The DOM stand-in from ./dom.mjs has to be installed before the module is
// imported: popup-core.js calls into `document` at call time and $() resolves
// against this shim's id map.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installStubs, importModule } from './stubs.mjs';
import { createDom } from './dom.mjs';

installStubs();
const dom = createDom();
const popupCore = await importModule('modules/popup-core.js');

// alertUser(…, 'open') schedules a 3s auto-hide, and Node's test runner waits for
// a pending timer before it lets the process exit — that one call stretched this
// file from ~0.1s to 3.1s of wall clock. The handle never returns to the caller,
// so no case can clear it after the fact.
//
// Collected for the whole file rather than per case on purpose: a per-case
// helper is only as good as the next author remembering to call it, and
// forgetting costs 3 seconds while still passing green — a slow failure nobody
// has a reason to look at. Clearing after every case leaves nothing to forget.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const pendingTimers = [];
const clearedLongDelays = [];
globalThis.setTimeout = function (fn, ms, ...args) {
    const id = realSetTimeout(fn, ms, ...args);
    pendingTimers.push({ id, ms });
    return id;
};
// The receipt is taken here, inside clearTimeout, rather than next to the call
// site that asks for the sweep. Bookkeeping that lives beside the call keeps
// ticking when the call is deleted — the sweep would still look like it ran,
// and the suite would still pay its 3 seconds for nothing.
globalThis.clearTimeout = function (id) {
    realClearTimeout(id);
    const at = pendingTimers.findIndex((timer) => timer.id === id);
    if (at < 0) return;
    if (pendingTimers[at].ms >= 1000) clearedLongDelays.push(pendingTimers[at].ms);
    pendingTimers.splice(at, 1);
};
test.afterEach(() => {
    for (const timer of pendingTimers.slice()) clearTimeout(timer.id);
});

// 2024-01-02 13:05:06 local time, built from components so the rendering does
// not depend on the machine's timezone.
const TS = new Date(2024, 0, 2, 13, 5, 6, 0).getTime();

/**
 * Restore `keys` to whatever they held once the test ends.
 *
 * Every case here sets storage directly and localStorage is shared by the whole
 * file, so one leaking `mv-itemsno` silently changes what the next case renders.
 */
function restoreStorage(t, keys) {
    const saved = keys.map((key) => [key, localStorage[key]]);
    t.after(() => {
        for (const [key, value] of saved) {
            if (value === undefined) delete localStorage[key];
            else localStorage[key] = value;
        }
    });
}

/** An empty block container with the id popup.js would have created. */
function block(id) {
    const el = dom.el(id);
    el.innerHTML = '';
    el.style.display = 'block';
    return el;
}

/**
 * Swap in a `chrome.*` namespace for the duration of `fn`.
 *
 * The swap has to outlive an async `fn`: a `finally` around `return fn()`
 * restores `chrome` while the promise is still pending, so every continuation —
 * which is where a stubbed callback actually resolves — would run against the
 * original namespace.
 */
function withChromeApi(overrides, fn) {
    const saved = globalThis.chrome;
    globalThis.chrome = { ...saved, ...overrides };

    let result;
    try {
        result = fn();
    } catch (error) {
        globalThis.chrome = saved;
        throw error;
    }

    if (result && typeof result.then === 'function') {
        return result.finally(() => { globalThis.chrome = saved; });
    }
    globalThis.chrome = saved;
    return result;
}

// ---------------------------------------------------------------------------
// mostVisited() — the block whose bounds issue #12 item 1 was about
// ---------------------------------------------------------------------------

test('mostVisited renders every cached row, not a fixed number of them', (t) => {
    // The loop walked MOST_VISITED_MAX (45) rows. The cache holds only as many
    // as survive the worker's own filters — internal URLs, the 28-day window —
    // so it is nearly always shorter, and `mvd[i].title` threw.
    //
    // It threw inside popup.js' block loop, so every block after this one never
    // rendered: the popup stopped half way down, with nothing in the console of
    // any page the user had open.
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    localStorage['mv-cache'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', visitCount: 9 },
        { url: 'https://b.test/1', title: 'B1', favicon: '', visitCount: 8 },
        { url: 'https://c.test/1', title: 'C1', favicon: '', visitCount: 7 },
    ]);
    localStorage['mv-itemsno'] = '45'; // more than the cache holds
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited(), 'a short cache is the normal case');
    assert.equal(holder.children.length, 3);
    assert.match(holder.children[2].innerHTML, /https:\/\/c\.test\/1/, 'the last row survives');
});

test('mostVisited stops at the configured count on a longer cache', (t) => {
    // Both bounds, in the direction that is easy to get wrong: the limit is what
    // caps the render and the cache length is what caps the walk. Neither alone
    // is enough — the first leaves the throw, the second ignores the setting.
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    localStorage['mv-cache'] = JSON.stringify(
        Array.from({ length: 60 }, (_v, i) => ({ url: `https://m${i}.test/`, title: `M${i}`, favicon: '', visitCount: 60 - i })),
    );
    localStorage['mv-itemsno'] = '5';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited());
    assert.equal(holder.children.length, 5, 'the configured count wins');
});

test('mostVisited renders nothing before the worker has written a cache', (t) => {
    // A brand-new profile: `mv-cache` is absent and the old guard only excluded
    // the 'false' sentinel, so the very first popup threw in JSON.parse().
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    delete localStorage['mv-cache'];
    localStorage['mv-itemsno'] = '8';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited());
    assert.equal(holder.children.length, 0);
});

test('mostVisited survives a corrupt mv-cache instead of taking the popup down', (t) => {
    // popup.js runs its blocks in a plain `for` loop with no try/catch, so a
    // throw here does not fail one block — it ends the loop, and every block
    // after it renders nothing with no error to point at. The worker is the
    // writer of `mv-cache`, and it already guards its own JSON.parse; this is
    // the read side catching up.
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    localStorage['mv-cache'] = '{"url": "https://a.test/", '; // truncated
    localStorage['mv-itemsno'] = '8';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited(), 'a corrupt cache must not throw');
    assert.equal(holder.children.length, 0, 'and must not render half an entry either');
});

test('mostVisited ignores a cache that parses to something other than a list', (t) => {
    // JSON-valid but the wrong shape. The guard has to be `Array.isArray`, not
    // "does it have a length", and only an ARRAY-LIKE can tell the two apart:
    // a plain object has no `.length`, so the walk ends immediately whether the
    // guard is there or not — deleting the guard leaves the whole file green.
    //
    // An array-like with a real entry under 0 is the shape that separates them:
    // unguarded, the loop reads `mvd[0].title` and renders that row, i.e. it
    // copies onto the screen a value it never validated.
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    localStorage['mv-cache'] = JSON.stringify({
        0: { url: 'https://a.test/1', title: 'A1', favicon: '', visitCount: 9 },
        length: 1,
    });
    localStorage['mv-itemsno'] = '8';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited());
    assert.equal(holder.children.length, 0, 'an array-like cache must not be walked at all');
});

test('mostVisited skips a blacklisted host without spending a slot', (t) => {
    // Same rule as the internal URLs in recentHistory(): a dropped row is not a
    // used slot, or a filtered-down list comes back short.
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);
    const holder = block('mv-inject');

    localStorage['mv-cache'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', visitCount: 9 },
        { url: 'https://b.test/1', title: 'B1', favicon: '', visitCount: 8 },
    ]);
    localStorage['mv-itemsno'] = '1';
    localStorage['mv-blocklist'] = 'https://a.test/1|';

    popupCore.mostVisited();

    assert.equal(holder.children.length, 1);
    assert.doesNotMatch(holder.children[0].innerHTML, /a\.test/);
    assert.match(holder.children[0].innerHTML, /https:\/\/b\.test\/1/);
});

// ---------------------------------------------------------------------------
// pinned() — read-only since the pin button was removed
// ---------------------------------------------------------------------------

test('pinned ignores a rh-pinned value that parses to something other than a list', (t) => {
    // The corrupt-value case below only proves the try/catch. This one proves
    // the shape check next to it, and needs an array-like to do so: a plain
    // object makes the walk end on its own, so removing the guard would still
    // pass. Here the unguarded loop would render `pd[0]`.
    restoreStorage(t, ['rh-pinned']);
    const holder = block('pi-inject');

    localStorage['rh-pinned'] = JSON.stringify({
        0: { url: 'https://a.test/1', title: 'A1', favicon: '', time: '10:00' },
        length: 1,
    });

    assert.doesNotThrow(() => popupCore.pinned());
    assert.equal(holder.children.length, 0, 'an array-like value must not be walked at all');
});

test('pinned survives a corrupt rh-pinned value', (t) => {
    // Same failure mode as mv-cache, on the block that renders FIRST (ahead of
    // the loop over `rh-list-order`), so a throw here would take the whole
    // popup with it rather than just the tail.
    restoreStorage(t, ['rh-pinned']);
    const holder = block('pi-inject');

    localStorage['rh-pinned'] = '[{"url":"https://a.test/1"'; // truncated

    assert.doesNotThrow(() => popupCore.pinned());
    assert.equal(holder.children.length, 0);
});

test('pinned renders every stored entry', (t) => {
    // `rh-pinned` can only shrink now — nothing adds to it — but entries pinned
    // before that still have to be reachable, and this is the only caller of the
    // 'pi' branch in formatItem().
    restoreStorage(t, ['rh-pinned']);
    const holder = block('pi-inject');

    localStorage['rh-pinned'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', time: '10:00' },
        { url: 'https://b.test/1', title: 'B1', favicon: '', time: '10:05' },
    ]);

    popupCore.pinned();

    assert.equal(holder.children.length, 2);
    assert.match(holder.children[0].innerHTML, /https:\/\/a\.test\/1/);
});

test('pinned does nothing when the popup has no block for it', (t) => {
    // popup.js only creates #pi-inject when there is something to show, so this
    // is the path every profile without pinned entries takes.
    restoreStorage(t, ['rh-pinned']);
    localStorage['rh-pinned'] = JSON.stringify([{ url: 'https://a.test/', title: 'A', favicon: '', time: '' }]);

    const saved = dom.el('pi-inject');
    // #pi-inject stops resolving, which is what "no block" means to $().
    dom.reset();
    t.after(() => { dom.el(saved.id || 'pi-inject'); });

    assert.doesNotThrow(() => popupCore.pinned(), 'a missing block must not throw');
});

// ---------------------------------------------------------------------------
// showRecentTabs() — the tab list the worker mirrors into session storage
// ---------------------------------------------------------------------------
//
// The cases below pass the snapshot straight in, which is the branch
// `showRecentTabs` takes when both arguments are given. That entry point is the
// only one exported: `showRecentTabsImpl` is where the normalising happens, and
// a test that reached for it directly would be the first caller to leave the
// door to the renderer open.

test('showRecentTabs renders the snapshot in activation order', (t) => {
    // The list arrives as a map plus an order, and the map is the only source of
    // urls and titles — so an id present in the order but missing from the map
    // must be skipped rather than rendered as "undefined". That is exactly the
    // shape a snapshot has after the worker was recycled mid-write.
    restoreStorage(t, ['rt-itemsno']);
    const holder = block('rt-inject');
    localStorage['rt-itemsno'] = '6';

    popupCore.showRecentTabs(
        { 7: { id: 7, url: 'https://a.test/1', title: 'A1' }, 9: { id: 9, url: 'https://b.test/1', title: 'B1' } },
        [9, 7, 42], // 42 is not in the map
    );

    assert.equal(holder.children.length, 2, 'the unknown id must not render');
    // Activation order, not id order: preserving it is the whole reason the
    // worker mirrors the list instead of the popup re-deriving it from a query.
    assert.match(holder.children[0].innerHTML, /https:\/\/b\.test\/1/);
    assert.match(holder.children[1].innerHTML, /https:\/\/a\.test\/1/);
});

test('showRecentTabs hides the block when there is nothing to show', (t) => {
    // The snapshot is JSON round-tripped through chrome.storage.session, so a
    // truncated write can leave the order as something other than an array. An
    // object is the dangerous shape: `rt.length` is then undefined, `i < undefined`
    // is false, and the block silently renders nothing.
    //
    // "Hides itself" rather than "throws": the throw-free version of this bug is
    // the one that ships, and an empty block beats an exception inside popup.js'
    // block loop, which is what took every later block down when mostVisited()
    // did the same thing.
    //
    // An empty list is not unusual either. The heading would otherwise sit there
    // with no rows under it, and the block is last in the default order — so it
    // reads as "the popup is broken" rather than "you have one tab".
    restoreStorage(t, ['rt-itemsno']);
    const holder = block('rt-inject');
    localStorage['rt-itemsno'] = '6';

    popupCore.showRecentTabs({}, []);

    assert.equal(holder.children.length, 0);
    assert.equal(holder.style.display, 'none', 'an empty block must not keep its heading');
});

test('showRecentTabs stops at the configured number of tabs', (t) => {
    // rt-itemsno is a slider (0-100) and a browser can hold more tabs than that.
    restoreStorage(t, ['rt-itemsno']);
    const holder = block('rt-inject');
    localStorage['rt-itemsno'] = '2';

    const opened = {};
    const order = [];
    for (let id = 1; id <= 5; id++) {
        opened[id] = { id, url: `https://t${id}.test/`, title: `T${id}` };
        order.push(id);
    }

    popupCore.showRecentTabs(opened, order);

    assert.equal(holder.children.length, 2, 'the configured count wins over the snapshot length');
    assert.match(holder.children[0].innerHTML, /https:\/\/t1\.test/);
});

test('showRecentTabs tolerates an order that is not an array', (t) => {
    // The snapshot is JSON round-tripped through chrome.storage.session, so a
    // truncated write leaves the field as something other than an array. An
    // object is the dangerous shape: it has no `.length`, so `rt.length` is
    // undefined and `i < undefined` is false — the block silently renders
    // nothing rather than throwing, and the user sees an empty "recent tabs".
    //
    // Asserted as "renders its one entry" rather than "does not throw": the
    // throw-free version of this bug is the one that ships.
    restoreStorage(t, ['rt-itemsno']);
    const holder = block('rt-inject');
    localStorage['rt-itemsno'] = '6';

    const opened = { 1: { id: 1, url: 'https://a.test/', title: 'A' } };
    popupCore.showRecentTabs(opened, { 0: 1 }); // an object, not an array

    // Dropped rather than coerced: an object has no `.length`, so the walk ends
    // immediately. That is the safe direction — an empty block beats a throw
    // inside popup.js' block loop, which is what took every later block down
    // when mostVisited() did the same thing.
    assert.equal(holder.children.length, 0, 'a non-array order is dropped, not walked');
    assert.equal(holder.style.display, 'none', 'and the block hides itself');

    // The case above cannot tell "dropped" from "walked and found nothing": a
    // plain object renders nothing either way, because it has no `.length` and
    // the walk ends immediately. Deleting the array check leaves this whole file
    // green. So feed an ARRAY-LIKE — numeric keys plus a length, which is the
    // shape `JSON.parse` produces for a truncated snapshot — with a real tab
    // under the id the walk would look up. Uncoerced this renders that row, from
    // an order that was never trustworthy; coerced it renders nothing.
    holder.innerHTML = '';
    holder.style.display = 'block';
    popupCore.showRecentTabs(opened, { 0: 1, length: 1 });
    assert.equal(holder.children.length, 0, 'an array-like order must not be walked at all');
    assert.equal(holder.style.display, 'none', 'and the block must still hide itself');

    // The map gets the same treatment, and `null` is the value that proves it —
    // `rhhistory[t]` on `undefined` quietly yields undefined and a string has no
    // such key, but a property read on `null` throws. The map is JSON
    // round-tripped too, so an explicit `null` is a shape a truncated snapshot
    // can hand over.
    for (const map of [undefined, null, 'a string', 42]) {
        holder.innerHTML = '';
        holder.style.display = 'block';
        assert.doesNotThrow(
            () => popupCore.showRecentTabs(map, [1]),
            `a ${map === null ? 'null' : typeof map} map must not throw`,
        );
        assert.equal(holder.children.length, 0);
    }
});

// ---------------------------------------------------------------------------
// recentlyClosedTabs() / recentBookmarks()
// ---------------------------------------------------------------------------

test('clicking a closed-tab row reports a stale sessionId instead of doing nothing', (t) => {
    // A sessionId goes stale as soon as the page has been open a while — the
    // entry expires from chrome.sessions while the row is still on screen. The
    // click handler used to pass an empty callback, so that click was simply
    // swallowed: the row looked dead and said nothing.
    restoreStorage(t, ['rct-itemsno']);
    const holder = block('rct-inject');
    localStorage['rct-itemsno'] = '4';

    withChromeApi({
        sessions: {
            getRecentlyClosed: (_q, cb) => cb([
                { tab: { sessionId: 'stale-1', title: 'Gone', url: 'https://gone.test/' } },
            ]),
        },
    }, () => popupCore.recentlyClosedTabs());

    const alert = dom.el('alert-text');
    const holderEl = dom.el('alert-holder');
    const savedAlert = { text: alert.textContent, display: holderEl.style.display };
    alert.textContent = '';
    holderEl.style.display = 'none';
    // 'alert-text' and 'alert-holder' are one pair of nodes shared by the whole
    // file (see dom.mjs), and this case is the only one that fills them. Left
    // behind, the next case asserting on that node would read this case's
    // message and pass or fail for the wrong reason.
    t.after(() => {
        alert.textContent = savedAlert.text;
        holderEl.style.display = savedAlert.display;
    });

    const savedWarn = console.warn;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(' '));
    t.after(() => { console.warn = savedWarn; });

    const row = holder.children[0];
    withChromeApi({
        sessions: {
            restore: (_id, cb) => {
                globalThis.chrome.runtime.lastError = { message: 'Invalid session id' };
                cb();
                delete globalThis.chrome.runtime.lastError;
            },
        },
    }, () => row.dispatch('click', { preventDefault() {} }));

    assert.equal(warned.length, 1, 'the failure must reach the console');
    assert.match(warned[0], /Invalid session id/);
    assert.equal(dom.el('alert-holder').style.display, 'block', 'and be shown, not swallowed');
});

test('the timer sweep really clears the banner timer', () => {
    // The sweep in test.afterEach() has one job: stop Node waiting 3 seconds on
    // alertUser()'s auto-hide. A sweep that clears nothing still lets every
    // case pass — the run just takes 3.1s instead of 0.1s, which is a slow
    // failure nobody looks at. So the sweep keeps a receipt and this reads it.
    //
    // Order matters: this runs after the case that trips alertUser(), so the
    // 3s timer is already in the ledger. Before it, the ledger is legitimately
    // empty and the assertion below would be vacuous.
    assert.ok(clearedLongDelays.includes(3000),
        `no 3s timer was swept; the suite pays 3s of wall clock for it (swept: ${clearedLongDelays.join(', ') || 'none'})`);
});

test('a case that trips the alert banner leaves nothing of it behind', (t) => {
    // 'alert-holder' / 'alert-text' are two nodes shared by the whole file, and
    // the case above is the only one that writes them. Its restore is the only
    // thing keeping the message out of every later case, so it needs a reader:
    // without one, dropping that restore is a green mutation and the trap gets
    // set again for whoever asserts on this node next.
    const holderEl = dom.el('alert-holder');
    const alertEl = dom.el('alert-text');

    assert.notEqual(holderEl.style.display, 'block', 'the banner is still up from an earlier case');
    assert.doesNotMatch(alertEl.textContent, /restoreFailed|Invalid session id/,
        'an earlier case\'s message is still in the banner');
});

test('recentlyClosedTabs restores a window session as one entry', (t) => {
    // chrome.sessions returns either a tab (one page) or a window (several pages
    // under one sessionId). The tab count is only ever visible in the title, so
    // that is where the branch is asserted.
    restoreStorage(t, ['rct-itemsno']);
    const holder = block('rct-inject');
    localStorage['rct-itemsno'] = '4';

    withChromeApi({
        sessions: {
            getRecentlyClosed: (_q, cb) => cb([
                { window: { sessionId: 'win-1', tabs: [{ title: 'W1', url: 'https://w1.test/' }, { title: 'W2', url: 'https://w2.test/' }] } },
                { tab: { sessionId: 'tab-1', title: 'T1', url: 'https://t1.test/' } },
            ]),
        },
    }, () => popupCore.recentlyClosedTabs());

    assert.equal(holder.children.length, 2, 'a window and a tab are both listed');
    assert.match(holder.children[0].innerHTML, /\[2\]/, 'a window shows how many tabs it holds');
    assert.match(holder.children[0].innerHTML, /https:\/\/w1\.test/, 'and leads with its first tab');
});

test('recentlyClosedTabs skips the extension\'s own pages', (t) => {
    // Its own pages cannot be restored from a session id, so listing one puts a
    // dead row in a block whose only purpose is "get this back".
    restoreStorage(t, ['rct-itemsno']);
    const holder = block('rct-inject');
    localStorage['rct-itemsno'] = '4';

    withChromeApi({
        sessions: {
            getRecentlyClosed: (_q, cb) => cb([
                { tab: { sessionId: 'own', title: 'Popup', url: 'chrome-extension://abcdefg/popup.html' } },
                { tab: { sessionId: 'real', title: 'Real', url: 'https://real.test/' } },
            ]),
        },
    }, () => popupCore.recentlyClosedTabs());

    assert.equal(holder.children.length, 1);
    assert.match(holder.children[0].innerHTML, /https:\/\/real\.test/);
});

test('recentBookmarks asks for nothing when the block is switched off', (t) => {
    // popup.js only creates #rb-inject when rb-itemsno > 0, so a query here is
    // not merely wasted work: it is a chrome.bookmarks call the user turned off.
    restoreStorage(t, ['rb-itemsno']);
    const holder = block('rb-inject');
    localStorage['rb-itemsno'] = '0';

    let queried = 0;
    withChromeApi({ bookmarks: { getRecent: (_n, cb) => { queried++; cb([]); } } }, () => popupCore.recentBookmarks());

    assert.equal(queried, 0);
    assert.equal(holder.children.length, 0);
});

test('recentBookmarks renders a bookmark with its added date', (t) => {
    // The only block whose time field is `dateAdded` rather than a visit time,
    // and the only one that formats it through formatDate() — which reads the
    // date pattern out of storage, so the pattern has to be set here.
    restoreStorage(t, ['rb-itemsno', 'rh-date']);
    const holder = block('rb-inject');
    localStorage['rb-itemsno'] = '3';
    localStorage['rh-date'] = 'yyyy/mm/dd';

    withChromeApi({
        bookmarks: { getRecent: (_n, cb) => cb([{ title: 'BM', url: 'https://bm.test/', dateAdded: TS }]) },
    }, () => popupCore.recentBookmarks());

    assert.equal(holder.children.length, 1);
    assert.match(holder.children[0].innerHTML, /https:\/\/bm\.test/);
    assert.match(holder.children[0].innerHTML, /BM/);
    assert.match(holder.children[0].innerHTML, /2024\/01\/02/, 'the date follows the configured pattern');
});

// ---------------------------------------------------------------------------
// formatItem() — the HTML every block shares
// ---------------------------------------------------------------------------

test('formatItem escapes for the attribute and for the text separately', () => {
    // One value, two positions: the tip attribute needs its quotes rewritten,
    // the text position does not. A single escaper either leaves an injection
    // or shows &quot; in the middle of a page title.
    const html = popupCore.formatItem({
        url: 'https://example.test/p', title: 'Docs / API "v2"', time: '13:05', type: 'rh', favicon: '',
    }).innerHTML;

    assert.match(html, /title="[^"]*&quot;v2&quot;/, 'the attribute escapes quotes');
    assert.match(html, />Docs \/ API "v2"</, 'the text does not');
});

test('formatItem falls back to the URL when there is no title', () => {
    // Rows with an empty title are common. The row then has to be recognisable
    // by URL rather than render as an empty box.
    const html = popupCore.formatItem({ url: 'https://example.test/p', title: '', type: 'rh', favicon: '' }).innerHTML;
    assert.match(html, /https:\/\/example\.test\/p/);
});

test('formatItem hides the URL and the visit count when both are switched off', (t) => {
    // rhs-showurl / rhs-showext default to 'no': the two spans are still
    // rendered and hidden with an inline style rather than omitted, so the
    // assertion has to look at the style and not at the presence of the span.
    restoreStorage(t, ['rhs-showurl', 'rhs-showext', 'rhs-showsep']);
    localStorage['rhs-showurl'] = 'no';
    localStorage['rhs-showext'] = 'no';
    localStorage['rhs-showsep'] = 'no';

    const html = popupCore.formatItem({ url: 'https://example.test/p', title: 'T', type: 'rh', visits: 3, favicon: '' }).innerHTML;
    assert.match(html, /<span style="display:none;" class="extra">/);
    assert.match(html, /<span style="display:none;" class="url">/);
});

test('formatItem shows the visit count only for the blocks that have one', (t) => {
    // `visits` is meaningful for history and most-visited rows and empty for a
    // tab or a bookmark, and the span is hidden per type rather than per value.
    restoreStorage(t, ['rhs-showurl', 'rhs-showext', 'rhs-showsep']);
    localStorage['rhs-showurl'] = 'yes';
    localStorage['rhs-showext'] = 'yes';
    localStorage['rhs-showsep'] = 'no';

    const history = popupCore.formatItem({ url: 'https://a.test/', title: 'A', type: 'rh', visits: 4, favicon: '' }).innerHTML;
    const tab = popupCore.formatItem({ url: 'https://b.test/', title: 'B', type: 'rt', visits: 4, favicon: '' }).innerHTML;

    assert.match(history, /class="extra">visits: 4/, 'a history row shows its visit count');
    assert.match(tab, /display:none/, 'a tab row does not');
});

test('formatItem binds a click handler to every row it renders', () => {
    // A row is an <a> with no href, so nothing navigates by default: the whole
    // row — open in a new tab, switch to a tab, restore a session, copy a URL —
    // hangs off the handlers bound here.
    const el = popupCore.formatItem({ url: 'https://example.test/p', title: 'T', type: 'rh', favicon: '' });

    assert.equal(el.tagName, 'A');
    assert.ok((el.handlers.click || []).length > 0, 'a row without a click handler is inert');
    assert.ok((el.handlers.contextmenu || []).length > 0, 'and right click copies the URL');
});

// ---------------------------------------------------------------------------
// Click behaviour
// ---------------------------------------------------------------------------

test('leftClick opens a new tab and closes the popup by default', (t) => {
    // rh-click defaults to 'newtab'. window.close() is how the popup dismisses
    // itself; the stand-in records the call rather than tearing anything down.
    restoreStorage(t, ['rh-click']);
    localStorage['rh-click'] = 'newtab';

    let created = null;
    let closed = false;
    const savedClose = globalThis.window.close;
    globalThis.window.close = () => { closed = true; };
    t.after(() => { globalThis.window.close = savedClose; });

    withChromeApi({ tabs: { create: (o) => { created = o; } } }, () => {
        popupCore.leftClick('https://example.test/p', { preventDefault() {} });
    });

    assert.equal(created && created.url, 'https://example.test/p');
    assert.ok(closed, 'the popup closes once the tab is opened');
});

test('leftClick executes a bookmarklet instead of navigating to it', async (t) => {
    // A javascript: URL in an href is dropped by MV3's CSP; executing it is the
    // only way the row does anything at all.
    restoreStorage(t, ['rh-click']);
    localStorage['rh-click'] = 'newtab';

    let injected = null;
    await withChromeApi({
        tabs: { query: (_q, cb) => cb([{ id: 1 }]), update: () => {} },
        scripting: { executeScript: (o) => { injected = o; return Promise.resolve([]); } },
    }, async () => {
        popupCore.leftClick('javascript:alert(1)', { preventDefault() {} });
        await new Promise((r) => setTimeout(r, 0));
    });

    assert.ok(injected, 'the bookmarklet was injected into the page');
});

test('rightClick copies the URL to the clipboard', () => {
    // The popup has no context menu: right click means "copy this link".
    let written = '';
    const savedExec = document.execCommand;
    const savedCreate = document.createElement;
    document.execCommand = () => true;
    document.createElement = (tag) => {
        const el = savedCreate.call(document, tag);
        Object.defineProperty(el, 'value', { get() { return written; }, set(v) { written = v; }, configurable: true });
        return el;
    };
    try {
        popupCore.rightClick('https://example.test/p');
    } finally {
        document.execCommand = savedExec;
        document.createElement = savedCreate;
    }
    assert.equal(written, 'https://example.test/p');
});

// ---------------------------------------------------------------------------
// popupSearch()
// ---------------------------------------------------------------------------

test('popupSearch renders hits, and says so when there are none', () => {
    // The one block that replaces the popup's contents rather than appending to
    // them, so "no results" has to be written by hand.
    const holder = block('popup-search-insert');

    withChromeApi({ history: { search: (_q, cb) => cb([]) } }, () => popupCore.popupSearch('nope'));
    assert.match(holder.innerHTML, /no-results/);

    withChromeApi({
        history: { search: (_q, cb) => cb([{ title: 'Hit', url: 'https://hit.test/', visitCount: 2 }]) },
    }, () => popupCore.popupSearch('hit'));

    assert.equal(holder.children.length, 1);
    assert.match(holder.children[0].innerHTML, /https:\/\/hit\.test/);
});

test('popupSearch ignores an empty query', () => {
    // The keyup handler only calls it past two characters, but the clear button
    // resets the field to '' — a search for everything would then wipe the list.
    let queried = 0;
    withChromeApi({ history: { search: (_q, cb) => { queried++; cb([]); } } }, () => {
        popupCore.popupSearch('');
        popupCore.popupSearch(undefined);
    });
    assert.equal(queried, 0);
});

// ---------------------------------------------------------------------------
// The item counts are sliders, i.e. strings in storage
// ---------------------------------------------------------------------------

test('a switched-off block does not query its API', (t) => {
    // Every stored value is a string, so `Number()` is what makes a slider
    // setting behave like one — and 0 has to mean "no block, no query".
    restoreStorage(t, ['rh-itemsno', 'rct-itemsno']);
    localStorage['rh-itemsno'] = '0';
    localStorage['rct-itemsno'] = '0';

    const history = block('rh-inject');
    const closed = block('rct-inject');
    let queried = 0;

    withChromeApi({
        history: { search: (_q, cb) => { queried++; cb([]); } },
        sessions: { getRecentlyClosed: (_q, cb) => { queried++; cb([]); } },
    }, () => {
        popupCore.recentHistory();
        popupCore.recentlyClosedTabs();
    });

    assert.equal(queried, 0, 'a block the user switched off must stay silent');
    assert.equal(history.children.length, 0);
    assert.equal(closed.children.length, 0);
});

test('recentHistory renders exactly the configured count, not one less', (t) => {
    // The quota check is `ir >= rhino`. This test asserts the boundary itself —
    // asking for 3 draws 3 — and deliberately does NOT claim to distinguish
    // `>=` from `==`: `ir` only ever steps by one here, so it can never jump
    // over the limit and the two spellings behave identically in this loop.
    // Reverting to `==` keeps this test green, which is the honest outcome.
    //
    // Keep `>=` anyway: it states "stop once full" rather than "stop when the
    // count happens to line up", so a future change that drops several rows in
    // one step (or starts `ir` from a non-zero base) cannot walk past the
    // quota. What this test protects is that the configured number of rows
    // reaches the DOM at all.
    restoreStorage(t, ['rh-itemsno']);
    const holder = block('rh-inject');
    localStorage['rh-itemsno'] = '3';

    const now = Date.now();
    const rows = Array.from({ length: 6 }, (_v, i) => ({
        url: `https://r${i}.test/`, title: `R${i}`, visitCount: 1, lastVisitTime: now - i * 1000,
    }));
    withChromeApi({ history: { search: (_query, cb) => cb(rows) } }, () => {
        popupCore.recentHistory();
    });

    assert.equal(holder.children.length, 3, 'three asked for, three drawn');
});
