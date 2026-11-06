// Pure source guards for the crawl-state convergence in background-sw.js.
//
// Both the real assertions in static.test.mjs and their mutation probes call
// these same functions. A probe that restates the guard as a second regex only
// proves "the same regex returns true twice"; feeding the mutation to the real
// guard proves the mutation is actually detectable.
//
// These take the whole (comment-stripped) SW source and return a list of
// problems, so a caller can `deepEqual(problems, [])` and a probe can assert
// the list is non-empty. Keeping the slicing markers here means a rewritten
// marker makes BOTH the real guard and its probes fail loudly instead of the
// probe silently slicing from -1.

import vm from 'node:vm';

const CRAWL_IO_START = 'function emptyCrawlState(';
const CRAWL_IO_END = 'function loadHistory(';
const CRAWL_PASS_START = 'async function processVisits(';
const CRAWL_PASS_END = 'function saveCrawledHeat(';
const EMPTY_PASS_MARK = 'if (walked === 0 && !cursor.resumed)';
const COMPLETE_MARK = 'if (complete)';

/** Source between two function markers, or null if either is unrecognisable. */
function sliceBetween(source, start, end) {
    const a = source.indexOf(start);
    const b = source.indexOf(end, a + 1);
    return a >= 0 && b > a ? source.slice(a, b) : null;
}

/** Count session storage calls, including chained and renamed receivers. */
function storageCalls(source) {
    const re = /(?:\barea|sessionArea\s*\(\s*\))\s*\.\s*(get|set|remove)\s*\(/g;
    const calls = { get: 0, set: 0, remove: 0 };
    for (const m of source.matchAll(re)) calls[m[1]]++;
    return calls;
}

/** A brace-depth extraction is only trustworthy if it parses as a call. */
function parsesAsCall(args) {
    try {
        new vm.Script('(async function(){ await ' + args + '); })');
        return true;
    } catch {
        return false;
    }
}

export function crawlStateGuard(sw) {
    const problems = [];
    const io = sliceBetween(sw, CRAWL_IO_START, CRAWL_IO_END);
    const pass = sliceBetween(sw, CRAWL_PASS_START, CRAWL_PASS_END);
    if (io === null || pass === null) {
        problems.push('the crawl-state I/O and processVisits() slices must both be recognisable');
        return problems;
    }

    // ONE read and ONE write, counted over calls rather than prose. The regex
    // tolerates whitespace and a renamed `sessionArea()` receiver, so a second
    // write hidden in a `.then()` chain or behind an alias cannot slip through
    // by keeping the literal `area.get(` / `area.set(` count at one.
    const calls = storageCalls(io);
    if (calls.get !== 1 || calls.set !== 1 || calls.remove !== 0) {
        problems.push(`expected 1 get / 1 set / 0 remove, got ${JSON.stringify(calls)}`);
    }
    if (!/return\s+area\s*\.\s*get\s*\(\s*CRAWL_STATE_KEY\s*\)\s*;/.test(io)) {
        problems.push("the single read must be restoreCrawlState()'s area.get(CRAWL_STATE_KEY)");
    }
    if (!/return\s+area\s*\.\s*set\s*\(\s*\{\s*\[\s*CRAWL_STATE_KEY\s*\]\s*:\s*snapshot\s*\}\s*\)\s*;/.test(io)) {
        problems.push("the single write must be saveCrawlState()'s area.set({ [CRAWL_STATE_KEY]: snapshot })");
    }

    const passCalls = storageCalls(pass);
    if (passCalls.get || passCalls.set || passCalls.remove) {
        problems.push('processVisits() must not reach into session storage itself');
    }
    if (!/const\s+state\s*=\s*await\s+restoreCrawlState\(\)/.test(pass)) {
        problems.push('one read must feed the whole pass');
    }
    if (!/state\s*\.\s*sweepAt/.test(pass)) {
        problems.push('the sweep watermark must come from the state object');
    }
    if (!/resumeIndex\(state\)/.test(pass)) {
        problems.push('the resume index must come from the state object');
    }
    return problems;
}

export function crawlHeatGuard(sw) {
    const problems = [];
    const pass = sliceBetween(sw, CRAWL_PASS_START, CRAWL_PASS_END);
    if (pass === null) {
        problems.push('processVisits() must be recognisable');
        return problems;
    }

    if (!/hydrateHeat\(\s*state\.cursor\s*\?\s*state\.heat\s*:\s*\{\}\s*\)/.test(pass)) {
        problems.push('the pass must hydrate heatDays in place from the object it just read');
    }
    const wStart = sw.indexOf('function saveCrawlState(');
    const wEnd = sw.indexOf('\nfunction ', wStart + 1);
    const writeFn = wStart < 0 ? '' : sw.slice(wStart, wEnd < 0 ? sw.length : wEnd);
    if (/heatDays/.test(writeFn)) {
        problems.push('saveCrawlState() must not fall back to the module-level accumulator');
    }
    if (!/Object\.keys\(state\.heat\)/.test(writeFn)) {
        problems.push('the stored counts must come from the required state.heat field');
    }

    // Extract each call's object literal by brace depth (a nested
    // `cursor: {...}` defeats a flat `[^}]*`). A failed pairing would run to
    // the next `}` and still look like a "slice", so parse each one as a call
    // before trusting it.
    const calls = [];
    for (let at = pass.indexOf('saveCrawlState({'); at >= 0;
         at = pass.indexOf('saveCrawlState({', at + 1)) {
        let depth = 0;
        let end = at + 'saveCrawlState('.length;
        for (; end < pass.length; end++) {
            if (pass[end] === '{') depth++;
            else if (pass[end] === '}' && --depth === 0) { end++; break; }
        }
        calls.push(pass.slice(at, end));
    }
    if (calls.length !== 3) {
        problems.push(`expected 3 saveCrawlState() calls in the pass, found ${calls.length}`);
    }
    for (const args of calls) {
        if (!args.endsWith('}') || !parsesAsCall(args)) {
            problems.push('a saveCrawlState() argument is not a complete object literal');
        }
        if (!/\bheat\s*:/.test(args)) {
            problems.push('every saveCrawlState() call must pass heat');
        }
    }

    // Assert the markers BEFORE slicing: indexOf() returning -1 otherwise
    // yields slice(-1, …), a short string that doesNotMatch() stays green on.
    const eStart = pass.indexOf(EMPTY_PASS_MARK);
    const cStart = pass.indexOf(COMPLETE_MARK, eStart + 1);
    if (eStart < 0 || cStart <= eStart) {
        problems.push('the empty-pass branch markers must both be recognisable');
    } else {
        const emptyBranch = pass.slice(eStart, cStart);
        if (/saveCrawlState\(/.test(emptyBranch)) {
            problems.push('a pass that walked nothing must not write crawl state');
        }
        if (!/setBadge\(\s*''\s*,\s*true\s*\)/.test(emptyBranch)) {
            problems.push('the empty pass must still clear the badge');
        }
    }
    return problems;
}

/** The original comment-stripped source, plus helpers for building mutants. */
export function sourceParts(sw) {
    const io = sliceBetween(sw, CRAWL_IO_START, CRAWL_IO_END);
    const pass = sliceBetween(sw, CRAWL_PASS_START, CRAWL_PASS_END);
    return {
        io,
        pass,
        swapIo: (fn) => sw.replace(io, fn(io)),
        swapPass: (fn) => sw.replace(pass, fn(pass)),
    };
}
