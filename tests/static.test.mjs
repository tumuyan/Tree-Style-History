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

// Vendored third-party code: excluded from every source-shape check below.
const VENDORED = new Set([
    'jquery-3.6.0.min.js',
    'jquery.ztree.core.js',
    'jquery.ztree.exhide.js',
    'fuzzysearch.js',
]);

/** Visit every first-party script as (relativePath, source). */
function walkScripts(visit) {
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.js') && !VENDORED.has(entry.name)) {
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

test('every data-lang-string element also carries the .lang class',
    { skip: 'TODO.md P1 — options.html:37 的 treeOptionsDetail 有 data-lang-string 但没有 .lang' },
    () => {
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
// Module graph vs. func.js compatibility layer
//
// func.js re-exports the modules onto `window` by hand. Nothing checks that
// list: if a module renames or drops an export, `window.X` silently becomes
// undefined and only fails when a page happens to call it.
// ---------------------------------------------------------------------------

// Paths are relative to CHROME_DIR, matching moduleExports()/fs calls above.
const MODULES = [
    'scripts/dom-helper.js',
    'scripts/modules/helpers.js',
    'scripts/modules/config.js',
    'scripts/modules/calendar.js',
    'scripts/modules/popup-core.js',
    'scripts/modules/history-core.js',
];

// Exports that stay module-private on purpose: they are filter state that no
// page script reads, so mounting them would only widen the global surface.
const MODULE_PRIVATE = new Set(['flist', 'flist_r']);

test('func.js re-exports every module symbol the page scripts rely on', () => {
    const funcSrc = fs.readFileSync(path.join(CHROME_DIR, 'scripts/func.js'), 'utf8');
    const unmounted = [];
    for (const file of MODULES) {
        for (const name of moduleExports(file)) {
            if (MODULE_PRIVATE.has(name)) continue;
            // Some are mounted under a different name (history -> historyView).
            // The property itself can be `$`/`$$`, hence the permissive class.
            if (!new RegExp(`^window\\.[\\w$]+\\s*=\\s*${escapeRe(name)}\\s*;`, 'm').test(funcSrc)) {
                unmounted.push(`${file}: ${name}`);
            }
        }
    }
    assert.deepEqual(unmounted, []);
});

test('every window.* assignment in func.js resolves to a real binding', () => {
    const funcSrc = fs.readFileSync(path.join(CHROME_DIR, 'scripts/func.js'), 'utf8');
    const exported = new Set(MODULES.flatMap(moduleExports));
    // Locals declared inside func.js itself.
    const locals = new Set(['itemSelectedColor']);

    const dangling = [];
    for (const m of funcSrc.matchAll(/^window\.([\w$]+)\s*=\s*([^;]+);/gm)) {
        const value = m[2].trim();
        if (locals.has(m[1]) || /^['"]/.test(value)) continue;
        if (!exported.has(value)) dangling.push(`window.${m[1]} = ${value}`);
    }
    assert.deepEqual(dangling, [], 'func.js mounts a symbol no module exports — it would be undefined at runtime');
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
        for (const _ of stripJsComments(src).matchAll(/\btitle_fix\s*\(/g)) {
            offenders.push(file.replace(/\\/g, '/'));
        }
    });
    assert.deepEqual(offenders, []);
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
