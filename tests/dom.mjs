// A very small DOM stand-in, just large enough to drive the option-page code
// paths in chrome/scripts/modules/config.js under `node:test`.
//
// Why not jsdom?
//   The suite is deliberately dependency-free (see stubs.mjs), and the code
//   under test only needs: getElementById, querySelectorAll for a handful of
//   literal selectors, createElement + innerHTML, and addEventListener.
//   Modelling those explicitly also keeps assertions honest: a selector this
//   shim does not understand returns [] rather than half-working.
//
// Deliberate limitations (read before extending):
//   * `innerHTML` is NOT parsed into a tree. Setting it (a) registers every
//     `id="..."` it contains so `$()` can find generated nodes, and (b) extracts
//     `<td>` contents for `<tr>` elements, which is the only nesting config.js
//     queries into. Anything else must use the real browser.
//   * Quoted attribute selectors (`[rel="…"]`) undo CSS escapes before
//     comparing, and an attribute selector whose value contains an unescaped
//     quote throws a SyntaxError — both as the browser does. Selectors beyond
//     the shapes listed in `matches()` return [] rather than half-working.
//     `matches()` also accepts a type + class compound (`div.item-holder`):
//     that is the selector the selection code reaches its rows with, via
//     `closest()`, so supporting it is what lets an unselect-all sweep find
//     the rows a test just built.
//   * `getElementById` returns null for unknown ids and records them in
//     `missing`, so tests can assert the code never touches an element that
//     options.html does not define.

import fs from 'node:fs';
import path from 'node:path';

const CHROME_DIR = new URL('../chrome/', import.meta.url).pathname;

// `#flist tr td:first-child` is queried but the rows are appended to
// `#flist-table` (the <table> inside <div id="flist">). The shim has no
// descendant axis, so the two container ids are aliased explicitly.
const CONTAINER_ALIAS = Object.freeze({ flist: 'flist-table', mvlist: 'mvlist-table' });

