// Guard the hand-maintained duplication between background-utils.js and
// modules/.
//
// MV3 service workers cannot `importScripts()` an ES module, so
// background-utils.js carries its own copies of helpers that live in
// modules/*.js. The file header lists the mapping; nothing enforces it. A
// one-sided edit is invisible until the worker and the page disagree at
// runtime, so this script compares the two side by side in CI.
//
// Unlike the rest of the suite this is not a unit test: it is a drift check
// over source text, and its output is meant to be read by a human.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SW = 'chrome/scripts/background-utils.js';
const MODULES = {
    'modules/helpers.js': 'chrome/scripts/modules/helpers.js',
    'modules/config.js': 'chrome/scripts/modules/config.js',
    'modules/calendar.js': 'chrome/scripts/modules/calendar.js',
};

// The functions declared as duplicated in the background-utils.js header.
const SYNCED = [
    ['getVersion', 'modules/helpers.js'],
    ['getVersionType', 'modules/helpers.js'],
    ['returnLang', 'modules/helpers.js'],
    ['timeNow', 'modules/helpers.js'],
    ['isBookmarkletUrl', 'modules/helpers.js'],
    ['get_host', 'modules/helpers.js'],
    ['getFaviconUrl', 'modules/helpers.js'],
    ['getFaviconOnerror', 'modules/helpers.js'],
    ['defaultConfig', 'modules/config.js'],
    ['save_calendar_storage2', 'modules/calendar.js'],
];

// Bodies that are already known to differ. Each entry must carry a reason and
// a TODO reference; leaving one here means further drift is invisible, so the
// list is meant to shrink, not grow.
const ACCEPTED_DRIFT = new Map([
    ['timeNow', 'background-utils 把 te 初始化为 ""，helpers 声明为未初始化的 var —— 两者行为在 rh-timeformat 既非 12 也非 24 时不同（TODO.md P2），修 timeNow 时统一并删除本条'],
]);

// --- source scanning -------------------------------------------------------

/** Remove // and /* *\/ comments without touching string literals. */
function stripComments(src) {
    let out = '';
    let quote = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        const next = src[i + 1];
        if (quote) {
            out += c;
            if (c === '\\') { out += next ?? ''; i++; } else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
        if (c === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i++;
            continue;
        }
        out += c;
    }
    return out;
}

// `x.hasOwnProperty(k)` and `Object.prototype.hasOwnProperty.call(x, k)` mean
// the same thing, and background-utils.js uses the defensive form while
// modules/helpers.js uses the short one. Canonicalising them keeps the
// comparison about behaviour instead of idiom — otherwise the difference would
// force the whole getFaviconUrl() body out of the check.
const canonicalise = (src) => src
    .replace(/Object\.prototype\.hasOwnProperty\.call\(\s*([\w$.]+)\s*,\s*'([\w-]+)'\s*\)/g, 'HASOWN($1,$2)')
    .replace(/([\w$.]+)\.hasOwnProperty\(\s*'([\w-]+)'\s*\)/g, 'HASOWN($1,$2)');

const normalize = (src) => canonicalise(stripComments(src).replace(/\s+/g, ' ').trim());

/** Return the brace-balanced body starting at the '{' at `start`. */
function matchBraces(src, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return src.slice(start + 1, i);
    }
    return '';
}

function collectFunctions(src) {
    const out = new Map();
    const re = /(?:^|[;\n])\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const brace = src.indexOf('{', re.lastIndex - 1);
        out.set(m[1], { params: normalize(m[2]), body: normalize(matchBraces(src, brace)) });
    }
    return out;
}

/** Parse the `var defaultValues = { ... }` literal into a plain object. */
function parseDefaults(src) {
    const block = /var\s+defaultValues\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
    if (!block) return null;
    const out = {};
    for (const m of block[1].matchAll(/['"]?([\w-]+)['"]?\s*:\s*(?:"([^"]*)"|'([^']*)'|(-?[\d.]+))/g)) {
        out[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    }
    return out;
}

// --- checks ----------------------------------------------------------------

const errors = [];
const warnings = [];

const swFunctions = collectFunctions(read(SW));
const moduleFunctions = new Map(
    Object.entries(MODULES).map(([name, file]) => [name, collectFunctions(read(file))]),
);

console.log('对比 background-utils.js 与 modules/ 的手工同步副本\n');

for (const [name, moduleName] of SYNCED) {
    const theirs = moduleFunctions.get(moduleName).get(name);
    const mine = swFunctions.get(name);

    if (!mine) { errors.push(`${name}(): 在 ${SW} 中缺失`); continue; }
    if (!theirs) { errors.push(`${name}(): 在 ${moduleName} 中缺失`); continue; }

    if (mine.params !== theirs.params) {
        errors.push(`${name}(): 形参不一致 — SW (${mine.params}) vs ${moduleName} (${theirs.params})`);
        continue;
    }
    if (mine.body === theirs.body) {
        console.log(`✓ ${name}() 与 ${moduleName} 一致`);
        continue;
    }
    if (ACCEPTED_DRIFT.has(name)) {
        warnings.push(`${name}(): 已知差异 — ${ACCEPTED_DRIFT.get(name)}`);
        continue;
    }
    errors.push(`${name}(): 函数体与 ${moduleName} 不一致（改动一侧时请同步另一侧）`);
    if (process.env.SW_SYNC_DEBUG) {
        console.log(`--- ${SW} ---\n${mine.body}\n--- ${moduleName} ---\n${theirs.body}\n`);
    }
}

// The 38-key defaults object is duplicated verbatim; a single-key drift is
// easy to miss by eye and silently changes behaviour on one side only.
const swDefaults = parseDefaults(read(SW));
const configDefaults = parseDefaults(read(MODULES['modules/config.js']));

if (!swDefaults || !configDefaults) {
    errors.push('defaultValues: 至少一侧解析失败');
} else {
    const keys = new Set([...Object.keys(swDefaults), ...Object.keys(configDefaults)]);
    const diffs = [];
    for (const key of [...keys].sort()) {
        const a = swDefaults[key];
        const b = configDefaults[key];
        if (String(a) !== String(b)) diffs.push(`  ${key}: SW=${JSON.stringify(a)} config=${JSON.stringify(b)}`);
    }
    if (diffs.length === 0) {
        console.log(`✓ defaultValues 两侧一致（${keys.size} 个键）`);
    } else {
        errors.push(`defaultValues 不一致:\n${diffs.join('\n')}`);
    }
}

console.log('');
for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);

if (errors.length > 0) {
    console.error(`\n${errors.length} 处同步漂移`);
    process.exit(1);
}
console.log(warnings.length ? `\n${warnings.length} 处已知差异（见上）` : '\n✓ 无同步漂移');
