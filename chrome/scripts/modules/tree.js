// Tree Style History - tree renderer
//
// history2.html used to render through jQuery + zTree, plus a locally patched
// exhide extension and fuzzysearch.js for filtering. That was ~2.6k lines of
// third-party code for one widget, and zTree's async loader shipped a runtime
// compiler that MV3's CSP forbids. It is gone from that page; closed.html has
// not been migrated yet and still loads all four.
//
// This module does what the page actually uses: build a tree out of flat
// `{ id, pId }` nodes, expand/collapse, filter by keyword (keeping the
// ancestor chain of every match), and report clicks. It emits the same element
// classes zTree did, so css/zTreeStyle.css still applies — the icons, the
// connector line and the indentation are that stylesheet's, not zTree's.
//
// A node's `name` is PLAIN TEXT (a page title as the browser reported it) and
// is escaped here, at the one place that knows it is writing text content.

import { escapeHtmlAttr, escapeHtmlText, escapeRegExp } from './helpers.js';

// zTree's class vocabulary, kept so the stylesheet keeps working:
//   switch  root_/center_/bottom_ × open/close/docu
//   ico     ico_open / ico_close / ico_docu
function switchClass(level, isLast, hasChildren, open) {
    const shape = level === 0 ? 'root' : (isLast ? 'bottom' : 'center');
    if (!hasChildren) return `${shape}_docu`;
    return `${shape}_${open ? 'open' : 'close'}`;
}

function icoClass(hasChildren, open) {
    if (!hasChildren) return 'ico_docu';
    return open ? 'ico_open' : 'ico_close';
}

/**
 * Escape a favicon URL for the CSS `url('…')` inside a style attribute.
 *
 * Two escapings, in this order, because two parsers read the value: the HTML
 * parser decodes entities FIRST, so `escapeHtmlAttr()` alone turns `'` into
 * `&#39;` and the CSS tokenizer then decodes it straight back and closes the
 * url() string — the icon silently disappears. Escaping the quote for CSS
 * keeps it literal there, and `escapeHtmlAttr()` keeps the attribute intact.
 */
