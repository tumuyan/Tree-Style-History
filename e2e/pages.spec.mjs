// Smoke tests: load the unpacked extension in a real Chromium and assert that
// every shipped page opens without throwing.
//
// Why this file lives outside `tests/`:
//   `npm test` globs `tests/**/*.test.mjs` and must stay runnable in the bare
//   `node:22` CI image, which has no browser. This suite needs a real DOM, a
//   real service worker, real IndexedDB and real `chrome.*` APIs, so it gets
//   its own glob and its own npm script (`npm run test:e2e`).
//
// Everything below follows the official Playwright extension guide
// (https://playwright.dev/docs/chrome-extensions):
//   * extensions only work in a *persistent* context — they are disabled in a
//     normal `browser.newContext()`;
//   * `channel: 'chromium'` is required for headless. Chrome and Edge removed
//     the command-line flags that side-load extensions, and the headless shell
//     does not support them either, so Playwright's bundled Chromium is the
//     only option;
//   * the MV3 extension id is read off the service worker URL — there is no
//     background page to read it from any more.
//
// Two classes of console output are kept apart on purpose:
//   * JS errors (uncaught exceptions + console.error from extension code) fail
//     the test. These are the "page is broken" signal we are after.
//   * network errors are reported but do not fail. The popup renders favicons
//     through third-party services and `chrome://favicon/`; in a sandbox with
//     no egress every one of them fails, which is a degraded icon, not a
//     broken page.
//
// Favicon requests to the five third-party services are aborted up front
// (FAVICON_SERVICE_HOSTS below). Offline they do not "fail" — the connection
// hangs, and an `<img>` request that is still pending keeps the document's
// `load` event from firing. That made `goto(waitUntil: 'load')` time out at
// random on whichever case rendered the first external favicon. Aborting turns
// the hang into the immediate `img` error the frontend already degrades on.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const CHROME_DIR = fileURLToPath(new URL('../chrome', import.meta.url));

/**
 * Every page a user can reach: 5 full pages plus the toolbar popup.
 * `options.html` is also `manifest.options_page`, so it is reachable twice.
 */
const PAGES = [
    'popup.html',
    'history.html',
    'history2.html',
    'closed.html',
    'bookmark.html',
    'options.html',
];

// Playwright is a devDependency that is only needed for this suite; if it is
// absent (or its browser was never downloaded) the whole file skips instead of
// blowing up `npm run test:e2e`.
let chromium = null;
try {
    ({ chromium } = await import('playwright'));
} catch {
    chromium = null;
}

const SKIP = chromium ? false : 'playwright is not installed — run: npm i -D playwright && npx playwright install chromium';

// Mirrors FAVICON_SERVICE_PATTERNS in scripts/background-sw.js — the hostnames
// getFaviconUrl() can produce. Keep the two lists in step.
const FAVICON_SERVICE_HOSTS = [
    'icons.duckduckgo.com',
    'www.google.com/s2/favicons',
    'favicon.im/',
    'ico.faviconkit.net/',
    'faviconsnap.com/api/favicon',
];

const isFaviconServiceUrl = (url) => FAVICON_SERVICE_HOSTS.some((host) => url.href.includes(host));

/** How long to let async rendering run after `load` fires. */
const SETTLE_MS = 1500;

let context = null;
let extensionId = '';

before(async () => {
    if (!chromium) return;

    context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        args: [
            `--disable-extensions-except=${CHROME_DIR}`,
            `--load-extension=${CHROME_DIR}`,
        ],
    });

    // Registered on the context so it covers every page opened below, including
    // the ones a later case adds. A per-case `page.route()` would miss the
    // requests issued between navigation start and the route being installed.
    await context.route((url) => url.protocol !== 'chrome-extension:' && isFaviconServiceUrl(url), (route) => route.abort());

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');

    // e.g. chrome-extension://gighmmpiobklfepjocnamgkkbiglidom/background-sw.js
    extensionId = serviceWorker.url().split('/')[2];
});

after(async () => {
    if (context) await context.close();
});

/**
 * Attach error collectors to a page.
 *
 * Returns the two buckets described in the header comment. `jsErrors` is what
 * the assertion looks at; `netErrors` exists so a failure report can mention
 * that the sandbox simply has no network.
 */
function collectErrors(page) {
    const jsErrors = [];
    const netErrors = [];

    page.on('pageerror', (err) => {
        jsErrors.push(`uncaught ${err.name}: ${err.message}`);
    });

    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const url = msg.location()?.url ?? '';
        const text = msg.text();
        // A failing request is reported against the *resource* URL, so an
        // unreachable favicon service lands here with an external URL.
        if (url.startsWith('chrome-extension://')) {
            jsErrors.push(`console.error: ${text}`);
        } else {
            netErrors.push(text);
        }
    });

    return { jsErrors, netErrors };
}

/**
 * Wait until the page has actually finished its asynchronous work.
 *
 * Two things have to settle, and neither is covered by `waitUntil: 'load'`:
 *   1. `storage-adapter.js` fills its cache from `chrome.storage.local` in a
 *      callback. Every page entry point is wrapped in `onStorageReady()`, so
 *      nothing renders — and nothing can throw — before that resolves.
 *   2. `history2.html` / `closed.html` render in chunks driven by
 *      `setInterval(..., 5)` and read IndexedDB.
 *
 * `networkidle` is deliberately NOT used: the pages keep requesting favicons
 * from third-party services, and offline every one of those fails, so the
 * network settles late and unreliably. Wait on the storage cache instead.
 */
async function settle(page) {
    await page.evaluate(() => (window.storageAdapter ? window.storageAdapter.ready() : undefined));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

/**
 * Read `localStorage[key]` off `page` until it equals `expected`, or give up.
 *
 * chrome.storage.onChanged is delivered to the other contexts asynchronously,
 * with no ordering guarantee against the write's own callback in the page that
 * made it. So "the other page can see it" is a property to poll for, not to
 * read once — a single read fails intermittently on a busy profile.
 */
async function waitForCacheValue(page, key, expected, timeout = 5000) {
    const deadline = Date.now() + timeout;
    let seen;
    do {
        seen = await page.evaluate((k) => localStorage[k], key);
        if (seen === expected) return seen;
        await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return seen;
}

test('the extension loads and its service worker boots', { skip: SKIP }, async () => {
    assert.match(extensionId, /^[a-p]{32}$/, `expected a packed extension id, got: ${extensionId}`);
});

test('the service worker seeds defaultConfig into storage', { skip: SKIP }, async () => {
    // If the SW dies on startup, `defaultConfig()` never runs and every page
    // reads `undefined` out of localStorage — the popup then throws on
    // `localStorage['rh-list-order'].split(',')`. Asserting the seed here
    // pins the *cause* rather than the downstream symptom.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await settle(page);

    const missing = await page.evaluate(() => {
        const keys = ['rh-list-order', 'rh-itemsno', 'show-popup', 'favicon-service', 'rh-width'];
        return keys.filter((k) => localStorage[k] === undefined);
    });

    // Not asserted in-page: options.js itself may mutate values on load.
    assert.deepEqual(missing, [], 'service worker did not seed defaultValues');

    await page.close();
});

for (const file of PAGES) {
    test(`${file} opens without JavaScript errors`, { skip: SKIP }, async () => {
        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);

        await page.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'load' });
        await settle(page);

        // The page must also have rendered its shell, not just avoided throwing.
        const title = await page.title();

        await page.close();

        assert.deepEqual(
            jsErrors,
            [],
            [
                `${file} threw while loading.`,
                netErrors.length ? `(${netErrors.length} non-fatal network error(s) ignored — no egress in this sandbox)` : '',
            ].filter(Boolean).join(' '),
        );
        assert.ok(title.length > 0, `${file} has an empty <title>`);
    });
}

for (const file of ['history2.html', 'closed.html']) {
    test(`${file} renders its tree without zTree`, { skip: SKIP }, async () => {
        // The suites above only prove the page does not throw, and a page that
        // silently renders nothing passes them — which is exactly what dropping
        // a library can produce. Both tree pages now draw through
        // scripts/modules/tree.js, so assert the rows are really there, that
        // they carry the class names css/zTreeStyle.css styles (the stylesheet
        // stayed, the library did not), and that jQuery is gone.
        //
        // No seeded data: with an empty database both pages fall back to their
        // "nothing found" placeholder, and that is still two rows the renderer
        // has to draw.
        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);
        await page.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'load' });
        await settle(page);

        const shape = await page.evaluate(() => ({
            rows: document.querySelectorAll('#treeDemo li[data-tid]').length,
            switches: document.querySelectorAll('#treeDemo span.button.switch').length,
            icons: document.querySelectorAll('#treeDemo span.button.ico').length,
            jquery: typeof window.jQuery,
        }));
        await page.close();

        assert.deepEqual(jsErrors, [], `${file} threw (${netErrors.length} network error(s) ignored)`);
        assert.ok(shape.rows > 0, `the native renderer drew no rows at all on ${file}`);
        assert.equal(shape.switches, shape.rows, 'every row needs a switch span for the stylesheet');
        assert.equal(shape.icons, shape.rows, 'and an ico span, or the favicon/folder glyph is missing');
        assert.equal(shape.jquery, 'undefined', `${file} must not load jQuery any more`);
    });
}

