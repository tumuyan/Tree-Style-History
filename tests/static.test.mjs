// Static analysis of the shipped extension: manifest validity, MV3 constraints,
// asset references and i18n coverage.
//
// These are the checks that a browser would only surface at runtime (or not at
// all — a missing i18n key silently renders an empty label), so they are worth
// asserting in CI.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CHROME_DIR } from './stubs.mjs';
import { createDom } from './dom.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(CHROME_DIR, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(CHROME_DIR, rel));
const htmlFiles = () => fs.readdirSync(CHROME_DIR).filter((f) => f.endsWith('.html'));

/** Strip HTML comments so commented-out markup is not treated as live. */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/** Collect every start/self-closing tag as an attribute map. */
function collectTags(html) {
    const tags = [];
    for (const m of stripComments(html).matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
        const attrs = {};
        for (const a of m[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
        tags.push({ name: m[1].toLowerCase(), attrs });
    }
    return tags;
}

const hasClass = (tag, cls) => (tag.attrs.class || '').split(/\s+/).includes(cls);

/** Visit every first-party script as (relativePath, source). */
function walkScripts(visit) {
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.js')) {
                visit(path.relative(CHROME_DIR, p), fs.readFileSync(p, 'utf8'));
            }
        }
    };
    walk(path.join(CHROME_DIR, 'scripts'));
}

/** Names listed in a module's `export { ... }` block(s). */
function moduleExports(rel) {
    const src = fs.readFileSync(path.join(CHROME_DIR, rel), 'utf8');
    return [...src.matchAll(/export\s*\{([\s\S]*?)\};?/g)]
        .flatMap((block) => block[1].split(',').map((s) => s.trim()).filter(Boolean));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The source of `function name(...) { ... }`, braces balanced. */
function functionBody(src, name) {
    const head = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
    assert.ok(head, `${name}() is gone; update this guard`);
    const open = src.indexOf('{', head.index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    assert.fail(`${name}(): unbalanced braces`);
}

const MANIFEST = readJson('manifest.json');
const EN = readJson('_locales/en/messages.json');
const ZH = readJson('_locales/zh_CN/messages.json');

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

test('manifest declares Manifest V3', () => {
    assert.equal(MANIFEST.manifest_version, 3);
});

test('manifest has no MV2 background leftovers', () => {
    assert.equal(MANIFEST.background?.persistent, undefined, 'persistent background is MV2-only');
    assert.equal(MANIFEST.background?.page, undefined, 'background.page is MV2-only');
    assert.equal(MANIFEST.background?.scripts, undefined, 'background.scripts is MV2-only');
    assert.equal(MANIFEST.browser_action, undefined, 'browser_action is MV2-only');
    assert.ok(MANIFEST.background?.service_worker, 'MV3 requires background.service_worker');
});

test('every file referenced by manifest.json exists', () => {
    const refs = [
        MANIFEST.background?.service_worker,
        MANIFEST.options_page,
        MANIFEST.action?.default_popup,
        ...Object.values(MANIFEST.icons || {}),
        ...Object.values(MANIFEST.action?.default_icon || {}),
    ].filter(Boolean);

    assert.ok(refs.length > 0, 'expected at least one referenced file');
    for (const ref of refs) {
        assert.ok(exists(ref), `manifest references missing file: ${ref}`);
    }
});

test('manifest __MSG_*__ keys resolve in every locale', () => {
    const used = [];
    const collect = (s) => {
        const m = /__MSG_([A-Za-z0-9_]+)__/.exec(s || '');
        if (m) used.push(m[1]);
    };
    [MANIFEST.name, MANIFEST.short_name, MANIFEST.description].forEach(collect);
    Object.values(MANIFEST.commands || {}).forEach((c) => collect(c.description));

    assert.ok(used.length > 0, 'expected manifest to use i18n placeholders');
    for (const key of new Set(used)) {
        assert.ok(EN[key], `en is missing manifest key: ${key}`);
        assert.ok(ZH[key], `zh_CN is missing manifest key: ${key}`);
    }
});

// ---------------------------------------------------------------------------
// MV3 Content Security Policy
// ---------------------------------------------------------------------------

test('no inline <script> blocks in any HTML page (MV3 CSP)', () => {
    for (const file of htmlFiles()) {
        const html = stripComments(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'));
        for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
            assert.ok(
                /\bsrc\s*=/.test(m[1]),
                `${file}: inline <script> is forbidden under MV3 CSP: ${m[0]}`,
            );
        }
    }
});

test('no inline event-handler attributes in any HTML page (MV3 CSP)', () => {
    const handler = /\son[a-z]+\s*=/i;
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            const offenders = Object.keys(tag.attrs).filter((a) => handler.test(` ${a}=`));
            assert.deepEqual(offenders, [], `${file}: <${tag.name}> uses inline handlers: ${offenders}`);
        }
    }
});

test('no remotely hosted scripts (MV3 forbids remote code)', () => {
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            if (tag.name !== 'script') continue;
            const src = tag.attrs.src;
            if (src) {
                assert.ok(
                    !/^https?:\/\//i.test(src),
                    `${file}: remote script src is forbidden: ${src}`,
                );
            }
        }
    }
});

// ---------------------------------------------------------------------------
// MV3 Service Worker constraints
// ---------------------------------------------------------------------------