/** Every `id="..."` in an extension HTML file. */
export function htmlIds(file) {
    const html = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8');
    return [...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
}

function extractIds(html) {
    return [...String(html).matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Lift `li[data-tid]` rows out of assigned innerHTML as real child elements.
 *
 * createTree() re-renders wholesale on every filter and then walks
 * `querySelectorAll('li[data-tid]')` to maintain its roving tabindex. The
 * generic id registry above answers those ids with flat divs, which the
 * `li[data-tid]` selector cannot match — so the tab stop would silently never
 * be set in any unit test. Parse just those rows (and their id, classes,
 * data-tid, tabindex and aria-expanded) into the child list; the full markup
 * tree is still the browser's job, exercised by the e2e suite.
 */
function extractTreeRows(html) {
    const rows = [];
    for (const m of String(html).matchAll(/<li\b([^>]*)>/g)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
        if (attrs['data-tid'] === undefined) continue;
        rows.push(attrs);
    }
    return rows;
}

function extractCellText(html) {
    return [...String(html).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
        .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
}

/**
 * Install the fake DOM as the ambient `document` / `window`.
 * Call AFTER installStubs() but BEFORE importing any extension module.
 */
export function createDom(options = {}) {
    const byId = new Map();
    const bySelector = new Map();
    const missing = [];

    function makeEl(tag) {
        const el = {
            tagName: String(tag).toUpperCase(),
            id: '',
            style: {},
            dataset: {},
            children: [],
            parentNode: null,
            cells: [],
            handlers: {},
            attrs: {},
            classes: new Set(),
            value: '',
            checked: false,
            disabled: false,
            selectedIndex: 0,
            options: [{ value: '' }],
            offsetWidth: 10,
            clientWidth: 100,
            tabIndex: -1,
            focused: false,
            _html: '',
            _text: '',
        };

        Object.defineProperty(el, 'innerHTML', {
            get() { return el._html; },
            set(v) {
                el._html = String(v);
                el._text = el._html.replace(/<[^>]*>/g, '');
                el.children.length = 0; // matches the DOM: assigning innerHTML replaces children
                for (const id of extractIds(el._html)) {
                    if (byId.has(id)) continue;
                    const node = makeEl('div');
                    // Parent them to the element that owns the HTML. The shim
                    // still does not build a nested tree — ids cannot nest —
                    // but one level up is enough for closest('tr') to resolve,
                    // which is how the blocklist rows wire up their X button.
                    node.parentNode = el;
                    byId.set(id, node);
                }
                el.cells = extractCellText(el._html).map((text) => {
                    const cell = makeEl('td');
                    cell.textContent = text;
                    return cell;
                });
                for (const attrs of extractTreeRows(el._html)) {
                    const li = makeEl('li');
                    li.id = attrs.id || '';
                    li.dataset.tid = attrs['data-tid'];
                    li.className = attrs.class || '';
                    if (attrs.tabindex !== undefined) li.tabIndex = Number(attrs.tabindex);
                    for (const [name, v] of Object.entries(attrs)) {
                        if (name !== 'id' && name !== 'class' && name !== 'tabindex') {
                            li.attrs[name] = v;
                        }
                    }
                    // A real <li> is focusable once it has a tabindex. The
                    // shim has no focus state, so record it: the keyboard
                    // tests assert which row the roving tab stop landed on.
                    li.focus = () => { li.focused = true; };
                    li.parentNode = el;
                    el.children.push(li);
                    // getElementById() and querySelectorAll() must answer the
                    // SAME object, as they do in a browser: createTree() sets
                    // the tab stop through the latter and moves focus through
                    // the former. extractIds() registered a flat div for this
                    // id a moment ago; replace it with the real row.
                    if (li.id) byId.set(li.id, li);
                }
            },
        });

        Object.defineProperty(el, 'textContent', {
            get() { return el._text; },
            set(v) {
                el._text = String(v);
                el._html = '';
                // Assigning textContent replaces everything inside the element,
                // children included. Leaving them made `container.textContent =
                // ''` a no-op on the tree, so an assertion like
                // `children.length === 2` after a re-render could not tell two
                // fresh rows from two stale ones.
                el.children.length = 0;
            },
        });

        Object.defineProperty(el, 'firstChild', { get() { return el.children[0] ?? null; } });

        Object.defineProperty(el, 'className', {
            get() { return [...el.classes].join(' '); },
            set(v) {
                el.classes = new Set(String(v).split(/\s+/).filter(Boolean));
                // `className` and the `class` attribute are one thing in the
                // DOM; without this the attribute selector `div.item-holder`
                // (type + class compound) could not match an element whose
                // class was set the ordinary way.
                el.attrs.class = [...el.classes].join(' ');
            },
        });

        el.classList = {
            add: (...c) => c.forEach((x) => el.classes.add(x)),
            remove: (...c) => c.forEach((x) => el.classes.delete(x)),
            contains: (c) => el.classes.has(c),
        };

        el.setAttribute = (name, v) => {
            el.attrs[name] = String(v);
            if (name === 'id') el.id = String(v);
            if (name === 'class') el.className = v;
            if (name === 'value') el.value = String(v);
        };
        el.getAttribute = (name) => (name === 'id' ? el.id : (name in el.attrs ? el.attrs[name] : null));
        el.removeAttribute = (name) => { delete el.attrs[name]; };
        el.hasAttribute = (name) => name in el.attrs;

        el.addEventListener = (type, fn) => { (el.handlers[type] ||= []).push(fn); };
        /** Invoke the handlers registered for `type` (test-side trigger). */
        el.dispatch = (type, event = {}) => (el.handlers[type] || []).forEach((fn) => fn.call(el, { type, target: el, preventDefault() {}, ...event }));

        // Appending MOVES: the child leaves whatever `children` list it was in,
        // which is the only reason an element can never be under two parents at
        // once. Pushing it on top of the old list left the same node reachable
        // from two roots, and `queryAll()` had to de-duplicate the walk to hide
        // it — a shim answering a shape the DOM cannot produce. Also `moveRow`
        // semantics: a render loop that re-parents a row expects the row gone
        // from where it was.
        el.appendChild = (child) => {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = el;
            el.children.push(child);
            return child;
        };
        el.removeChild = (child) => { el.children = el.children.filter((c) => c !== child); return child; };
        el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: el.clientWidth, height: 20 });
        el.select = () => {};

        el.closest = (sel) => {
            for (let node = el; node; node = node.parentNode) if (matches(node, sel)) return node;
            return null;
        };
        el.querySelector = (sel) => queryAll(sel, el)[0] ?? null;
        el.querySelectorAll = (sel) => queryAll(sel, el);
        /** True when this node is `node` or one of its ancestors. */
        el.contains = (node) => {
            for (let cur = node; cur; cur = cur.parentNode) if (cur === el) return true;
            return false;
        };

        return el;
    }

    // `\c` is a literal character, `\1f ` a code point in hex followed by a
    // terminator: both are what CSS.escape() emits, and the browser applies them
    // when it reads a quoted attribute value. Without this the shim would
    // compare the escaped text against the raw attribute and every escaped
    // lookup would miss — which is the opposite of how the browser behaves, and
    // would make the CSS.escape() tests below assert nothing.
    function cssUnescape(value) {
        return value.replace(/\\(?:([0-9a-fA-F]{1,6})[ \n\t]?|([\s\S]))/g,
            (_m, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
    }

    function matches(el, sel) {
        const s = String(sel).trim();
        // `:checked` is a state, not a shape: `.chkbx:checked` is how every
        // selection sweep asks for the ticked rows, and answering it with
        // "unknown selector, no match" made the shim report zero ticked rows in
        // a tree that had them. Anything past the state falls through to the
        // class match below.
        const stateful = /^(\.[\w-]+):checked$/.exec(s);
        if (stateful) return el.classes.has(stateful[1].slice(1)) && el.checked === true;
        if (s.startsWith('#')) return el.id === s.slice(1);
        if (s.startsWith('.')) return el.classes.has(s.slice(1));
        // Type + class compound: `div.item-holder`. This is the shape the
        // selection code reaches its rows with (`closest('div.item-holder')`),
        // so without it every repaint silently finds nothing and the tests
        // below would assert on rows the code never touched.
        const compound = /^([a-zA-Z][\w-]*)((?:\.[\w-]+)+)$/.exec(s);
        if (compound) {
            return el.tagName === compound[1].toUpperCase()
                && compound[2].split('.').filter(Boolean).every((cls) => el.classes.has(cls));
        }
        // Presence: `li[data-tid]`, the shape a delegated handler uses to find
        // the row a click landed in. `getAttribute()` returns null for an
        // attribute that was never set, which is what distinguishes it.
        const present = /^([a-zA-Z]*)\[([\w-]+)\]$/.exec(s);
        if (present) {
            return (!present[1] || el.tagName === present[1].toUpperCase())
                && el.getAttribute(present[2]) !== null;
        }
        const attr = /^([a-zA-Z]*)\[([\w-]+)="((?:[^"\\]|\\.)*)"\]$/.exec(s);
        if (attr) {
            return (!attr[1] || el.tagName === attr[1].toUpperCase())
                && el.getAttribute(attr[2]) === cssUnescape(attr[3]);
        }
        // A selector the browser would reject. `[rel="a"b"]` is not a valid
        // attribute selector — the quote closes the string early — and
        // querySelector() throws a SyntaxError rather than returning null. That
        // throw is the damage an unescaped host actually does: it propagates out
        // of the chunked render loop and leaves the page half drawn. The shim
        // reproduces it so "escaped" and "not escaped" are distinguishable.
        // Single attribute selectors only: a compound `a[rel="x"][data-y="1"]`
        // is legal but falls through to here and would be rejected. Nothing in
        // the extension builds one; a selector past the shapes above is simply
        // not supported by this shim.
        if (/^([a-zA-Z]*)\[([\w-]+)="[\s\S]*"[^[\]]*\][^[\]]*$/.test(s)) {
            throw new SyntaxError(`Failed to execute 'querySelector': '${s}' is not a valid selector.`);
        }
        return el.tagName === s.toUpperCase();
    }

    function queryAll(selector, root) {
        const sel = String(selector).trim();
        if (bySelector.has(sel)) return bySelector.get(sel);

        // Document-rooted selectors carry the descendant axis too: a root-less
        // query used to answer every selector that did not start with `#` by
        // matching it against the document node itself — always zero rows, so
        // "found nothing to paint" and "painted nothing" were the same result.
        if (root || !/^#/.test(sel)) {
            const out = [];
            const walk = (node) => {
                for (const child of node.children) {
                    if (matches(child, sel)) out.push(child);
                    walk(child);
                }
            };
            // `el()` makes elements on demand and does not parent them
            // anywhere, so a walk from `document.body` alone would miss whatever
            // a test appended to a container it seeded by id — the shape these
            // fixtures use. Walk the seeded roots as well, skipping any a
            // parent already reaches so nothing is reported twice.
            const roots = root ? [root] : [document.body];
            if (!root) {
                for (const seeded of byId.values()) {
                    if (!roots.some((r) => r !== seeded && r.contains(seeded))) roots.push(seeded);
                }
            }
            // "Not contained in an earlier root" is the wrong test when an
            // element MOVES between containers: seed A, put A inside B, seed B,
            // and A is no longer inside anything seeded before it — so both go
            // in `roots` and everything under A is visited twice. Measured: one
            // node came back as two. Containment cannot see the ordering, so
            // drop the repeats the walk actually produced instead.
            const seen = new Set();
            for (const r of roots) walk(r);
            return out.filter((el) => (seen.has(el) ? false : (seen.add(el), true)));
        }

        // Remaining shape: `#id`, `#id <step>`, `#id <step> <tag>[:first-child]`.
        // The ids are answered from the registry (and its aliases) rather than
        // from the tree, so a test can seed a container by id alone. A `<step>`
        // is one of `tag`, `tag.class`, `.class` — spelling `.class` out is
        // what makes `#view .chkbx` (the shape every selection sweep uses)
        // answerable, instead of silently returning [] and turning "painted
        // nothing" into a pass.
        //
        // No attribute in a step. `div[title="host"]` used to be admitted — for
        // the group-title lookup — but that lookup is a walk of the container's
        // `children` now (history-core.js's `titleInContainer()`), so nothing
        // reaches the shim with that shape: admitting a step it never sees is
        // how a shim ends up answering a selector nobody asks for.
        const STEP = /^(?:[a-zA-Z][\w-]*(?:\.[\w-]+)*|\.[\w-]+)$/;
        const parts = sel.split(/\s+/).filter(Boolean);
        let base = null;
        let step = null;
        let tail = null;
        if (/^#[\w-]+$/.test(parts[0] || '')) {
            const id = parts[0].slice(1);
            base = byId.get(CONTAINER_ALIAS[id] || id);
            step = parts[1] ?? null;
            tail = parts[2] ?? null;
            if ((step && !STEP.test(step)) || (tail && !/^[a-zA-Z][\w-]*(?::first-child)?$/.test(tail))) return [];
            if (parts.length > 3) return [];
        }
        if (!base) return [];
        if (!step) return [base];
        // `matches()` understands `tag`, `.class` and `tag.class` alike, which
        // is exactly the three shapes a step can take here.
        // Descendant axis: a row can be nested (`div.group-title` sits beside
        // `div.group-holder`, and the checkboxes sit inside `div.item-holder`),
        // so the step is matched at any depth, as CSS does.
        const rows = [];
        const walk = (node) => {
            for (const child of node.children) {
                if (matches(child, step)) rows.push(child);
                walk(child);
            }
        };
        walk(base);
        if (!tail) return rows;
        return rows.flatMap((row) => row.cells.slice(0, 1));
    }

    const document = {
        title: '',
        getElementById(id) {
            if (byId.has(id)) return byId.get(id);
            missing.push(id);
            return null;
        },
        createElement: (tag) => makeEl(tag),
        createTextNode: (text) => { const el = makeEl('#text'); el.textContent = text; return el; },
        querySelector: (sel) => queryAll(sel)[0] ?? null,
        querySelectorAll: (sel) => queryAll(sel),
        /**
         * Page scripts register their entry point here
         * (`document.addEventListener('DOMContentLoaded', ...)`). Keep the
         * handlers so a test can run them with `dispatch('DOMContentLoaded')`;
         * dropping them silently meant no page script could ever be driven.
         */
        handlers: {},
        addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
        /** Run every handler registered for `type` (test-side trigger). */
        dispatch(type, event = {}) {
            (this.handlers[type] || []).forEach((fn) => fn.call(this, { type, target: this, ...event }));
        },
        execCommand() {},
        write() {},
    };
    document.body = makeEl('body');

    const win = {
        document,
        getComputedStyle: () => ({}),
        location: { href: options.href ?? 'chrome-extension://test/options.html?a=1', reload() {} },
        itemSelectedColor: '#ffcbd3',
        ctrlState: 'false',
        shiftState: 'false',
    };

    // config.js and modules/shared/calendar-storage.js register an onStorageReady
    // hook at module scope. This shim replaces `window` outright, so forward it
    // — otherwise those hooks silently never run here.
    Object.defineProperty(win, 'onStorageReady', {
        get: () => globalThis.onStorageReady,
        configurable: true,
    });

    globalThis.document = document;
    globalThis.window = win;
    globalThis.location = win.location;
    globalThis.getComputedStyle = win.getComputedStyle;
    globalThis.alert = () => {}; // addList()/mergeList() surface validation via alert()

    const api = {
        document,
        window: win,
        missing,

        /** Element by id, created on demand (tests use it to build a form). */
        el(id) {
            if (!byId.has(id)) byId.set(id, makeEl('div'));
            return byId.get(id);
        },
        makeEl,
        seedIds(ids) { for (const id of ids) if (!byId.has(id)) byId.set(id, makeEl('div')); },
        /**
         * Pin the result of a literal selector, e.g. `register('a[href="#"]', [])`.
         *
         * Answering `undefined` is not the same as answering `[]`: the lookups
         * hand the pinned value straight back, so `undefined.length` throws
         * inside the caller instead of the code under test. Keep the two apart.
         */
        register(sel, list = []) { bySelector.set(sel, list); return list; },
        /**
         * Turn an element into a <select> with the given option values.
         *
         * `option.selected = true` must move `select.selectedIndex`, exactly as
         * it does in the browser — loadOptions()/selectOptionByIdValue() rely on
         * it and read the value back through `options[selectedIndex]`.
         */
        setOptions(id, values, selected) {
            const el = api.el(id);
            el.options = values.map((value, index) => ({
                value,
                get selected() { return el.selectedIndex === index; },
                set selected(v) { if (v) el.selectedIndex = index; },
            }));
            el.selectedIndex = selected === undefined ? 0 : Math.max(0, values.indexOf(selected));
            el.value = el.options[el.selectedIndex]?.value ?? '';
            return el;
        },
        reset() {
            byId.clear();
            bySelector.clear();
            missing.length = 0;
        },
    };

    return api;
}