test('bookmark.html renders a bookmark title verbatim in grouped mode', { skip: SKIP }, async () => {
    // The six suites above only prove the pages do not throw; every one of them
    // renders an EMPTY list, so the render loops that build an item never run.
    // This seeds a real bookmark so they do.
    //
    // Deliberately hostile: a page title is attacker-controlled, and this one
    // carries every character that used to be mangled. Slashes were deleted
    // outright by title_fix(); quotes were pre-escaped and then escaped again
    // into a literal '&#34;'; tags used to be deleted rather than escaped, so
    // they never proved anything.
    const TITLE = 'Docs / API "v2" <b>x</b>';

    // Seeded from options.html: the bookmark has to exist before the navigation,
    // and every extension page can reach chrome.bookmarks.
    let bookmarkId;
    {
        const seed = await context.newPage();
        const { jsErrors } = collectErrors(seed);
        await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
        await settle(seed);
        bookmarkId = await seed.evaluate(async (title) => {
            localStorage['rh-group'] = 'yes';
            // The proxy flushes to chrome.storage.local asynchronously, and the
            // seed page closes right after this. Optional chaining because not
            // every page exposes the adapter — see settle().
            await window.storageAdapter?.ready();
            const node = await chrome.bookmarks.create({
                title,
                url: 'https://tree-style-history.test/path',
            });
            return node.id;
        }, TITLE);
        assert.deepEqual(jsErrors, [], 'seeding the bookmark threw');
        await seed.close();
    }

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/bookmark.html`, { waitUntil: 'load' });
    await settle(page);
    // textContent rather than innerText: a collapsed group is absent from
    // innerText, and whether the first group ends up expanded is an
    // implementation detail this assertion must not depend on.
    const rendered = await page.evaluate(() => document.body.textContent);
    const injected = await page.evaluate(() => document.querySelectorAll('.title b').length);
    await page.close();

    try {
        assert.deepEqual(jsErrors, [], `the grouped render loop threw (${netErrors.length} network error(s) ignored)`);
        // Two failure modes, one assertion each:
        //   * not escaped at all -> `<b>` really exists in the DOM
        //   * escaped twice     -> the entity shows up verbatim in the text
        // Only a single pass of escapeHtmlText() satisfies both.
        assert.equal(injected, 0, 'the <b> in the title became a real element');
        assert.match(rendered, /Docs \/ API "v2" <b>x<\/b>/, 'the title must be shown verbatim, entities included');
    } finally {
        // Guarded: if create() above threw, bookmarkId is undefined and an
        // unguarded remove() would throw again and mask the real failure.
        if (bookmarkId) {
            const cleanup = await context.newPage();
            await cleanup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await cleanup.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
            await cleanup.close();
        }
    }
});

test('a page still applies its saved zoom when storage answers late', { skip: SKIP }, async () => {
    // `page-init.js` reads `popup-zoom` / `page-zoom` at DOMContentLoaded, which
    // fires BEFORE chrome.storage.local.get() has answered — so the key reads
    // `undefined` and the page silently renders at 100%. Nothing is thrown and
    // nothing is logged, which is why this survived every existing suite: the
    // six "opens without JavaScript errors" cases all pass with the zoom lost.
    //
    // The delay below is what makes it reproducible: normally the read resolves
    // in ~30ms and DOMContentLoaded often (but not reliably) lands after it.
    const ZOOM_DELAY_MS = 1500;

    const zoomOf = async (file) => {
        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);
        await page.addInitScript((delay) => {
            const realGet = chrome.storage.local.get.bind(chrome.storage.local);
            chrome.storage.local.get = (keys, cb) => realGet(keys, (items) => setTimeout(() => cb(items), delay));
        }, ZOOM_DELAY_MS);
        await page.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'load' });
        // `settle()` cannot be used here: it polls `storageAdapter.ready()`, and
        // readiness is exactly what is being delayed. Wait for the effect the
        // test is about instead, then give the rest of the boot a fixed margin
        // before collecting errors — every other case settles in `SETTLE_MS`.
        //
        // The margin is bounded by `ZOOM_DELAY_MS`, not stacked on top of it:
        // `waitForFunction` already returns once the delayed `get()` has landed,
        // so what is left to wait for is the same render the other cases wait
        // for. Adding the delay again would just re-pay for time already spent.
        let zoom = '';
        try {
            await page.waitForFunction(() => document.body.style.zoom !== '', { timeout: ZOOM_DELAY_MS });
            zoom = await page.evaluate(() => document.body.style.zoom);
        } catch {
            zoom = await page.evaluate(() => document.body.style.zoom);
        }
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        await page.close();
        assert.deepEqual(jsErrors, [], `${file} threw while waiting for storage (${netErrors.length} network error(s) ignored)`);
        return zoom;
    };

    // Seeded and restored through an ordinary page, so both go through the
    // adapter. Restoring matters: these two keys are global to the extension
    // profile, and a run that leaves them at 150 changes what every later case
    // in this file renders.
    const seed = await context.newPage();
    const { jsErrors: seedErrors } = collectErrors(seed);
    await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(seed);

    try {
        await seed.evaluate(async () => {
            localStorage['page-zoom'] = '150';
            localStorage['popup-zoom'] = '150';
            await window.storageAdapter.ready();
        });

        for (const file of ['history2.html', 'popup.html']) {
            assert.equal(await zoomOf(file), '150%', `${file} lost the saved zoom`);
        }
        assert.deepEqual(seedErrors, [], 'seeding the zoom threw');
    } finally {
        await seed.evaluate(async () => {
            localStorage['page-zoom'] = '100';
            localStorage['popup-zoom'] = '100';
            await window.storageAdapter.ready();
        });
        await seed.close();
    }
});

test('popup.html renders its tab block from a seeded snapshot', { skip: SKIP }, async () => {
    // The six "opens without JavaScript errors" cases all load the popup in a
    // fresh profile, where there is one about:blank tab and no history: the
    // "recent tabs" block hides itself and its render loop never runs.
    //
    // Seeded through chrome.storage.session rather than localStorage because
    // that is where the worker mirrors the list, and the popup reads it from
    // there — a write to localStorage would be invisible to this block. The
    // version field is what makes the snapshot acceptable at all.
    const seed = await context.newPage();
    const { jsErrors: seedErrors } = collectErrors(seed);
    await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(seed);

    try {
        await seed.evaluate(async () => {
            localStorage['rt-itemsno'] = '6';
            await window.storageAdapter.ready();
            await chrome.storage.session.set({
                'tab-list': {
                    v: 1,
                    openedTabs: {
                        11: { id: 11, url: 'https://tab-a.test/1', title: 'Tab A' },
                        12: { id: 12, url: 'https://tab-b.test/1', title: 'Tab B' },
                    },
                    recentTabs: [12, 11],
                },
            });
        });
        assert.deepEqual(seedErrors, [], 'seeding the tab list threw');

        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);
        await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
        await settle(page);

        const shape = await page.evaluate(() => ({
            rows: document.querySelectorAll('#rt-inject .item').length,
            // Activation order is the whole reason the list is mirrored at all:
            // a live `chrome.tabs.query()` cannot reconstruct it.
            first: document.querySelector('#rt-inject .item .url')?.textContent ?? '',
            visible: document.getElementById('rt-inject')?.style.display ?? 'gone',
        }));
        await page.close();

        assert.deepEqual(jsErrors, [], `popup threw (${netErrors.length} network error(s) ignored)`);
        assert.equal(shape.rows, 2, 'both tabs from the snapshot are listed');
        assert.match(shape.first, /tab-b\.test/, 'the most recently activated tab comes first');
        assert.notEqual(shape.visible, 'none', 'a block with rows must not hide itself');
    } finally {
        await seed.evaluate(async () => {
            await chrome.storage.session.remove('tab-list');
            localStorage['rt-itemsno'] = '0';
            await window.storageAdapter.ready();
        });
        await seed.close();
    }
});

test('popup.html renders the most-visited block from a short cache', { skip: SKIP }, async () => {
    // The six "opens without JavaScript errors" cases all load the popup with
    // an EMPTY `mv-cache`, so mostVisited() never enters its loop. The bug it
    // used to hide — walking MOST_VISITED_MAX rows of a cache that is usually
    // much shorter, and throwing on `mvd[i].title` — is therefore invisible to
    // them, and it throws inside the block loop, so every block after it is
    // silently lost.
    //
    // Seeded through a real page and the real adapter, like the bookmark case:
    // three rows against a configured 8 is the shape that used to throw.
    const seed = await context.newPage();
    const { jsErrors: seedErrors } = collectErrors(seed);
    await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(seed);

    try {
        await seed.evaluate(async () => {
            localStorage['mv-itemsno'] = '8';
            localStorage['mv-blocklist'] = 'false';
            // Written explicitly rather than left to the worker's defaultConfig():
            // the popup only creates #rb-inject when this is > 0, and the
            // assertion below would otherwise depend on when the worker got
            // round to seeding defaults. 3 is the default.
            localStorage['rb-itemsno'] = '3';
            localStorage['mv-cache'] = JSON.stringify([
                { url: 'https://mv-a.test/1', title: 'MV A', favicon: '', visitCount: 9 },
                { url: 'https://mv-b.test/1', title: 'MV B', favicon: '', visitCount: 8 },
                { url: 'https://mv-c.test/1', title: 'MV C', favicon: '', visitCount: 7 },
            ]);
            await window.storageAdapter.ready();
        });
        assert.deepEqual(seedErrors, [], 'seeding the most-visited cache threw');

        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);
        await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
        await settle(page);

        const shape = await page.evaluate(() => ({
            rows: document.querySelectorAll('#mv-inject .item').length,
            // The block after "most visited" in the default rh-list-order:
            // this is what used to be swallowed by the throw. The container, not
            // its rows: a fresh profile has no bookmarks, but popup.js creates
            // it from rb-itemsno before any query returns.
            bookmarks: document.querySelectorAll('#rb-inject').length,
            text: document.body.textContent,
        }));
        await page.close();

        assert.deepEqual(jsErrors, [], `popup threw (${netErrors.length} network error(s) ignored)`);
        assert.equal(shape.rows, 3, 'every cached row must be rendered');
        assert.match(shape.text, /MV C/, 'the last cached row must survive');
        assert.equal(shape.bookmarks, 1, 'the block after "most visited" must still be there');
    } finally {
        await seed.evaluate(async () => {
            localStorage.removeItem('mv-cache');
            localStorage['mv-itemsno'] = '0';
            await window.storageAdapter.ready();
        });
        await seed.close();
    }
});

/**
 * The service worker, for the cases that have to drive its own code.
 *
 * `page.evaluate()` runs in the page's realm; the crawl and everything it
 * accumulates live in the worker's. Playwright can evaluate there too, and it
 * is the only way to run the crawl deterministically.
 */
function worker() {
    const sw = context.serviceWorkers()[0];
    assert.ok(sw, 'the service worker must be up to drive the crawl');
    // The startup crawl normally runs in a freshly woken worker. These cases
    // run it on demand instead, and a worker that is already mid-crawl would
    // interleave with it (both write `visitBatch`/`heatDays`), so wait for the
    // one Playwright knows about to be the one that answers.
    return sw;
}

/**
 * Run the shipped crawl over a single synthetic URL, then put history back.
 *
 * `processVisits()` reads `urls_wait_load`, which `loadHistory()` normally fills
 * from IndexedDB. Driving it directly is what makes the case independent of
 * what the browser happens to have in its own history.
 *
 * The map is read back out of storage rather than off `calendar_storage2`: that
 * in-worker object is the boot-time copy, and "what did the crawl leave behind
 * for a page to read" is the question here.
 */
/* eslint-disable no-undef -- inside worker().evaluate(); see above */
// The two hand-driven crawl cases below each reset the single `crawl-state`
// object to a fresh window first (see the comment at the call site). The
// startup crawl may have left a completed-window sweep watermark there; that
// watermark makes a hand-driven pass incremental and filters the seed URL out.
// It used to be an argument to processVisits(), so calling it with no argument
// walked the whole queue — now it is a field of the state object and has to be
// reset explicitly. The call is written inline because an e2e-side helper is
// not visible inside page/worker evaluate() realms.
async function runCrawlOnOneUrl(url) {
    return worker().evaluate(async (u) => {
        const saved = urls_wait_load;
        urls_wait_load = [{ id: 'seed', url: u, title: 'Seed', lastVisitTime: Date.now() }];
        heatDays = {};
        await saveCrawlState(emptyCrawlState());
        await processVisits();
        urls_wait_load = saved;
        globalThis.restoreHistory();
        return JSON.parse(localStorage['calendar-storage2'] || '{}');
    }, url);
}
/* eslint-enable no-undef */

/**
 * Clear the heat map — in *both* places it lives — and report what is left.
 *
 * shared/calendar-storage.js empties its parsed map on a `chrome.storage`
 * removal, but that broadcast is asynchronous: the `evaluate()` below reads
 * storage back before it has necessarily arrived. Delete the in-memory copy
 * here too, so the case cannot race the listener. Both sides are emptied, and
 * storage is read back so the caller can assert the map really did start empty.
 */
/* eslint-disable no-undef -- inside worker().evaluate(); see above */
async function resetAndReadStoredHeatMap() {
    return worker().evaluate(() => {
        localStorage.removeItem('calendar-storage2');
        for (const key of Object.keys(calendar_storage2)) delete calendar_storage2[key];
        return JSON.parse(localStorage['calendar-storage2'] || '{}');
    });
}
/* eslint-enable no-undef */

/**
 * Put a known visit on a day that the calendar will actually show, inside the
 * crawl's window.
 *
 * The day is in the past on purpose: `load-range` (7 days by default) bounds
 * what the crawl walks, and today is deliberately never written by the worker —
 * see the "never writes today" case below, which asserts exactly that.
 *
 * "In the displayed month" is the second constraint, and it is why the day is
 * chosen rather than hard-coded to yesterday: calendar() renders one month, so
 * on the 1st, yesterday is in the previous month with no cell to assert on.
 *
 * `chrome.history.getVisits()` is stubbed for the duration of the crawl rather
 * than seeding real history, because `chrome.history.addUrl()` always
 * timestamps with "now" and nothing else in the API writes a visit at a chosen
 * time. `deleteRange()` reads like the answer, but against a real browser an
 * old window is accepted and changes nothing, while a window over data still in
 * Chrome's in-memory buffer can instead *flush* it — so it cannot be used to
 * build history either. The stub only has to be good enough for the crawl's own
 * code path, which is what these cases are about.
 */
async function seedBackfillableVisit() {
    return worker().evaluate(() => {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        // A day of the month the calendar is showing, not just "yesterday".
        // calendar() draws exactly one month (`cdateo`, today's), so yesterday
        // has no cell when today is the 1st — the assertion would then fail on
        // the calendar's layout rather than on the back-fill. Walk back to the
        // 2nd, which is always in the displayed month, and use *its* end as the
        // write time (an hour before, so the visit is unambiguously that day).
        const target = new Date(end);
        if (target.getDate() === 1) target.setDate(2);
        else target.setDate(target.getDate() - 1);
        target.setHours(23, 59, 59, 999);
        const when = target.getTime() - 3600000;

        const real = chrome.history.getVisits;
        chrome.history.getVisits = (q, cb) => cb([
            { visitId: 990001, visitTime: when, transition: 'link', referringVisitId: 0 },
            { visitId: 990002, visitTime: when + 60000, transition: 'link', referringVisitId: 0 },
        ]);
        globalThis.restoreHistory = () => { chrome.history.getVisits = real; };
        return { yesterday: target.getTime(), today: end.getTime() };
    });
}

/**
 * Boot the shipped worker into a page and run one crawl, from a planted map.
 *
 * The map is planted in `chrome.storage.local` before the scripts are injected,
 * so the worker's boot hydrates it — the path a real worker start takes, and
 * the only way to test "a day that already has a count is not re-written".
 * shared/calendar-storage.js also re-hydrates on `chrome.storage.onChanged`,
 * but nothing writes the key between the injection and the crawl below, so
 * that listener stays idle and the boot-time copy is what the crawl reads.
 *
 * `new Worker()` is not an option: an MV3 service worker is started by the
 * browser, so there is no way to hand it pre-seeded storage before it boots.
 * Evaluating the same four files as classic scripts does boot the real worker,
 * with three differences from a worker realm, all supplied here:
 *
 *   * `importScripts` does not exist in a page. Left undefined it throws at
 *     `background-sw.js` line 5 and the *entire* file body never executes —
 *     the failure surfaces as an unrelated TDZ error further down. It is a
 *     no-op here because the files it would load are already loaded.
 *   * the worker's browser-driven entry points are never fired here; the one
 *     that would throw on the `onStorageReady` path is stubbed out. The crawl
 *     needs neither.
 *   * an empty first-party realm: `options.html` loads no module bundle, so the
 *     worker's own declarations cannot collide with a copy of them (two `const`
 *     bindings of the same name in one realm is a collision, not a shadow).
 *
 * Everything the crawl touches — `chrome.history`, `chrome.storage`,
 * IndexedDB, `localStorage` — exists in both realms, so the code under test is
 * the shipped file rather than a copy of it.
 *
 * `dayKey` is the day to plant as "already counted"; "today" (`dayKey + DAY`)
 * is always planted too, at a different value, so that "today was not written"
 * is an assertion and not the absence of one. `clearMap: true` instead starts
 * from an empty map, which is the state the bug lives in. Returns the worker's
 * own hydrated map, whether the crawl walked anything, and the map left in
 * storage.
 */
/* eslint-disable no-undef -- inside page.evaluate(); see above */
async function probeWorkerWithPlantedDay(dayKey, clearMap = false) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(page);

    // Everything the bank of cases wants, arranged before the worker boots: the
    // map it will hydrate, and the visit its crawl will find. `chrome.history`
    // is stubbed *before* the worker loads, because its own startup path reaches
    // it — `background-sw.js` is a classic script whose boot calls
    // `loadHistory()`, and a stub installed afterwards loses the race.
    const seeded = await page.evaluate(async ({ dayKey, clearMap }) => {
        const DAY = 86400000;
        localStorage.removeItem('calendar-storage2');
        if (!clearMap) {
            // A count no visit could have produced, so "did it overwrite?" has
            // an unambiguous answer; and today's key at a different value, so
            // "today was written" is just as unambiguous.
            localStorage['calendar-storage2'] = JSON.stringify({ [dayKey]: 4242, [dayKey + DAY]: 777 });
        }
        localStorage['load-range'] = '7';
        await window.storageAdapter.ready();

        // `Date.now()`: unambiguously today, whichever side of midnight the run
        // lands on. A time derived from a day *key* is pinned to 23:59:59.999
        // and could answer for tomorrow instead.
        const visit = { visitId: 980001, visitTime: Date.now(), transition: 'link', referringVisitId: 0 };
        window.__visitsServed = 0;
        const realGetVisits = chrome.history.getVisits;
        chrome.history.getVisits = (q, cb) => {
            window.__visitsServed++;
            return cb(q.url === 'https://seed.test/heat' ? [visit] : []);
        };
        window.__realGetVisits = realGetVisits;

        // Supplied by a worker realm, called by the browser, absent in a page.
        window.importScripts = () => {};
        window.mostVisitedInit = () => {};
        return { today: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })(), visit };
    }, { dayKey, clearMap });

    // The browser's own ordering for the files the worker asks for by name.
    for (const name of ['storage-adapter.js', 'background-utils.js', 'db-manager.js', 'background-sw.js']) {
        await page.addScriptTag({ url: `chrome-extension://${extensionId}/scripts/${name}` });
    }
    // The worker's boot is asynchronous: `loadHistory()` walks the database and
    // then crawls. Let it finish before driving the crawl by hand, or the two
    // would interleave on the same accumulators.
    await settle(page);

    const probe = await page.evaluate(async () => {
        // Drive the crawl over a known URL list. `loadHistory()` has already run
        // by now and left its own list behind; this replaces it, the same way
        // the other cases here do.
        urls_wait_load = [{ id: 'seed', url: 'https://seed.test/heat', title: 'Seed', lastVisitTime: Date.now() }];
        heatDays = {};
        await saveCrawlState(emptyCrawlState());
        await processVisits();

        // `calendar_storage2` is the worker's own hydrated copy; storage is what
        // a page would read. Both are reported, and the case asserts on both.
        return {
            hydrated: Object.values(calendar_storage2),
            keys: Object.keys(calendar_storage2),
            map: JSON.parse(localStorage['calendar-storage2'] || '{}'),
            counted: JSON.stringify(heatDays),
        };
    });

    await page.close();
    return { ...probe, today: seeded.today };
}
/* eslint-enable no-undef */