test('service worker does not use DOM or timer-based scheduling', () => {
    const sw = fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8');

    // The SW has no DOM. (localStorage is safe only because storage-adapter.js
    // redefines it in the SW scope — do not remove that import.)
    assert.ok(!/\bdocument\./.test(sw), 'service worker must not touch document');

    // A SW can be terminated after ~30s of idleness, so setInterval/setTimeout
    // cannot be used for periodic work. chrome.alarms is the MV3 replacement.
    assert.ok(!/\bsetInterval\s*\(/.test(sw), 'service worker must use chrome.alarms, not setInterval');
});

test('service worker never calls a function named by the message itself', () => {
    // Comments are stripped: this file documents the removed dispatch by
    // writing it out, which would otherwise match the very thing we forbid.
    const sw = stripJsComments(fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8'));

    // `self[message.function](...)` exposed every service-worker global —
    // internal helpers included — to anyone who could reach the port. Dispatch
    // has to go through an explicit table of names.
    assert.doesNotMatch(sw, /self\s*\[\s*message\s*\.\s*function\s*\]/);
    assert.match(sw, /CALLABLE_FUNCTIONS\s*\[\s*message\.function\s*\]/);
});

test('service worker checks the sender before running a callFunction request', () => {
    const sw = fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8');

    // Without this, any page or extension that can guess the name gets to run it.
    assert.match(sw, /sender\.id\s*!==\s*chrome\.runtime\.id/);
});

test('the crawl is paced, and its constants are declared before their callers', () => {
    // Two halves of one change. Raising the frequency only helps if a single
    // pass is bounded, and a bounded pass only covers the window if a pass that
    // stops is resumed by the next one — so the budget, the cursor and the
    // alarm have to all be present.
    const sw = stripJsComments(fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8'));

    for (const name of ['CRAWL_BUDGET_URLS', 'CRAWL_PERIOD_MINUTES', 'CRAWL_ALARM', 'CRAWL_SWEEP_KEY']) {
        assert.match(sw, new RegExp('const\\s+' + name + '\\s*='), `the crawl needs ${name}`);
    }
    // The alarm is the frequency half, and it has to be armed from somewhere.
    assert.match(sw, /chrome\.alarms\.create\(\s*CRAWL_ALARM/);
    assert.match(sw, /alarm\.name\s*===\s*CRAWL_ALARM/, 'the alarm must reach the crawl');

    // `const` is in the temporal dead zone until execution reaches it. The
    // alarms listener is registered near the top of the file and reads
    // CRAWL_ALARM when it runs, so a declaration further down throws — and only
    // on the path that listener starts, which no crawl test would notice.
    const listener = sw.indexOf('chrome.alarms.onAlarm.addListener');
    assert.ok(listener > 0, 'expected an alarm listener');
    for (const name of ['CRAWL_ALARM']) {
        const decl = sw.indexOf(`const ${name} `);
        assert.ok(decl > 0 && decl < listener,
            `${name} must be declared before the alarm listener that reads it`);
    }
});

test('the crawl publishes the heat map only for a finished window', () => {
    // The rule the accumulator exists for, and the one a "just clear the badge"
    // tidy-up would silently undo: a day's square is a cache that is filled once
    // and never recomputed, so a pass holding half a window must not write it.
    //
    // Checked on the source because the failure mode is a *missing* write on a
    // path the behaviour tests reach through a stubbed storage area: what they
    // would show is a wrong number, several layers away from the line that
    // caused it.
    const sw = stripJsComments(fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8'));
    const body = sw.slice(sw.indexOf('async function processVisits('));

    // A call statement, not a mention: the comments above this line talk about
    // saveCrawledHeat() a dozen times, and a bare /saveCrawledHeat\(/ counts
    // those too.
    const writes = body.match(/^\s*saveCrawledHeat\(/gm) || [];
    assert.equal(writes.length, 1,
        'saveCrawledHeat() must be called exactly once, from the finished-window branch');

    // *Where* it is called, not just how often. "Call it whenever a pass ends"
    // is the bug this replaced, and it still reads as one call: the write has to
    // sit inside `if (complete)`, which is what says the window is whole.
    const branch = body.slice(body.indexOf('if (complete) {'), body.indexOf('} else {', body.indexOf('if (complete) {')));
    assert.match(branch, /^\s*saveCrawledHeat\(/m,
        'the heat map must be written from the `complete` branch, where the window is whole');

    // Both the accumulator and its storage key, or a window counted in passes
    // would publish only the last pass's share.
    for (const fn of ['restoreCrawlHeat', 'saveCrawlState', 'clearCrawlState']) {
        assert.match(sw, new RegExp('function\\s+' + fn + '\\s*\\('), `the crawl needs ${fn}()`);
    }
    assert.match(sw, /const\s+CRAWL_HEAT_KEY\s*=/);
});

test('service worker imports its dependencies via importScripts', () => {
    const sw = fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8');
    // storage-adapter is mandatory: without it `localStorage` is undefined in a SW.
    assert.match(sw, /importScripts\(['"][^'"]*storage-adapter\.js['"]\)/);
});

// ---------------------------------------------------------------------------
// Asset references
// ---------------------------------------------------------------------------

test('every local src/href in HTML points at an existing file', () => {
    const missing = [];
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            for (const attr of ['src', 'href']) {
                const v = tag.attrs[attr];
                if (!v || v.startsWith('#') || v.startsWith('data:')) continue;
                if (/^[a-z][a-z0-9+.-]*:/i.test(v)) continue; // chrome://, https://, mailto: …
                if (!exists(v)) missing.push(`${file}: ${attr}="${v}"`);
            }
        }
    }
    assert.deepEqual(missing, []);
});

test('popup.html loads neither a message channel nor db-manager.js', () => {
    // Both were dead there: the popup lists come from chrome.history /
    // sessions / bookmarks and from the tab list the worker mirrors into
    // chrome.storage.session, so it never touches IndexedDB. The tags were
    // misleading — a message channel to the worker wakes it into re-running its
    // startup crawl — so the removal is asserted, not just commented.
    //
    // The other pages still load db-manager.js; this guard is deliberately
    // about the popup alone.
    const scripts = collectTags(fs.readFileSync(path.join(CHROME_DIR, 'popup.html'), 'utf8'))
        .filter((tag) => tag.name === 'script')
        .map((tag) => tag.attrs.src || '');

    assert.deepEqual(
        scripts.filter((s) => /message-adapter\.js|db-manager\.js/.test(s)),
        [],
        'the popup must not reach for the worker or IndexedDB',
    );
    // Guard against the tag being renamed away instead of removed: the comment
    // in popup.html explains an absence, so it has to still be an absence.
    assert.ok(scripts.some((s) => /storage-adapter\.js/.test(s)),
        'storage-adapter.js is still required; did the script list change?');
});

test('no page loads message-adapter.js any more', () => {
    // It wrapped the MV2/MV3 difference behind one API, but `useServiceWorker`
    // was derived from manifest_version and is therefore always true: every
    // MV2 branch (chrome.extension.getBackgroundPage()) was unreachable. The
    // one call site left — options.js's deleteDB() — went straight to
    // dbManager, which is all its MV3 route did anyway.
    const offenders = [];
    for (const file of htmlFiles()) {
        const html = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8');
        for (const tag of collectTags(html)) {
            if (tag.name === 'script' && /message-adapter\.js/.test(tag.attrs.src || '')) {
                offenders.push(file);
            }
        }
    }
    assert.deepEqual(offenders, [], 'message-adapter.js is back — call dbManager directly');
    assert.equal(
        fs.existsSync(path.join(CHROME_DIR, 'scripts/message-adapter.js')),
        false,
        'scripts/message-adapter.js was deleted; do not re-add it',
    );
});

test('no page loads jQuery, zTree or fuzzysearch any more', () => {
    // Every tree page now renders through scripts/modules/tree.js. The four
    // vendored files are deleted from the repo, so a re-add would be a new
    // dependency, not a restoration: assert both halves.
    //
    // Why it matters beyond size: zTree's async loader ships an eval() that
    // MV3's CSP forbids, and `first-party scripts never compile code at
    // runtime` above only ever exempted it by looking the other way.
    const BANNED = /jquery|ztree|fuzzysearch/i;

    const loaded = [];
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            if (tag.name !== 'script') continue;
            if (BANNED.test(tag.attrs.src || '')) loaded.push(`${file}: ${tag.attrs.src}`);
        }
    }
    assert.deepEqual(loaded, [], 'a page is loading the vendored tree library again');

    // A file that exists but is unreferenced is dead weight in the package the
    // user has to download, and it comes back the moment someone re-adds a tag.
    const shipped = fs.readdirSync(path.join(CHROME_DIR, 'scripts'))
        .filter((name) => BANNED.test(name));
    assert.deepEqual(shipped, [], 'the vendored library files are back in scripts/');
});

test('first-party scripts never reference jQuery or zTree globals', () => {
    // The library is gone from the pages; a leftover `$jq(…)` / `$.fn.zTree`
    // would be an undefined-variable crash at the first click, which no static
    // check above catches because `$` is also dom-helper's getElementById. So
    // match the shapes that only ever meant the library: the `$.fn.` namespace
    // and the noConflict() alias the two tree pages used.
    const offenders = [];
    walkScripts((file, src) => {
        const code = stripJsComments(src);
        for (const m of code.matchAll(/\$\.fn\.\w|\bfuzzySearch\s*\(|\bjQuery\b|\$jq\b/g)) {
            offenders.push(`${file.replace(/\\/g, '/')}: ${m[0]}`);
        }
    });
    assert.deepEqual(offenders, [], 'a reference to the removed library survived');
});

// ---------------------------------------------------------------------------
// i18n coverage
// ---------------------------------------------------------------------------

test('en and zh_CN message files have identical key sets', () => {
    const en = Object.keys(EN).sort();
    const zh = Object.keys(ZH).sort();
    assert.deepEqual(
        en.filter((k) => !zh.includes(k)),
        [],
        'keys present in en but missing from zh_CN',
    );
    assert.deepEqual(
        zh.filter((k) => !en.includes(k)),
        [],
        'keys present in zh_CN but missing from en',
    );
});

test('every rendered .lang key resolves in both locales', () => {
    const keys = new Set();
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            if (hasClass(tag, 'lang') && tag.attrs['data-lang-string']) {
                keys.add(tag.attrs['data-lang-string']);
            }
        }
    }
    assert.ok(keys.size > 0, 'expected at least one .lang element');
    for (const key of keys) {
        assert.ok(EN[key], `en missing data-lang-string key: ${key}`);
        assert.ok(ZH[key], `zh_CN missing data-lang-string key: ${key}`);
    }
});

test('every .help-tip element id resolves in both locales', () => {
    // loadOptionsLang() does `el.title = returnLang(el.id)`, so the element id
    // doubles as an i18n key. A missing key yields an empty tooltip.
    const ids = new Set();
    for (const file of htmlFiles()) {
        for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
            if (hasClass(tag, 'help-tip') && tag.attrs.id) ids.add(tag.attrs.id);
        }
    }
    assert.ok(ids.size > 0, 'expected at least one .help-tip element');
    for (const id of ids) {
        assert.ok(EN[id], `en missing help-tip key: ${id}`);
        assert.ok(ZH[id], `zh_CN missing help-tip key: ${id}`);
    }
});

test('every returnLang() key used in JS exists in both locales', () => {
    const keys = new Set();
    walkScripts((_file, src) => {
        for (const m of src.matchAll(/returnLang\(\s*'([^']+)'\s*\)/g)) keys.add(m[1]);
    });

    assert.ok(keys.size > 0, 'expected at least one i18n lookup in JS');
    for (const key of keys) {
        assert.ok(EN[key], `en missing JS key: ${key}`);
        assert.ok(ZH[key], `zh_CN missing JS key: ${key}`);
    }
});

test('no user-visible string in a page script is hard-coded Chinese', () => {
    // The tree pages' "nothing found" placeholders were literal Chinese, so an
    // English user saw 没有找到浏览历史 in an otherwise English tree. The i18n
    // assertions above all check the other direction — that a key the code asks
    // for exists — and none of them can see a string that never asked.
    //
    // Chinese comments are fine and stay: scanJs() has already dropped them.
    const offenders = [];
    walkScripts((file, src) => {
        const rel = file.replace(/\\/g, '/');
        // The generated copy of the shared layer is not hand-written.
        if (rel.endsWith('background-utils.js')) return;
        for (const { line, text } of hardCodedChineseIn(scanJs(src))) {
            offenders.push(`${rel}:${line}: ${text.slice(0, 40)}`);
        }
    });
    assert.deepEqual(offenders, [], 'these strings reach the screen untranslated');
});

test('the hard-coded-Chinese guard sees the shapes it claims to catch', () => {
    // Same rule as above, run against invented source. The first version of it
    // matched literals line by line, so every shape below reported zero and the
    // guard was green for the strings most likely to exist: the multi-line
    // template holding a page's placeholder markup.
    const foundIn = (src) => hardCodedChineseIn(scanJs(src)).map((o) => o.line);

    assert.deepEqual(foundIn("var a = '没有找到记录';"), [1], 'a one-line literal');
    assert.deepEqual(foundIn('var h = `<div class="empty">\n  没有找到记录\n</div>`;'), [1],
        'a multi-line template');
    // An escaped quote moves the closing delimiter, and `'([^']*)'` read the
    // escaped one as the end — the match stopped short of the Chinese.
    assert.deepEqual(foundIn("var a = 'It\\'s 没有找到记录';"), [1], 'an escaped single quote');
    assert.deepEqual(foundIn('var a = "say \\"没有找到记录\\"";'), [1], 'an escaped double quote');
    // The quote inside a regex literal is not a string delimiter. A regex
    // scanning already-stripped text cannot know that: it opened a literal on
    // the quote in `/'/g` and swallowed the real literal after it.
    assert.deepEqual(foundIn("var s = t.replace(/'/g, ''); var x = '没有找到记录';"), [1],
        'a quote inside a regex literal');
    // A division read as a regex literal. `hits / total` ends in a space, and the
    // old BEFORE_REGEX accepted a space as "an expression may start here"; the
    // scan then closed the literal on the `/` of `</td>` and dropped the string
    // between the two, so the span list came back empty instead of red.
    assert.deepEqual(foundIn("var pct = hits / total; item += '<td>没有找到记录</td>';"), [1],
        'a division before an inline HTML string');
    // ...and the fix must not overreach: `/ /g` matches a single space and is a
    // real literal. Requiring `/\S` — the obvious way to kill the division above
    // — misreads this one as a division, and then the `/` of the trailing
    // comment closes the "literal" it thinks is still open, so both the read and
    // the comment after it disappear. The comment is what makes this probe
    // discriminate: without a later `/` on the line the misread is harmless and
    // the assertion passes either way.
    assert.deepEqual(foundIn("var s = 'a b'.replace(/ /g, ''); var x = '没有找到记录'; // note"), [1],
        'a regex literal that starts with a space');

    // A literal after an arrow or an arithmetic operator. These were the largest
    // hole left: the operator was not in BEFORE_REGEX at all, so the `/` read as
    // a division, the pattern was copied through as text, and its inner quote
    // opened a string that ran to the next real `'` in the file. Everything in
    // between — Chinese included — was reported as one span, i.e. the guard was
    // green on a file that plainly contains Chinese.
    assert.deepEqual(foundIn("var k = xs.filter((t) => /['\"]/.test(t));\nvar x = '没有找到记录';"), [2],
        'a regex literal after an arrow');
    // One probe per member of BEFORE_REGEX's operator class, built the same way.
    // The class grew to `* % < > ~ ^` in this change and several of those
    // members were never mentioned by any probe: deleting them left the suite
    // at `pass 72 / fail 0`, so the rule enforced six characters nobody had
    // shown to matter. The pattern in these probes holds a quote on purpose —
    // read as a division it is copied through as text, the quote opens a
    // *string*, and the Chinese on the next line lands inside that span and is
    // never reported. Without the quote the two readings produce identical
    // output and the probe proves nothing.
    for (const op of ['+', '-', '*', '%', '<', '>', '~', '^']) {
        assert.deepEqual(
            foundIn(`var k = a ${op} /['"]/.test(t);\nvar x = '没有找到记录';`),
            [2],
            `a regex literal after \`${op}\``,
        );
    }
    // ...but `+` and `-` only open a literal when they are not doubled: `i++ / 2`
    // is a division, and adding them naively swallowed the literal after it.
    // Both doubles are checked — a veto that only looked at `++` left `i-- / 2`
    // free to open a bogus literal.
    for (const op of ['++', '--']) {
        assert.deepEqual(
            foundIn(`var q = n${op} / 2, label = '没有找到记录', r = a / b;`),
            [1],
            `a division after a postfix \`${op}\``,
        );
    }

    // The line number has to point at the literal, since that is the only
    // locator the message gives.
    assert.deepEqual(foundIn("var a = 1;\nvar b = 2;\nvar c = '没有找到记录';"), [3],
        'the reported line is the literal, not the top of the file');

    // And the two shapes it must never flag: Chinese prose (this repo writes its
    // comments in Chinese) and a string that goes through i18n.
    assert.deepEqual(foundIn('// 没有找到记录\nvar a = 1;'), [], 'a line comment');
    assert.deepEqual(foundIn('/* 没有找到记录 */\nvar a = 1;'), [], 'a block comment');
    assert.deepEqual(foundIn("var a = returnLang('noClosedFound');"), [], 'a translated string');
});

test('every data-lang-string element also carries the .lang class', () => {
        // page-init.js fills only elements matching '.lang', so an element with
        // just data-lang-string renders as an empty box — silently, with no console
        // error to point at the cause.
        const offenders = [];
        for (const file of htmlFiles()) {
            for (const tag of collectTags(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'))) {
                if (tag.attrs['data-lang-string'] && !hasClass(tag, 'lang')) {
                    offenders.push(`${file}: <${tag.name}>${tag.attrs.id ? ' #' + tag.attrs.id : ''}`);
                }
            }
        }
        assert.deepEqual(offenders, []);
    });

// ---------------------------------------------------------------------------
// Module graph vs. the page scripts that consume it
//
// The page scripts used to be classic scripts calling module functions through
// `window.*` mounts installed by func.js, so a missing mount was a runtime
// `undefined` that nothing reported. They are ES modules now: every symbol
// they call arrives by import, so what has to be checked is that each page
// script really imports what it uses.
// ---------------------------------------------------------------------------

// Paths are relative to CHROME_DIR, matching moduleExports()/fs calls above.
const MODULES = [
    'scripts/dom-helper.js',
    'scripts/modules/helpers.js',
    'scripts/modules/config.js',
    'scripts/modules/calendar.js',
    'scripts/modules/calendar-colors.js',
    'scripts/modules/popup-core.js',
    'scripts/modules/history-core.js',
    'scripts/modules/tree.js',
    'scripts/modules/ui-state.js',
    'scripts/modules/page-init.js',
];

// The pages: a script reached by navigating to a real HTML file. Everything
// else under scripts/ is either a module or loaded by importScripts().
const PAGE_SCRIPTS = [
    'scripts/popup.js',
    'scripts/history.js',
    'scripts/history2.js',
    'scripts/closed.js',
    'scripts/bookmark.js',
    'scripts/options.js',
];

const readScript = (rel) => fs.readFileSync(path.join(CHROME_DIR, rel), 'utf8');

/** Names a script brings into scope: imports plus its own top-level bindings. */
function scopeOf(rel) {
    const src = readScript(rel);
    const names = new Set();

    // `import { a, b as c } from '…'` — the local binding is what matters.
    for (const clause of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)) {
        for (const part of clause[1].split(',')) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const as = trimmed.split(/\s+as\s+/);
            names.add((as[1] || as[0]).trim());
        }
    }
    for (const clause of src.matchAll(/import\s+(\w+)\s*,?\s*(?:\{([\s\S]*?)\})?\s*from/g)) {
        if (clause[1]) names.add(clause[1]);
        for (const part of (clause[2] || '').split(',')) {
            const trimmed = part.trim();
            if (trimmed) names.add(trimmed.split(/\s+as\s+/).pop().trim());
        }
    }

    const addDecl = (re, group = 1) => {
        for (const m of src.matchAll(re)) names.add(m[group]);
    };
    // Top-level-ish declarations. Nested ones are included too: a false
    // negative here would only make these guards stricter, never wrong.
    addDecl(/(?:^|\n)\s*(?:const|let|var)\s+([\w$]+)/g);
    addDecl(/(?:^|\n)\s*function\s+([\w$]+)/g);
    addDecl(/(?:^|\n)\s*for\s*\(\s*(?:const|let|var)\s+([\w$]+)/g);
    addDecl(/function\s*\(([^)]*)\)\s*\{/g);
    for (const params of src.matchAll(/function\s*\(([^)]*)\)/g)) {
        for (const arg of params[1].split(',')) {
            if (arg.trim()) names.add(arg.trim());
        }
    }
    return names;
}

test('no module calls a function through window.* any more', () => {
    // Same family as the mount guard below, but for the read side: a `window.x()`
    // call in a module is a TypeError whenever x is an ES module export, and
    // nothing between here and the browser says so. `window.calendar('yes','')`
    // in history-core.js was exactly that — it threw in the deleteRange
    // callback, where the only symptom was "the calendar does not refresh".
    //
    // window.close()/open()/location/event/getComputedStyle are the real
    // browser API. onStorageReady is installed by storage-adapter.js, a
    // classic script, which is the one way a global can legitimately appear
    // here at all.
    const ALLOWED = new Set([
        'close', 'open', 'location', 'event', 'getComputedStyle', 'scrollY', 'pageYOffset',
        'getSelection', 'matchMedia', 'print', 'focus', 'blur', 'alert',
        'onStorageReady',
    ]);

    const offenders = [];
    walkScripts((file, src) => {
        const rel = file.replace(/\\/g, '/');
        if (!MODULES.some((m) => rel.endsWith(m.replace('scripts/', '')))) return;
        // Comments stripped, as in the dispatch guard above: this file
        // documents the removed call by writing it out.
        const code = stripJsComments(src);
        for (const m of code.matchAll(/\bwindow\.([\w$]+)\s*\(/g)) {
            if (!ALLOWED.has(m[1])) offenders.push(`${file}: window.${m[1]}()`);
        }
    });
    assert.deepEqual(offenders, [], 'a module calls a function through window — import it, or drop the call');
});

test('no first-party script mounts anything onto window any more', () => {
    // The window layer is what made dependencies invisible: a page script
    // called `filtUrl()`, nothing said where it came from, and a rename or a
    // deleted mount surfaced as `undefined is not a function` at runtime.
    //
    // Two exemptions, both genuine cross-file boundaries rather than a
    // compatibility layer:
    //   - storage-adapter.js replaces the `localStorage` global itself;
    //   - db-manager.js exposes a singleton to classic scripts, including the
    //     service worker's importScripts().
    //
    // There used to be a third, `selectBookmarkItemForTest` in bookmark.js:
    // the page's selection logic lived inside its `DOMContentLoaded` +
    // `onStorageReady` callback, so a global was the only way to reach it.
    // It is a module-level function now and tests/modules.test.mjs imports
    // it, so the exemption is gone rather than pinned.
    const EXEMPT = new Set([
        'scripts/storage-adapter.js',
        'scripts/db-manager.js',
    ]);

    const offenders = [];
    walkScripts((file, src) => {
        if (EXEMPT.has(file.replace(/\\/g, '/'))) return;
        for (const m of src.matchAll(/^\s*(?:window|self|globalThis)\.[\w$]+\s*=/gm)) {
            offenders.push(`${file.replace(/\\/g, '/')}: ${m[0].trim()}`);
        }
    });
    assert.deepEqual(offenders, [], 'a first-party script writes to a global again — import it instead');
});

test('every page script is loaded as a module, not as a classic script', () => {
    // The inverse of the guard above, and the one that would actually break
    // the pages: `import` is a syntax error in a classic script, so a stray
    // `<script src>` instead of `<script type="module" src>` fails before the
    // page renders anything.
    const offenders = [];
    for (const file of htmlFiles()) {
        const html = stripComments(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'));
        for (const rel of PAGE_SCRIPTS) {
            const tag = new RegExp(`<script\\b[^>]*src=["']${escapeRe(rel)}["']`, 'g');
            for (const m of html.matchAll(tag)) {
                if (!/type=["']module["']/.test(m[0])) offenders.push(`${file}: ${rel}`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});

test('the ES module graph is acyclic', () => {
    // ES modules tolerate cycles, but which of two mutually importing modules
    // finishes evaluating first decides whether a binding is defined or in the
    // temporal dead zone at import time. Two cycles used to exist here; the
    // helpers<->config one was broken by moving defaultValues into shared/,
    // the calendar<->history-core one by importing the bottom layer directly.
    const graph = new Map();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(p); continue; }
            if (!entry.name.endsWith('.js')) continue;
            const rel = path.relative(CHROME_DIR, p);
            const src = fs.readFileSync(p, 'utf8');
            const deps = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)]
                .map((m) => m[1])
                .filter((spec) => spec.startsWith('.'))
                .map((spec) => path.relative(CHROME_DIR, path.resolve(path.dirname(p), spec)));
            graph.set(rel, deps);
        }
    };
    walk(path.join(CHROME_DIR, 'scripts', 'modules'));

    assert.ok(graph.size >= 5, `expected the module directory to be walked, saw ${graph.size} files`);

    const state = new Map();
    const stack = [];
    const cycles = [];
    const visit = (node) => {
        if (state.get(node) === 'done') return;
        if (state.get(node) === 'open') {
            cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '));
            return;
        }
        state.set(node, 'open');
        stack.push(node);
        for (const dep of graph.get(node) || []) visit(dep);
        stack.pop();
        state.set(node, 'done');
    };
    for (const node of graph.keys()) visit(node);

    assert.deepEqual(cycles, [], `import cycles found:\n${cycles.join('\n')}`);
});

test('every page script imports what it calls', () => {
    // The check the window layer used to defeat. `no-undef` covers this while
    // the file is linted as a module; this covers it independently, because
    // the eslint config's module list is a separate thing to forget.
    const exportsByModule = new Map();
    for (const file of MODULES) {
        for (const name of moduleExports(file)) exportsByModule.set(name, file);
    }

    // Provided by the classic scripts a page loads before its module, or by
    // the platform. Not imports, and not something these guards should force
    // into one.
    const PROVIDED = new Set([
        'onStorageReady', 'dbManager', 'storageAdapter', 'localStorage',
        'window', 'document', 'chrome', 'console', 'location', 'navigator', 'performance',
        'Array', 'Date', 'JSON', 'Math', 'Number', 'Object', 'String', 'Set', 'Map',
        'RegExp', 'Promise', 'URL', 'CSS', 'IDBKeyRange', 'setTimeout', 'clearTimeout',
        'setInterval', 'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'undefined',
        'alert', 'module',
    ]);

    const unresolved = [];
    for (const file of PAGE_SCRIPTS) {
        const src = stripJsComments(readScript(file));
        const local = scopeOf(file);
        const unresolvedInFile = new Set();

        // Calls, reads and writes of anything not imported or declared locally.
        for (const m of src.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
            const name = m[1];
            if (local.has(name) || PROVIDED.has(name)) continue;
            if (!exportsByModule.has(name)) continue; // not ours; another guard's business
            unresolvedInFile.add(name);
        }
        for (const name of unresolvedInFile) unresolved.push(`${file}: ${name}`);
    }
    assert.deepEqual(unresolved, [], 'a page script calls a module function it never imports');
});

// ---------------------------------------------------------------------------
// MV3 code-shape constraints
// ---------------------------------------------------------------------------

test('first-party scripts never compile code at runtime', () => {
    // MV3's CSP forbids eval()/new Function() in an extension context. The one
    // exception is the bookmarklet runner: its function body is serialised by
    // chrome.scripting.executeScript and evaluated in the page's MAIN world,
    // which the extension CSP does not govern.
    const ALLOWED = { 'scripts/modules/helpers.js': 1 };
    const offenders = [];
    walkScripts((file, src) => {
        const hits = [...src.matchAll(/\beval\s*\(|new\s+Function\s*\(/g)].length;
        if (hits > (ALLOWED[file.replace(/\\/g, '/')] ?? 0)) offenders.push(`${file}: ${hits}`);
    });
    assert.deepEqual(offenders, [], 'a first-party script ships eval()/new Function()');
});

test('config.js only references option-page ids that exist', () => {
    const optionsIds = new Set(
        [...fs.readFileSync(path.join(CHROME_DIR, 'options.html'), 'utf8')
            .matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/config.js'), 'utf8');
    const referenced = new Set([
        ...[...src.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]),
        ...[...src.matchAll(/selectOptionByIdValue\('([\w-]+)'/g)].map((m) => m[1]),
    ]);

    const missing = [...referenced].filter((id) => !optionsIds.has(id)).sort();
    assert.deepEqual(missing, [], 'config.js references an element options.html does not define');
    // The last gap was `rhshare`: options.html has no control for rh-share, so
    // loadOptions() was looking up an element that cannot exist on every load.
    // Both halves are gone now (see also "saveOptions leaves settings without
    // an options-page control alone" in modules.test.mjs).
});

/**
 * Every key `defaultConfig()` writes, and every page script that mentions each.
 *
 * A key nobody reads is not neutral: `defaultConfig()` writes it into
 * chrome.storage.local on every service-worker start, `saveOptions(true)` uploads
 * it (or not) to chrome.storage.sync, and `downloadOptions()` writes it back —
 * so it occupies a slot in a 100KB quota and shows up in every diff of the
 * settings, all while doing nothing. Three of them (`rh-time`, `rh-share`,
 * `rhs-showbg`) survived years that way.
 */
function configKeyUsage() {
    const defaults = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/shared/config-defaults.js'), 'utf8');
    const keys = [...defaults.matchAll(/^\s*["']([^"']+)["']\s*:/gm)].map((m) => m[1]);

    // Matched as a quoted key, not as a substring: `rh-time` is a prefix of
    // `rh-timeformat`, so `src.includes(key)` would report the retired key as
    // read by every site that reads the live one.
    const usage = new Map(keys.map((k) => [k, []]));
    walkScripts((file, src) => {
        const rel = file.replace(/\\/g, '/');
        // The table itself is not a reader: every key appears in it by
        // definition, so counting this file would make the check say all 38
        // keys are read no matter what the rest of the extension does.
        //
        // background-utils.js is that same table again: `npm run gen` copies
        // config-defaults.js into it line for line, so excluding only the
        // source would leave the generated duplicate voting for every key —
        // and it is a file that always exists and is always regenerated, so
        // the guard went green for a key nothing reads. It only ever caught a
        // dead key by accident, when gen had not been run yet and
        // verify:sw-sync failed first.
        if (rel.endsWith('modules/shared/config-defaults.js') || rel === 'scripts/background-utils.js') return;
        for (const key of keys) {
            // A key is a WHOLE string literal or it is not this key: `rh-time`
            // is a prefix of `rh-timeformat`, so a prefix match reports the
            // retired key as read by every site that reads the live one.
            const quoted = new RegExp('([\'"])' + escapeRe(key) + '\\1', 'g');
            if (quoted.test(src)) usage.get(key).push(rel);
        }
    });
    return { keys, usage };
}

test('every default config key is read somewhere outside the defaults table', () => {
    // `defaultValues` is the single source of truth, which makes it the natural
    // place for a retired setting to rot: removing a feature deletes its readers,
    // and nothing then complains that the key itself is still being written,
    // uploaded and restored on every start.
    const { usage } = configKeyUsage();
    const dead = [...usage].filter(([, files]) => files.length === 0).map(([key]) => key).sort();

    assert.deepEqual(dead, [], 'a default is written, synced and restored but never read — drop it');
});

test('a key saveOptions writes is also one the options page reads back', () => {
    // The direction of issue #5 that a user actually feels. rh-group /
    // rh-orderby / rh-order are written by the sort toolbar on the history and
    // bookmark pages, which has no control on the options page; if saveOptions()
    // collected them it would write whatever the form happens to hold — the
    // default — and undo a choice the user made ten seconds ago.
    //
    // "Reads back" rather than "has an element with a matching id": the ids are
    // camelCase spellings of some keys and unrelated to others (`rhtime` reads
    // `rh-timeformat`), so a name-matching guard needs a hand-maintained map —
    // the very thing that drifts. What holds without one is that a value can
    // only leave this page if the page put it on screen first.
    const cfg = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/config.js'), 'utf8');
    const written = new Set([...cfg.matchAll(/^\s*so\['([\w-]+)'\]\s*=/gm)].map((m) => m[1]));

    const read = new Set([...cfg.matchAll(/localStorage\['([\w-]+)'\]/g)].map((m) => m[1]));
    // loadSlider() takes the key as its last argument, so those reads are named
    // in options.js rather than in config.js.
    const options = fs.readFileSync(path.join(CHROME_DIR, 'scripts/options.js'), 'utf8');
    for (const m of options.matchAll(/loadSlider\(\s*'[^']*'\s*,\s*[^,]+\s*,\s*[^,]+\s*,\s*'([\w-]+)'\s*\)/g)) {
        read.add(m[1]);
    }

    const unread = [...written].filter((key) => !read.has(key)).sort();
    assert.deepEqual(unread, [], 'saveOptions() writes a value the options page never shows');
});

test('the saveOptions key guard matches the shapes it claims to catch', () => {
    // Both directions, or it proves nothing: a guard that accepts everything
    // reports an empty list and looks like the rule holds.
    const keyOf = (line) => /^\s*so\['([\w-]+)'\]/.exec(line)[1];
    assert.equal(keyOf("    so['rh-itemsno'] = $('rhitemsno').value;"), 'rh-itemsno');
    assert.equal(keyOf("    so['favicon-service-fallback'] = $('x').value;"), 'favicon-service-fallback');
    // A key with a dashes-stripped and a camelCase spelling both resolve, which
    // is why the guard tries every form rather than one.
    assert.equal('rh-itemsno'.replace(/-/g, ''), 'rhitemsno');
    assert.equal('favicon-service-fallback'.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), 'faviconServiceFallback');
});

/**
 * Locals already escaped by `escaper`, e.g. `var titleText = escapeHtmlText(t)`.
 * A render site may escape either inline or through such a variable, and the
 * guards below have to accept both.
 */
function escapedLocals(src, escaper) {
    const re = new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*${escaper}\\s*\\(`, 'g');
    return new Set([...src.matchAll(re)].map((m) => m[1]));
}

test('user-controlled values are escaped before being interpolated into HTML attributes', () => {
    // A double quote in a page title or URL closes a double-quoted attribute
    // and injects markup. The pages hold history/bookmarks/tabs/sessions
    // permissions, so this is not a cosmetic issue.
    //
    // Judgment is by WHITELIST, not by "does this look like user data". The
    // render sites name their escaped locals `*Attr`, and the previous
    // blacklist went blind the moment they did: it happily passed a raw
    // `rha[thisc.counter].url` interpolation, because `urlAttr` matches
    // neither `\.url\b` nor any of its other patterns. A guard that owes its
    // green to a rename is worse than a skip — the skip at least said so.
    const ATTRIBUTES = ['href', 'value', 'title', 'src'];
    const FILES = ['modules/history-core.js', 'modules/popup-core.js', 'modules/config.js', 'bookmark.js'];
    // Built here rather than read out of the browser: i18n strings and literals.
    const GENERATED = /^returnLang\(|^\d+$/;

    const offenders = [];
    for (const file of FILES) {
        const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts', file), 'utf8');
        const escaped = escapedLocals(src, 'escapeHtmlAttr');
        for (const attr of ATTRIBUTES) {
            // `(?<!\[)` skips CSS attribute selectors — `[title="' + CSS.escape(host) + '"]`
            // is a lookup, not markup, and is covered by the selector guard
            // instead. Both spell `title="`, so without this the two are
            // indistinguishable to a regex.
            const pattern = new RegExp(`(?<!\\[)${attr}="'\\s*\\+\\s*([^'"]+?)\\s*\\+\\s*'"`, 'g');
            for (const m of src.matchAll(pattern)) {
                const expr = m[1].trim();
                if (expr.includes('escapeHtmlAttr') || escaped.has(expr)) continue;
                if (GENERATED.test(expr)) continue;
                offenders.push(`${file}: ${attr}="${expr}"`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Escaping — text positions
// ---------------------------------------------------------------------------

// A `/` that opens a regex literal rather than a comment can only follow an
// operator, a bracket, a `;`, or a keyword that expects an expression. Without
// this, `.replace(/'/g, …)` leaves the quote state open for the rest of the file
// and the comment stripping silently stops working — which is how a doc comment
// mentioning title_fix() came to look like a call to it.
//
// Whitespace alone is NOT one of the tokens it may follow, even though a regex
// cannot follow an operand either: `hits / total` ends in a space, so listing
// `\s` here said "a regex can start after a space" and a division read as a
// literal. `endOfRegex()` then closed it on the `/` of a later `</td>` and the
// string in between vanished from the span list — the shape
// `hits / total; item += '<td>…</td>'` was invisible. The operands themselves
// are the discriminator, and they are what this list enumerates.
//
// The tempting one-liner — "a regex cannot start with a space, so require
// `/\S`" — is wrong in the other direction: `/ /g` is a real literal (matching
// one space), and rejecting it left the comment after it unstripped.
//
// Arithmetic and comparison operators belong in the list for the same reason
// the brackets do: `(t) => /['"]/` and `a + /x/` start a literal. Omitting them
// read the `/` as a division and copied the pattern through as text, after
// which its inner quote opened a *string* — and the damage was silent and
// large: quote state ran to the next real `'` in the file, so every literal in
// between was reported as one span and the hard-coded-Chinese guard went green
// on a file that plainly contains Chinese. `i++ / 2` is the shape that keeps
// `+` and `-` from being added naively: the veto is a lookbehind, because the
// operator touching the `/` is the second half of a doubled pair. The
// lookahead that used to accompany it is gone — this regex is matched as a
// suffix of the text before the `/`, so a lookahead at the end of the match can
// never fail, and no probe could tell whether it was there.
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};*%<>~^]|(?<![+\-])[+\-]|\b(?:return|typeof|case|in|of|delete|void|new|do|else|yield|await))\s*$/;

/**
 * Index just past the closing `/` of the regex literal beginning at `start`
 * (the index after its opening slash), or -1 if there is no such literal.
 *
 * `/` is ambiguous — division and the start of a regex literal look alike — and
 * guessing wrong used to be silent: the scan ran to the end of the file, every
 * remaining character was copied through unexamined, and comment stripping
 * quietly stopped working from that point on, so the guard stopped guarding
 * without ever going red. Requiring a closing slash on the same line (a regex
 * literal cannot span lines) means a division is copied through as ordinary
 * text instead of swallowing the rest of the file.
 *
 * A division followed by a later regex on the same line is still misread, but
 * the characters in between are copied verbatim — the only thing lost is a
 * comment sitting inside that span, which the old behaviour lost too, along
 * with everything after it.
 */
function endOfRegex(src, start) {
    let inClass = false;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { i++; continue; }
        if (c === '\n') return -1;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) return i + 1;
    }
    return -1;
}

/**
 * Comment-strip `src` and, in the same pass, record where each string or
 * template literal starts and ends.
 *
 * The span list is why this is not `stripJsComments()` plus a regex over its
 * output: by the time the comments are gone, a `'` inside a regex literal is
 * indistinguishable from a real string delimiter. `t.replace(/'/g, '')` made a
 * regex-based scan open a literal on that quote and close it on the `'` of the
 * next real string, so the two spans reported were `'/g, '` and
 * `"'); var x = '"` — neither containing the Chinese in between.
 *
 * Quote state here is the same state `stripJsComments()` tracks, so this is a
 * refactor of that function rather than a second implementation that has to
 * agree with it: `stripJsComments()` returns `.code` from this scan.
 *
 * Known limit, shared with the stripper: a `${}` hole in a template is not
 * descended into, so a nested backtick inside one ends the outer span early.
 * Every span still gets its own text, which is all the caller needs.
 */
function scanJs(src) {
    let code = '';
    const literals = [];
    let quote = null;
    let quoteAt = 0;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            code += ch;
            if (ch === '\\') { code += src[i + 1] ?? ''; i++; }
            else if (ch === quote) {
                literals.push({ at: quoteAt, text: code.slice(quoteAt) });
                quote = null;
            }
        } else if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            quoteAt = code.length;
            code += ch;
        } else if (ch === '/' && src[i + 1] === '/') {
            // Stop *before* the newline, so the loop's i++ lands on it and the
            // `else` below copies it through. Skipping past it deletes the line
            // boundary and every reported line number drifts — which is the only
            // locator this rule gives.
            while (i + 1 < src.length && src[i + 1] !== '\n') i++;
        } else if (ch === '/' && src[i + 1] === '*') {
            // A block comment can span lines, and it is copied through as
            // newlines only: dropping them would move every line after it.
            let nl = '';
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') nl += '\n';
                i++;
            }
            code += nl;
            i++;
        } else if (ch === '/' && BEFORE_REGEX.test(code)) {
            // Regex literal, but only if one actually closes on this line;
            // otherwise it is a division and has to be copied through as
            // ordinary text.
            const end = endOfRegex(src, i + 1);
            if (end < 0) {
                code += ch;
            } else {
                code += src.slice(i, end);
                i = end - 1; // the loop's i++ lands on the first character after it
            }
        } else {
            code += ch;
        }
    }
    return { code, literals };
}

/**
 * The comment-free source, i.e. `scanJs(src).code`.
 *
 * A wrapper rather than a second scan, so the two can never disagree about
 * where a literal starts — the spans the Chinese guard reads and the text the
 * other rules match have to describe the same file.
 */
function stripJsComments(src) {
    return scanJs(src).code;
}

/**
 * Every string / template literal in `scan` whose text contains CJK, with the
 * 1-based line the literal starts on.
 *
 * Reads `scanJs()`'s span list instead of matching a regex over the stripped
 * text: see the note on scanJs() for the quote inside a regex literal, which a
 * regex over the stripped text reads as a delimiter and hides the rest of the
 * line behind.
 */
function hardCodedChineseIn(scan) {
    const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
    return scan.literals
        .filter((literal) => CJK.test(literal.text))
        .map((literal) => ({
            line: scan.code.slice(0, literal.at).split('\n').length,
            text: literal.text,
        }));
}

test('stripJsComments drops prose that merely mentions a symbol', () => {
    // The reason this function exists: a doc comment reading "the old
    // title_fix() deleted…" used to look like a call.
    assert.doesNotMatch(stripJsComments('// title_fix()\nfoo();'), /title_fix/);
    assert.doesNotMatch(stripJsComments('/* title_fix() */\nfoo();'), /title_fix/);
    assert.doesNotMatch(stripJsComments('var x = 1; /* see title_fix() */ var y = 2;'), /title_fix/);
});

test('stripJsComments survives a regex literal that contains a quote', () => {
    // `.replace(/'/g, '')` is what broke the first version of this guard: with
    // the quote state left open, comment stripping silently stopped.
    assert.doesNotMatch(stripJsComments("var s = t.replace(/'/g, ''); // title_fix()\n"), /title_fix/);
    // A character class may hold an unescaped '/'.
    assert.doesNotMatch(stripJsComments('if (/[/]/.test(u)) { } // title_fix()\n'), /title_fix/);
});

test('stripJsComments does not read a division as a regex literal', () => {
    // A '/' that is really an operator has no closing slash on its line. The
    // old scan ran to end of file from here, copying everything through
    // unexamined — so every later comment survived and the guard quietly
    // stopped guarding. Both complaints below depend on it still working.
    const src = 'const ratio = total / count;\n// title_fix()\nvar n = 1; /* title_fix() */\n';
    assert.match(stripJsComments(src), /total \/ count/, 'the division itself must survive');
    assert.doesNotMatch(stripJsComments(src), /title_fix/, 'comment stripping must still be live');
});

test('no render site relies on title_fix for safety', () => {
    // title_fix() deleted '<', '>' and '/' instead of escaping them, which both
    // mangled titles ("Docs / API" lost its slashes) and produced a value that
    // could not be escaped again without the entity showing up as literal text.
    // Escaping now belongs at the interpolation site, where the context —
    // attribute or text — is actually known.
    //
    // Deliberately has no allow-list: the right number of call sites is zero,
    // so this also stops anyone reintroducing the function later.
    const offenders = [];
    walkScripts((file, src) => {
        // One offender per occurrence, so the report names the file once per
        // call site.
        const found = stripJsComments(src).match(/\btitle_fix\s*\(/g);
        for (let _i = 0; found && _i < found.length; _i++) {
            offenders.push(file.replace(/\\/g, '/'));
        }
    });
    assert.deepEqual(offenders, []);
});

test('element ids come from uniqueId(), not from inline random arithmetic', () => {
    // The 18-digit expression `Math.floor(Math.random() * <18 nines>) + <18
    // digit floor>` was written out seventeen times: seven in each list
    // renderer, three in the options page's list builders. A sweep that
    // collapsed the fourteen it found left the options page's three in place
    // and read, for a while, as "done" — which is exactly what this guard is
    // for. uniqueId() is the one place that shape is allowed to live.
    const offenders = [];
    walkScripts((file, src) => {
        // One offender per occurrence, so the report names the file once per
        // site rather than once per file.
        const found = stripJsComments(src).match(/Math\.floor\(\(Math\.random\(\)/g);
        for (let _i = 0; found && _i < found.length; _i++) {
            offenders.push(file.replace(/\\/g, '/'));
        }
    });
    assert.deepEqual(offenders, []);
});

// A value heading for storage or for another module must arrive RAW: the side
// that turns it into markup is the only one that knows whether it is writing
// attribute text, element text or JSON, and a pre-escaped value cannot be
// un-escaped there. It is also how a title ended up displayed as literal
// `&amp;#34;` — hand-escaped on the way into `mv-cache`, escaped again at the
// interpolation site.
//
// What this does NOT ban: the two escapers themselves (helpers.js defines
// them), and the odd HTML string a page builds inline. It bans the one shape
// that has actually bitten twice — reaching for `.replace()` to do escaping.
// Running it inside helpers.js too is deliberate: a third escaping helper must
// not appear there either.
const HAND_ESCAPED = /(?:&(?:amp|lt|gt|quot|#3[49]);)/;

/**
 * `src` with the two escapers' bodies cut out.
 *
 * They are defined here as what they are: the tables listing those five
 * entities. A rule banning the entities with no exception for the escapers
 * would report helpers.js eight times, and an allow-list keyed on file would
 * let a third escaper appear next to them — so cut the two by name instead,
 * which keeps the rest of the file covered.
 */
function withoutEscapers(src) {
    let out = src;
    for (const name of ['escapeHtmlAttr', 'escapeHtmlText']) {
        const head = new RegExp(`function\\s+${name}\\s*\\(`).exec(out);
        if (!head) continue;
        const open = out.indexOf('{', head.index);
        let depth = 0;
        let close = -1;
        for (let i = open; i < out.length; i++) {
            if (out[i] === '{') depth++;
            else if (out[i] === '}' && --depth === 0) { close = i; break; }
        }
        assert.ok(close > 0, `${name}(): unbalanced braces`);
        out = out.slice(0, open) + out.slice(close + 1);
    }
    return out;
}

test('nothing hand-escapes a value on its way into storage', () => {
    const offenders = [];
    walkScripts((file, src) => {
        const rel = file.replace(/\\/g, '/');
        for (const line of stripJsComments(withoutEscapers(src)).split('\n')) {
            if (!HAND_ESCAPED.test(line)) continue;
            offenders.push(`${rel}: ${line.trim()}`);
        }
    });
    assert.deepEqual(offenders, []);
});

test('the hand-escaping guard matches the shape it claims to catch', () => {
    // Same rule as above, run against invented source: without this the guard
    // is one `.replace()` away from going green permanently. The first two
    // shapes are the ones that were actually in the tree; the last two are what
    // the rule must NOT see, and they are why it runs on stripJsComments()
    // output rather than on the raw file.
    const foundIn = (src) => stripJsComments(withoutEscapers(src)).split('\n')
        .filter((line) => HAND_ESCAPED.test(line))
        .map((line) => line.trim());

    const was = "title: title.replace(/\"/g, \'&#34;\'),";
    assert.equal(foundIn(was).length, 1, 'the mv-cache write must not come back');
    assert.equal(foundIn("title = t.replace(/&/g, \'&amp;\');").length, 1, 'an inline & escaper either');

    assert.deepEqual(foundIn("// which came out as a literal \'&#34;\'"), [],
        'prose describing the entities is not an offender');
    assert.deepEqual(foundIn('value.replace(/&/g, ESC.amp)'), [],
        'a table-driven replacement does not mention the entity');
    // The escapers are cut rather than exempted by file, so a third one
    // appearing beside them is what this has to stay able to see. The escape
    // sequences are what they are because the snippet has to be a real
    // function body: withoutEscapers() looks for a brace-balanced block, and
    // a truncated one would leave the rest of the line in place and look like
    // an offender for the wrong reason.
    assert.equal(
        foundIn('function escapeHtmlAttr(t) {\n  return t.replace(/&/g, \'&amp;\');\n}\n').length, 0,
        'the two escapers themselves are not offenders');
    assert.equal(
        foundIn('function escapeHtmlXss(t) {\n  return t.replace(/&/g, \'&amp;\');\n}\n').length, 1,
        'a hand-rolled escaper next to the real ones still is');
});

// `date = date + DAY` reads like date arithmetic but is string concatenation:
// `+` converts a Date through ToPrimitive with hint "default", which prefers a
// string, so the variable silently becomes "Wed Sep 10 2026 ...86400000".
// Every later `.getTime()` on it throws, and every comparison against it
// (`time >= date`) degrades into a lexicographic string compare.
//
// The correct form is the one shared/format.js has used since the 1.8 batch:
// `new Date(x.getTime() + DAY)`.
// Deliberately only the `x = x + DAY` shape. `x += DAY` is NOT covered: on a
// number it is ordinary arithmetic and is common enough that matching it would
// be pure noise, so the two forms cannot share one rule.
const DATE_ADVANCE = /\b(\w+)\s*=\s*\1\s*\+\s*(?:DAY|86400000)\b/;
// matchAll() requires the global flag; derived from the same source so the two
// can never drift apart.
const DATE_ADVANCE_ALL = new RegExp(DATE_ADVANCE.source, 'g');

test('no Date object is advanced by adding a day count', () => {
    // Three sites had this: background-sw.js:797 (visitTab), history2.js:201 and
    // closed.js:220 (both in timeStr2). All three hold a real Date.
    //
    // No allow-list: `n = n + DAY` on a number is only a verbose `n += DAY`, so
    // failing the build costs one keystroke and catches the real thing.
    const offenders = [];
    walkScripts((file, src) => {
        for (const m of stripJsComments(src).matchAll(DATE_ADVANCE_ALL)) {
            offenders.push(`${file.replace(/\\/g, '/')}: ${m[0]}`);
        }
    });
    assert.deepEqual(offenders, []);
});

// Platform APIs that are newer than the manifest's declared floor, mapped to
// the first Chrome that ships them. Anything listed here is a hard requirement:
// the extension installs on older Chrome but breaks the moment it runs, which
// is worse than refusing to install.
//
// Only APIs whose use can be detected reliably by source shape belong here —
// a heuristic that over-matches would just produce noise.
const CHROME_API_VERSIONS = [
    { name: 'Object.hasOwn()', min: 93, pattern: /\bObject\.hasOwn\s*\(/ },
    // Bookmarklets must run in the page's main world to see page globals.
    // Chrome silently drops the option on older versions, so the script ends up
    // in the isolated world and half the bookmarklets on the web stop working.
    { name: "scripting.executeScript({ world: 'MAIN' })", min: 95, pattern: /world\s*:\s*['"]MAIN['"]/ },
    { name: 'structuredClone()', min: 98, pattern: /\bstructuredClone\s*\(/ },
    { name: 'Array.prototype.findLast()', min: 97, pattern: /\.findLast(Index)?\s*\(/ },
    { name: 'Array.prototype.toSorted()', min: 110, pattern: /\.to(Sorted|Reversed|Spliced)\s*\(/ },
    { name: 'Promise.withResolvers()', min: 119, pattern: /\bPromise\.withResolvers\s*\(/ },
    { name: 'Object.groupBy()', min: 117, pattern: /\bObject\.groupBy\s*\(/ },
    // Session storage is the only area that survives a service worker restart
    // without touching the disk, and the only one the tab-tracking state can
    // be persisted to. On older Chrome the property is simply undefined, so
    // the extension would lose the visit tree rather than fail loudly.
    { name: 'chrome.storage.session', min: 102, pattern: /chrome\.storage\.session\b/ },
];

test('minimum_chrome_version is a string, as Chrome parses it', () => {
    // Found the hard way: writing it as the NUMBER 96 makes Chrome reject the
    // manifest outright. Nothing in the extension reports this — the service
    // worker simply never registers, so only the e2e suite notices, and there
    // it looks like "the service worker did not start".
    const raw = readJson('manifest.json').minimum_chrome_version;
    assert.equal(typeof raw, 'string',
        'Chrome parses minimum_chrome_version as a version string; a number breaks extension loading');
});

test('minimum_chrome_version covers the newest API the code uses', () => {
    const declared = Number(readJson('manifest.json').minimum_chrome_version);
    // "parse as", not "be": the field is a version STRING — see the guard above.
    assert.ok(Number.isFinite(declared), 'minimum_chrome_version must parse as a number');

    let required = 0;
    const evidence = [];
    walkScripts((file, src) => {
        const code = stripJsComments(src);
        for (const { name, min, pattern } of CHROME_API_VERSIONS) {
            if (!pattern.test(code)) continue;
            evidence.push(`${name} needs Chrome ${min} (${file.replace(/\\/g, '/')})`);
            if (min > required) required = min;
        }
    });

    assert.ok(
        declared >= required,
        `manifest.json declares minimum_chrome_version ${declared} but the code needs ${required}:\n  ${evidence.join('\n  ')}`,
    );
});

test('the Date-advance guard matches the shape it claims to catch', () => {
    // Mutation check. The guard is a regex over source text, so it has to be
    // pinned to the failing and passing forms — otherwise it stays green by
    // simply seeing nothing.
    assert.match('            date = date + DAY;', DATE_ADVANCE);
    assert.match('date = date + 86400000;', DATE_ADVANCE);

    // The fixed forms must NOT match.
    assert.doesNotMatch('date = new Date(date.getTime() + DAY);', DATE_ADVANCE);
    assert.doesNotMatch('_DATE = new Date(_DATE.getTime() + DAY);', DATE_ADVANCE);
    // loadDate() builds its calendar key from a NUMBER, so `date + DAY` there
    // is ordinary arithmetic, not the bug.
    assert.doesNotMatch('let dday = "d" + (date + DAY).toString();', DATE_ADVANCE);
});

// closest() returns null when no ancestor matches — which happens routinely
// here, because a delete detaches rows while a repaint is still sweeping the
// checkboxes they contained. Dereferencing that null throws and aborts the
// whole sweep, leaving the list half updated.
//
// The guard is static because bookmark.js keeps these functions inside a
// DOMContentLoaded closure, so there is no handle to call them from a test.
const CLOSEST_ASSIGN = /\b(?:var|let|const)\s+(\w+)\s*=\s*[^;\n]*\.closest\s*\(/;

/**
 * 1-based line number of the `nth` (0-based) occurrence of `needle`.
 *
 * Needed because two offending declarations can be textually identical — the
 * same `var parent = ele.closest(...)` appears twice in bookmark.js — so the
 * snippet alone cannot tell them apart.
 */
function lineOfNth(lines, needle, nth) {
    let seen = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle) && ++seen === nth) return i + 1;
    }
    return 0;
}
/** `x.getAttribute(...)` / `x.style.` — a use that throws on null. */
const DEREFERENCE = (name) => new RegExp('\\b' + name + '\\s*\\.');
/** Every null-check shape the codebase already uses. */
const NULL_GUARD = (name) => new RegExp(
    'if\\s*\\(\\s*!?\\s*' + name + '\\s*\\)' // if (x) / if (!x)
    + '|\\b' + name + '\\s*&&' // x && …
    + '|\\b' + name + '\\s*\\?', // x ? … : …
);

test('every closest() result is null-checked before it is dereferenced', () => {
    // No allow-list: a missing row is always a legitimate state, so there is
    // no call site where an unguarded dereference would be correct.
    const offenders = [];
    walkScripts((file, src) => {
        // Detection runs on the comment-stripped source so prose is not
        // mistaken for code; the report uses the ORIGINAL line number, because
        // stripping block comments shifts line numbers by dozens and a wrong
        // one is worse than none.
        const rawLines = src.split('\n');
        const lines = stripJsComments(src).split('\n');
        const seen = new Map();
        for (let i = 0; i < lines.length; i++) {
            const m = CLOSEST_ASSIGN.exec(lines[i]);
            if (!m) continue;
            const nth = seen.get(m[0]) ?? 0;
            seen.set(m[0], nth + 1);
            const name = m[1];
            // The declaration plus the two lines after it: if a null check
            // exists at all, it is within reach.
            const view = lines.slice(i, i + 3).join('\n').slice(m.index);
            if (!DEREFERENCE(name).test(view)) continue; // assigned, never used here
            if (NULL_GUARD(name).test(view)) continue;
            const at = lineOfNth(rawLines, m[0], nth);
            offenders.push(`${file.replace(/\\/g, '/')}:${at || i + 1}: ${m[0].trim()}`);
        }
    });
    assert.deepEqual(offenders, []);
});

test('the closest guard accepts each guarded shape and rejects the unguarded ones', () => {
    // Mutation check: the guard is regex over source text, so it has to be
    // pinned from both sides — otherwise it goes green by matching nothing.
    const guarded = (lines) => {
        const m = CLOSEST_ASSIGN.exec(lines[0]);
        const name = m[1];
        const view = lines.slice(0, 3).join('\n').slice(m.index);
        return !DEREFERENCE(name).test(view) || NULL_GUARD(name).test(view);
    };

    // Accepted: every shape already used in the codebase.
    assert.ok(guarded(["var h = el.closest('div');", 'if (h) h.style.color = "x";']));
    assert.ok(guarded(["var h = el.closest('div');", 'if (!h) return;', 'var id = h.getAttribute("id");']));
    assert.ok(guarded(["var p = el.closest('div');", 'if (p && p.getAttribute("rel") == "w") {}']));
    assert.ok(guarded(["var h = el.closest('div');", 'var url = h ? h.getAttribute("x") : null;']));
    // Assigned but not dereferenced in reach: nothing to guard.
    assert.ok(guarded(["var p = el.closest('div');", 'handItOff(p);']));

    // Rejected: the two shapes that were actually broken.
    assert.ok(!guarded(["var p = el.closest('div');", 'if (p.getAttribute("rel") == "w") {}']));
    assert.ok(!guarded(["var h = el.closest('div');", 'var id = h.getAttribute("data-id");']));
});

test('page titles are escaped at the point they become text content', () => {
    // The counterpart of the attribute check above. A page title is
    // attacker-controlled and is interpolated as TEXT CONTENT (`>' + x + '<`),
    // where escapeHtmlAttr() is the wrong escaper — it rewrites quotes that in
    // a text position need no escaping at all.
    //
    // No allow-list: every site that carries a page title has to escape it.
    // Generated values (timestamps, ids, i18n strings) simply do not match the
    // TITLE_FIELDS filter below, so there is nothing to exempt — and an
    // exemption list is exactly what lets the next unescaped title slip
    // through. The "looks like user data" heuristic the attribute check once
    // used was defeated by renaming a variable; matching on the field names
    // instead is not.
    const TITLE_FIELDS = /(?:rha\[thisc\.counter\]|data)\.title\b|\bdisplayTitleText\b|\btitle\b(?=\s*\|\||\s*\))/;

    const offenders = [];
    walkScripts((file, src) => {
        const code = stripJsComments(src);
        const escaped = escapedLocals(code, 'escapeHtmlText');
        // `">' + expr + '</span>'` — a text position. Anchored on the closing
        // `'<` so that `title="' + … + '"` (an attribute) does not match, and
        // on the opening `>` so a merely adjacent quote is not enough.
        for (const m of code.matchAll(/>\s*'\s*\+\s*([^']+?)\s*\+\s*'\s*</g)) {
            const expr = m[1].trim();
            if (!TITLE_FIELDS.test(expr)) continue;
            if (expr.includes('escapeHtmlText') || escaped.has(expr)) continue;
            offenders.push(`${file.replace(/\\/g, '/')}: >${expr}<`);
        }
    });
    assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Stored values
// ---------------------------------------------------------------------------

// Every value read out of `localStorage` in this project is a string:
// storage-adapter.js coerces with String(value) on the way in, which is what
// chrome.storage.local hands back. Using one as a number therefore depends on
// implicit coercion — `>` and `-` convert for you, `+` concatenates, and `===`
// never converts. The conversion is invisible at the read site, which is why
// these reads are wrapped; see the note above loadDate() in background-sw.js.
//
// Deliberately NOT reported:
//   * `+` — string building ("D" + n) is far more common here than addition, so
//     flagging it would train everyone to ignore the output.
//   * equality against a string literal (`=== 'yes'`, `!= 'no'`) — that is how
//     config switches are read, and Number() would break it.
//   * a member access or a call on the value (`mvbl.length`, `rl.indexOf(u)`):
//     the operator belongs to the member, which is a number already.
//   * `++` / `--` / `+=` — `oid++` on a string yields a number, `s += read`
//     is concatenation. Neither has ever been the bug.
//
// A value handed to a variable first is followed: `n = localStorage['x']` and
// `dateId > n` three lines later is exactly the shape that ended the history
// crawl a day early, and it is invisible to a check that only looks at the read.
//
// That follow is scoped to ONE top-level function at a time — a single table for
// the whole file exempts a name everywhere as soon as it is wrapped once.
// popup-core.js declares `var itemsno` three times (rct-itemsno / rt-itemsno /
// mv-itemsno); wrapping one of them used to clear the other two. Kept a copy of
// the shape rather than of the code: this file and the script must agree, and
// they cannot agree by sharing, because the script's copy is what `verify` runs
// on its own.

// The operator that can sit to the RIGHT of an operand: `n > read`, `read - n`.
const RIGHT_OPERATOR = /^\s*(<=|>=|===|!==|==|!=|<|>|\*|\/|%|-)/;
// ...and the one that can sit to its LEFT: `read > n`, `DAY * read`. The
// optional `=` covers `x -= read`; plain `x = read` does not match, because `=`
// alone is not in the alternation.
const LEFT_OPERATOR = /(<=|>=|<|>|\*|\/|%|-)=?\s*$/;
// A read already made numeric — or parsed as JSON — where it is read.
const NUMERIC_WRAPPER = /\b(?:Number|parseInt|parseFloat|JSON\.\w+)\s*\(\s*$/;
// Equality only coerces when the other side is a number, so `=== 'yes'` (the
// switch idiom) is fine. `=== 1` is not: strict equality never converts, so a
// stored value compared to a number is never equal.
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?\b/;

/** The characters immediately before `index`, on the same line. */
function beforeAt(src, index) {
    return src.slice(src.lastIndexOf('\n', index - 1) + 1, index);
}

/** The operator an operand sits next to, or null when it is not an operand. */
function operatorNear(before, after) {
    if (/=>\s*$/.test(before)) return null; // `() => localStorage['x']`: an arrow

    const right = RIGHT_OPERATOR.exec(after);
    if (right) {
        if (/^(?:===|!==|==|!=)$/.test(right[1])) {
            return NUMBER_LITERAL.test(after.slice(right[0].length).trimStart()) ? right[1] : null;
        }
        return right[1];
    }
    const left = LEFT_OPERATOR.exec(before);
    return left ? left[1] : null;
}

/**
 * Split `src` at its top-level `function` declarations.
 *
 * Each slice carries its own `at` (its offset in `src`) so a report can name the
 * line the reader sees; positions inside a slice are slice-relative and only
 * make sense added back to it.
 */
function functionSlices(src) {
    const starts = [];
    // Column zero, so a nested function or a method is not a boundary, and an
    // IIFE or an arrow — neither of which is written `function name(` at the
    // margin in this codebase — is not one either.
    for (const m of src.matchAll(/^function[\s\S]*?\s([\w$]+)\s*\(/gm)) starts.push(m.index);
    starts.push(src.length);
    return starts.slice(0, -1).map((at, i) => ({ at, code: src.slice(at, starts[i + 1]) }));
}

/**
 * Locals that still hold a raw stored string: `var n = localStorage['x']`, per
 * slice — `var n = Number(localStorage['x'])` is the fix being enforced, not a
 * violation of it.
 *
 * Keyed by slice, not merged into one set: the point of slicing is that
 * `itemsno` wrapped in one function says nothing about the `itemsno` in the
 * next, and a flat set of names throws that distinction away again the moment
 * two slices declare the same name. Callers get back the slices with their own
 * name sets attached.
 */
function slicesWithStringVars(src) {
    return functionSlices(src).map(({ at, code }) => {
        const numeric = new Set(
            [...code.matchAll(/(?:var|let|const)\s+([\w$]+)\s*=\s*(?:Number|parseInt|parseFloat)\s*\(\s*localStorage\b/g)]
                .map((m) => m[1]),
        );
        const names = new Set();
        // Anchored at the start of a statement so that `style.width = localStorage[…]`
        // is not read as a variable named `width`. `var`/`let`/`const` is optional
        // because `oid = localStorage['oid']` reassigns one too.
        //
        // `\n` belongs in that "start of statement" set, and dropping it is not a
        // cosmetic difference: the most common real shape is a name on the line
        // after a closing brace — `popup-core.js`'s `var ca`, `background-sw.js`'s
        // `_shareFaviconCache` — and the assignment there is preceded by a newline,
        // not by `;` or `{`. This copy had `(?:^|[;{])` while
        // scripts/check-storage-numbers.mjs had `(?:^|[;{]|\n)`, so the two checks
        // disagreed about whether a violation below one of those lines existed.
        // Kept identical to the script by the parity guard below.
        for (const m of code.matchAll(/(?:^|[;{]|\n)\s*(?:(?:var|let|const)\s+)?([\w$]+)\s*=\s*localStorage\b/g)) {
            if (!numeric.has(m[1])) names.add(m[1]);
        }
        return { at, code, names };
    });
}

/**
 * The whole rule as shipped in scripts/check-storage-numbers.mjs — the comment
 * stripper and `unwrappedNumericReads` together, from its operator constants to
 * the driver loop.
 *
 * Loaded by evaluating the source, not by importing it: the script runs its
 * driver loop at module scope, so importing it would scan the tree a second
 * time as a side effect of a test.
 *
 * The whole rule, not just the stripper: comparing stripped text is only half
 * of "the two agree". The other half is the rule that reads the stripped text,
 * and the two copies of the "a local that still holds a string" pattern lived
 * on that side — the suite's had `(?:^|[;{])` where the script's had
 * `(?:^|[;{]|\\n)`, and a parity check that ran *this* file's rule over the
 * script's output could not see it.
 */
function scriptRule() {
    const file = path.join(CHROME_DIR, '..', 'scripts', 'check-storage-numbers.mjs');
    const src = fs.readFileSync(file, 'utf8');
    const from = src.indexOf('const RIGHT_OPERATOR');
    const to = src.indexOf('const offenders = [];');
    assert.ok(from > 0 && to > from, 'the rule moved — update scriptRule()');
    return new Function(`${src.slice(from, to)}\nreturn { stripComments, unwrappedNumericReads };`)();
}

/**
 * Wrap a fragment in a top-level function.
 *
 * The rule scans one top-level function at a time, so a probe written as a bare
 * statement is inside no slice and is never read — a "violation" that both
 * implementations agree is clean. Every probe below goes through here, and the
 * one probe that does not is asserted to be the exception.
 */
function fn(body) {
    return `function probe() {\n${body}\n}\n`;
}

/** Every bare `localStorage['x']` / `getItem('x')` read that feeds an operator. */
function unwrappedNumericReads(src) {
    const out = [];
    // Each slice answers two questions on its own: "is this read wrapped", and
    // "is this followed variable wrapped". Pairs of (slice offset, position in
    // slice) are added back together so a report names a line of `src`.
    for (const { at, code } of functionSlices(src)) {
        const re = /localStorage\s*(?:\[\s*(['"])(.*?)\1\s*\]|\.\s*getItem\s*\([^)]*\))/g;
        let m;
        while ((m = re.exec(code))) {
            const before = beforeAt(code, m.index);
            if (NUMERIC_WRAPPER.test(before.replace(/\s+$/, ''))) continue;
            const op = operatorNear(before, code.slice(m.index + m[0].length));
            if (op) out.push({ what: m[0], op, at: m.index + at });
        }
    }

    // The same rule, applied where the value is used rather than read. Each
    // slice is searched for the names it declared itself.
    for (const { at, code, names } of slicesWithStringVars(src)) {
        for (const name of names) {
            const re = new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
            let hit;
            while ((hit = re.exec(code))) {
                const after = code.slice(hit.index + hit[0].length);
                if (/^\s*[.[(]/.test(after)) continue; // `.length`, `.indexOf()`, `[i]`
                const op = operatorNear(beforeAt(code, hit.index), after);
                if (op) out.push({ what: name, op, at: hit.index + at });
            }
        }
    }
    return out;
}

test('a stored value used as a number is wrapped in Number() or parseInt()', () => {
    // `11 > "10"` is true and `"120" - 3` is 117, so most of these sites have
    // always behaved. The ones that do not are why the rule exists: comparing
    // `load-range3` as strings puts "9" above "120", which ends the crawl early,
    // and `"7" + 1` is "71". Both look right until the value leaves the range
    // where the two orderings happen to agree.
    //
    // Number() on these sites is not a bug fix — it is the implicit conversion
    // written down, so nobody has to remember which operator coerces. This guard
    // is what stops the next read from being written the other way.
    const offenders = [];
    walkScripts((file, src) => {
        for (const hit of unwrappedNumericReads(stripJsComments(src))) {
            offenders.push(`${file.replace(/\\/g, '/')}: ${hit.what} ${hit.op}`);
        }
    });
    assert.deepEqual(offenders, [], 'wrap the read in Number() — every stored value is a string');
});

test('the numeric-wrapper guard matches the shapes it claims to catch', () => {
    // Pinned from both sides. A guard that only matches one spelling of "read a
    // stored value" goes green by matching nothing, which is worse than no
    // guard: it looks like the rule is being enforced.
    //
    // Fragments, not whole files: every probe below is a statement or two, and
    // the rule scans one top-level function at a time — a bare statement is not
    // inside one. `fn()` wraps each probe so it is still a shape the rule has to
    // judge, exactly as it would see it in a real file, and the two assertions
    // at the end pin that the wrapper is what makes the probes visible: without
    // it every probe would silently report nothing.
    const shapes = (src) => unwrappedNumericReads(functionSlices(fn(src))[0].code).length;
    assert.equal(
        unwrappedNumericReads(fn("if (dateId > localStorage['load-range']) { }")).length, 1,
        'an unwrapped probe must be scanned',
    );
    assert.equal(
        unwrappedNumericReads("if (dateId > localStorage['load-range']) { }").length, 0,
        'a bare statement is not inside a function, so it is not scanned',
    );

    assert.equal(shapes("if (dateId > localStorage['load-range']) { }"), 1,
        'the comparison that ends loadDate() early must be reported');
    assert.equal(shapes("if (zNodes.length < localStorage['load-range4']) { }"), 1,
        'a string comparison on the day count must be reported');
    assert.equal(shapes("DAY * localStorage['load-range']"), 1,
        'an operator to the left of the read counts too');
    assert.equal(shapes("var n = localStorage['load-range'];\nif (dateId > n) { }"), 1,
        'a value handed to a variable first is still a string when compared');
    assert.equal(shapes("if (n > localStorage.getItem('load-range')) { }"), 1,
        'getItem() reads the same storage');

    // Not arithmetic: wrapped, the switch idiom, an assignment, a member access.
    assert.equal(shapes("var n = Number(localStorage['load-range']);\nif (dateId > n) { }"), 0,
        'the fix itself must pass');
    assert.equal(shapes("if (localStorage['share-favicon-cache'] !== 'no') { }"), 0,
        'comparing a switch to its literal is not numeric');
    assert.equal(shapes("var grp = localStorage['rh-group'];\nif (grp == 'yes') { }"), 0);
    assert.equal(shapes("var fbl = localStorage['rh-filtered'];\nif (fbl.length > 0) { }"), 0,
        'the length of a string is a number already');
    assert.equal(shapes("var rl = localStorage['mv-blocklist'];\nif (rl.indexOf(u) < 0) { }"), 0);
    assert.equal(shapes("document.body.style.width = localStorage['rh-width'];"), 0,
        'an assignment is not an operator on the value');
    assert.equal(shapes("const load = (k) => localStorage[k];"), 0,
        'an arrow returning the value is not a comparison');
    assert.equal(shapes('oid++;'), 0, '`oid++` on a string yields a number');
});

test('the numeric-read rule agrees with scripts/check-storage-numbers.mjs', () => {
    // Two implementations of one rule: this file's `unwrappedNumericReads` +
    // `stringVarsFromStorage` + `stripJsComments`, and the standalone
    // `npm run verify:storage-numbers`. They exist separately on purpose — one
    // runs inside the suite, the other is a `verify` step anyone can point at a
    // file — but they must not disagree about what the code says.
    //
    // They did, twice, and both times the probe was the reason this test exists
    // rather than a reason to trust it:
    //
    //   * the stripper's `//` handling turned the `//` inside a regex literal
    //     such as `/^(http|https)\:\/\//` into a comment that ran to the end of
    //     the file, so everything after the first such regex was dropped;
    //   * the two copies of the "a local that still holds a string" rule had
    //     `(?:^|[;{])` and `(?:^|[;{]|\n)`. The most common real shape is a
    //     name on the line after a closing brace — `popup-core.js`'s `var ca`,
    //     `background-sw.js`'s `_shareFaviconCache` — so the suite stayed green
    //     on code the script rejected.
    //
    // The probe list below is the fix: each entry is a shape that made the two
    // implementations disagree, or that a naive rewrite would let them diverge
    // on again. Three things are compared per probe — the stripped text
    // character for character, the verdict, and the line count — because a
    // report carrying the wrong line number is a report nobody can act on.
    const probes = [
        // A read below a regex literal: the stripper must not swallow it.
        [
            'a read after a regex literal',
            fn('for (var i = 0; i < n; i++) {\n'
            + 'if ((/^(http|https)\\:\\/\\//).test(u)) {\n'
            + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"
            + '}\n'),
        ],
        // A local assigned after a closing brace, then compared: the shape the
        // suite's narrower anchoring used to miss.
        ['a local followed across a newline', fn("}\nvar ca = localStorage['rh-click'];\nif (ca > 3) { }\n")],
        ['a bare reassignment after a newline', fn("}\n_shareFaviconCache = localStorage['share-favicon-cache'];\n")],
        // Line-comment runs: the newline must survive, or every later report
        // carries a line number from the wrong line.
        ['two line comments before a read', fn("// one\n// two\nvar bad = localStorage['rh-itemsno'];\nif (bad > 3) { }\n")],
        // A block comment that spans lines.
        ['a multi-line block comment', fn("/*\n  two\n  lines\n*/\nvar bad = localStorage['rh-itemsno'];\nif (bad > 3) { }\n")],
        // Wrapped at the read: both must stay silent.
        ['a wrapped read', fn("var n = Number(localStorage['load-range']);\nif (dateId > n) { }\n")],
        // Equality only coerces against a number literal, so this is a violation
        // while `=== 'yes'` is not. A rule that drops that distinction reports
        // the switch idiom, which is how a check trains people to ignore it.
        ['equality against a number literal', fn("if (localStorage['rh-itemsno'] === 3) { }\n")],
        ['the switch idiom, which must stay silent', fn("if (localStorage['share-favicon-cache'] !== 'no') { }\n")],
        // The operator on the left of the read, and a compound assignment.
        // Each is a separate piece of the rule, and a piece that silently
        // matches nothing is how a check goes green while enforcing nothing.
        ['an operator to the left of the read', fn("DAY * localStorage['load-range']\n")],
        ['a read on the right of a compound assignment', fn("x -= localStorage['rh-itemsno']\n")],
        // A division, not a regex: both must still see the comment after it.
        ['a division that looks like a regex', fn("var r = total / count; // note\nvar bad = localStorage['rh-itemsno'];\nif (bad > 3) { }\n")],
        // The same division, but followed on its line by an inline `</td>`: the
        // scan used to close a bogus literal on that slash and drop the read in
        // between, and both strippers have to agree that they do not.
        [
            'a division followed by an inline closing tag',
            fn("var pct = hits / total; var s = '<td>x</td>';\n"
            + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"),
        ],
        // ...while a literal that legitimately starts with a space keeps being a
        // literal, or the fix for the line above hides the read after it.
        [
            'a regex literal that starts with a space',
            fn("var s = 'a b'.replace(/ /g, ''); // note\n"
            + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"),
        ],
        // A `/` in regex position with no closing `/` on its line, followed by a
        // line comment. A stripper that lets a literal run past the newline
        // swallows the `// comment` line as if it were part of the pattern —
        // and a comment is exactly where a violation likes to hide.
        ['a slash that must not reach the next line', fn("var r = 1 / 2\n// comment\nvar bad = localStorage['x'];\nif (bad > 3) { }\n")],
        // A literal after an arrow or an arithmetic operator: both strippers
        // have to agree that the `/` opens a literal rather than a division.
        // The trailing comment is what makes the probe discriminate — reading
        // the `/` as a division copies the pattern through and then lets its
        // inner quote open a string that swallows the `// note`, so that side
        // keeps the comment while the other drops it. Without a comment the two
        // outputs are identical either way and the probe proves nothing.
        [
            'a read after a literal that follows an arrow',
            fn("var k = xs.filter((t) => /['\"]/.test(t)); // note\n"
            + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"),
        ],
        // One probe per operator in that class, built the same way, because
        // `* % < > ~ ^` arrived with no probe pointing at them — a mutation that
        // deleted any one of the six left this suite green. The pattern holds a
        // quote on purpose: read as a division it is copied through as text, the
        // quote opens a *string*, and both the `// note` and the read below it
        // land inside that span on one side only.
        ...['+', '-', '*', '%', '<', '>', '~', '^'].map((op) => [
            `a read after a literal that follows \`${op}\``,
            fn(`var k = a ${op} /['"]/.test(t); // note\n`
                + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"),
        ]),
        // ...while `i++ / 2` stays a division. Reading it as a literal closes it
        // on a later `/` on the line and swallows everything between, comment
        // included — so this is the probe that keeps `+`/`-` from being added to
        // BEFORE_REGEX without the doubled-operator veto.
        ...['++', '--'].map((op) => [
            `a division after a postfix \`${op}\``,
            fn(`var q = i${op} / 2; var s = 'x'; // note\n`
                + "var bad = localStorage['rh-itemsno']; if (bad > 3) { }\n"),
        ]),
        // The same local name in two top-level functions, wrapped in one of them
        // only. A file-wide symbol table exempts both — which is what this rule
        // did, on popup-core.js, where `itemsno` is declared three times.
        // Everything below is wrapped in a function because the rule scans one
        // function at a time; see the note on functionSlices().
        [
            'a name wrapped in one function and not the next',
            'function a() {\n'
            + "var itemsno = Number(localStorage['rt-itemsno']);\n"
            + 'if (itemsno > 0) { }\n'
            + '}\n'
            + 'function b() {\n'
            + "var itemsno = localStorage['mv-itemsno'];\n"
            + 'if (itemsno > 0) { }\n'
            + '}\n'
            + 'function c() {\n'
            + "var other = localStorage['mv-itemsno'];\n"
            + 'if (other > 0) { }\n'
            + '}\n',
        ],
        // Statements outside every function: the slice is the file up to the
        // first `function`, so a violation there must still be reported.
        // Not wrapped, on purpose: statements outside every function are their
        // own slice, and a read there has to be judged like any other. This is
        // the only probe `fn()` does not wrap, and the assertion after the loop
        // checks that it is the only one.
        ['statements outside every function', "var bad = localStorage['rh-itemsno'];\nif (bad > 3) { }\nfunction a() { }\n"],
    ];

    // The script's side is loaded by slicing its source, because its driver loop
    // runs at module scope and importing it would scan the tree a second time.
    const shipped = scriptRule();

    for (const [what, probe] of probes) {
        const suiteStripped = stripJsComments(probe);
        // Compared as text, not as two derived numbers. Asserting only "same
        // verdict, same line count" leaves a stripper free to mangle the code it
        // copies through — dropping the closing slash of a regex literal keeps
        // both counts identical while the rule is now reading a different file.
        // The stripped sources being equal is the invariant that makes the two
        // verdicts comparable in the first place.
        assert.equal(
            shipped.stripComments(probe),
            suiteStripped,
            `the two strippers must agree character for character on: ${what}`,
        );
        // Each side's rule runs over its own stripped text. Running one rule
        // over the other's output was how the mismatched `stringVarsFromStorage`
        // patterns stayed invisible.
        const suiteVerdict = unwrappedNumericReads(suiteStripped);
        const shippedVerdict = shipped.unwrappedNumericReads(shipped.stripComments(probe));
        assert.equal(
            suiteVerdict.length,
            shippedVerdict.length,
            `the two checks must reach the same verdict on: ${what}`,
        );
        // ...and report it at the same place. `unwrappedNumericReads` walks one
        // top-level function at a time and adds the slice offset back to reach a
        // line of the file; a copy that skipped that addition would agree on the
        // count and disagree on where the code is.
        assert.deepEqual(
            suiteVerdict.map((hit) => suiteStripped.slice(0, hit.at).split('\n').length),
            shippedVerdict.map((hit) => shipped.stripComments(probe).slice(0, hit.at).split('\n').length),
            `the two checks must count lines the same way on: ${what}`,
        );
        assert.equal(
            suiteStripped.split('\n').length,
            probe.split('\n').length,
            `the line count must survive the strip on: ${what}`,
        );
    }

    // And the verdicts have to be the interesting ones, not a column of silent
    // zeros: a parity guard that compares "no violations" against "no
    // violations" is green by matching nothing, which is the failure this whole
    // pair of checks was written about.
    const offenders = probes.filter(([, p]) => unwrappedNumericReads(stripJsComments(p)).length > 0);
    assert.ok(offenders.length >= 5,
        `the probe list needs violations to disagree about, not just agreements (found ${offenders.length})`);

    // Every probe with a violation has to be inside a top-level function, or the
    // rule never reads it — see functionSlices(). A probe written as a bare
    // statement is a "violation" that both implementations agree is clean, which
    // is exactly the column of silent zeros the assertion above prevents. So the
    // two counts have to match: the probes that report something are the probes
    // that are wrapped, with the single exception of the one about statements
    // outside every function.
    const wrapped = probes.filter(([, p]) => /^function\s/.test(stripJsComments(p).trimStart()));
    assert.equal(
        probes.filter(([, p]) => /localStorage/.test(stripJsComments(p))).length,
        wrapped.length + 1,
        `${offenders.length} probes report a violation but only ${wrapped.length}`
        + ' are inside a function — wrap the rest in fn(), or the rule never reads them',
    );
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

// chrome.* API -> the manifest permission it requires. APIs absent from this
// map (runtime, i18n, action, commands, windows…) need no permission.
const API_PERMISSIONS = {
    storage: 'storage',
    tabs: 'tabs',
    history: 'history',
    bookmarks: 'bookmarks',
    sessions: 'sessions',
    contextMenus: 'contextMenus',
    alarms: 'alarms',
    scripting: 'scripting',
};

// Consumed implicitly: chrome.scripting.executeScript acts on the tab the user
// is looking at, which activeTab grants without a host permission.
const IMPLICIT_PERMISSIONS = new Set(['activeTab']);

const chromeApisUsed = () => {
    const used = new Set();
    walkScripts((_file, src) => {
        for (const m of src.matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) used.add(m[1]);
    });
    return used;
};

test('every chrome.* API in use is covered by a manifest permission', () => {
    const used = chromeApisUsed();
    const granted = new Set(MANIFEST.permissions || []);
    const uncovered = Object.entries(API_PERMISSIONS)
        .filter(([api, permission]) => used.has(api) && !granted.has(permission))
        .map(([api, permission]) => `chrome.${api} needs "${permission}"`);
    assert.deepEqual(uncovered, [], 'a missing permission makes the API undefined at runtime, with no error');
});

test('the manifest declares no permission the code never uses', () => {
    // Permissions are shown to the user at install time and are scrutinised in
    // store review, so an unused one is a real cost.
    const used = chromeApisUsed();
    const apiForPermission = Object.fromEntries(
        Object.entries(API_PERMISSIONS).map(([api, permission]) => [permission, api]),
    );
    const unused = (MANIFEST.permissions || []).filter((permission) => {
        if (IMPLICIT_PERMISSIONS.has(permission)) return false;
        const api = apiForPermission[permission];
        return !api || !used.has(api);
    });
    assert.deepEqual(unused, []);
});

test('history.js hands the calendar redraw to the range delete', () => {
    // deleteHistoryItem('range') cannot import calendar(): calendar.js imports
    // history() from history-core.js, which would close a cycle. So the redraw
    // has to come from the page — and nothing but this file notices if the page
    // stops passing it. Without it the delete still happens, the list still
    // reloads, and the heat map of every day but the selected one keeps the
    // counts from before the delete.
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/history.js'), 'utf8');
    assert.match(
        src,
        /deleteHistoryItem\(\s*'range'\s*,\s*[\s\S]{0,200}?calendar\(/,
        'deleteHistoryItem(\'range\') needs the calendar redraw as its second argument',
    );
});

test('the heat map has exactly one page-side writer, and it lives in history-core.js', () => {
    // Two things about `save_calendar_storage2()` are easy to undo by accident
    // and invisible from the UI until an actual day is wrong:
    //
    //   * it must be called for an *empty* result too — `n < 1` is how an entry
    //     is deleted, and no other code removes one, so a call that only sits
    //     inside `if (rha.length > 0)` can never clean up;
    //   * the `overwrite` argument must be written out, not hardcoded — only
    //     today may be replaced by the page (see the note in the module's own
    //     test), and `true` in that slot silently re-creates the race with the
    //     crawl's differently-measured count.
    //
    // Both were true of the code this guard was added for; the module tests
    // cover the behaviour, and this covers the shape.
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/history-core.js'), 'utf8');
    const code = stripJsComments(src);

    const calls = [...code.matchAll(/save_calendar_storage2\(([^;]*?)\);/g)].map((m) => m[1]);
    assert.equal(calls.length, 1, `expected one call site in history-core.js, found ${calls.length}`);
    assert.match(calls[0], /rha\.length/, 'the count has to come from the rows just collected');
    assert.match(calls[0], /isToday/, 'the overwrite flag has to be decided, not literalled');

    // And the decision itself: today, by day key, not by "the day on screen".
    assert.match(code, /dayKey\(obj\['endTime'\]\)\s*===\s*dayKey\(Date\.now\(\)\)/,
        'the authoritative day has to be computed from the query window being today');

    // ...and both the flag and the write sit at the search callback's own
    // level, so *both* the empty and the non-empty path reach the write.
    // Written as a brace depth rather than a regex, because "outside the
    // branch" is a structural property and a regex over the text cannot see it.
    //
    // Third round of review, twice over: the first attempt had both lines
    // inside `if (hi.length > 0)` (the empty result got nothing, which is the
    // bug this whole rule exists to prevent), and the second had the write
    // *before* the fill loop that builds `rha` — so it always reported 0 and
    // silently deleted the day. The depth check plus the fill-loop ordering
    // catches both; the module tests' "an empty older day still gets filled
    // in" and "a day that just became empty is dropped" catch them from the
    // behaviour side.
    //
    // Quotes are blanked first: `'{'` in a string is not a brace, and this file
    // has plenty of `{` inside string literals (`'div[rel="' + …`).
    const depthOf = (text) => {
        const slice = text.replace(/'(\\.|[^'])*'/g, "''").replace(/"(\\.|[^"])*"/g, '""');
        let depth = 0;
        for (const ch of slice) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        return depth;
    };
    // Searched after the declaration: the import statement names the function
    // too, and taking the first hit would compare the import's depth.
    const declaration = code.indexOf('var isToday');
    const call = code.indexOf('save_calendar_storage2', declaration);
    assert.ok(declaration > -1 && call > declaration, 'the flag must be decided before the write');

    // The fill loop comes between them: the rows are collected, then reported.
    const fillLoop = code.indexOf('rha.push(', declaration);
    assert.ok(fillLoop > -1 && fillLoop < call,
        'the write has to report the rows the loop collected, not whatever `rha` held before it ran');

    assert.equal(depthOf(code.slice(0, call)), depthOf(code.slice(0, declaration)),
        `the write is nested deeper than the flag — one of the two is inside a branch, so an empty result never reaches the write`);
});

test('the heat map re-hydrates on cross-context writes', () => {
    // Two runtimes write the same key, each serialising its OWN parsed map
    // over the whole value. storage-adapter keeps the localStorage cache in
    // sync, but the parsed object is a separate copy hydrated once at startup;
    // without an onChanged listener a write from one context is erased by the
    // other's next flush and nothing recomputes the lost days.
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/shared/calendar-storage.js'), 'utf8');
    const code = stripJsComments(src);
    assert.match(code, /chrome\.storage\.onChanged\.addListener/,
        'the shared layer must listen for changes to calendar-storage2');
    assert.match(code, /hydrateCalendarStorage\(/,
        'the parsed map must be rebuilt, not left as the boot-time copy');
    // `change.newValue` is the value that just landed: reading the localStorage
    // cache instead would depend on storage-adapter's own listener running
    // first, which is an ordering nothing enforces.
    assert.match(code, /'newValue'\s+in\s+change/,
        're-hydration must use the change payload, not the localStorage cache');
});

test('finishEmptyDay only clears the calendar for the day view', () => {
    // history('search', q) shares the empty-result path with the day view.
    // A keyword that matches nothing says nothing about the day on the
    // calendar, so writing '0' and uncolouring the selected cell there wiped
    // a perfectly good day's total and colour.
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/history-core.js'), 'utf8');
    const code = stripJsComments(src);
    const slice = code.slice(code.indexOf('function finishEmptyDay'), code.indexOf('function history('));
    const guard = slice.indexOf('rh-views-insert');
    const total = slice.indexOf('calendar-total-value');
    const paint = slice.indexOf('paintSelectedDay');
    assert.ok(guard > -1, 'finishEmptyDay must decide which view it is finishing');
    assert.ok(total > guard, 'the total must be written inside the day-view branch');
    assert.ok(paint > guard, 'the selected cell must be cleared inside the day-view branch');
});

test('the tree pages label their total as a node count, not the row total', () => {
    // `#calendar-total-value` means two different things: on history.html it is
    // the day's history rows, on the two tree pages it is how many nodes the
    // tree was given. Both used to say "Total History Items", which invites the
    // reader to compare them — and they are not comparable (the tree counts
    // every visit it walked, the list counts URLs after filtering).
    //
    // The distinction became load-bearing once the heat map stopped being
    // written by these pages: their numbers no longer have anything to do with
    // the calendar above them, so the label has to stop implying that they do.
    for (const file of ['history2.html', 'closed.html']) {
        const html = stripComments(fs.readFileSync(path.join(CHROME_DIR, file), 'utf8'));
        assert.match(html, /data-lang-string="totalTabsInTree"/,
            `${file} still labels its node count as a history-row total`);
        assert.doesNotMatch(html, /data-lang-string="totalHistoryItems"/,
            `${file} shows the history-row label next to a node count`);
    }

    // The key has to exist in both locales, or page-init() writes the key name
    // into the element and nobody sees a number at all.
    for (const locale of ['en', 'zh_CN']) {
        const messages = JSON.parse(
            fs.readFileSync(path.join(CHROME_DIR, '_locales', locale, 'messages.json'), 'utf8'));
        assert.ok(messages.totalTabsInTree, `_locales/${locale} is missing totalTabsInTree`);
    }
});

test('popup rows carry no dead per-row controls', () => {
    // The popup used to draw a `.ui-pin` / `.ui-delete` span on every row while
    // the functions that would have handled them (uiPinItem / uiDeleteItem)
    // had no callers at all: visible, hoverable, and completely inert. Nothing
    // between here and the browser noticed — not the module tests, which never
    // fed the popup data, and not the e2e suite, which only checks that the
    // page does not throw.
    //
    // A class name the stylesheet still styles but no script renders is
    // harmless; the reverse is what hurts. So assert both directions: the
    // markup is gone, and the CSS that only ever served it is gone with it.
    const popupCore = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/popup-core.js'), 'utf8');
    const popupCss = fs.readFileSync(path.join(CHROME_DIR, 'css/popup.css'), 'utf8');

    for (const cls of ['ui-pin', 'ui-delete', 'ui-share', 'edit-items-ui']) {
        assert.doesNotMatch(popupCore, new RegExp(`class="${cls}"`), `popup-core.js renders .${cls} again`);
        assert.doesNotMatch(popupCss, new RegExp(`\\.${cls}\\b`), `css/popup.css still styles .${cls}`);
    }
});

/**
 * Every `#id` popup.css and the popup's own scripts reach for.
 *
 * A selector naming an element that no longer exists is invisible at runtime:
 * $('alert-yes') returns null, .remove() on it was guarded, and nothing ever
 * said anything. CSS is worse still: a rule for a missing element simply never
 * applies, so those rules sat in the file for years.
 *
 * Why the popup alone: it is the only page with a stylesheet of its own.
 * css/history.css styles six pages at once, so #calendar resolves on some of
 * them and not others, and any per-file answer either way would be noise.
 *
 * Which is also why the dark-mode block is exempt below: half of it names ids
 * that only ever existed on the other pages (#main-table, #rh-bar,
 * #rhlistorder), because it was written by copying rules out of history.css.
 * Judging it against popup.html judges it against a page it was never about.
 * The bright-mode half, where the real dead selector lived, is checked whole.
 *
 * `declared` also carries what createElement() produces: popup.js builds its
 * blocks in JS (mv-inject, rh-inject...), and those ids are absent from the
 * HTML by design. Ids written inside a markup string are collected from the
 * string too, because being inside a string is not the same as being dead.
 */
function popupIdReferences() {
    const JS = ['scripts/popup.js', 'scripts/modules/popup-core.js'];
    const declared = new Set(
        [...fs.readFileSync(path.join(CHROME_DIR, 'popup.html'), 'utf8')
            .matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
    );

    for (const file of JS) {
        const raw = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8');
        const js = stripCommentsOf(raw);
        // createElement options: `id: 'mv-inject'`
        for (const m of js.matchAll(/\bid:\s*'([\w-]+)'/g)) declared.add(m[1]);
        // markup written as a string: `id="rt-inject-title"`
        for (const m of js.matchAll(/\bid=(\\?["'])([\w-]+)\1/g)) declared.add(m[2]);
    }

    const css = fs.readFileSync(path.join(CHROME_DIR, 'css/popup.css'), 'utf8');
    const inScope = cutMediaBlock(css, 'prefers-color-scheme: dark');

    const referenced = new Map();
    // $() calls are id lookups too, and they are the half that fails loudly:
    // a null dereference the first time the row is drawn. The CSS half fails
    // silently, which is why it gets the longer comment above.
    const inFiles = [['css/popup.css', inScope],
        ...JS.map((f) => [f, stripCommentsOf(fs.readFileSync(path.join(CHROME_DIR, f), 'utf8'))])];
    for (const [file, src] of inFiles) {
        for (const m of src.matchAll(/#([A-Za-z][\w-]*)|\$\('([\w-]+)'\)/g)) {
            const id = m[1] ?? m[2];
            // Colour literals are not ids. There is no hex-shaped id here, so
            // excluding the shape costs nothing and they are everywhere.
            if (/^[0-9a-fA-F]{3,8}$/.test(id)) continue;
            if (!referenced.has(id)) referenced.set(id, []);
            referenced.get(id).push(file.replace(/\\/g, '/'));
        }
    }
    return { declared, referenced };
}

/** `src` with every comment blanked out, newlines kept so line numbers hold. */
function stripCommentsOf(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
        .replace(/\/\/[^\n]*/g, '');
}

/**
 * `css` minus one @media block.
 *
 * If the block is absent the whole file comes back, so renaming the media
 * query widens what is checked rather than silently narrowing it.
 */
function cutMediaBlock(css, needle) {
    const head = new RegExp(
        `@media[^{]*\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{`).exec(css);
    if (!head) return css;
    const open = css.indexOf('{', head.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(0, head.index) + css.slice(i + 1);
    }
    return css;
}

test('no popup selector targets an element the page does not have', () => {
    // #alert-yes / #alert-no belonged to a confirm dialog whose buttons were
    // deleted, leaving four rules and a two-line alertUser() branch that
    // quietly did nothing. See the note above popupIdReferences() for what is
    // and is not in scope.
    const { declared, referenced } = popupIdReferences();

    const dead = [];
    for (const [id, files] of referenced) {
        if (declared.has(id)) continue;
        dead.push(`${id} (${[...new Set(files)].join(', ')})`);
    }
    assert.deepEqual(dead.sort(), [], [
        'a selector names an id no page and no createElement() produces.',
        'Delete the selector along with whatever it styled.',
    ].join(' '));
});

test('the popup dead-selector guard matches the shape it claims to catch', () => {
    // Otherwise it stays green by the oldest trick in the book: a regex that
    // quietly stopped matching anything.
    //
    // Each case swaps the real file out, so this exercises the whole path
    // including stripCommentsOf(): a commented-out selection is exactly why the
    // rule does not read a raw file, and a stripper that failed would pass
    // every case here while being unable to tell live code from a note about
    // dead code.
    const CSS_PATH = path.join(CHROME_DIR, 'css/popup.css');
    const JS_PATH = path.join(CHROME_DIR, 'scripts/modules/popup-core.js');
    /** Run popupIdReferences() against a replaced copy of `file`, then undo it. */
    const withFile = (file, src) => {
        const saved = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, src);
        try {
            return popupIdReferences();
        } finally {
            fs.writeFileSync(file, saved);
        }
    };
    const deadIds = (res) => [...res.referenced.keys()].filter((id) => !res.declared.has(id));

    // The shape that was in the file, inside the half that gets checked.
    assert.deepEqual(deadIds(withFile(CSS_PATH, '#alert #alert-yes { color: #444; }')), ['alert-yes'],
        'a selector for an element nobody creates');
    assert.deepEqual(deadIds(withFile(CSS_PATH, '#popup { margin: 5px; }')), [], 'a live id is fine');
    assert.deepEqual(deadIds(withFile(CSS_PATH, '#alert { color: #444; background: #fafafa; }')), [],
        'colour literals are not ids');
    // The other half: a $() lookup of an id nothing produces. It fails loudly
    // rather than silently, which is not a reason to leave it unchecked.
    const jsShifted = fs.readFileSync(JS_PATH, 'utf8').replace(
        "$('alert-holder').style.display = 'none';",
        "$('alert-holder').style.display = 'none'; var yes = $('alert-yes');");
    assert.deepEqual(deadIds(withFile(JS_PATH, jsShifted)), ['alert-yes'],
        'a $("...") lookup is an id reference too');
    // And inside the exempted block, which has to stay exempt: it names ids
    // from the pages it was copied out of.
    assert.deepEqual(deadIds(withFile(CSS_PATH,
        '@media (prefers-color-scheme: dark) {\n  #rh-bar { color: #fff; }\n}\n')), [],
    'the dark-mode block still names ids from the pages it was copied from');
});

test('popup-core.js does not export its renderer internals', () => {
    // `showRecentTabs` normalises an odd-shaped snapshot and then hands the
    // result to `showRecentTabsImpl`. Exporting the implementation alongside it
    // gives the next caller a way past the normalising — which is the one thing
    // this pair exists to prevent, and the reason a PR that added the export was
    // sent back. The only consumer outside the module was the test file, and it
    // goes through `showRecentTabs` now.
    //
    // Asserted by name rather than by counting call sites: a second caller inside
    // the module is fine, a second name in the export block is not.
    const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/popup-core.js'), 'utf8');
    const block = /export \{([\s\S]*?)\};/.exec(src);
    assert.ok(block, 'popup-core.js no longer has an export block');
    const exported = block[1].split(',').map((name) => name.trim()).filter(Boolean);

    assert.ok(exported.includes('showRecentTabs'), 'showRecentTabs is the entry point and must stay exported');
    for (const internal of ['showRecentTabsImpl', 'readTabList', 'readTabListFromTabs', 'tabListArea']) {
        assert.ok(
            !exported.includes(internal),
            `${internal} is an internal of showRecentTabs() and must not be exported`,
        );
    }
});

test('the e2e favicon blocklist matches the service worker patterns', () => {
    // e2e/pages.spec.mjs aborts every favicon request before it leaves the
    // browser: offline these hosts do not fail, they hang, and a pending <img>
    // holds the document's `load` event open — which made goto(waitUntil:'load')
    // time out at random. The blocklist is a copy of
    // FAVICON_SERVICE_PATTERNS, so the two can drift: add a service to the
    // worker and the e2e suite quietly goes back to hanging on it.
    //
    // Compared as a set, not by order — the worker's list is scanned with
    // indexOf() and order carries no meaning there.
    const sw = fs.readFileSync(path.join(CHROME_DIR, 'scripts/background-sw.js'), 'utf8');
    const spec = fs.readFileSync(path.resolve(CHROME_DIR, '../e2e/pages.spec.mjs'), 'utf8');

    const block = /const FAVICON_SERVICE_PATTERNS = \[([\s\S]*?)\];/.exec(sw);
    assert.ok(block, 'background-sw.js no longer declares FAVICON_SERVICE_PATTERNS');
    const fromSw = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const specBlock = /const FAVICON_SERVICE_HOSTS = \[([\s\S]*?)\];/.exec(spec);
    assert.ok(specBlock, 'e2e/pages.spec.mjs no longer declares FAVICON_SERVICE_HOSTS');
    const fromSpec = [...specBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    assert.ok(fromSw.length > 0, 'expected at least one favicon service pattern');
    assert.deepEqual(
        [...fromSw].sort(),
        [...fromSpec].sort(),
        'e2e/pages.spec.mjs must abort every favicon host the worker can produce',
    );
});
test('unselecting a row clears its inline colour instead of painting a third shade', () => {
    // Clicking "select all" then "unselect all" has to leave the list exactly
    // as it was. Selecting writes ITEM_SELECTED_COLOR inline, so unselecting
    // must *remove that write* — `backgroundColor = ''` — and let the row fall
    // back to `div[rel="white"]` / `div[rel="grey"]` in history.css.
    //
    // Every literal this used to write was wrong somewhere: `#fafafa` was not
    // even the light-theme grey row (`#f1f1f1` was), and in the dark theme the
    // CSS pair is `#555`/`#444`, so no literal at all can be right.
    //
    // Scope is whole functions, not the `unselect all` branch. Two rounds of
    // this guard have now been too narrow to be true:
    //
    //   - the first matched `w == 'all'`, which covers three of history-core's
    //     six unselect sites;
    //   - the second took whole functions, which covers history-core but *not*
    //     bookmark.js's two: both live in a helper (`markBookmarkedRow`) that
    //     `selectBookmarkItem()` calls, and the helper is where a literal would
    //     be written anyway. Reverting either one kept the suite green.
    //
    // So the guard follows the call: `clearRowColor()` and
    // `markBookmarkedRow()` are the two functions that may write an unselect
    // colour, and every function in `WRITERS` has to route through one of
    // them.
    const WRITERS = ['scripts/modules/history-core.js', 'scripts/bookmark.js'];
    const HELPERS = ['clearRowColor', 'markBookmarkedRow'];

    let sites = 0;
    const routed = new Set();
    for (const file of WRITERS) {
        const src = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        // Every place a row colour can be written, anywhere in the file.
        // A literal is what cannot follow the theme, so any hex string in an
        // assignment is a failure — including one that only *looks* like it
        // came from ITEM_SELECTED_COLOR, which is why the value is matched and
        // not the line's tail.
        for (const line of src.split('\n')) {
            const write = /(?:backgroundColor|['"]background-color['"])\s*[:=]\s*(.+)$/.exec(line);
            if (!write) continue;
            assert.ok(!/#/.test(write[1]) || /^\s*''\s*;?\s*$/.test(write[1]),
                `${file} writes the literal colour ${line.trim()}`);
        }

        for (const name of HELPERS) {
            if (src.includes(`function ${name}(`)) routed.add(name);
        }
    }

    // The one function that may paint a *row* on the bookmarks page. Everything
    // that selects or unselects a bookmark has to reach it: a grouped row shows
    // its group title's colour, and only this function knows to paint the title
    // instead. An inline `style.backgroundColor = ITEM_SELECTED_COLOR` in the
    // click handler turns one bookmark pink inside a white group.
    const ROW_PAINTER_FILE = 'scripts/bookmark.js';
    for (const file of WRITERS) {
        const src = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        for (const name of HELPERS) {
            if (new RegExp(`function\\s+${name}\\s*\\(`).test(src)) {
                sites += (functionBody(src, name).match(/backgroundColor/g) || []).length;
            }
        }
    }

    // …and it is called from both branches of the click handler (select and
    // unselect), not just the sweep: the single-click path was the one place
    // that painted a row directly.
    {
        const src = fs.readFileSync(path.join(CHROME_DIR, ROW_PAINTER_FILE), 'utf8');
        const caller = functionBody(src, 'selectBookmarkItem');
        for (const call of ['markBookmarkedRow(el, true)', 'markBookmarkedRow(ele, false)',
            'markBookmarkedRow(ele, selectingAll)']) {
            assert.ok(caller.includes(call),
                `selectBookmarkItem() no longer routes through ${call.split('(')[0]}()`);
        }
    }

    // The helpers exist and are the only ones allowed to touch the colour.
    assert.deepEqual([...routed].sort(), [...HELPERS].sort(),
        'an unselect helper disappeared; a literal would have nowhere to hide is not true without it');

    // `clearRowColor()` is reached from two functions in history-core
    // (`getMoreItems`, `selectHistoryItem`) and one in bookmark.js
    // (`markBookmarkedRow`), which is where the count comes from —
    // it is the only thing that writes an unselect colour, so a call site that
    // stops routing through it would have to write a literal instead, and the
    // literal scan above would catch it. Pinned anyway: the count is the cheap
    // signal that the helper did not simply lose its callers.
    const calls = WRITERS.map((file) => fs.readFileSync(path.join(CHROME_DIR, file), 'utf8')).join('\n');
    const callCount = (calls.match(/clearRowColor\(/g) || []).length;
    assert.ok(callCount >= 9, `only ${callCount} unselect sites still route through clearRowColor()`);
    assert.ok(sites >= 1, 'neither helper writes a colour any more; update this guard');
});
test('a repaint never carries a literal colour of its own', () => {
    // `paintClosest()` is the third way a colour reaches an element: the colour
    // is the THIRD ARGUMENT, so the guard above — which reads
    // `backgroundColor = …` assignments — cannot see a single one of its five
    // call sites. It writes `''` in one of them today, and `''` happens to be
    // the shape that guard allows, so the two look consistent; the moment the
    // argument becomes `#fff` the whole suite stays green. Measured: reverting
    // getMoreItems()'s unselect to `paintClosest(el, 'div.group-title', '#fff')`
    // kept 311/311 green.
    //
    // So scan the call itself, over both list pages, and forbid a hex literal
    // in any position. The legal values are `ITEM_SELECTED_COLOR` and — while
    // one call site still clears through it — `''`.
    const REPAINTERS = ['scripts/modules/history-core.js', 'scripts/bookmark.js'];
    // Probes below reuse this regex, and `test()` on a /g-flagged one resumes
    // from where the last match ended — the second probe would then read
    // nothing and fail for the wrong reason. So the scanner gets its own copy.
    // The argument list is read with balanced one-level nesting rather than up
    // to a `;`: a call written as an arrow body —
    // `.forEach((e) => paintClosest(e, 'a', '#fff'))` — has no semicolon to
    // stop at, and that is exactly the shape a repaint inside a sweep takes.
    const PAINT = /paintClosest\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)/;
    const PAINT_G = new RegExp(PAINT.source, 'g');
    let seen = 0;
    for (const file of REPAINTERS) {
        const src = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        for (const hit of src.matchAll(PAINT_G)) {
            seen++;
            assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(hit[1]),
                `${file} repaints with a literal colour: paintClosest(${hit[1].trim()})`);
        }
    }

    // Zero matches would make the loop above a pass, so the number of calls it
    // actually read is asserted: renaming `paintClosest()` — or moving every
    // repaint onto a direct assignment — has to turn this red rather than
    // quietly empty it. Same reason the `clearRowColor()` guard pins a count.
    assert.ok(seen >= 4, `the repaint guard only saw ${seen} call sites; it stopped matching`);

    // …and the matcher itself, so it cannot drift into matching nothing. The
    // pair that matters is "sees a hex" vs "does not": the first two are the
    // regression, the third is the legal value the fix is written in, and the
    // fourth is the helper that replaced the call in one place — a matcher wide
    // enough to read it would be reporting code that is already right.
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    const argOf = (call) => PAINT.exec(call)?.[1] ?? null;
    assert.ok(HEX.test(argOf("paintClosest(el, 'div.group-title', '#fff');")),
        'the repaint matcher stopped seeing a literal in the third argument');
    assert.ok(HEX.test(argOf("paintClosest(el, 'div.group-title',\n        '#ffcbd3');")),
        'the repaint matcher stopped spanning the newline a wrapped call has');
    // The legal value has to be READ, not merely not-matched: `HEX.test(null)`
    // is false too, so a matcher that stopped extracting the argument would
    // pass the negative probe while seeing nothing at all.
    const legal = argOf("paintClosest(el, 'div.group-title', ITEM_SELECTED_COLOR);");
    assert.ok(legal && legal.includes('ITEM_SELECTED_COLOR'),
        'the repaint matcher stopped reading the third argument');
    assert.ok(!HEX.test(legal), 'the legal repaint value was reported as a literal');
    assert.equal(argOf("clearRowColor(el.closest('div.group-title'));"), null,
        'the repaint matcher started matching the helper that replaced it');
    // The no-semicolon shape: a repaint written as an arrow body, which the
    // `;`-terminated version of this matcher could never see.
    assert.ok(HEX.test(argOf("Array.from(x).forEach((e) => paintClosest(e, 'div.item-holder', '#fff'))")),
        'the repaint matcher stopped seeing a call with no semicolon after it');
});

test('a grouped row keeps the group title in charge of its colour', () => {
    // Grouping renders each `div.item-holder` with an EMPTY inline colour and
    // lets `div[rel=white|grey]` on the enclosing title show through. Copying
    // the title's inline colour onto the row disconnects the two: selecting the
    // group repaints the title, the row never follows, and the row's copy wins
    // over the stylesheet for good. It is also not what the CSS says the row's
    // colour is — the row's `rel` is the one the render loop assigned it.
    //
    // Both render loops copy it — history-core.js grouped rows AND
    // bookmark.js grouped rows — so both are scanned. The two earlier versions
    // of this line asserted shapes that could not fail:
    //
    //   - matching the value (`styles: { 'backgroundColor': group|parentHolder… }`)
    //     missed the only occurrence there ever was, because the value assigned
    //     was an intermediate variable (`bgColor`) resolved two lines above;
    //   - matching only the unquoted key missed bookmark.js, which spells it
    //     `'background-color'`.
    //
    // So match the fact rather than the expression: a `styles:` block that
    // carries a background key at all, in either spelling, is the failure.
    const COPIERS = ['scripts/modules/history-core.js', 'scripts/bookmark.js'];
    for (const file of COPIERS) {
        const src = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8');
        const copy = /styles:\s*\{[^}]*['"]?background-?[Cc]olor['"]?\s*:/.exec(src);
        assert.ok(!copy, `${file} copies an inline background onto a rendered row again: `
            + `${(copy?.[0] || '').replace(/\s+/g, ' ')}`);
    }
});

test('no code calls an array method on a querySelectorAll result', () => {
    // $$() is `querySelectorAll()`, which answers a NodeList — no concat, no
    // map, no filter, no push. tests/dom.mjs answers a real array instead, so
    // `$$(...).concat(...)` passes the whole suite and throws a TypeError in
    // the browser. That is exactly what happened to groupTitleOf() in
    // bookmark.js: the throw made it return null for every grouped row, so the
    // "paint the group title" branch could not be reached outside the tests.
    //
    // The fix is always Array.from() first (the shape the other nineteen sites
    // use). This guard is the only thing standing between the shim and a
    // repeat, because the suite cannot tell the two apart.
    //
    // Matched over the WHOLE text, not line by line. The matcher allows a
    // newline between `$$(...)` and the method — that is what makes
    // `$$(sel)\n    .map(fn)` visible — so a line-by-line scan could never
    // match the very shape the probes below pin: the two are split apart
    // first. Measured before the change: rewriting popup.js's
    // `Array.from($$('.favicon')).forEach(...)` as a two-line
    // `$$('.favicon')\n    .forEach(...)` was one hit whole-text, zero
    // per-line, and the whole suite stayed green.
    //
    // Counting the hits over the whole text and then locating each one in a
    // line is what keeps both halves honest: the detection covers a newline,
    // and the report still says where the code is.
    const ARRAY_ONLY = /\$\$\s*\([^)]*\)\s*\.\s*(?:concat|map|filter|forEach|reduce|push|slice|sort|join|indexOf)\s*\(/g;
    const files = fs.readdirSync(path.join(CHROME_DIR, 'scripts'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join('scripts', name))
        .concat(fs.readdirSync(path.join(CHROME_DIR, 'scripts/modules'))
            .filter((name) => name.endsWith('.js'))
            .map((name) => path.join('scripts/modules', name)));

    const offenders = [];
    for (const file of files) {
        const src = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        for (const hit of src.matchAll(ARRAY_ONLY)) {
            const line = src.slice(0, hit.index).split('\n').length;
            const where = src.split('\n')[line - 1].trim();
            offenders.push(`${file}:${line}: ${where}`);
        }
    }
    assert.deepEqual(offenders, [], 'a NodeList is being used as an array: '
        + offenders.join(' | '));
});
test('the NodeList guard matches the shapes it claims to catch', () => {
    // Same convention as the closest() and numeric-wrapper guards: pin the
    // matcher itself, so a guard that quietly stops matching is visible without
    // having to mutate production code.
    const ARRAY_ONLY = /\$\$\s*\([^)]*\)\s*\.\s*(?:concat|map|filter|forEach|reduce|push|slice|sort|join|indexOf)\s*\(/;

    // Caught: calling an array method straight off a $$() result. The probes
    // run over whole text (`match()`), the same way the guard above matches —
    // pinning them against a single line would pin a shape the guard never
    // uses.
    assert.ok(ARRAY_ONLY.test("$$('#a .b').concat($$('#c .d'))"));
    assert.ok(ARRAY_ONLY.test("$$(into + ' .chkbx').forEach(function () {})"));
    assert.ok(ARRAY_ONLY.test('$$(sel)\n    .map(fn)'));
    // The one the line-by-line version missed, and the reason it is spelled
    // out: method on its own line, without the dots aligned.
    assert.ok(ARRAY_ONLY.test('$$(sel)\n    .forEach(fn)'));

    // Not caught, because these are what the fix looks like.
    assert.ok(!ARRAY_ONLY.test("Array.from($$('#a .b')).concat(Array.from($$('#c .d')))"));
    assert.ok(!ARRAY_ONLY.test("var list = $$('#a .b'); list.concat(other)"));
    assert.ok(!ARRAY_ONLY.test("$$('#a .b')[i]"));

    // `.length` is the one member a NodeList does share with an array, so it
    // never throws — and that is exactly why it needs pinning here rather than
    // in the guard above: `$$(...).length` reads fine in both the shim and the
    // browser, and it was the shape of the one real defect this guard exists
    // for (bookmark.js' groupTitleOf() counted `querySelectorAll()` directly).
    // Counting is not an array method, so the scanner deliberately leaves it
    // alone; what is pinned is that the scanner KNOWS it is not catching it.
    assert.ok(!ARRAY_ONLY.test("var n = $$('#a .b').length"),
        'the scanner started reporting .length; production code counts it in 8 places');
});

test('a test-side re-render really replaces the nodes', () => {
    // `container.textContent = ''` is how every page clears a list before
    // drawing the next one, and the shim used to leave `children` untouched —
    // so `assert.equal(children.length, 2)` after a re-render could not tell
    // two fresh rows from two stale ones.
    //
    // Asserted through a query and not through `children`: the first version
    // built the box with `makeEl()` and counted `box.children` directly, so it
    // never reached `queryAll()` — deleting the `el.children.length = 0` line
    // from the shim left the whole suite green. What a page actually does after
    // clearing is ask the container what is inside it, so that is what is asked
    // here: rows are seeded, cleared, re-seeded, and counted back.
    const dom = createDom();
    const view = dom.el('rh-views-insert');
    for (let i = 0; i < 2; i++) {
        const row = dom.makeEl('div');
        row.className = 'item-holder';
        view.appendChild(row);
    }
    assert.equal(document.querySelectorAll('#rh-views-insert div.item-holder').length, 2,
        'the shim stopped answering the selector this case counts with');

    view.textContent = '';
    assert.equal(document.querySelectorAll('#rh-views-insert div.item-holder').length, 0,
        'textContent = "" left the old children behind, so a re-render cannot be told from the last one');
    assert.equal(view.textContent, '');

    // …and the container takes new children afterwards, which is the other half
    // of "replaces": an emptied list has to be drawable again.
    const fresh = dom.makeEl('div');
    fresh.className = 'item-holder';
    view.appendChild(fresh);
    assert.equal(document.querySelectorAll('#rh-views-insert div.item-holder').length, 1);
});

test('a document-wide query reports each element once, even after a move', () => {
    // `queryAll()` walks `document.body` plus every id-seeded element, skipping
    // any root an earlier one already contains. That test is about containment
    // and cannot see ordering: seed A, hang A under a later-seeded B, and A is
    // no longer inside anything checked before it — so both go in `roots` and
    // everything under A is visited twice.
    //
    // The first version of this case moved the leaf into the later container
    // and then compared `new Set(hits).size` with `hits.length` — which is the
    // same number whatever `queryAll()` does, because a Set of two identical
    // references is one entry. Removing the de-duplication left all 310 tests
    // green. So the count is asserted directly, and it is the count of a real
    // query: the shape below measured 2 hits before the fix and 1 after.
    const dom = createDom();
    const a = dom.el('seeded-first');
    const leaf = dom.makeEl('div');
    leaf.className = 'target';
    a.appendChild(leaf);
    // The move: A itself goes under a container seeded after it. Both are roots
    // now — `contains()` cannot see that A was seeded first — so the walk of B
    // reaches the leaf a second time.
    const b = dom.el('seeded-second');
    b.appendChild(a);

    const hits = document.querySelectorAll('.target');
    assert.equal(hits.length, 1, 'the moved node should be reported exactly once');
    assert.equal(hits[0], leaf);
});

test('the unselect guards stay pointed at code that is still there', () => {
    // The three guards above agree on a small set of facts about the code —
    // which functions may write a row colour, and how many sites route through
    // `clearRowColor()` — and every one of those facts has been wrong at some
    // point because it was only written in a comment. Two rounds of the
    // literal scan were too narrow to be true (see the note in that test) and
    // one comment named a function that never existed.
    //
    // So pin the premises against the real files: the helper names have to
    // appear in the sources the guards read, and the count they compare against
    // has to be one the sources still reach. A future edit that renames or
    // moves a helper then turns a silently-green guard into a red one here.
    const historySrc = fs.readFileSync(path.join(CHROME_DIR, 'scripts/modules/history-core.js'), 'utf8');
    const bookmarkSrc = fs.readFileSync(path.join(CHROME_DIR, 'scripts/bookmark.js'), 'utf8');

    // The two functions the literal scan scopes itself to, and the one
    // bookmark.js routes its own unselects through.
    assert.ok(/function\s+clearRowColor\s*\(/.test(historySrc), 'clearRowColor() left history-core.js');
    assert.ok(/function\s+markBookmarkedRow\s*\(/.test(bookmarkSrc), 'markBookmarkedRow() left bookmark.js');

    // The count the guard pins (`>= 9`) is only meaningful while the call is
    // what the writers actually use: bookmark.js reaches it by import now, so a
    // rename on either side has to be visible.
    assert.ok(/clearRowColor/.test(bookmarkSrc), 'bookmark.js stopped routing through clearRowColor()');
    const exports = /export \{([\s\S]*?)\};/.exec(historySrc);
    assert.ok(exports, 'history-core.js no longer has an export block');
    for (const name of ['clearRowColor', 'groupTitleOf']) {
        assert.ok(exports[1].includes(name), `history-core.js stopped exporting ${name}()`);
    }

    // The group-title lookup is one rule for both list pages, so bookmark.js
    // imports it rather than declaring its own. A second copy is how the two
    // drifted in the first place (one was document-wide, one was not).
    assert.ok(!/function\s+groupTitleOf\s*\(/.test(bookmarkSrc),
        'bookmark.js declares its own groupTitleOf() again; import history-core.js instead');
    assert.ok(/groupTitleOf/.test(bookmarkSrc), 'bookmark.js no longer resolves group titles');

    // "When is a group title released?" is one rule, and bookmark.js decides it
    // once per sweep (`clearOrphanedTitles`) instead of per row — the per-row
    // version cleared the title of a group that still had a ticked row in it.
    assert.ok(/function\s+clearOrphanedTitles\s*\(/.test(bookmarkSrc),
        'clearOrphanedTitles() left bookmark.js; a title cleared per row again is the bug');
    assert.ok(!/function\s+clearOrphanedTitles\s*\(/.test(historySrc),
        'clearOrphanedTitles() belongs to bookmark.js, which owns its own sweeps');

    // …and the tally it reads is a question about ONE group, so it is asked of
    // that group's own holder. Counting over the view answers "is anything left
    // anywhere", which lets a group with a ticked row of its own look emptied
    // out; it also makes one click walk every bookmark on the page, because
    // bookmark.html spreads its rows over one group per host.
    //
    // The unselect-all branch carries no tally at all: the sweep above it has
    // just set every checkbox false, so "how many are left" is 0 before it is
    // asked — collecting survivors there only adds a branch the reader has to
    // rule out. It clears the titles the way history-core.js does instead.
    {
        const sweep = functionBody(bookmarkSrc, 'selectBookmarkItem');
        assert.ok(/holder\.querySelectorAll\('\.chkbx:checked'\)/.test(sweep),
            "the survivors tally is no longer scoped to the group's own holder");
        assert.ok(!/survivors\s*\+\+/.test(sweep),
            'the survivors tally counts per row over the view again');
        // Exactly one, and it has to be the sweep's own: the argument of that
        // call is what a reintroduced unselect-all tally would be named.
        // Matching the NAME (`emptied`) is what the previous version did, and
        // renaming the local to `emptied2` put the branch straight back with
        // the suite green — the fact being guarded is the number of call sites,
        // not a spelling.
        assert.equal((sweep.match(/clearOrphanedTitles\(/g) || []).length, 1,
            'unselect-all collects survivors for a tally whose answer is already 0');
    }

    // …and neither sweep resolves a title per row. `groupTitleOf()` walks the
    // container's `children`, so once per row it costs rows x groups — the
    // shape both sweeps had, and the reason "select all" measured 7.5s on 8000
    // bookmarks over 2000 groups. Both now paint the titles in one pass over
    // `.group-title` afterwards; the per-row helper only reaches for one when
    // it is about to paint it.
    {
        const sweep = functionBody(bookmarkSrc, 'selectBookmarkItem');
        assert.equal((sweep.match(/\.group-title/g) || []).length, 2,
            'the sweeps stopped painting the group titles in one pass');
        // Scoped to the select-all call, because that is the only site where
        // the two are distinguishable: the helper is reached from four places,
        // and a check over the whole function passes either way (measured).
        const selectAll = /\(function\(ele\) \{\s*ele\.checked = selectingAll;([\s\S]*?)\}\)\(items\[i\]\);/.exec(sweep);
        assert.ok(selectAll, 'the select-all sweep changed shape; update this guard');
        assert.ok(/div\.group-holder/.test(selectAll[1]),
            'select-all resolves a group title for every row again');
    }

    // …and the per-row painter resolves a title only when it is painting one.
    // `groupTitleOf()` walks the container's `children`, so calling it on the
    // unselect path — which returns without ever looking at the result — costs
    // rows x groups: "unselect all" on 8000 bookmarks over 2000 groups measured
    // 58ms -> 4188ms with it hoisted back to the top of the function. It is a
    // guard rather than a test because nothing in the suite is big enough to
    // feel it.
    {
        // Comments stripped first: the reason a lookup must not happen here is
        // worth writing down, and writing it down names the function — which
        // would trip a matcher that reads comments as code.
        const painter = functionBody(bookmarkSrc, 'markBookmarkedRow')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        const unselect = /if \(!selected\) \{[\s\S]*?\n    \}/.exec(painter);
        assert.ok(unselect, 'markBookmarkedRow() lost the branch that only clears colours');
        // Before the branch, not inside it: resolving the title at the top of
        // the function is how the cost got in — the unselect path then walks a
        // container it never looks at. Pinning the branch's own body would pass
        // on exactly that shape, which is what the first version of this guard
        // did (measured: the lookup hoisted back to the top stayed green).
        const prologue = painter.slice(0, unselect.index);
        assert.ok(!/groupTitleOf\(/.test(prologue),
            'the unselect path resolves a group title it goes on to ignore');
    }

    // bookmark.js's selection logic is a module-level function, so the
    // behaviour tests import it. It used to live inside the page's
    // `DOMContentLoaded` + `onStorageReady` callback, and the only way to
    // reach it was a `globalThis.selectBookmarkItemForTest` hook — which made
    // a test-only door part of the shipped extension. Keep the export, so that
    // moving it back into the callback is impossible without a hook.
    const bookmarkExports = /export \{([\s\S]*?)\};/.exec(bookmarkSrc);
    assert.ok(bookmarkExports && bookmarkExports[1].includes('selectBookmarkItem'),
        'bookmark.js stopped exporting selectBookmarkItem(); the tests would need a global again');
});

// Removing from an array while walking it forward is the classic off-by-one:
// `splice(i, 1)` shifts everything after `i` down, so the next element is never
// examined. The ways out are to iterate backwards, or to not mutate at all and
// build a new array — which is what the one site that had this shape does now.
//
// Matched structurally rather than by file: background-sw.js splices inside a
// `.indexOf()` guard where the element can only ever be removed once, and that
// is a legitimate use of the idiom. What is never legitimate is doing it in a
// `for` loop whose counter is also the index being spliced.
const SPLICE_WHILE_WALKING = /for\s*\(\s*(?:var|let|const)\s+(\w+)\s*=[\s\S]{0,120}?\1\s*<\s*(\w+)\.length[\s\S]{0,400}?\2\.splice\(\s*\1\b/;

test('no loop removes from the array it is walking', () => {
    const offenders = [];
    walkScripts((file, src) => {
        const code = stripJsComments(src);
        for (const m of code.matchAll(new RegExp(SPLICE_WHILE_WALKING.source, 'g'))) {
            offenders.push(`${file.replace(/\\/g, '/')}: for (${m[1]}...) { ${m[2]}.splice(${m[1]}...) }`);
        }
    });
    assert.deepEqual(offenders, []);
});

test('the splice guard matches the shape it claims to catch', () => {
    // The shape that was in history2.js, and the two shapes it must stay blind
    // to — the indexOf() idiom, which is safe, and a splice of a *different*
    // variable, which is not this bug at all.
    const hits = (src) => [...src.matchAll(new RegExp(SPLICE_WHILE_WALKING.source, 'g'))].length;

    assert.equal(hits(`for (let s = 0; s < zNodes.length; s++) {
    zNodes.splice(s, 1);
}`), 1, 'the loop this was written for');

    assert.equal(hits(`var i = recentTabs.indexOf(id);
if (i >= 0) { recentTabs.splice(i, 1); }`), 0, 'indexOf() + splice is not a walk');

    assert.equal(hits(`for (let s = 0; s < zNodes.length; s++) {
    others.splice(s, 1);
}`), 0, 'a splice on another array is not this bug');

    assert.equal(hits(`zNodes = zNodes.filter(function (node) {
    return pIDs[node.id] == true;
});`), 0, 'the replacement must pass');
});

test('options.js seeds the defaults itself instead of trusting the worker', () => {
    // `defaultConfig()` is the service worker's job, and the options page used
    // to build its form on the assumption that it had already run. On a cold
    // profile it often has not: the page then read `undefined` for every key and
    // filled the numeric boxes with NaN, and before loadOptions() was made
    // tolerant the resulting TypeError killed the rest of the DOMContentLoaded
    // handler — i.e. every button on the page, save and upload included, became
    // dead until a manual reload. Reproduced in a real Chromium at roughly one
    // cold start in seven, which is why this is asserted statically: the e2e
    // suite cannot be relied on to lose the race on demand.
    //
    // The fix is two words, and the failure mode without it is invisible until
    // the timing goes wrong, so the order of these two calls is the assertion.
    const src = readScript('scripts/options.js');
    const seed = src.indexOf('defaultConfig(false)');
    const load = src.indexOf('loadOptions(true)');

    assert.notEqual(seed, -1, 'options.js must seed the defaults before building the form');
    assert.notEqual(load, -1, 'options.js must still call loadOptions()');
    assert.ok(seed < load, 'the seed has to come first, or the form is built from unseeded storage');
});
