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
 * `networkidle` is deliberately NOT used: `func.js` installs a 250 ms
 * `setInterval` that never clears, so the page is never idle.
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