test('the crawl back-fills the heat map for the days it walks', { skip: SKIP }, async () => {
    // The map is a cache of the past, and the crawl is the only writer that can
    // reach days older than today — the page only ever counts the day it is
    // showing. Asserted against the *stored map*: a rendered cell has a second
    // way to get coloured (the page's own click-path paint), so a coloured cell
    // alone would not prove the worker did anything.
    // Start from a clean map: it is shared with the other cases, and "was this
    // day written?" would otherwise answer yes for reasons of its own.
    const empty = await resetAndReadStoredHeatMap();
    assert.deepEqual(empty, {}, 'the case must start from an empty map');
    const landmarks = await seedBackfillableVisit();
    const map = await runCrawlOnOneUrl('https://seed.test/heat');

    assert.equal(map[landmarks.yesterday], 2, `the visited day must hold both visits (map was ${JSON.stringify(map)})`);
    assert.equal(map[landmarks.today], undefined, 'the crawl must not write today — the page owns it');
});

test('a day the map already has a count for is not written again', { skip: SKIP }, async () => {
    // The "unless there is no data" half of the request: the map is filled, not
    // recomputed. A day that already has a count keeps it, which is what makes
    // the back-fill free once the days have been walked through once.
    //
    // The count is planted where the worker will read it — storage, before its
    // own boot, because a live worker hydrates its map once. See
    // probeWorkerWithPlantedDay().
    const dayKey = await worker().evaluate(() => {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        return end.getTime() - 86400000;
    });
    const probe = await probeWorkerWithPlantedDay(dayKey);

    // Guards on the case itself, in order: the worker's own map really did
    // hydrate the plant (so this is not "an empty map was left alone"), and its
    // crawl really did count a visit for the day it walked (so this is not
    // "nothing ran at all"). Without the second, "kept 4242" is unfalsifiable.
    assert.deepEqual(
        probe.hydrated.slice().sort((a, b) => a - b),
        [777, 4242],
        'the plant must reach the worker\'s own hydrated map',
    );
    assert.equal(
        probe.counted,
        `{"${probe.today}":1}`,
        'the crawl must have counted the seeded visit towards today',
    );
    assert.equal(
        probe.map[dayKey],
        4242,
        `the crawl overwrote a day it had nothing new to say about (map was ${JSON.stringify(probe.map)})`,
    );
    assert.equal(
        probe.map[probe.today],
        777,
        `the crawl wrote today on top of the page's count (map was ${JSON.stringify(probe.map)})`,
    );
});

test('the crawl never writes today, even into an empty map', { skip: SKIP }, async () => {
    // The boundary both cases above take for granted, in the only state that
    // makes it visible. Today belongs to the page: it counts the day it is
    // displaying, and only it sees browsing that happened after the crawl ran.
    // A count taken by the crawl would be today as it stood at crawl time —
    // and being non-zero, it would then hide today from every later crawl, long
    // after the page's fresher number is gone.
    //
    // The map starts empty, because with today already planted this is
    // indistinguishable from "an existing count wins" — which is the case
    // above. The bug lives in the empty-map path: a fresh install, or a history
    // that was cleared.
    //
    // The seeded visit falls on today and nowhere else, so "the crawl wrote
    // nothing at all for it" is exactly `today` being absent.
    const probe = await probeWorkerWithPlantedDay(0, true);

    assert.deepEqual(probe.hydrated, [], 'the case must start from an empty map');
    // The control, and the reason the absence below is an assertion rather than
    // the lack of one: the crawl really did count a visit, for today.
    assert.equal(
        probe.counted,
        `{"${probe.today}":1}`,
        'the crawl must have counted the seeded visit towards today',
    );
    assert.equal(
        probe.map[probe.today],
        undefined,
        `the crawl wrote today into an empty map (map was ${JSON.stringify(probe.map)})`,
    );
    assert.deepEqual(
        probe.keys,
        [],
        `today was the only day the crawl saw, so the worker's map must be empty too (had ${JSON.stringify(probe.keys)})`,
    );
});

test('history2.html paints a day the worker back-filled, without counting it itself', { skip: SKIP }, async () => {
    // history2.html never calls history(): it fetches its own tree from
    // IndexedDB over a multi-day range and counts no single day. So any colour
    // on a day here can only have come from the shared map — which is the
    // "reuse that data, do not recompute" half of the request.
    //
    // The back-filled day is in the past on purpose. Today belongs to the page
    // (only it can see browsing that happened after the crawl ran), while an
    // older day inside `load-range` has exactly one possible author: the crawl.
    //
    // Asserted against the map the page renders from *and* the cell it paints,
    // because either alone is weak: calendar.js paints every cell in one pass,
    // so a missing entry and an emptied style look the same from the DOM, and
    // "some cell has a colour" would be satisfied by today's own count.
    await resetAndReadStoredHeatMap();
    const landmarks = await seedBackfillableVisit();
    const written = await runCrawlOnOneUrl('https://seed.test/heat');

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
    await settle(page);

    const painted = await page.evaluate(async (key) => {
        await window.storageAdapter.ready();
        const map = JSON.parse(localStorage['calendar-storage2'] || '{}');
        const day = new Date(key);
        // Cells are `<a class="day">NN</a>` in order; only the selected one
        // carries a `rel`, so the day is located by its number within the
        // displayed month (which is why, in the last week of a month, the day
        // before the 1st simply has no cell — the calendar shows one month).
        const cells = [...document.querySelectorAll('#calendar-days a')];
        const cell = cells.find((a) => Number(a.textContent.trim()) === day.getDate());
        return {
            stored: map[key],
            found: cell !== undefined,
            backgroundColor: cell ? cell.style.backgroundColor : null,
        };
    }, landmarks.yesterday);
    await page.close();

    assert.equal(
        written[landmarks.yesterday],
        2,
        `the crawl did not write the day (map was ${JSON.stringify(written)})`,
    );

    assert.deepEqual(jsErrors, [], `history2.html threw (${netErrors.length} network error(s) ignored)`);
    assert.equal(painted.stored, 2, 'the page must see the back-filled count in its heat map');
    assert.equal(painted.found, true, 'the back-filled day has no cell in the calendar');
    assert.notEqual(painted.backgroundColor, '', 'the back-filled day must be painted, not left blank');
});

