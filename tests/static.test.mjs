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

test('popup.html loads neither message-adapter.js nor db-manager.js', () => {
    // Both were dead there: the popup lists come from chrome.history /
    // sessions / bookmarks and from the tab list the worker mirrors into
    // chrome.storage.session, so it never touches IndexedDB. The tags were
    // misleading — a message channel to the worker wakes it into re-running its
    // startup crawl — so the removal is asserted, not just commented.
    //
    // The other pages still load them; this guard is deliberately about the
    // popup alone.
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

test('every returnLang()/echoLang() key used in JS exists in both locales', () => {
    const keys = new Set();
    walkScripts((_file, src) => {
        for (const m of src.matchAll(/(?:returnLang|echoLang)\(\s*'([^']+)'\s*\)/g)) keys.add(m[1]);
    });

    assert.ok(keys.size > 0, 'expected at least one i18n lookup in JS');
    for (const key of keys) {
        assert.ok(EN[key], `en missing JS key: ${key}`);
        assert.ok(ZH[key], `zh_CN missing JS key: ${key}`);
    }
});

test('every data-lang-string element also carries the .lang class', () => {
        // func.js fills only elements matching '.lang', so an element with just
        // data-lang-string renders as an empty box — silently, with no console
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

test('no first-party script mounts anything onto window any more', () => {
    // The window layer is what made dependencies invisible: a page script
    // called `filtUrl()`, nothing said where it came from, and a rename or a
    // deleted mount surfaced as `undefined is not a function` at runtime.
    //
    // Two exemptions, both genuine cross-file boundaries rather than a
    // compatibility layer:
    //   - storage-adapter.js replaces the `localStorage` global itself;
    //   - db-manager.js / message-adapter.js expose singletons to classic
    //     scripts, including the service worker's importScripts().
    const EXEMPT = new Set([
        'scripts/storage-adapter.js',
        'scripts/db-manager.js',
        'scripts/message-adapter.js',
    ]);

    const offenders = [];
    walkScripts((file, src) => {
        if (EXEMPT.has(file.replace(/\\/g, '/'))) return;
        for (const m of src.matchAll(/^\s*(?:window|self|globalThis)\.[\w$]+\s*=/gm)) {
            offenders.push(`${file}: ${m[0].trim()}`);
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
        'onStorageReady', 'dbManager', 'messageAdapter', 'storageAdapter', 'localStorage',
        'window', 'document', 'chrome', 'console', 'location', 'navigator', 'performance',
        'Array', 'Date', 'JSON', 'Math', 'Number', 'Object', 'String', 'Set', 'Map',
        'RegExp', 'Promise', 'URL', 'CSS', 'IDBKeyRange', 'setTimeout', 'clearTimeout',
        'setInterval', 'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'undefined',
        'alert', 'views', 'module', 'history', 'arguments', 'this', 'event', 'Element',
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
    assert.deepEqual(offenders, [], 'zTree still ships an eval() — see TODO.md P2');
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

    // Known gaps, each tracked in TODO.md — delete the entry as it is fixed.
    const KNOWN_GAPS = new Set([
        'rhshare', // no control in options.html: rh-share is neither shown nor saved
    ]);

    const missing = [...referenced].filter((id) => !optionsIds.has(id) && !KNOWN_GAPS.has(id)).sort();
    assert.deepEqual(missing, [], 'config.js references an element options.html does not define');
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
// operator, a bracket, a `;`, a newline, or `return`. Without this, `.replace(/'/g, …)`
// leaves the quote state open for the rest of the file and the comment
// stripping silently stops working — which is how a doc comment mentioning
// title_fix() came to look like a call to it.
const BEFORE_REGEX = /[(,=:[!&|?{};\s]$|\breturn\s*$/;

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
 * Remove `//` and block comments from a JavaScript source.
 *
 * (Distinct from the `stripComments` above, which drops `<!-- -->` from HTML.)
 *
 * Prose that mentions a symbol — "the old title_fix() deleted…" — must not be
 * mistaken for a call to it. String and regex literals are tracked so that a
 * `//` or `/*` inside one survives.
 */
function stripJsComments(src) {
    let out = '';
    let quote = null;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            out += ch;
            if (ch === '\\') { out += src[i + 1] ?? ''; i++; }
            else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            out += ch;
        } else if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') i++;
        } else if (ch === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i++;
        } else if (ch === '/' && BEFORE_REGEX.test(out)) {
            // Regex literal, but only if one actually closes on this line;
            // otherwise it is a division and has to be copied through as
            // ordinary text.
            const end = endOfRegex(src, i + 1);
            if (end < 0) {
                out += ch;
            } else {
                out += src.slice(i, end);
                i = end - 1; // the loop's i++ lands on the first character after it
            }
        } else {
            out += ch;
        }
    }
    return out;
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
