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
const MODULE_PRIVATE = new Set(['flist', 'flist_r', 'site_r']);

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
        'rhshare',      // no control in options.html: rh-share is neither shown nor saved
        'mvlist-table', // no table in options.html: mostVisitedBlocklist() throws
    ]);

    const missing = [...referenced].filter((id) => !optionsIds.has(id) && !KNOWN_GAPS.has(id)).sort();
    assert.deepEqual(missing, [], 'config.js references an element options.html does not define');
});

test('user-controlled values are escaped before being interpolated into HTML attributes',
    { skip: 'TODO.md P0 — history-core.js / config.js 把 URL、域名直接拼进 href/value/title' },
    () => {
        // A double quote in a page title or URL closes a double-quoted attribute
        // and injects markup. The pages hold history/bookmarks/tabs/sessions
        // permissions, so this is not a cosmetic issue.
        const ATTRIBUTES = ['href', 'value', 'title', 'src'];
        // Expressions that carry data originating from the browser or the user,
        // as opposed to generated ids (`selectid`, `toggleid`, …).
        const USER_DATA = /\.url\b|\.title\b|\.host\b|mvbl\[|fbl\[|fliv\b|textContent|localStorage\[/;

        const offenders = [];
        for (const file of ['modules/history-core.js', 'modules/popup-core.js', 'modules/config.js']) {
            const src = fs.readFileSync(path.join(CHROME_DIR, 'scripts', file), 'utf8');
            for (const attr of ATTRIBUTES) {
                const pattern = new RegExp(`${attr}="'\\s*\\+\\s*([^'"]+?)\\s*\\+\\s*'"`, 'g');
                for (const m of src.matchAll(pattern)) {
                    if (USER_DATA.test(m[1]) && !m[1].includes('escapeHtmlAttr')) {
                        offenders.push(`${file}: ${attr}="${m[1].trim()}"`);
                    }
                }
            }
        }
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
