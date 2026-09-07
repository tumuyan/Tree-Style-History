// sw-sync.test.mjs — verify the generated background-utils.js is in sync with
// the shared bottom layer and that it exposes everything background-sw.js uses.
//
// This guards the architectural rule documented in CODEBUDDY.md: background-
// utils.js is GENERATED from modules/shared/*, never hand-maintained. A drift
// (forgot to regenerate, or hand-edited the generated file) turns this test red.
//
// Up-to-dateness of the generated file is enforced by `npm run verify:sw-sync`
// (i.e. `gen-sw-utils.mjs --check`). What is left here is the part that script
// cannot see: that the generated file is really the *generated* one, and that
// it still covers what background-sw.js calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SHARED_DIR = resolve(ROOT, 'chrome/scripts/modules/shared');
const UTILS_FILE = resolve(ROOT, 'chrome/scripts/background-utils.js');
const SW_FILE = resolve(ROOT, 'chrome/scripts/background-sw.js');

const utils = readFileSync(UTILS_FILE, 'utf8');
const sw = readFileSync(SW_FILE, 'utf8');

/**
 * Every name exported by `modules/shared/`.
 *
 * This is the whole point of the test: the set is read from the source of
 * truth, so it cannot fall behind the way a hand-written list did (the first
 * version of this file listed 6 names and missed `getVersionType`, which the
 * service worker used to call).
 */
function sharedExports() {
    const names = new Set();
    const files = readdirSync(SHARED_DIR).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0, 'expected modules/shared/ to contain modules');
    for (const file of files) {
        const src = readFileSync(resolve(SHARED_DIR, file), 'utf8');
        for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|var|let|const|class)\s+([A-Za-z_$][\w$]*)/gm)) {
            names.add(m[1]);
        }
        for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
            for (const part of m[1].split(',')) {
                // `a as b` is exported under `b`.
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (name) names.add(name);
            }
        }
    }
    return names;
}

/** Is `name` declared at the top level of the flattened classic script? */
function isDeclaredInUtils(name) {
    return new RegExp(
        `(?:^|\\n)\\s*(?:function\\s+${name}\\b|var\\s+${name}\\b|let\\s+${name}\\b|const\\s+${name}\\b)`,
    ).test(utils);
}

const shared = sharedExports();

test('generated file carries the DO-NOT-EDIT banner', () => {
    assert.match(utils, /GENERATED FILE — DO NOT EDIT BY HAND/);
    assert.match(utils, /scripts\/gen-sw-utils\.mjs/);
});

test('generated file defines every symbol the shared layer exports', () => {
    // Guards the generator's file list: a shared module missing from FILES in
    // gen-sw-utils.mjs would simply never be emitted.
    assert.ok(shared.size > 0, 'expected modules/shared/ to export something');
    for (const name of [...shared].sort()) {
        assert.ok(isDeclaredInUtils(name), `${name} is exported by modules/shared/ but absent from background-utils.js`);
    }
});

test('background-sw.js only uses shared symbols the generated file defines', () => {
    const used = [...shared].filter((name) => new RegExp(`\\b${name}\\b`).test(sw));

    // Regression guard for the hand-written-list bug: the original version of
    // this test checked 6 names and missed `getVersionType`, so a one-sided
    // edit would have gone unnoticed. Pinning two names keeps the check from
    // passing just because the `used` set happens to be empty.
    assert.ok(
        used.includes('getVersion'),
        'background-sw.js calls getVersion(); it must be covered by this check',
    );
    assert.ok(
        used.includes('save_calendar_storage2'),
        'background-sw.js calls save_calendar_storage2(); it must be covered by this check',
    );

    for (const name of used.sort()) {
        assert.ok(
            isDeclaredInUtils(name),
            `background-sw.js uses ${name} but it is not declared in background-utils.js`,
        );
    }
});