function cssUrl(icon) {
    return escapeHtmlAttr(String(icon).replace(/[\\']/g, '\\$&'));
}

const HIGHLIGHT = 'color: whitesmoke;background-color: darkred;';

/**
 * True if following `pId` from this node leads back to somewhere already seen.
 *
 * A cycle would otherwise leave every member of it with a resolvable parent and
 * therefore no root at all — the whole tree would silently render as nothing.
 * Treating the members as roots renders them (duplicated, once per member)
 * instead of dropping them.
 */
function inCycle(node, byId, cache) {
    if (cache.has(node)) return cache.get(node);
    const seen = new Set();
    let cur = node;
    let cyclic = false;
    while (cur) {
        if (seen.has(cur)) { cyclic = true; break; }
        seen.add(cur);
        cur = byId.get(String(cur.pId));
    }
    for (const n of seen) cache.set(n, cyclic);
    cache.set(node, cyclic);
    return cyclic;
}

/** Parent lookup, plus the children of each node, both in insertion order. */
function indexNodes(nodes) {
    const byId = new Map();
    for (const n of nodes) byId.set(String(n.id), n);
    const children = new Map();
    const roots = [];
    const cycleCache = new Map();
    for (const n of nodes) {
        const parent = byId.get(String(n.pId));
        if (parent && parent !== n && !inCycle(n, byId, cycleCache)) {
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent).push(n);
        } else {
            roots.push(n);
        }
    }
    return { byId, children, roots };
}

/**
 * Render flat nodes as the nested `<li>`/`<ul>` markup zTree produced.
 *
 * Exported as a pure function — no DOM, no state — so the shape of the tree
 * can be asserted without a browser. createTree() is the stateful wrapper that
 * puts this into an element and handles clicks.
 *
 * @param {Array}  nodes flat `{ id, pId, name, t, icon, open }`
 * @param {object} [opts]
 * @param {string} [opts.treeId]  prefix for element ids
 * @param {string} [opts.keyword]  filter; empty shows everything
 * @param {string} [opts.urlKey]   node field holding the URL (default `t`)
 * @param {Map}    [opts.ids]      node -> stable element id, kept by the caller
 */
function treeHtml(nodes, opts) {
    const options = opts || {};
    const treeId = options.treeId || 'tree';
    const keyword = options.keyword || '';
    const urlKey = options.urlKey || 't';
    const ids = options.ids || new Map();

    const tId = function (node) {
        if (!ids.has(node)) ids.set(node, ids.size + 1);
        return ids.get(node);
    };

    const matches = function (node) {
        const needle = keyword.toLowerCase();
        const name = node.name == null ? '' : String(node.name);
        const url = node[urlKey] == null ? '' : String(node[urlKey]);
        return name.toLowerCase().indexOf(needle) !== -1
            || url.toLowerCase().indexOf(needle) !== -1;
    };

    /** Matches plus their ancestors: a match buried in a branch is no use if
     *  the branch above it is hidden. */
    const visibleSet = function (idx) {
        if (!keyword) return null;
        const visible = new Set();
        for (const n of nodes) {
            if (!matches(n)) continue;
            visible.add(n);
            let parent = idx.byId.get(String(n.pId));
            // Guard against a pId cycle, which would otherwise loop forever.
            for (let guard = 0; parent && guard < nodes.length; guard++) {
                visible.add(parent);
                parent = idx.byId.get(String(parent.pId));
            }
        }
        return visible;
    };

    /**
     * Escape the name and wrap every hit in a highlight span.
     *
     * `name` is PLAIN TEXT — a page title as the browser reported it — and this
     * is where it becomes HTML. It used to be the caller's job, which meant
     * every future call site had to remember it (history2.js only deleted '<'
     * and '>'), and the highlight then ran over already-escaped text, where a
     * keyword like "amp" cuts `&amp;` in half and prints a mangled row.
     *
     * So the match is made on the raw text and each piece — before, inside and
     * after a hit — is escaped separately: nothing is escaped twice, and no
     * highlight can land inside an entity. The keyword is regex-quoted because
     * it is typed by the user and would otherwise throw on `a(`.
     */
    const nameHtml = function (node) {
        const name = node.name == null ? '' : String(node.name);
        if (!keyword) return escapeHtmlText(name);

        const re = new RegExp(escapeRegExp(keyword), 'gi');
        let out = '';
        let last = 0;
        let hit;
        while ((hit = re.exec(name)) !== null) {
            out += escapeHtmlText(name.slice(last, hit.index));
            out += `<span style="${HIGHLIGHT}">${escapeHtmlText(hit[0])}</span>`;
            last = hit.index + hit[0].length;
            // A zero-width match would leave lastIndex where it is and loop
            // forever. escapeRegExp('') cannot produce one today, but the
            // keyword is user input and this is a render loop.
            if (hit[0] === '') re.lastIndex++;
        }
        return out + escapeHtmlText(name.slice(last));
    };

    const nodeHtml = function (node, level, isLast, idx, visible) {
        if (visible && !visible.has(node)) return '';

        const tid = tId(node);
        const kids = idx.children.get(node) || [];
        const shown = kids.filter(function (k) { return !visible || visible.has(k); });
        const hasChildren = shown.length > 0;
        const open = node.open !== false;
        const prefix = `${treeId}_${tid}`;

        // A custom icon (the favicon) replaces the folder/file glyph entirely.
        const icoStyle = node.icon
            ? ` style="background:url('${cssUrl(node.icon)}') 0 0 no-repeat;"` : '';

        let html = `<li id="${prefix}" class="level${level}" data-tid="${tid}">`
            + `<span id="${prefix}_switch" class="button switch ${switchClass(level, isLast, hasChildren, open)}"></span>`
            + `<a id="${prefix}_a" class="level${level}" title="${escapeHtmlAttr(node[urlKey])}">`
            + `<span id="${prefix}_ico" class="button ico ${icoClass(hasChildren, open)}"${icoStyle}></span>`
            + `<span id="${prefix}_span">${nameHtml(node)}</span>`
            + '</a>';

        if (hasChildren) {
            const inner = shown.map(function (kid, i) {
                return nodeHtml(kid, level + 1, i === shown.length - 1, idx, visible);
            }).join('');
            html += `<ul id="${prefix}_ul" class="level${level} line"`
                + ` style="display:${open ? 'block' : 'none'}">${inner}</ul>`;
        }
        return html + '</li>';
    };

    const idx = indexNodes(nodes);
    const visible = visibleSet(idx);
    return idx.roots.map(function (root, i) {
        return nodeHtml(root, 0, i === idx.roots.length - 1, idx, visible);
    }).join('');
}

/**
 * @param {HTMLElement} container the <ul> to render into
 * @param {object} [opts]
 * @param {Function} [opts.onClick] (event, treeId, node)
 * @param {string}   [opts.urlKey]  node field holding the URL (default `t`)
 */
function createTree(container, opts) {
    const options = opts || {};
    const onClick = options.onClick || function () {};
    const urlKey = options.urlKey || 't';
    const treeId = container.id || 'tree';

    let nodes = [];
    let keyword = '';
    // Node objects are the identity: the same node keeps its element id across
    // renders, so a click can be mapped back to it.
    const ids = new Map();

    function byTid(tid) {
        for (const [node, id] of ids) if (id === tid) return node;
        return undefined;
    }

    function render() {
        container.innerHTML = treeHtml(nodes, { treeId, keyword, urlKey, ids });
    }

    // Delegated: rows are re-rendered wholesale on every filter, so a listener
    // per row would have to be re-bound each time.
    container.addEventListener('click', function (event) {
        const row = event.target.closest ? event.target.closest('li[data-tid]') : null;
        if (!row) return;
        const node = byTid(Number(row.dataset.tid));
        if (!node) return;

        if (event.target.closest && event.target.closest('.switch')) {
            toggle(node);
            return;
        }
        onClick(event, treeId, node);
    });

    /** Collapse in place: re-rendering would lose the scroll position. */
    function toggle(node) {
        const open = node.open === false;
        node.open = open;
        const prefix = `${treeId}_${ids.get(node)}`;
        const list = document.getElementById(`${prefix}_ul`);
        const sw = document.getElementById(`${prefix}_switch`);
        if (list) list.style.display = open ? 'block' : 'none';
        if (sw) {
            // Only the open/close half changes; the root/center/bottom shape is
            // decided by position and stays as rendered.
            sw.className = sw.className.replace(/_open|_close/, open ? '_open' : '_close');
        }
    }

    return {
        /** Replace everything. */
        setNodes(list) {
            nodes = Array.from(list || []);
            render();
        },
        /** Append, keeping what is already there. */
        addNodes(list) {
            nodes = nodes.concat(Array.from(list || []));
            render();
        },
        /** The roots, in insertion order. */
        getNodes() {
            return indexNodes(nodes).roots;
        },
        removeNode(node) {
            nodes = nodes.filter(function (n) { return n !== node; });
            render();
        },
        clear() {
            nodes = [];
            render();
        },
        /** Show only matches (and their ancestors); empty shows everything. */
        filter(text) {
            keyword = text == null ? '' : String(text);
            render();
        },
        getKeyword() {
            return keyword;
        },
    };
}

/**
 * Wire the filter box and the transition-icon tags to a tree.
 *
 * Replaces fuzzysearch.js, which bound the same two things through jQuery and
 * hid nodes with the patched exhide extension.
 *
 * @param {object} tree
 * @param {object} opts
 * @param {string}   opts.input     selector for the filter box
 * @param {string}   [opts.tags]    selector for the clickable filter tags
 * @param {Function} [opts.onStart] called while a keystroke is pending
 * @param {Function} [opts.onEnd]   called once the filter has been applied
 * @param {number}   [opts.delay]   debounce in ms
 */
function bindTreeSearch(tree, opts) {
    const input = document.querySelector(opts.input);
    const tags = opts.tags ? Array.from(document.querySelectorAll(opts.tags)) : [];
    const delay = opts.delay === undefined ? 500 : opts.delay;

    let timer = null;
    let last = '';

    function run(text) {
        // onStart fires on every keystroke, the first one included: it is what
        // puts the "searching" state up, and gating it on `timer` meant the
        // first keystroke — the one that starts the wait — never showed it.
        if (opts.onStart) opts.onStart();
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            // Cleared on fire as well as on cancel: a timer that already went
            // off is not pending, and run() has to be able to tell the two
            // apart or it calls onStart for a search that already finished.
            timer = null;
            if (text === last) return;
            tree.filter(text);
            last = text;
            if (opts.onEnd) opts.onEnd();
        }, delay);
    }

    // `input`, not `keyup`: it also covers paste and the clear button.
    if (input) {
        input.addEventListener('input', function () { run(input.value); });
    }

    // Clicking the tag that is already filtering clears it — a toggle, which
    // is what fuzzysearch.js did with `lastKeyword`.
    for (const tag of tags) {
        tag.addEventListener('click', function () {
            let text = tag.textContent || '';
            if (last.indexOf(text) >= 0) text = '';
            if (input) input.value = text;
            run(text);
        });
    }
}

// One `export {}` block rather than three inline `export function`s:
// tests/static.test.mjs reads this block to check that func.js really mounts
// every symbol a page script can call, and it cannot see the inline form.
export { treeHtml, createTree, bindTreeSearch };