test('history.html drops a day from the heat map once its history is gone', { skip: SKIP }, async () => {
    // The user-visible half of "a count of 0 is a deletion". `save_calendar_
    // storage2(obj, 0, …)` is the only code in the extension that removes a
    // heat-map entry, so if the write is skipped whenever the list comes back
    // empty, nothing can ever clean up — and the call used to sit inside
    // `if (rha.length > 0)`, which is exactly the case it exists for.
    //
    // The day is in the *past* on purpose: `history()` writes today every time
    // it loads, so a plant on today would be overwritten by the page's own
    // start and the case could not tell who removed it. An older day is only
    // ever written by this page when it is the selected one, which is what the
    // case does below.
    //
    // Nothing here talks to the service worker: both writers involved
    // (history() and the range delete) are page-side. The worker does hold its
    // own copy, but shared/calendar-storage.js re-hydrates on every storage
    // change, so a crawl can no longer flush a stale copy over these writes.
    const page = await context.newPage();
    const { jsErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(page);

    // Planted from the page that is about to read it, through the API rather
    // than the adapter cache: the mirror is asynchronous, and reloading before
    // it lands would hydrate from the previous value.
    const day = await page.evaluate(async () => {
        await window.storageAdapter.ready();
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        // Same walk-back as seedBackfillableVisit(): calendar() draws exactly
        // one month, so yesterday has no cell when today is the 1st.
        if (d.getDate() === 1) d.setDate(2);
        else d.setDate(d.getDate() - 1);
        // A count no real day could have produced, so "did it get cleaned up?"
        // has an unambiguous answer.
        const key = d.getTime();
        localStorage['calendar-storage2'] = JSON.stringify({ [key]: 99 });
        await chrome.storage.local.set({ 'calendar-storage2': localStorage['calendar-storage2'] });
        // Zero-padded, which is how calendar() writes both `<option>` lists
        // (`iaStr` / monthOptionsHtml()). An unpadded value matches no option
        // and `sel.value` keeps whatever it had, so the selects stay on today
        // and the case deletes the wrong day: it silently required a two-digit
        // day *and* a two-digit month, i.e. mid-October onwards. Written out
        // as-is it failed from the 1st to the 9th of November and on any day
        // in a single-digit month — green when the author wrote it, red later.
        const pad = (n) => String(n).padStart(2, '0');
        return { key, day: pad(d.getDate()), month: pad(d.getMonth() + 1), year: String(d.getFullYear()) };
    });

    // Reloaded so the page's own map hydrates from the plant — that object is
    // read once, at load, and a delete with nothing to remove is not a delete.
    await page.reload({ waitUntil: 'load' });
    await settle(page);

    const hydrated = await page.evaluate(async (key) => {
        await window.storageAdapter.ready();
        return JSON.parse(localStorage['calendar-storage2'] || '{}')[key];
    }, day.key);
    assert.equal(hydrated, 99, 'the page must start from the planted map, or the delete has nothing to remove');

    // Select the day the way the calendar does, then delete its range. The two
    // range inputs are filled in by history() from the selected day, so setting
    // the dropdowns is enough — and the calendar's own click handler does
    // exactly this.
    await page.evaluate(async (target) => {
        await window.storageAdapter.ready();
        const set = (id, value) => {
            const sel = document.querySelector(`#${id}`);
            const opt = [...sel.options].find((o) => o.value === value);
            if (opt) sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
        };
        set('date-select-year', target.year);
        set('date-select-month', target.month);
        set('date-select-day', target.day);
    }, day);
    await settle(page);

    const total = await page.evaluate(() => document.querySelector('#calendar-total-value').textContent);
    await page.evaluate(async () => {
        await window.storageAdapter.ready();
        document.querySelector('#delete-range-button').click();
    });
    // deleteRange() is asynchronous, and the redraw + history() reload happen
    // in its callback.
    await settle(page);

    const after = await page.evaluate(async (key) => {
        await window.storageAdapter.ready();
        const got = await chrome.storage.local.get('calendar-storage2');
        // The cell as well as the map: they are two different places, and a
        // count of 0 has to reach both or the user sees a square reading "0"
        // next to a dark green cell.
        //
        // What this does *not* pin is the clearing itself. The change events
        // that select the day each call history() before the delete does, and
        // one of those runs leaves the cell clean, so removing the clearing
        // from the empty path still ends here with an empty cell — verified by
        // mutation. The sequencing is pinned in tests/modules.test.mjs instead
        // ("a day that just became empty also loses the colour it was painted
        // with"), where the painted cell can be handed to history() directly.
        // This case is the end-to-end version: in a real browser the day ends
        // up gone from the map, from storage and from the grid.
        const date = new Date(key);
        const cells = [...document.querySelectorAll('#calendar-days a')];
        const cell = cells.find((a) => Number(a.textContent.trim()) === date.getDate());
        return {
            cached: JSON.parse(localStorage['calendar-storage2'] || '{}')[key],
            stored: JSON.parse(got['calendar-storage2'] || '{}')[key],
            background: cell ? cell.style.backgroundColor : null,
        };
    }, day.key);

    assert.deepEqual(jsErrors, [], 'history.html threw while selecting or deleting');
    assert.equal(total, '0', 'the selected day must be empty, or the delete has nothing to clear');
    assert.equal(after.cached, undefined,
        'the day became empty and the map still lists it — nothing else removes an entry');
    assert.equal(after.stored, undefined,
        'the deletion has to reach chrome.storage.local, or the next page start re-reads the stale day');
    assert.equal(after.background, '',
        'the cell still shows the count that was just deleted — the map is only half the fix');
    await page.close();
});

test('a page write reaches the live worker map before its next crawl', { skip: SKIP }, async () => {
    // The regression in its real shape. Two runtimes each hydrated a parsed
    // copy of the map at boot and each serialised its OWN copy over the whole
    // key. A page counting today was erased by the worker's next crawl flush —
    // and because the map is a long-lived cache ("有值不覆盖"), no one ever
    // recomputed it. shared/calendar-storage.js now re-hydrates on
    // chrome.storage.onChanged, so the worker's live map must follow the
    // page's write without a restart.
    //
    // A witness page (history2.html) is where the cross-context write is made;
    // it loads the shared module but never calls history(), so it will not
    // write the day itself. The worker's own `calendar_storage2` is read back
    // directly to prove its *parsed* map converged, not just the localStorage
    // cache that storage-adapter already mirrors.
    await resetAndReadStoredHeatMap();

    const witness = await context.newPage();
    const { jsErrors } = collectErrors(witness);
    await witness.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
    await settle(witness);

    try {
        const today = await worker().evaluate(() => {
            const d = new Date();
            d.setHours(23, 59, 59, 999);
            return d.getTime();
        });

        // Written in the witness page, through the adapter into real storage.
        // `history2.html` never calls history(), so it will not overwrite the
        // day itself.
        await witness.evaluate(async (key) => {
            await window.storageAdapter.ready();
            localStorage['calendar-storage2'] = JSON.stringify({ [key]: 4242 });
            await chrome.storage.local.set({ 'calendar-storage2': localStorage['calendar-storage2'] });
        }, today);

        // Poll: chrome.storage.onChanged is delivered asynchronously, with no
        // ordering guarantee against the write's own callback.
        const poll = async (read) => {
            const deadline = Date.now() + 5000;
            let seen;
            do {
                seen = await read();
                if (seen === 4242) return seen;
                await new Promise((resolve) => setTimeout(resolve, 50));
            } while (Date.now() < deadline);
            return seen;
        };

        /* eslint-disable no-undef -- inside worker().evaluate(); see above */
        const inWorker = await poll(() => worker().evaluate((key) => calendar_storage2[key], today));
        const inWitness = await poll(() => witness.evaluate(async (key) => {
            await window.storageAdapter.ready();
            return JSON.parse(localStorage['calendar-storage2'] || '{}')[key];
        }, today));
        /* eslint-enable no-undef */

        assert.equal(inWitness, 4242, 'the write never reached storage');
        assert.equal(inWorker, 4242,
            "the running worker's parsed map still holds its boot-time copy — the next crawl would erase the page's count");

        // Now let that same worker flush a crawl. saveCrawledHeat() skips today,
        // so the map it writes must still contain the page's 4242 rather than
        // overwriting the key with a copy that never had it.
        const landmarks = await seedBackfillableVisit();
        const map = await runCrawlOnOneUrl('https://seed.test/heat');
        assert.equal(map[today], 4242,
            "the crawl erased the page's count for today (map was " + JSON.stringify(map) + ')');
        assert.equal(map[landmarks.yesterday], 2, 'the crawl still back-filled its own day');
    } finally {
        assert.deepEqual(jsErrors, [], 'the witness page threw while the map changed under it');
        await witness.close();
    }
});

test('history2.html shows its node count under a label that says so', { skip: SKIP }, async () => {
    // The two tree pages do not call history(), so `#calendar-total-value` on
    // them is a node count rather than a day's row total — and they used to
    // share history.html's "Total History Items" label. That invited the reader
    // to compare two numbers measured differently; the label now says which is
    // which. Asserted on the rendered text, because page-init() is what turns
    // `data-lang-string` into words and a missing key renders as the key name.
    const page = await context.newPage();
    const { jsErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
    await settle(page);

    const label = await page.evaluate(async () => {
        await window.storageAdapter.ready();
        return document.querySelector('#calendar-total .lang').textContent.trim();
    });
    await page.close();

    assert.deepEqual(jsErrors, [], 'history2.html threw');
    assert.match(label, /tree/i, `the total line still reads ${JSON.stringify(label)}`);
    assert.doesNotMatch(label, /history items/i, 'the node count is labelled as a history-row total');
});

/**
 * Open options.html and wait for the form to be built.
 *
 * The wait has a purpose beyond timing: the form is built from `localStorage`,
 * which the worker seeds — and on a cold profile the page used to get there
 * first and render NaN in every box, so "the page opened" said nothing about
 * whether the buttons below were wired up. `#rhitemsno` only holds a number
 * once `loadOptions()` has run, so it doubles as the "the handler got to the
 * end" signal. It is also the exact statement that used to be false: when
 * loadOptions() threw, everything after it — every listener on the page — was
 * lost, and this wait is what reports that instead of a confusing timeout on
 * `#saveUpload`.
 */
async function openOptionsPage() {
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(page);
    const ready = await page
        .waitForFunction(() => /^\d+$/.test(document.getElementById('rhitemsno').value), null, { timeout: 10000 })
        .then(() => true, () => false);
    assert.ok(
        ready,
        'options.html never finished initialising: the form still holds no numbers, so none of its buttons are wired',
    );
    return { page, errors };
}

test('options.html really writes the config into chrome.storage.sync', { skip: SKIP }, async () => {
    // The upload is the one shipped feature nothing else here touches, and it
    // is also the one a sandbox invites you to fake: it is easy to test the
    // promise chain in tests/modules.test.mjs and call that "the upload works",
    // while the store underneath is a Map in a stub.
    //
    // A profile that never signed in is therefore the first thing asserted
    // about: chrome.storage.sync still accepts writes there, still enforces the
    // 8KB per-item quota, and its contents survive a reload — but it is a local
    // mirror, not a server round trip. The quota constant is the cheapest proof
    // that this is the real store and not chrome.storage.local under another
    // name (the two are separate namespaces, which saveOptions() depends on).
    const { page, errors } = await openOptionsPage();
    const { jsErrors } = errors;

    // The success label is whatever chrome.i18n resolves it to, not the English
    // literal: getMessage() follows the browser UI language, and on a zh_CN
    // machine the button reads 已保存！. Asserting 'Saved!' made the case pass or
    // fail on the locale of the box it ran on rather than on the upload.
    const savedLabel = await page.evaluate(() => chrome.i18n.getMessage('saved'));

    const before = await page.evaluate(() => new Promise((resolve) => chrome.storage.sync.get(null, resolve)));
    const formValue = await page.inputValue('#rhitemsno');

    // Three domains through the form, so the sliced path runs instead of the
    // empty-list branch: `rh-filtered` is never uploaded as itself, because one
    // domain list blows the per-item quota. It goes up as filterlist0..N plus a
    // count, and the count is what mergeList() reads back.
    for (const domain of ['sample-a.test', 'sample-b.test', 'sample-c.test']) {
        await page.fill('#flist-add-i', domain);
        await page.click('#flist-add-b');
    }

    await page.click('#saveUpload');
    // saveOptions() reports the outcome on the button, and only after the
    // writes settle. Waiting for the final label instead of a fixed delay is
    // what makes a stuck "Saving..." a failure rather than a slow pass — so the
    // timeout is not swallowed: it is re-thrown with the label the button is
    // actually stuck on, because a bare "Timeout exceeded" says nothing about
    // whether the upload failed ('Fail') or never settled ('Saving...').
    await page
        .waitForFunction(
            (label) => document.getElementById('saveUpload').value === label,
            savedLabel,
            { timeout: 10000 },
        )
        .catch(async (err) => {
            const stuck = await page
                .evaluate(() => document.getElementById('saveUpload').value)
                .catch(() => '<unreadable>');
            throw new Error(
                `the upload button never reported ${JSON.stringify(savedLabel)} — it reads ${JSON.stringify(stuck)}`,
                { cause: err },
            );
        });

    const observed = await page.evaluate(() => new Promise((resolve) => {
        chrome.storage.sync.get(null, (cloud) => resolve({
            button: document.getElementById('saveUpload').value,
            cloud,
            perItemQuota: chrome.storage.sync.QUOTA_BYTES_PER_ITEM,
        }));
    }));
    await page.close();

    assert.deepEqual(jsErrors, [], 'the upload path threw');
    assert.equal(observed.button, savedLabel, 'the button never reported success');
    assert.equal(observed.perItemQuota, 8192, 'chrome.storage.sync is not the store this upload writes to');
    assert.ok(
        Object.keys(observed.cloud).length > Object.keys(before).length,
        'not one key reached chrome.storage.sync',
    );
    // Config keys travel with every '-' spelled '_', so the dash-spelled name
    // must be absent — that pair is what downloadOptions() mirrors back.
    assert.equal(observed.cloud.rh_itemsno, formValue, 'rh-itemsno did not arrive as rh_itemsno, with the form value');
    assert.equal(observed.cloud.rh_filtered, undefined, 'the domain list is uploaded as slices, never whole');
    assert.match(String(observed.cloud.filterlist0), /sample-a\.test/, 'filterlist0 does not carry the domains');
    assert.equal(observed.cloud.filterlist_slices, '1', 'the slice count is what mergeList() indexes with');
});

test('the download button restores the cloud copy and reloads the page', { skip: SKIP }, async () => {
    // The 3.3.0 regression: a stray `ve = result` in this callback threw under
    // strict mode, so the handler died on its first statement — no key was
    // restored, location.reload() was never reached and the button sat on
    // "Saving..." forever. Nothing here was covered: the module tests call
    // downloadOptions() directly, bypassing the strict-mode module evaluation
    // that turns the assignment into a ReferenceError.
    //
    // So this case asserts the three observable consequences, not the call:
    // the value comes back, the form shows it, and the page reloads.
    const { page, errors } = await openOptionsPage();
    const { jsErrors } = errors;

    // A second page, deliberately left open and touched by nothing. The store
    // behind localStorage is chrome.storage.local, and the adapter mirrors it
    // into the cache of *every* page in this context through
    // chrome.storage.onChanged — so "did this case change a knob the rest of
    // the file shares" is only answerable from another context's cache, not
    // from the page that did the writing.
    const witness = await openOptionsPage();
    const original = await page.evaluate(() => localStorage['rh-itemsno']);
    assert.equal(
        await waitForCacheValue(witness.page, 'rh-itemsno', original),
        original,
        'the two pages disagree before the case even starts — rh-itemsno is not being read from one store',
    );

    try {
        // A cloud copy that disagrees with the local one, so "restored" is
        // distinguishable from "nothing happened".
        await page.evaluate(() => new Promise((resolve) => {
            chrome.storage.sync.set({ rh_itemsno: '37' }, resolve);
        }));
        await page.evaluate(() => { localStorage['rh-itemsno'] = '5'; });

        const reloaded = page
            .waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame(), timeout: 15000 })
            .then(() => true, () => false);

        await page.click('#downloadConfig');
        const didReload = await reloaded;
        await settle(page);

        const after = await page.evaluate(() => ({
            stored: localStorage['rh-itemsno'],
            form: document.getElementById('rhitemsno').value,
        }));
        const mirrored = await waitForCacheValue(witness.page, 'rh-itemsno', '37');

        assert.deepEqual(jsErrors, [], 'the download button threw — its handler never got past the first statement');
        assert.equal(didReload, true, 'the page never refreshed, so the button is stuck on "Saving..."');
        assert.equal(after.stored, '37', 'the cloud value never reached chrome.storage.local');
        assert.equal(after.form, '37', 'the form was not rebuilt from the restored value');
        // downloadOptions() writes localStorage, i.e. chrome.storage.local, and
        // that is the same road the restore travels — so the other page's cache
        // has to see both hops, not just this page's.
        assert.equal(mirrored, '37', 'the restored value never left the page that clicked the button');
    } finally {
        // rh-itemsno is a rendering knob every other case shares, and undoing it
        // is a write to shared state, not to this page alone. So the undo is
        // read back before the pages are closed: localStorage[...] alone is a
        // fire-and-forget setItem() (the adapter persists it with an ignored
        // promise) and the sync.remove() callback does not settle it either.
        await page.evaluate((value) => new Promise((resolve) => {
            localStorage['rh-itemsno'] = value;
            chrome.storage.local.get('rh-itemsno', (got) => resolve(got['rh-itemsno']));
        }), original).then((landed) => {
            assert.equal(landed, String(original), `restoring rh-itemsno left ${JSON.stringify(landed)} in storage`);
        });
        await page.evaluate(() => new Promise((resolve) => chrome.storage.sync.remove('rh_itemsno', resolve)));
        assert.equal(
            await waitForCacheValue(witness.page, 'rh-itemsno', String(original)),
            String(original),
            'the restore never reached the other page in this context',
        );
        assert.deepEqual(witness.errors.jsErrors, [], 'the witness page threw while the value changed under it');
        await page.close();
        await witness.page.close();
    }
});

