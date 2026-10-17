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
async function runCrawlOnOneUrl(url) {
    return worker().evaluate(async (u) => {
        const saved = urls_wait_load;
        urls_wait_load = [{ id: 'seed', url: u, title: 'Seed', lastVisitTime: Date.now() }];
        heatDays = {};
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
 * A removal is not a write, so it does not travel through the adapter: the
 * worker's own `calendar_storage2` keeps its entries unless they are deleted
 * too, and the next crawl would then read days the case believes it cleared.
 * Both sides are emptied, and storage is read back so the caller can assert the
 * map really did start empty.
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
 * The map is planted in `chrome.storage.local` and the worker's own boot
 * hydrates it — the path a real worker start takes. That is the only way to
 * test "a day that already has a count is not re-written": a *live* worker
 * hydrates `calendar_storage2` once, at boot, so nothing written to storage
 * afterwards can reach the map it crawls with. (`chrome.storage.onChanged` is
 * not the hook the shared map is rebuilt from either; a first attempt at this
 * case planted the day from a page and proved nothing.)
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
    // (history() and the range delete) are page-side, and the worker keeps a
    // second copy of the map hydrated at its own boot, which it flushes over
    // storage whenever it crawls.
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
        d.setDate(d.getDate() - 1); // yesterday: always in the displayed month except on the 1st
        d.setHours(23, 59, 59, 999);
        // A count no real day could have produced, so "did it get cleaned up?"
        // has an unambiguous answer.
        const key = d.getTime();
        localStorage['calendar-storage2'] = JSON.stringify({ [key]: 99 });
        await chrome.storage.local.set({ 'calendar-storage2': localStorage['calendar-storage2'] });
        return { key, day: String(d.getDate()), month: String(d.getMonth() + 1), year: String(d.getFullYear()) };
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
