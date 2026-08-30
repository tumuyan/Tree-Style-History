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
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            } else if (entry.name.endsWith('.js') && !entry.name.startsWith('jquery') && entry.name !== 'fuzzysearch.js') {
                const src = fs.readFileSync(p, 'utf8');
                for (const m of src.matchAll(/(?:returnLang|echoLang)\(\s*'([^']+)'\s*\)/g)) keys.add(m[1]);
            }
        }
    };
    walk(path.join(CHROME_DIR, 'scripts'));

    assert.ok(keys.size > 0, 'expected at least one i18n lookup in JS');
    for (const key of keys) {
        assert.ok(EN[key], `en missing JS key: ${key}`);
        assert.ok(ZH[key], `zh_CN missing JS key: ${key}`);
    }
});