test('options.html?p=<unknown tab> falls back instead of killing the page', { skip: SKIP }, async () => {
    // Review #5: `p` is read straight off the query string and used to build
    // two ids. A bogus value made $() return null and the handler threw on
    // `.style`; `?p=translations` is subtler — its content panel exists but
    // the tab anchor is commented out in options.html, so it threw too.
    // The exception lands in the middle of DOMContentLoaded, which is why the
    // failure is not "a tab does not open" but "every button on the page is
    // dead" (all listeners are registered below the throw).
    for (const p of ['bogus', 'translations']) {
        const page = await context.newPage();
        const { jsErrors } = collectErrors(page);
        await page.goto(`chrome-extension://${extensionId}/options.html?p=${p}`, { waitUntil: 'load' });
        await settle(page);

        // #rhitemsno only holds a number once loadOptions() has run, so it is
        // the "the handler reached the end" signal — the exact thing that used
        // to be lost. Asserting it here is what separates "fell back safely"
        // from "did not throw but stopped halfway".
        const shape = await page.evaluate(() => ({
            itemsno: document.getElementById('rhitemsno').value,
            optionsPanel: document.getElementById('tab-options-content').style.display,
            optionsTabCurrent: document.getElementById('tab-options').classList.contains('tab-current'),
        }));
        await page.close();

        assert.deepEqual(jsErrors, [], `?p=${p} threw inside DOMContentLoaded`);
        assert.match(shape.itemsno, /^\d+$/, `?p=${p}: initialisation did not finish, the buttons are not wired`);
        assert.equal(shape.optionsPanel, 'block', `?p=${p}: must fall back to the options panel`);
        assert.equal(shape.optionsTabCurrent, true, `?p=${p}: must mark the options tab current`);
    }
});

test('the linear pages drive their sort toolbar through data-state', { skip: SKIP }, async () => {
    // The unit suite proves the module's state machine with a DOM shim; only a
    // real browser proves the CSS mask actually picks the right half of the
    // vector icon. Both linear pages share the toolbar, so one of them is
    // enough to pin the wiring and the other is covered by the static guard.
    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(page);

    const before = await page.evaluate(() => {
        const el = document.getElementById('rh-bar-group');
        return {
            state: el.getAttribute('data-state'),
            position: getComputedStyle(el).maskPosition || getComputedStyle(el).webkitMaskPosition,
            label: el.getAttribute('aria-label'),
            bound: el.getAttribute('data-sortbar-bound'),
        };
    });
    assert.ok(before.state, 'the toolbar painted no data-state on load');
    assert.equal(before.bound, '1', 'initSortBar did not bind the button');
    assert.ok(before.label && before.label.length > 0, 'the button has no accessible label');

    await page.click('#rh-bar-group');
    // `a { transition: all 0.2s linear }` animates mask-position too: reading
    // the computed value immediately catches it mid-transition (a percentage
    // between 0% and 100%), not the state the CSS rule settles on.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const after = await page.evaluate(() => {
        const el = document.getElementById('rh-bar-group');
        return {
            state: el.getAttribute('data-state'),
            position: getComputedStyle(el).maskPosition || getComputedStyle(el).webkitMaskPosition,
            stored: localStorage['rh-group'],
        };
    });
    await page.close();

    assert.deepEqual(jsErrors, [],
        `the toolbar threw on click (${netErrors.length} network error(s) ignored)`);
    assert.notEqual(after.state, before.state, 'a click did not change the button state');
    assert.equal(after.stored, after.state, 'the painted state disagrees with the stored key');
    assert.notEqual(after.position, before.position,
        `CSS did not move the icon mask: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
});

test('bookmark.html re-renders its list when the toolbar is clicked on the initial view', { skip: SKIP }, async () => {
    // Review on PR #42: the shared toolbar used getActiveHistory() for BOTH
    // pages. bookmark.html's containers start with no inline `style.display`
    // (history.css gives them `inline` / `none`), so that detector answered
    // undefined and a click changed localStorage + the button state while the
    // list itself was never re-rendered. The page now passes its own
    // getActiveBookmark() and refreshActive() falls back to the full view.
    //
    // This is the real-browser proof: seed a bookmark, open the page, RESET the
    // containers to the raw CSS state (the initial render has already written
    // inline `display: block`), click a toolbar button, and assert the render
    // loop ran again. bookmark() sets `display: block` at the top of a render;
    // a page that only paints the button leaves the inline style empty.
    const TITLE = 'Sort bar regression probe';
    let bookmarkId;
    {
        const seed = await context.newPage();
        await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
        await settle(seed);
        bookmarkId = await seed.evaluate(async (title) => {
            localStorage['rh-group'] = 'yes';
            await window.storageAdapter?.ready();
            const node = await chrome.bookmarks.create({
                title,
                url: 'https://sort-bar-regression.test/page',
            });
            return node.id;
        }, TITLE);
        await seed.close();
    }

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    try {
        await page.goto(`chrome-extension://${extensionId}/bookmark.html`, { waitUntil: 'load' });
        await settle(page);

        const before = await page.evaluate(() => {
            const main = document.getElementById('rh-views-insert');
            const search = document.getElementById('rh-views-search-insert');
            // Reproduce the raw shipped state: no inline style, only the CSS.
            main.style.removeProperty('display');
            search.style.removeProperty('display');
            return {
                rows: document.querySelectorAll('#rh-views-insert .item-holder').length,
                computed: getComputedStyle(main).display,
                inline: main.style.display,
                state: document.getElementById('rh-bar-group').getAttribute('data-state'),
            };
        });
        assert.ok(before.rows > 0, 'the bookmark list did not render at all');
        assert.equal(before.inline, '', 'the test did not reproduce the initial CSS state');
        assert.equal(before.computed, 'inline', 'history.css no longer declares display: inline');

        await page.click('#rh-bar-group');
        await settle(page);
        const after = await page.evaluate(() => ({
            display: document.getElementById('rh-views-insert').style.display,
            state: document.getElementById('rh-bar-group').getAttribute('data-state'),
            rows: document.querySelectorAll('#rh-views-insert .item-holder').length,
        }));

        assert.notEqual(after.state, before.state, 'the click did not toggle the button state');
        // bookmark() sets `display: block` on the main container at the top of a
        // render. If it never ran, the inline style is still empty.
        assert.equal(after.display, 'block',
            'the toolbar click did not call bookmark() — the list was never re-rendered');
        assert.ok(after.rows > 0, 'the re-rendered list is empty');
        assert.deepEqual(jsErrors, [],
            `the toolbar threw on click (${netErrors.length} network error(s) ignored)`);
    } finally {
        await page.close();
        if (bookmarkId) {
            const cleanup = await context.newPage();
            await cleanup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await cleanup.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
            await cleanup.close();
        }
        // The click above toggles rh-group in shared storage. Restore it: the
        // layout cases below rely on grouped rows and should not have to
        // re-seed history just to undo this case's side effect.
        const restore = await context.newPage();
        await restore.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
        await restore.evaluate(async () => {
            localStorage['rh-group'] = 'yes';
            await window.storageAdapter?.ready();
        });
        await restore.close();
    }
});

test('the linear pages localise both placeholder and aria-label on the search box', { skip: SKIP }, async () => {
    // page-init.js used to loop over the two data-lang-* attributes; it now
    // spells each out. #rh-search carries BOTH attributes, so this pins the
    // behaviour the loop had and proves neither query was dropped.
    for (const file of ['history.html', 'bookmark.html']) {
        const page = await context.newPage();
        const { jsErrors, netErrors } = collectErrors(page);
        await page.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'load' });
        await settle(page);
        const attrs = await page.evaluate(() => {
            const el = document.getElementById('rh-search');
            return {
                placeholder: el.getAttribute('placeholder'),
                label: el.getAttribute('aria-label'),
                selectAll: document.getElementById('master-check-all').getAttribute('aria-label'),
            };
        });
        await page.close();
        assert.deepEqual(jsErrors, [],
            `${file} threw while localising attributes (${netErrors.length} network error(s) ignored)`);
        assert.ok(attrs.placeholder && attrs.placeholder.length > 0,
            `${file}: the search placeholder was not translated`);
        assert.ok(attrs.label && attrs.label.length > 0,
            `${file}: the search aria-label was not translated`);
        assert.ok(attrs.selectAll && attrs.selectAll.length > 0,
            `${file}: the select-all aria-label was not translated`);
    }
});

// ---------------------------------------------------------------------------
// Linear pages: flex/grid layout, sticky calendar and theme tokens
// (issue #40, step 2). The static guards prove the CSS/JS shape; these prove
// the browser really lays it out that way.
// ---------------------------------------------------------------------------

/**
 * Open a page in `ctx`, wait for the storage cache, and return it with its
 * error buckets. The shared `context` is light-only; the dark case below owns
 * a second persistent context.
 */
async function openForLayout(ctx, extId, file) {
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`chrome-extension://${extId}/${file}`, { waitUntil: 'load' });
    await settle(page);
    return { page, ...errors };
}

/** Seed a handful of visits so the linear render loop actually draws rows. */
async function seedLinearHistory(ctx, extId, count = 24) {
    const seed = await ctx.newPage();
    await seed.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
    await settle(seed);
    await seed.evaluate(async (n) => {
        localStorage['rh-group'] = 'yes';
        await window.storageAdapter?.ready();
        for (let i = 0; i < n; i++) {
            await chrome.history.addUrl({ url: `https://layout-probe-${i}.test/a/long/path/segment` });
        }
    }, count);
    await seed.close();
}

test('the linear rows are a flex line and the group title is a grid, with no clear-float div', { skip: SKIP }, async () => {
    const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'bookmark.html');
    // bookmark.html renders from chrome.bookmarks, so no history seed here:
    // group the row locally and create the one bookmark the loop needs.
    await page.evaluate(async () => {
        localStorage['rh-group'] = 'yes';
        await window.storageAdapter?.ready();
        await chrome.bookmarks.create({
            title: 'Layout probe with a long title that should ellipsise',
            url: 'https://layout-flex-probe.test/a/long/path/segment',
        });
    });
    await page.reload({ waitUntil: 'load' });
    await settle(page);

    const shape = await page.evaluate(() => {
        const item = document.querySelector('.item');
        const group = document.querySelector('.group-title');
        const title = document.querySelector('.title');
        const bar = document.getElementById('rh-bar');
        return {
            itemDisplay: item && getComputedStyle(item).display,
            itemFloat: item && getComputedStyle(item).float,
            groupDisplay: group && getComputedStyle(group).display,
            barDisplay: bar && getComputedStyle(bar).display,
            titleOverflow: title && getComputedStyle(title).textOverflow,
            clearitems: document.querySelectorAll('.clearitem').length,
            rows: document.querySelectorAll('#rh-views-insert .item-holder').length,
        };
    });
    await page.close();

    assert.deepEqual(jsErrors, [], `the linear row threw (${netErrors.length} network error(s) ignored)`);
    assert.ok(shape.rows > 0, 'the render loop drew no rows; the shape was never exercised');
    assert.equal(shape.itemDisplay, 'flex', 'the row is not a flex line');
    assert.equal(shape.itemFloat, 'none', 'the row still floats its children');
    assert.equal(shape.groupDisplay, 'grid', 'the group title is not a grid');
    assert.equal(shape.barDisplay, 'flex', 'the toolbar is not a flex row');
    assert.equal(shape.titleOverflow, 'ellipsis', 'a long title is not ellipsised');
    assert.equal(shape.clearitems, 0, 'a clear-float div is still emitted per row');
});

test('history.html keeps the calendar beside the list and sticky while scrolling', { skip: SKIP }, async () => {
    await seedLinearHistory(context, extensionId, 60);
    const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'history.html');
    const read = () => page.evaluate(() => {
        const cal = document.getElementById('calendar');
        const table = document.getElementById('main-table');
        const c = cal.getBoundingClientRect();
        const t = table.getBoundingClientRect();
        return {
            position: getComputedStyle(cal).position,
            top: Math.round(c.top),
            width: Math.round(c.width),
            overlapsList: c.left < t.right - 1,
            docHeight: document.documentElement.scrollHeight,
            rows: document.querySelectorAll('#rh-views-insert .item-holder').length,
        };
    });

    const atTop = await read();
    assert.ok(atTop.rows > 0, 'the list did not render, so the calendar had nothing to sit beside');
    assert.equal(atTop.position, 'sticky', 'the calendar is not sticky');
    assert.equal(atTop.overlapsList, false, 'the calendar still floats over the list');

    // A real scroll: the old implementation flipped to `position: fixed` at a
    // hard-coded 115px. sticky must hold the calendar at top:15px on its own.
    await page.evaluate(() => window.scrollTo(0, 700));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const scrolled = await read();
    assert.ok(scrolled.docHeight > 700, 'the page is not tall enough to scroll');
    assert.equal(scrolled.position, 'sticky', 'the calendar switched to fixed on scroll');
    assert.equal(scrolled.top, 15, 'the calendar did not stay pinned at the top');

    // Expanding is one attribute now; CSS owns both the width and the sprite.
    await page.click('#delete-range-toggle-button');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const expanded = await page.evaluate(() => {
        const cal = document.getElementById('calendar');
        return {
            state: cal.getAttribute('data-expanded'),
            width: Math.round(cal.getBoundingClientRect().width),
            sprite: getComputedStyle(document.getElementById('delete-range-toggle-button')).maskPosition ||
                getComputedStyle(document.getElementById('delete-range-toggle-button')).webkitMaskPosition,
        };
    });
    await page.close();

    assert.deepEqual(jsErrors, [], `the sticky calendar threw (${netErrors.length} network error(s) ignored)`);
    assert.equal(expanded.state, 'true', 'the toggle did not set data-expanded');
    assert.ok(expanded.width > atTop.width + 100, 'the calendar did not widen to its expanded column');
    assert.match(expanded.sprite, /100%|right/, 'the toggle icon mask did not follow the expand state');
});

