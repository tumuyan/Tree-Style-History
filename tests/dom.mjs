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
            },
        });

        Object.defineProperty(el, 'textContent', {
            get() { return el._text; },
            set(v) { el._text = String(v); el._html = ''; },
        });

        Object.defineProperty(el, 'firstChild', { get() { return el.children[0] ?? null; } });

        Object.defineProperty(el, 'className', {
            get() { return [...el.classes].join(' '); },
            set(v) { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
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

        el.appendChild = (child) => { child.parentNode = el; el.children.push(child); return child; };
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

        return el;
    }

    function matches(el, sel) {
        const s = String(sel).trim();
        if (s.startsWith('#')) return el.id === s.slice(1);
        if (s.startsWith('.')) return el.classes.has(s.slice(1));
        const attr = /^([a-zA-Z]*)\[([\w-]+)="([^"]*)"\]$/.exec(s);
        if (attr) return (!attr[1] || el.tagName === attr[1].toUpperCase()) && el.getAttribute(attr[2]) === attr[3];
        return el.tagName === s.toUpperCase();
    }

    function queryAll(selector, root) {
        const sel = String(selector).trim();
        if (bySelector.has(sel)) return bySelector.get(sel);

        if (root) {
            const out = [];
            const walk = (node) => {
                for (const child of node.children) {
                    if (matches(child, sel)) out.push(child);
                    walk(child);
                }
            };
            walk(root);
            return out;
        }

        // Supported shapes: `#id`, `#id tag`, `#id tag tag2[:first-child]`.
        const m = /^#([\w-]+)(?:\s+([a-zA-Z][\w-]*)(?:\s+([a-zA-Z][\w-]*)(?::first-child)?)?)?$/.exec(sel);
        if (!m) return [];
        const base = byId.get(m[2] && CONTAINER_ALIAS[m[1]] ? CONTAINER_ALIAS[m[1]] : m[1]);
        if (!base) return [];
        if (!m[2]) return [base];
        const rows = base.children.filter((c) => c.tagName === m[2].toUpperCase());
        if (!m[3]) return rows;
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
        addEventListener() {},
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
        /** Pin the result of a literal selector, e.g. `register('a[href="#"]', [])`. */
        register(sel, list) { bySelector.set(sel, list); return list; },
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
