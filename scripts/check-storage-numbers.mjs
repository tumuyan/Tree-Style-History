// Flag a stored value used as a number without Number()/parseInt().
//
// Every value in this project's `localStorage` is a string — storage-adapter.js
// coerces with String(value) on the way in, which is what chrome.storage.local
// hands back. Reading one and using it as a number therefore relies on implicit
// coercion: `>` and `-` convert for you, `+` does not (it concatenates), and
// `===` never does. The conversion is invisible at the read site, which is why
// these reads are wrapped — see the note above loadDate() in background-sw.js.
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
// That follow is scoped to ONE top-level function at a time. A single table for
// the whole file is unsound, and the file it was unsound about is the one this
// rule was written for: popup-core.js declares `var itemsno` three times — 374,
// 550 and 603, reading rct-itemsno / rt-itemsno / mv-itemsno — so wrapping any
// one of them made the other two exempt as well. Unwrapping one of the three by
// hand left `verify:storage-numbers` reporting success while the other two were
// still being compared as strings.
//
// The slice runs from one top-level `function` to the next, which is the right
// granularity for the name collision that makes a file-wide table wrong and is
// the cheapest thing to compute: no parser, and no per-function bookkeeping.
// Anything outside a function body — the top-level statements of a page script
// — is a slice of itself.

import fs from 'node:fs';
import path from 'node:path';

const CHROME_DIR = new URL('../chrome/', import.meta.url).pathname;
const SCRIPTS_DIR = path.join(CHROME_DIR, 'scripts');

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

// A `/` that opens a regex literal rather than a comment can only follow an
// operator, a bracket, a `;`, or a keyword that expects an expression. Without
// this, the `//` in `/^(http|https)\\:\\/\\//` reads as a line comment and the rest
// of the file — including the code the rule is supposed to inspect — is dropped.
//
// Whitespace is deliberately absent: `hits / total` ends in a space, and
// accepting that as "an expression may start here" made the scan read the
// division as a literal, close it on the `/` of a later `</td>` and swallow the
// code in between. Requiring `/\S` instead would be wrong the other way —
// `/ /g` is a real literal. Kept identical to tests/static.test.mjs by the
// parity guard there.
//
// The arithmetic and comparison operators are listed too, and they are not
// optional: `=> /x/` and `a + /x/` are literals just as much as `(/x/)` is, and
// leaving them out made the scan read the `/` as a division, copy the pattern
// through as text, and then open a *string* on the first quote inside it. The
// quote state ran to the next real `'` in the file, so every string literal in
// between — including Chinese ones the neighbouring guard exists to find — was
// filed under the wrong span.
//
// `+` and `-` need one more condition: `i++ / 2` is a division, and a plain
// `[+\-]` said "a literal may start here" and then closed the bogus literal on
// some later `/` on the same line. The lookbehind is what separates the two —
// the operator right before a `/` is the *second* of a doubled pair.
//
// There used to be a matching lookahead here as well. It was unreachable: this
// regex is tested as a suffix of the text before the `/`, so the lookahead
// always ran at end-of-string and never failed. Deleting it changes no file's
// strip result, which is how it was found — an unprovable branch is worse than
// no branch.
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};*%<>~^]|(?<![+\-])[+\-]|\b(?:return|typeof|case|in|of|delete|void|new|do|else|yield|await))\s*$/;

/**
 * Index just past the closing `/` of the regex literal beginning at `start`
 * (the index after its opening slash), or -1 if there is no such literal.
 *
 * `/` is ambiguous — division and the start of a regex literal look alike.
 * Requiring a closing slash on the same line (a regex literal cannot span
 * lines) means a division is copied through as ordinary text instead of
 * swallowing the rest of the file.
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
 * Drop comments, tracking strings and regex literals so a `//` or `/*` inside
 * one survives.
 *
 * Kept deliberately in step with `stripJsComments` in tests/static.test.mjs,
 * which applies the same numeric-read rule and must not disagree with this
 * script about where a line begins — see the parity guard next to it.
 */
function stripComments(src) {
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
            out += nl;
            i++;
        } else if (ch === '/' && BEFORE_REGEX.test(out)) {
            const end = endOfRegex(src, i + 1);
            if (end < 0) out += ch;             // a division, not a regex
            else {
                out += src.slice(i, end);
                i = end - 1; // the loop's i++ lands on the first character after it
            }
        } else {
            out += ch;
        }
    }
    return out;
}

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
 * two slices declare the same name — which is the case this whole change is
 * about. Callers get back the slices with their own name sets attached.
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
        for (const m of code.matchAll(/(?:^|[;{]|\n)\s*(?:(?:var|let|const)\s+)?([\w$]+)\s*=\s*localStorage\b/g)) {
            if (!numeric.has(m[1])) names.add(m[1]);
        }
        return { at, code, names };
    });
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

function lineOf(src, index) {
    return src.slice(0, index).split('\n').length;
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p, out);
        else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
}

const offenders = [];
for (const file of walk(SCRIPTS_DIR).sort()) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const hit of unwrappedNumericReads(src)) {
        const line = src.split('\n')[lineOf(src, hit.at) - 1].trim();
        offenders.push(`  ✗ ${path.relative(CHROME_DIR, file)}:${lineOf(src, hit.at)}  ${hit.what} ${hit.op}\n      ${line}`);
    }
}

if (offenders.length > 0) {
    console.error('A stored value is used as a number without Number()/parseInt():');
    for (const o of offenders) console.error(o);
    console.error(`\n${offenders.length} unwrapped numeric use(s) of a stored value`);
    console.error('Wrap the read — every value in localStorage is a string.');
    process.exit(1);
}

console.log('Every numeric use of a stored value goes through Number()/parseInt()');