test('dark mode swaps the linear theme tokens, not per-selector overrides', { skip: SKIP }, async () => {
    // A second persistent context: colorScheme is fixed when the context is
    // launched, and the shared one is light. The extension id is read off its
    // own service worker, as in before().
    const darkContext = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        colorScheme: 'dark',
        args: [
            `--disable-extensions-except=${CHROME_DIR}`,
            `--load-extension=${CHROME_DIR}`,
        ],
    });
    await darkContext.route(
        (url) => url.protocol !== 'chrome-extension:' && isFaviconServiceUrl(url),
        (route) => route.abort(),
    );
    try {
        let [sw] = darkContext.serviceWorkers();
        if (!sw) sw = await darkContext.waitForEvent('serviceworker');
        const darkId = sw.url().split('/')[2];

        const { page, jsErrors, netErrors } = await openForLayout(darkContext, darkId, 'bookmark.html');
        await page.evaluate(async () => {
            await chrome.bookmarks.create({ title: 'Dark theme probe', url: 'https://dark-theme-probe.test/x' });
        });
        await page.reload({ waitUntil: 'load' });
        await settle(page);
        const colors = await page.evaluate(() => {
            const title = document.querySelector('.title');
            const host = document.querySelector('.group-title-host');
            const bar = document.getElementById('rh-bar');
            const white = document.querySelector('div[rel="white"]');
            return {
                title: title && getComputedStyle(title).color,
                host: host && getComputedStyle(host).color,
                barBorder: bar && getComputedStyle(bar).borderTopColor,
                stripe: white && getComputedStyle(white).backgroundColor,
            };
        });
        await page.close();
        assert.deepEqual(jsErrors, [], `the dark page threw (${netErrors.length} network error(s) ignored)`);
        assert.equal(colors.title, 'rgb(255, 255, 255)', 'the title did not pick up --item-title-color');
        assert.equal(colors.host, 'rgb(222, 184, 135)', 'the group host did not pick up --group-host-color');
        assert.equal(colors.barBorder, 'rgb(102, 102, 102)', 'the toolbar border did not pick up --bar-border-color');
        assert.equal(colors.stripe, 'rgb(74, 74, 74)', 'the zebra stripe did not flatten in dark mode');
    } finally {
        await darkContext.close();
    }
});

test('the tree pages are untouched by the linear-page grid rules', { skip: SKIP }, async () => {
    // history.css is shared by four pages. .linear-view is on history.html
    // only, so history2.html / closed.html must keep their old absolute
    // calendar (their calendar2 class is fixed at top:59px).
    for (const file of ['history2.html', 'closed.html']) {
        const { page, jsErrors } = await openForLayout(context, extensionId, file);
        const shape = await page.evaluate(() => {
            const cal = document.getElementById('calendar');
            const container = document.getElementById('history-container');
            return {
                linearClass: container.classList.contains('linear-view'),
                containerDisplay: getComputedStyle(container).display,
                calPosition: cal && getComputedStyle(cal).position,
                treeRows: document.querySelectorAll('#treeDemo li[data-tid]').length,
            };
        });
        await page.close();
        assert.deepEqual(jsErrors, [], `${file} threw`);
        assert.equal(shape.linearClass, false, `${file} picked up the linear-view class`);
        assert.equal(shape.containerDisplay, 'block', `${file} became a two-column grid`);
        assert.equal(shape.calPosition, 'fixed', `${file}'s calendar2 lost its fixed position`);
        assert.ok(shape.treeRows > 0, `${file}'s tree did not render`);
    }
});

test('the narrow layout puts the calendar back over the list, not below it', { skip: SKIP }, async () => {
    await seedLinearHistory(context, extensionId, 24);
    const page = await context.newPage();
    await page.setViewportSize({ width: 480, height: 800 });
    const errors = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(page);
    const shape = await page.evaluate(() => {
        const cal = document.getElementById('calendar');
        const cs = getComputedStyle(cal);
        return {
            containerDisplay: getComputedStyle(document.getElementById('history-container')).display,
            position: cs.position,
            gridColumn: cs.gridColumn,
            gridRow: cs.gridRow,
            top: Math.round(cal.getBoundingClientRect().top),
            toggle: getComputedStyle(document.getElementById('showCalendar')).display,
        };
    });
    await page.close();
    assert.deepEqual(errors.jsErrors, [], `the narrow page threw (${errors.netErrors.length} network error(s) ignored)`);
    assert.equal(shape.containerDisplay, 'block', 'the container kept its two-column grid');
    assert.equal(shape.position, 'absolute', 'the calendar is still sticky on a narrow screen');
    assert.equal(shape.gridColumn, 'auto', 'the calendar kept its wide-screen grid column');
    assert.equal(shape.gridRow, 'auto', 'the calendar kept its wide-screen grid row');
    assert.equal(shape.top, 19, 'the calendar did not return to the shared 19px offset');
    assert.equal(shape.toggle, 'inline', 'the #showCalendar toggle is not available');
});

test('group columns are pinned explicitly on both list pages', { skip: SKIP }, async () => {
    // history.html rows come from the history seeded by the calendar cases
    // above (shared persistent context); bookmark.html seeds its own rows below.
    const read = (page) => page.evaluate(() => {
        const g = document.querySelector('.group-title');
        if (!g) return null;
        const col = (sel) => {
            const el = g.querySelector(sel);
            return el && getComputedStyle(el).gridColumn;
        };
        return {
            toggle: col('.group-title-toggle'),
            count: col('label.group-title-toggle-count'),
            checkbox: col('.group-title-checkbox'),
            favicon: col('.group-title-favicon'),
            host: col('.group-title-host'),
            countAlign: g.querySelector('label.group-title-toggle-count')
                && getComputedStyle(g.querySelector('label.group-title-toggle-count')).textAlign,
        };
    });

    const hp = await context.newPage();
    await hp.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(hp);
    const history = await read(hp);
    await hp.close();
    assert.ok(history, 'history.html rendered no group row');
    assert.equal(history.toggle, '1', 'history toggle lost column 1');
    assert.equal(history.checkbox, '2', 'history checkbox lost column 2');
    assert.equal(history.favicon, '3', 'history favicon lost column 3');
    assert.equal(history.host, '4', 'history host lost column 4');

    const bp = await context.newPage();
    await bp.goto(`chrome-extension://${extensionId}/bookmark.html`, { waitUntil: 'load' });
    await bp.evaluate(async () => {
        await chrome.bookmarks.create({ title: 'Column probe A', url: 'https://column-probe-a.test/x' });
        await chrome.bookmarks.create({ title: 'Column probe B', url: 'https://column-probe-b.test/x' });
    });
    await bp.reload({ waitUntil: 'load' });
    await settle(bp);
    const bookmark = await read(bp);
    await bp.close();
    assert.ok(bookmark, 'bookmark.html rendered no group row');
    assert.equal(bookmark.toggle, '1', 'bookmark toggle lost column 1');
    assert.equal(bookmark.count, '2', 'the count label is not pinned to column 2');
    assert.equal(bookmark.checkbox, '2', 'bookmark checkbox lost column 2');
    assert.equal(bookmark.favicon, '3', 'bookmark favicon lost column 3');
    assert.equal(bookmark.host, '4', 'bookmark host lost column 4');
    assert.equal(bookmark.countAlign, 'center', 'the group count is not centred');
});

test('the calendar width really follows data-expanded in both directions', { skip: SKIP }, async () => {
    await seedLinearHistory(context, extensionId, 8);
    const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'history.html');
    const width = () => page.evaluate(() => Math.round(document.getElementById('calendar').getBoundingClientRect().width));
    const collapsed = await width();
    await page.click('#delete-range-toggle-button');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const expanded = await width();
    await page.click('#delete-range-toggle-button');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const back = await width();
    await page.close();
    assert.deepEqual(jsErrors, [], `the calendar toggle threw (${netErrors.length} network error(s) ignored)`);
    assert.ok(expanded > collapsed + 100, 'expanding did not widen the calendar');
    assert.equal(back, collapsed, 'collapsing did not restore the narrow width');
});

// ---------------------------------------------------------------------------
// issue #40, step 3: shared status component, vector icons, inline editor
// ---------------------------------------------------------------------------

test('the linear pages render their loading and empty states through one component', { skip: SKIP }, async () => {
    // Seed real rows first: after the held search is released, the page must
    // transition from the loading component to those rows. Without data the
    // round-trip would just prove loading -> empty, not loading -> rendered.
    await seedLinearHistory(context, extensionId, 8);

    // The loading state is transient: by settle() a non-empty list has already
    // replaced it. Hold chrome.history.search's callbacks so the container is
    // caught mid-render in a real browser, then release every held callback.
    // The stub queues *all* held calls and counts them: a single swallowed
    // query would leave the page stuck in loading forever, which is exactly
    // the "unverifiable" shape this case used to have.
    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    await page.addInitScript(() => {
        const real = chrome.history.search.bind(chrome.history);
        window.__holdSearch = true;
        window.__searchPending = [];
        window.__searchHeld = 0;
        chrome.history.search = (query, cb) => real(query, (items) => {
            if (!window.__holdSearch) return cb(items);
            window.__searchHeld++;
            window.__searchPending.push(() => cb(items));
        });
    });
    await page.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(page);
    const loading = await page.evaluate(() => {
        const el = document.querySelector('#rh-views-insert .list-status-loading');
        return el ? {
            cls: el.className,
            role: el.getAttribute('role'),
            live: el.getAttribute('aria-live'),
            spinner: !!el.querySelector('.list-status-spinner'),
            text: el.textContent,
            held: window.__searchHeld,
        } : { held: window.__searchHeld };
    });
    // Release every held callback, then assert the page actually rendered the
    // seeded rows. That "loading -> real rows" round-trip is the proof that the
    // loading component was an in-progress state, not a permanently stuck one.
    await page.evaluate(() => {
        window.__holdSearch = false;
        window.__searchPending.splice(0).forEach((f) => f());
    });
    await settle(page);
    const afterRelease = await page.evaluate(() => ({
        stillLoading: !!document.querySelector('#rh-views-insert .list-status-loading'),
        rows: document.querySelectorAll('#rh-views-insert .item-holder').length,
    }));
    await page.close();
    assert.deepEqual(jsErrors, [], `the loading state threw (${netErrors.length} network error(s) ignored)`);
    assert.ok(loading.held > 0, 'the search callback was never held, so the loading state was not captured');
    assert.ok(loading.cls, 'the page did not render the shared loading component');
    assert.match(loading.cls, /list-status list-status-loading/, 'the loading component class is missing');
    assert.equal(loading.role, 'status', 'the loading status is not announced');
    assert.equal(loading.live, 'polite', 'the loading state is not live');
    assert.ok(loading.spinner, 'the loading spinner is missing');
    assert.ok(loading.text.length > 0, 'the loading state has no text');
    assert.equal(afterRelease.stillLoading, false, 'releasing the search left the container stuck in loading');
    assert.ok(afterRelease.rows > 0, 'the held query never rendered its rows after release');

    // Force an empty result through the search view and assert the empty state.
    const searchPage = await context.newPage();
    const errs = collectErrors(searchPage);
    await searchPage.goto(`chrome-extension://${extensionId}/history.html`, { waitUntil: 'load' });
    await settle(searchPage);
    await searchPage.evaluate(() => {
        document.getElementById('rh-what').value = 'all';
        document.getElementById('rh-what').dispatchEvent(new Event('change'));
        const input = document.getElementById('rh-search');
        input.value = 'zzzz-no-such-host-zzzz';
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });
    await settle(searchPage);
    const empty = await searchPage.evaluate(() => {
        const el = document.querySelector('#rh-views-search-insert .no-results');
        return el ? { cls: el.className, role: el.getAttribute('role'), text: el.textContent } : null;
    });
    await searchPage.close();
    assert.deepEqual(errs.jsErrors, [], `the empty state threw (${errs.netErrors.length} network error(s) ignored)`);
    assert.ok(empty, 'the empty state did not render the shared component');
    assert.match(empty.cls, /list-status/, 'the empty state is not the shared component');
    assert.equal(empty.role, 'status', 'the empty state is not announced');
    assert.ok(empty.text.length > 0, 'the empty state has no text');
});

