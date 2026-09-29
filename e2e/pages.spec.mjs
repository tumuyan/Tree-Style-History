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

test('history2.html renders its tree without zTree', { skip: SKIP }, async () => {
    // The suites above only prove the page does not throw, and a page that
    // silently renders nothing passes them — which is exactly what dropping a
    // library can produce. history2.html now draws through
    // scripts/modules/tree.js, so assert the rows are really there, that they
    // carry the class names css/zTreeStyle.css styles (the stylesheet stayed,
    // the library did not), and that jQuery is gone from this page.
    const page = await context.newPage();
    const { jsErrors, netErrors } = collectErrors(page);
    await page.goto(`chrome-extension://${extensionId}/history2.html`, { waitUntil: 'load' });
    await settle(page);

    const shape = await page.evaluate(() => ({
        rows: document.querySelectorAll('#treeDemo li[data-tid]').length,
        switches: document.querySelectorAll('#treeDemo span.button.switch').length,
        icons: document.querySelectorAll('#treeDemo span.button.ico').length,
        jquery: typeof window.jQuery,
    }));
    await page.close();

    assert.deepEqual(jsErrors, [], `history2.html threw (${netErrors.length} network error(s) ignored)`);
    assert.ok(shape.rows > 0, 'the native renderer drew no rows at all');
    assert.equal(shape.switches, shape.rows, 'every row needs a switch span for the stylesheet');
    assert.equal(shape.icons, shape.rows, 'and an ico span, or the favicon/folder glyph is missing');
    assert.equal(shape.jquery, 'undefined', 'history2.html must not load jQuery any more');
});

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