test('the linear icons are CSS masks and the group toggle state is an attribute', { skip: SKIP }, async () => {
    await seedLinearHistory(context, extensionId, 12);
    const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'history.html');
    const icons = await page.evaluate(() => {
        const bar = document.getElementById('rh-bar-group');
        const toggle = document.querySelector('#rh-views-insert .group-title-toggle');
        const range = document.getElementById('delete-range-toggle-button');
        const mask = (el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage;
        return {
            bar: mask(bar),
            barPos: getComputedStyle(bar).maskPosition || getComputedStyle(bar).webkitMaskPosition,
            toggle: toggle ? mask(toggle) : null,
            toggleState: toggle ? toggle.getAttribute('data-expanded') : null,
            range: mask(range),
        };
    });
    // Toggle a group and read the state the CSS consumes.
    const toggled = await page.evaluate(() => {
        const t = document.querySelector('#rh-views-insert .group-title-toggle');
        if (t) t.click();
        const a = document.querySelector('#rh-views-insert .group-title-toggle');
        return a ? a.getAttribute('data-expanded') : null;
    });
    await page.close();
    assert.deepEqual(jsErrors, [], `the icon masks threw (${netErrors.length} network error(s) ignored)`);
    for (const [name, value] of Object.entries(icons)) {
        if (name.endsWith('Pos') || name.endsWith('State')) continue;
        assert.match(value, /data:image\/svg\+xml/, `${name} is not an inline SVG mask`);
    }
    assert.ok(icons.barPos.length > 0, 'the toolbar icon has no mask position');
    assert.notEqual(toggled, icons.toggleState, 'toggleGroup did not flip data-expanded');
});

test('bookmark editing uses an inline panel and really writes the bookmark', { skip: SKIP }, async () => {
    const URL = 'https://edit-probe.test/before';
    const TITLE = 'Before edit';
    let bookmarkId;
    try {
        {
            const seed = await context.newPage();
            await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await settle(seed);
            bookmarkId = await seed.evaluate(async ({ title, url }) => {
                localStorage['rh-group'] = 'no';
                await window.storageAdapter?.ready();
                const node = await chrome.bookmarks.create({ title, url });
                return node.id;
            }, { title: TITLE, url: URL });
            await seed.close();
        }

        const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'bookmark.html');
        // Select the single row so the Edit button becomes visible.
        await page.click('#rh-views-insert .chkbx');
        await page.click('#edit-bookmark-button');
        const opened = await page.evaluate(() => {
            const panel = document.querySelector('.bookmark-edit');
            if (!panel) return null;
            const inputs = panel.querySelectorAll('input[type="text"]');
            return {
                fields: inputs.length,
                title: inputs[0] ? inputs[0].value : null,
                url: inputs[1] ? inputs[1].value : null,
                buttons: [...panel.querySelectorAll('input[type="button"]')].map((b) => b.value),
                nativePrompts: typeof window.prompt,
            };
        });
        assert.ok(opened, 'the inline editor did not open');
        assert.equal(opened.fields, 2, 'the editor needs title and URL fields');
        assert.equal(opened.title, TITLE, 'the title field was not prefilled');
        assert.equal(opened.url, URL, 'the URL field was not prefilled');
        assert.equal(opened.buttons.length, 2, 'the editor needs save and cancel');

        // Invalid URL: the panel stays open and shows an inline error.
        await page.evaluate(() => {
            const inputs = document.querySelectorAll('.bookmark-edit input[type="text"]');
            inputs[1].value = 'not a url';
            document.querySelector('.bookmark-edit input[type="button"]').click();
        });
        const invalid = await page.evaluate(() => ({
            panel: !!document.querySelector('.bookmark-edit'),
            error: document.querySelector('.bookmark-edit-error')?.textContent || '',
        }));
        assert.ok(invalid.panel, 'an invalid URL closed the editor');
        assert.ok(invalid.error.length > 0, 'an invalid URL produced no inline error');

        // A non-HTTP URL is legal for chrome.bookmarks.update. A title-only edit
        // on a mailto: bookmark used to be rejected by a hand-written scheme
        // allow-list, so the panel stayed open and the title could never be
        // changed. Let the API decide: it accepts the URL and the panel closes.
        await page.evaluate(() => {
            const inputs = document.querySelectorAll('.bookmark-edit input[type="text"]');
            inputs[0].value = 'mailto title only';
            inputs[1].value = 'mailto:foo@bar.test';
            document.querySelector('.bookmark-edit input[type="button"]').click();
        });
        await settle(page);
        const mailto = await page.evaluate(async (id) => {
            const nodes = await chrome.bookmarks.get(id);
            return { title: nodes[0].title, url: nodes[0].url, panel: !!document.querySelector('.bookmark-edit') };
        }, bookmarkId);
        assert.equal(mailto.title, 'mailto title only', 'a title-only edit on mailto: was blocked');
        assert.equal(mailto.url, 'mailto:foo@bar.test', 'the legal mailto: URL was not saved');
        assert.equal(mailto.panel, false, 'the editor stayed open after a legal mailto: edit');

        // The successful save re-rendered the list and cleared the selection,
        // so re-open the editor for the final (HTTP) edit.
        await page.click('#rh-views-insert .chkbx');
        await page.click('#edit-bookmark-button');
        // Save a real edit and assert chrome.bookmarks really changed.
        await page.evaluate(() => {
            const inputs = document.querySelectorAll('.bookmark-edit input[type="text"]');
            inputs[0].value = 'After edit';
            inputs[1].value = 'https://edit-probe.test/after';
            document.querySelector('.bookmark-edit input[type="button"]').click();
        });
        await settle(page);
        const saved = await page.evaluate(async (id) => {
            const nodes = await chrome.bookmarks.get(id);
            return { title: nodes[0].title, url: nodes[0].url, panel: !!document.querySelector('.bookmark-edit') };
        }, bookmarkId);
        const listed = await page.evaluate(() => document.body.textContent.includes('After edit'));
        await page.close();
        assert.deepEqual(jsErrors, [], `the editor threw (${netErrors.length} network error(s) ignored)`);
        assert.equal(saved.title, 'After edit', 'chrome.bookmarks.update did not save the title');
        assert.equal(saved.url, 'https://edit-probe.test/after', 'chrome.bookmarks.update did not save the URL');
        assert.equal(saved.panel, false, 'the editor stayed open after saving');
        assert.ok(listed, 'the re-rendered list does not show the new title');
    } finally {
        if (bookmarkId) {
            const cleanup = await context.newPage();
            await cleanup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await cleanup.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
            await cleanup.close();
            // rh-group was flipped by this case; restore it for the cases below.
            const restore = await context.newPage();
            await restore.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await restore.evaluate(async () => {
                localStorage['rh-group'] = 'yes';
                await window.storageAdapter?.ready();
            });
            await restore.close();
        }
    }
});

test('bookmark editor fields come from local helpers and Enter is consumed inside the panel', { skip: SKIP }, async () => {
    // Review follow-up: the panel's fields/buttons were hand-assembled in
    // eight variables, and an Enter/Escape key press could escape the panel
    // while a save re-render was about to remove it. Both are now pinned in a
    // real browser: the rendered shape must match the local builders, and the
    // keydown must not reach document.body.
    const URL = 'https://edit-keys-probe.test/before';
    const TITLE = 'Before key edit';
    let bookmarkId;
    try {
        {
            const seed = await context.newPage();
            await seed.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await settle(seed);
            bookmarkId = await seed.evaluate(async ({ title, url }) => {
                localStorage['rh-group'] = 'no';
                await window.storageAdapter?.ready();
                const node = await chrome.bookmarks.create({ title, url });
                return node.id;
            }, { title: TITLE, url: URL });
            await seed.close();
        }

        const { page, jsErrors, netErrors } = await openForLayout(context, extensionId, 'bookmark.html');
        await page.click('#rh-views-insert .chkbx');
        await page.click('#edit-bookmark-button');

        const shape = await page.evaluate(() => {
            const panel = document.querySelector('.bookmark-edit');
            if (!panel) return null;
            const labels = panel.querySelectorAll('label');
            const inputs = panel.querySelectorAll('input[type="text"]');
            const buttons = panel.querySelectorAll('input[type="button"]');
            return {
                labels: labels.length,
                inputs: inputs.length,
                buttons: buttons.length,
                // field() sets aria-label = the translated label text and
                // appends the input inside the label element.
                labelOwnsInput: [...labels].every((l) => l.querySelector('input[type="text"]')),
                ariaMatchesLabel: [...inputs].every((i, n) => i.getAttribute('aria-label') === labels[n].textContent),
                buttonsHaveClass: [...buttons].every((b) => b.classList.contains('button')),
            };
        });
        assert.ok(shape, 'the inline editor did not open');
        assert.equal(shape.labels, 2, 'the local field() builder did not produce two labels');
        assert.equal(shape.inputs, 2, 'the local field() builder did not produce two inputs');
        assert.equal(shape.buttons, 2, 'the local actionButton() builder did not produce two buttons');
        assert.ok(shape.labelOwnsInput, 'the input is not nested in its label');
        assert.ok(shape.ariaMatchesLabel, 'the aria-label drifted from the translated label');
        assert.ok(shape.buttonsHaveClass, 'the action buttons lost their .button class');

        // Count keydowns that reach body. A bubbled Enter/Escape would show up
        // here; the panel's handler must consume both before propagation.
        await page.evaluate(() => {
            window.__bodyKeydowns = 0;
            document.body.addEventListener('keydown', () => { window.__bodyKeydowns++; });
            const panel = document.querySelector('.bookmark-edit');
            const fire = (key) => panel.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            fire('Escape');
        });
        const afterEscape = await page.evaluate(() => ({
            body: window.__bodyKeydowns,
            panel: !!document.querySelector('.bookmark-edit'),
        }));
        assert.equal(afterEscape.panel, false, 'Escape did not close the editor');
        assert.equal(afterEscape.body, 0, 'Escape bubbled out of the panel to document.body');

        // Re-open and save via Enter. The row is still selected (Escape only
        // removed the panel), so a second click on the checkbox would just
        // deselect it and hide the Edit button. The keydown must be consumed
        // (body sees nothing) and chrome.bookmarks.update must still persist.
        await page.click('#edit-bookmark-button');
        await page.evaluate(() => {
            window.__bodyKeydowns = 0;
            // Count real update() calls: a held Enter (auto-repeat) or a
            // double-click used to fire several async updates whose chunked
            // redraws cancelled each other. The gate must allow exactly one.
            window.__updateCalls = 0;
            const realUpdate = chrome.bookmarks.update.bind(chrome.bookmarks);
            chrome.bookmarks.update = function (...args) {
                window.__updateCalls++;
                return realUpdate(...args);
            };
            const inputs = document.querySelectorAll('.bookmark-edit input[type="text"]');
            inputs[0].value = 'After key edit';
            inputs[1].value = 'https://edit-keys-probe.test/after';
            const panel = document.querySelector('.bookmark-edit');
            const fire = (repeat) => panel.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat }));
            fire(false);
            fire(true);  // key auto-repeat while update is still in flight
            fire(true);
        });
        await settle(page);
        const saved = await page.evaluate(async (id) => {
            const nodes = await chrome.bookmarks.get(id);
            return {
                title: nodes[0].title,
                url: nodes[0].url,
                panel: !!document.querySelector('.bookmark-edit'),
                body: window.__bodyKeydowns,
                updates: window.__updateCalls,
            };
        }, bookmarkId);
        assert.equal(saved.body, 0, 'Enter bubbled out of the panel to document.body');
        assert.equal(saved.updates, 1, 'key auto-repeat fired more than one bookmark update');
        assert.equal(saved.panel, false, 'the editor stayed open after an Enter save');
        assert.equal(saved.title, 'After key edit', 'Enter save did not write the title');
        assert.equal(saved.url, 'https://edit-keys-probe.test/after', 'Enter save did not write the URL');
        await page.close();
        assert.deepEqual(jsErrors, [], `the editor threw (${netErrors.length} network error(s) ignored)`);
    } finally {
        if (bookmarkId) {
            const cleanup = await context.newPage();
            await cleanup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await cleanup.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
            await cleanup.close();
            const restore = await context.newPage();
            await restore.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
            await restore.evaluate(async () => {
                localStorage['rh-group'] = 'yes';
                await window.storageAdapter?.ready();
            });
            await restore.close();
        }
    }
});

// ---------------------------------------------------------------------------
// Core interactions (issue #38, item 8). Real data through dbManager, so the
// loop under test is the shipped one. Offline, a real popup lands on
// chrome-error://chromewebdata/, so `window.open` is stubbed to record its
// arguments; commands are dispatched in the worker realm, where the MV3
// onCommand listener actually lives.
// ---------------------------------------------------------------------------

// Fresh keys keep each case independent: a crawl pass can putVisitItem() at
// any moment, and cleanup deletes by key. ReferringVisitId makes a child row
// (foldable branch); seedKeys() stays clear of chrome.history's string ids.
let nextSeedKey = 2_000_000_000;
function seedKeys(count) {
    const keys = Array.from({ length: count }, (_, i) => nextSeedKey + i);
    nextSeedKey += count;
    return keys;
}

/** Every row's text/title/switch state, in DOM order (used to report a dead tree). */
function treeRows(page) {
    return page.evaluate(() => [...document.querySelectorAll('#treeDemo li[data-tid]')].map((li) => {
        const sw = li.querySelector('span.switch');
        const ul = li.querySelector('ul');
        return {
            text: li.querySelector('a')?.textContent ?? '',
            title: li.querySelector('a')?.getAttribute('title') ?? '',
            switchClass: sw ? sw.className : '',
            childList: ul ? ul.style.display : null,
        };
    }));
}

// Put a parent/child pair into `VisitItem` (the tree pages read that store,
// not chrome.history). `rh-filtered` must be false or an inherited filter
// list drops both rows. Returns the seeded rows' URLs, ids and a cleanup().
// `withUnrelated` adds a third root so a filter that never ran is detectable.
async function seedTreeVisits(page, tag, withUnrelated = false) {
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(page);
    const [parentId, childId, unrelatedId] = seedKeys(withUnrelated ? 3 : 2);
    const seeded = await page.evaluate(async ({ t, withUnrelated, parentId, childId, unrelatedId }) => {
        await window.storageAdapter.ready();
        localStorage['rh-filtered'] = 'false';
        localStorage['less-item'] = 'no';
        const parent = `https://${t}-parent.test/page`;
        const child = `https://${t}-child.test/page`;
        const base = Date.now();
        const rows = [
            { visitId: parentId, referringVisitId: 0, url: parent, title: `${t} PARENT`, visitTime: base - 120000, transition: 'link' },
            { visitId: childId, referringVisitId: parentId, url: child, title: `${t} CHILD`, visitTime: base - 60000, transition: 'link' },
        ];
        if (withUnrelated) {
            rows.push({
                visitId: unrelatedId, referringVisitId: 0,
                url: `https://${t}-unrelated.test/page`, title: `${t} UNRELATED`,
                visitTime: base - 30000, transition: 'link',
            });
        }
        await Promise.all(rows.map((r) => window.dbManager.putVisitItem(r)));
        return { parent, child, ids: rows.map((r) => r.visitId) };
    }, { t: tag, withUnrelated, parentId, childId, unrelatedId });
    return {
        ...seeded,
        cleanup: () => page.evaluate((ids) => Promise.all(
            ids.map((id) => window.dbManager.deleteVisitItem(id)),
        ), seeded.ids),
    };
}

// Two closed tabs sharing one `oid` make closed.html draw a group row with
// two page children. dbManager has no deleteClosedTab(), so cleanup uses a
// readwrite transaction on the same store (see putClosedTab).
async function seedClosedGroup(page, tag) {
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
    await settle(page);
    const [aId, bId, groupOid] = seedKeys(3);
    const seeded = await page.evaluate(async ({ t, aId, bId, groupOid }) => {
        await window.storageAdapter.ready();
        localStorage['rh-filtered'] = 'false';
        const a = `https://${t}-group-a.test/1`;
        const b = `https://${t}-group-b.test/2`;
        const base = Date.now();
        const rows = [
            { id: aId, oid: groupOid, url: a, title: `${t} GROUP A`, closeTime: base - 120000, close: 0 },
            { id: bId, oid: groupOid, url: b, title: `${t} GROUP B`, closeTime: base - 119000, close: 0 },
        ];
        await Promise.all(rows.map((r) => window.dbManager.putClosedTab(r)));
        return { a, b, ids: rows.map((r) => r.id) };
    }, { t: tag, aId, bId, groupOid });
    return {
        ...seeded,
        cleanup: () => page.evaluate((ids) => new Promise((resolve, reject) => {
            const tx = window.dbManager.db.transaction(['closed'], 'readwrite');
            const store = tx.objectStore('closed');
            for (const id of ids) store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }), seeded.ids),
    };
}

// Stub `window.open` in a page: `urls()` reads the recorded calls, `restore()`
// puts the original back. Both are page.evaluate calls on an open page.
async function recordWindowOpen(page) {
    await page.evaluate(() => {
        window.__opened = [];
        window.__restoreOpen = window.open;
        window.open = (url, target) => {
            window.__opened.push({ url, target });
            return null;
        };
    });
    return {
        urls: () => page.evaluate(() => window.__opened.map((o) => o.url)),
        restore: () => page.evaluate(() => { window.open = window.__restoreOpen; }),
    };
}

test('clicking a tree row opens its URL, and the switch folds and unfolds the branch', { skip: SKIP }, async () => {
    // createTree() wires both the click and the collapse/expand through one
    // delegated listener on the container — a regression there kills the tree
    // silently, with no exception and no log.
    const tag = `tree-click-${Date.now()}`;
    const seed = await context.newPage();
    const s = await seedTreeVisits(seed, tag);

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    let open;
    try {
        await page.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
        await settle(page);
        open = await recordWindowOpen(page);

        // `:scope >` is required: an unscoped descendant match also hits the
        // parent li, whose <ul> contains the child's <a>.
        const rows = page.locator('#treeDemo li[data-tid]');
        const parentRow = rows.filter({ has: page.locator(`:scope > a[title="${s.parent}"]`) });
        const childRow = rows.filter({ has: page.locator(`:scope > a[title="${s.child}"]`) });
        const parentSwitch = parentRow.locator(':scope > span.switch');
        assert.equal(await parentRow.count(), 1, 'the seeded parent did not render');
        assert.equal(await childRow.count(), 1, 'the seeded child did not render');
        assert.equal(await parentRow.locator(':scope > ul').count(), 1,
            'the parent has no child list — the case has nothing to fold');
        assert.equal(await parentRow.locator(':scope > ul').evaluate((ul) => ul.style.display), 'block',
            'the parent started folded — the case has nothing to fold');
        assert.match(await parentSwitch.getAttribute('class'), /root_open/,
            'the parent switch is not drawn as an open branch');

        await childRow.locator(':scope > a').click();
        assert.deepEqual(await open.urls(), [s.child],
            'the click opened the wrong URL — the row is not mapped back to its node');

        await parentSwitch.click();
        assert.equal(await parentRow.locator(':scope > ul').evaluate((ul) => ul.style.display), 'none',
            'the switch did not hide the child list');
        assert.match(await parentSwitch.getAttribute('class'), /root_close/,
            'the switch icon did not follow the folded state');
        assert.equal(await childRow.count(), 1,
            'folding must hide the child with CSS, not drop it from the data');
        assert.deepEqual(await open.urls(), [s.child], 'folding a branch must not navigate');

        await parentSwitch.click();
        assert.equal(await parentRow.locator(':scope > ul').evaluate((ul) => ul.style.display), 'block',
            'the switch did not restore the child list');
        assert.match(await parentSwitch.getAttribute('class'), /root_open/,
            'the switch icon did not follow the unfolded state');

        await parentRow.locator(':scope > a').click();
        assert.deepEqual(await open.urls(), [s.child, s.parent],
            'each row must open its own URL');

        assert.deepEqual(jsErrors, [], `the tree interaction threw (${netErrors.length} network error(s) ignored)`);
    } finally {
        if (open) await open.restore();
        await page.close();
        await s.cleanup();
        await seed.close();
    }
});

test('the tree filter keeps the ancestor chain and highlights only the match', { skip: SKIP }, async () => {
    // bindTreeSearch() debounces 500ms, then treeHtml() filters by keyword and
    // keeps every ancestor of a hit. Neither the debounce nor the ancestor
    // rule is exercised by a page that merely opens.
    const tag = `tree-filter-${Date.now()}`;
    const seed = await context.newPage();
    const s = await seedTreeVisits(seed, tag, true);

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    try {
        await page.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
        await settle(page);

        // Scope every assertion to this case's tag: the shared context holds
        // other VisitItem rows from the crawl cases above.
        const unfiltered = await treeRows(page);
        assert.equal(unfiltered.filter((r) => r.text.includes(tag)).length, 3,
            'the seed must draw the pair plus one unrelated root');

        // Wait for the tree to CHANGE, not for the row's text: the unfiltered
        // tree already shows the matching title, so a text-based wait returns
        // immediately and catches the pre-debounce tree with no highlight.
        await page.fill('#rh-search', `${tag} CHILD`);
        const filteredInTime = await page.waitForFunction(
            (t) => {
                const rows = [...document.querySelectorAll('#treeDemo li[data-tid]')];
                const mine = rows.filter((li) => (li.textContent || '').includes(t));
                return mine.length === 2
                    && document.querySelectorAll('#treeDemo span[style*="darkred"]').length > 0;
            },
            tag,
            { timeout: 5000 },
        ).then(() => true, () => false);
        if (!filteredInTime) {
            const dead = await treeRows(page);
            assert.fail(`the filter never produced a filtered, highlighted tree (rows: ${JSON.stringify(dead)})`);
        }

        const shape = await page.evaluate((t) => {
            const rows = [...document.querySelectorAll('#treeDemo li[data-tid]')];
            const mine = rows.filter((li) => (li.textContent || '').includes(t));
            return {
                texts: mine.map((li) => li.querySelector('a')?.textContent ?? ''),
                highlights: [...document.querySelectorAll('#treeDemo span[style*="darkred"]')]
                    .map((s) => s.textContent),
                parentKept: mine.some((li) => (li.textContent || '').includes(`${t} PARENT`)),
                childKept: mine.some((li) => (li.textContent || '').includes(`${t} CHILD`)),
                unrelatedKept: mine.some((li) => (li.textContent || '').includes('UNRELATED')),
            };
        }, tag);

        assert.equal(shape.texts.length, 2,
            'the filter must keep the match AND its ancestor, and drop the unrelated root');
        assert.equal(shape.parentKept, true, 'the ancestor chain of the match was dropped');
        assert.equal(shape.childKept, true, 'the matching row itself was dropped');
        assert.equal(shape.unrelatedKept, false,
            'a row that matches nothing must be filtered out — the filter never ran');
        assert.deepEqual(shape.highlights, [`${tag} CHILD`],
            'only the typed keyword may be highlighted, on the matching row');
        assert.deepEqual(jsErrors, [], `the filter threw (${netErrors.length} network error(s) ignored)`);
    } finally {
        await page.close();
        await s.cleanup();
        await seed.close();
    }
});

test('clicking a closed-tab group reopens every page under it', { skip: SKIP }, async () => {
    // onClickNodeUrl() walks tree.childrenOf() and opens every page below a
    // group — it used to walk freshly drawn <a href="#"> elements, which a
    // re-render broke. No other suite clicks a group at all.
    const tag = `closed-group-${Date.now()}`;
    const seed = await context.newPage();
    const s = await seedClosedGroup(seed, tag);

    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    let open;
    try {
        await page.goto(`chrome-extension://${extensionId}/closed.html`, { waitUntil: 'load' });
        await settle(page);
        open = await recordWindowOpen(page);

        const group = page.locator('#treeDemo li[data-tid]:has(ul)')
            .filter({ has: page.locator(`a[title="${s.a}"]`) })
            .first();
        assert.equal(await group.count(), 1, 'the seeded session group did not render');
        // `:scope > a` is the group's OWN row; its children's <a> elements
        // carry real URLs in their title.
        const groupTitle = await group.locator(':scope > a').getAttribute('title');
        assert.equal(/^https?:/.test(groupTitle), false,
            'the group row must carry a label, not a URL');

        await group.locator(':scope > a').click();
        const urls = await open.urls();
        assert.deepEqual(urls.slice().sort(), [s.a, s.b].sort(),
            'the group did not reopen exactly the two pages under it');
        assert.equal(urls.length, 2, 'a group click must open every child once, not more');
        assert.deepEqual(jsErrors, [], `the group click threw (${netErrors.length} network error(s) ignored)`);
    } finally {
        if (open) await open.restore();
        await page.close();
        await s.cleanup();
        await seed.close();
    }
});

test('a keyboard shortcut opens its page through the service worker listener', { skip: SKIP }, async () => {
    // dispatch() fires the registered listener rather than calling the handler
    // directly — the same path a real key press takes — and must run in the
    // worker realm, where MV3 registers onCommand. All four mappings are
    // asserted because the handler is a chain of `if`s.
    const sw = context.serviceWorkers()[0];
    assert.ok(sw, 'the service worker must be up to receive commands');

    const commands = [
        ['open_history2', 'history2.html'],
        ['open_history1', 'history.html'],
        ['open_closed', 'closed.html'],
        ['open_bookmark', 'bookmark.html'],
    ];
    const isCasePage = (url) => commands.some(([, file]) => url.endsWith(`/${file}`));
    const urlOf = (p) => {
        try { return p.isClosed() ? '' : p.url(); } catch { return ''; }
    };

    // Keep PAGE OBJECTS, not URL strings: a URL snapshot stays green even if
    // a handler creates a tab and immediately removes it.
    const opened = [];
    const onPage = (p) => opened.push(p);
    context.on('page', onPage);
    try {
        const registered = await sw.evaluate(() => chrome.commands.onCommand.hasListeners());
        assert.equal(registered, true, 'the worker has no onCommand listener registered');

        for (const [command] of commands) {
            await sw.evaluate((c) => chrome.commands.onCommand.dispatch(c), command);
        }

        // tabs.create() and navigation are both async in the worker; poll for
        // the four live pages instead of a fixed sleep.
        const deadline = Date.now() + 10000;
        let live = [];
        do {
            live = opened.filter((p) => isCasePage(urlOf(p)));
            if (commands.every(([, file]) => live.some((p) => urlOf(p).endsWith(`/${file}`)))) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);

        for (const [command, file] of commands) {
            assert.ok(
                live.some((p) => urlOf(p).endsWith(`/${file}`)),
                `${command} did not leave ${file} open (opened: ${JSON.stringify(opened.map(urlOf))})`,
            );
        }
    } finally {
        context.off('page', onPage);
        for (const p of opened.slice()) {
            if (!p.isClosed()) await p.close().catch(() => {});
        }
    }
});
