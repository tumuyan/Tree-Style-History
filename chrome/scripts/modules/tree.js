// Tree Style History - tree renderer
//
// Both tree pages (history2.html and closed.html) used to render through
// jQuery + zTree, plus a locally patched exhide extension and fuzzysearch.js
// for filtering. That was ~2.6k lines of third-party code for one widget, and
// zTree's async loader shipped a runtime compiler that MV3's CSP forbids.
// All four files are gone from the repo; this module renders both pages.
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
 * The only plain keys the tree claims. Everything else (Tab / Shift+Tab,
 * PageDown, Ctrl+F ...) must keep its native behaviour — swallowing a key the
 * tree does not handle traps a keyboard user here, the opposite of making the
 * tree keyboard-reachable. Browser/system chords (Alt+Left = Back,
 * Ctrl+ArrowDown, Meta+...) are excluded separately, in onKeydown().
 */
const HANDLED_KEYS = new Set([
    'ArrowDown', 'ArrowUp', 'Home', 'End',
    'ArrowRight', 'ArrowLeft', 'Enter', ' ', '*',
]);

/** Keyword match, over the raw name and URL. User input, so no regex here. */
function matcher(keyword, urlKey) {
    const needle = keyword.toLowerCase();
    return function (node) {
        const name = node.name == null ? '' : String(node.name);
        const url = node[urlKey] == null ? '' : String(node[urlKey]);
        return name.toLowerCase().indexOf(needle) !== -1
            || url.toLowerCase().indexOf(needle) !== -1;
    };
}

/**
 * Matches plus their ancestors: a match buried in a branch is no use if the
 * branch above it is hidden. `null` means "no filter, everything is visible".
 */
function visibleSet(nodes, idx, keyword, urlKey) {
    if (!keyword) return null;
    const visible = new Set();
    const match = matcher(keyword, urlKey);
    for (const n of nodes) {
        if (!match(n)) continue;
        visible.add(n);
        let parent = idx.byId.get(String(n.pId));
        // Guard against a pId cycle, which would otherwise loop forever.
        for (let guard = 0; parent && guard < nodes.length; guard++) {
            visible.add(parent);
            parent = idx.byId.get(String(parent.pId));
        }
    }
    return visible;
}

/** Children that survive the filter — the exact set treeHtml() renders. */
function visibleChildren(node, idx, visible) {
    return (idx.children.get(node) || [])
        .filter(function (k) { return !visible || visible.has(k); });
}

/**
 * Every row a keyboard user can reach, in the order treeHtml() draws them.
 *
 * A folded branch's rows are still in the DOM (their <ul> is display:none), so
 * "visible" here means rendered AND not under a collapsed ancestor. Keeping
 * this a pure walk of the same index/visible set is what stops the arrow keys
 * from drifting away from the markup after a filter or a fold.
 */
function visibleRows(idx, visible) {
    const out = [];
    const walk = function (node) {
        if (visible && !visible.has(node)) return;
        out.push(node);
        if (node.open === false) return;
        for (const kid of visibleChildren(node, idx, visible)) walk(kid);
    };
    for (const root of idx.roots) walk(root);
    return out;
}

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
        const shown = visibleChildren(node, idx, visible);
        const hasChildren = shown.length > 0;
        const open = node.open !== false;
        const prefix = `${treeId}_${tid}`;

        // A custom icon (the favicon) replaces the folder/file glyph entirely.
        //
        // `background-size:cover` is not decoration: the box is 16x16, and
        // favicons are served at 32x32 or 64x64. With the initial `auto` the
        // image is painted at its natural size and clipped to the box, so the
        // row shows the icon's top-left corner -- for a transparent-padded
        // favicon that crop is often empty, and the icon "does not display"
        // even though the URL resolves. zTree emitted exactly this declaration
        // (makeNodeIcoStyle in jquery.ztree.core.js); dropping it is what broke
        // the icons, so it is part of the markup contract, not a tweak.
        const icoStyle = node.icon
            ? ` style="background:url('${cssUrl(node.icon)}') 0 0 no-repeat;background-size:cover;"` : '';

        // WAI-ARIA tree: the <li> is the focusable treeitem, the child <ul> is
        // its group. aria-expanded lives on the row (not the glyph), so a
        // screen reader hears the branch state without the decorative switch
        // and icon spans being announced as separate controls.
        const expanded = hasChildren ? ` aria-expanded="${open ? 'true' : 'false'}"` : '';

        let html = `<li id="${prefix}" class="level${level}" data-tid="${tid}"`
            + ` role="treeitem" aria-level="${level + 1}"${expanded} tabindex="-1">`
            + `<span id="${prefix}_switch" class="button switch ${switchClass(level, isLast, hasChildren, open)}" aria-hidden="true"></span>`
            + `<a id="${prefix}_a" class="level${level}" title="${escapeHtmlAttr(node[urlKey])}">`
            + `<span id="${prefix}_ico" class="button ico ${icoClass(hasChildren, open)}"${icoStyle} aria-hidden="true"></span>`
            + `<span id="${prefix}_span">${nameHtml(node)}</span>`
            + '</a>';

        if (hasChildren) {
            const inner = shown.map(function (kid, i) {
                return nodeHtml(kid, level + 1, i === shown.length - 1, idx, visible);
            }).join('');
            html += `<ul id="${prefix}_ul" class="level${level} line" role="group"`
                + ` style="display:${open ? 'block' : 'none'}">${inner}</ul>`;
        }
        return html + '</li>';
    };

    const idx = indexNodes(nodes);
    const visible = visibleSet(nodes, idx, keyword, urlKey);
    return idx.roots.map(function (root, i) {
        return nodeHtml(root, 0, i === idx.roots.length - 1, idx, visible);
    }).join('');
}

/**
 * @param {HTMLElement} container the <ul> to render into
 * @param {object} [opts]
 * @param {Function} [opts.onClick] (event, treeId, node)
 * @param {string}   [opts.urlKey]  node field holding the URL (default `t`)
 * @param {string}   [opts.label]   accessible name for the tree (i18n'd)
 *
 * The container becomes a WAI-ARIA tree with a roving tabindex: exactly one
 * row is tabbable, arrow keys move the focus, Enter/Space activates the row
 * (the same onClick the mouse uses), and Left/Right fold and unfold a branch.
 * All of it is delegated on the container, because filter() re-renders the
 * rows wholesale and per-row listeners would be lost on every keystroke.
 */
function createTree(container, opts) {
    const options = opts || {};
    const onClick = options.onClick || function () {};
    const urlKey = options.urlKey || 't';
    const treeId = container.id || 'tree';
    container.setAttribute('role', 'tree');
    if (options.label) container.setAttribute('aria-label', options.label);

    // Exactly one tabbable row. `null` = nothing focused yet; render() then
    // makes the first row the tab stop.
    let focusTid = null;

    let nodes = [];
    let keyword = '';
    // Node objects are the identity: the same node keeps its element id across
    // renders, so a click can be mapped back to it.
    const ids = new Map();
    // Kept between renders because callers walk it: closed.js reopens every
    // page under the group that was clicked, which is a question about the
    // data, not about the markup.
    let index = indexNodes(nodes);

    function byTid(tid) {
        for (const [node, id] of ids) if (id === tid) return node;
        return undefined;
    }

    function render() {
        index = indexNodes(nodes);
        container.innerHTML = treeHtml(nodes, { treeId, keyword, urlKey, ids });
        const rows = visibleRows(index, visibleSet(nodes, index, keyword, urlKey));
        if (focusTid !== null && !rows.some(function (n) { return ids.get(n) === focusTid; })) {
            focusTid = null; // the focused row was filtered out
        }
        if (focusTid === null && rows.length) focusTid = ids.get(rows[0]);
        for (const row of container.querySelectorAll('li[data-tid]')) {
            row.tabIndex = Number(row.dataset.tid) === focusTid ? 0 : -1;
        }
    }

    // Delegated: rows are re-rendered wholesale on every filter, so a listener
    // per row would have to be re-bound each time.
    container.addEventListener('click', function (event) {
        const node = nodeOfEvent(event);
        if (!node) return;

        // A mouse click should leave the roving tab stop on that row too.
        focusNode(node);
        if (event.target.closest && event.target.closest('.switch')) {
            toggle(node);
            return;
        }
        onClick(event, treeId, node);
    });

    /** Keep the row's ARIA state with its CSS state, in place. */
    function syncRow(node) {
        const open = node.open !== false;
        const prefix = `${treeId}_${ids.get(node)}`;
        const row = document.getElementById(prefix);
        const list = document.getElementById(`${prefix}_ul`);
        const sw = document.getElementById(`${prefix}_switch`);
        if (row && list) row.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (list) list.style.display = open ? 'block' : 'none';
        if (sw) {
            // Only the open/close half changes; the root/center/bottom shape is
            // decided by position and stays as rendered.
            sw.className = sw.className.replace(/_open|_close/, open ? '_open' : '_close');
        }
    }

    /** Collapse in place: re-rendering would lose the scroll position. */
    function toggle(node) {
        node.open = node.open === false;
        syncRow(node);
    }

    /** Move the roving tab stop to `node` and focus its row. */
    function focusNode(node) {
        const tid = ids.get(node);
        if (tid === undefined) return;
        for (const row of container.querySelectorAll('li[data-tid]')) {
            row.tabIndex = Number(row.dataset.tid) === tid ? 0 : -1;
        }
        focusTid = tid;
        const row = document.getElementById(`${treeId}_${tid}`);
        if (row && row.focus) row.focus();
    }

    function nodeOfEvent(event) {
        const row = event.target && event.target.closest
            ? event.target.closest('li[data-tid]') : null;
        return row ? byTid(Number(row.dataset.tid)) : undefined;
    }

    /** Activate exactly as a click would; the page decides what that means. */
    function activate(event, node) {
        if (node) onClick(event, treeId, node);
    }

    /**
     * WAI-ARIA tree keyboard support: Up/Down move through the *visible*
     * rows, Right opens a folded branch (or steps into an open one), Left
     * folds a branch (or steps out to its parent), Home/End jump to the ends,
     * Enter/Space activate. Star (*) expands every sibling at this level.
     *
     * Only HANDLED_KEYS with no browser/system modifier are ours. Tab,
     * Shift+Tab, PageDown, Ctrl+F and chords like Alt+Left (Back) or
     * Ctrl+ArrowDown keep their native behaviour; swallowing them would trap
     * the focus inside the tree. `*` is typed with Shift on most layouts, so
     * Shift is allowed for that one key.
     */
    function onKeydown(event) {
        const node = nodeOfEvent(event);
        if (!node) return;
        if (!HANDLED_KEYS.has(event.key)
            || event.altKey || event.ctrlKey || event.metaKey
            || (event.shiftKey && event.key !== '*')) return;
        const visible = visibleSet(nodes, index, keyword, urlKey);
        const rows = visibleRows(index, visible);
        const pos = rows.indexOf(node);
        const here = visibleChildren(node, index, visible);
        let next = null;
        // A scripted focus can land on a row a folded ancestor just hid. Start
        // over from the first visible row instead of doing arithmetic on -1.
        if (pos < 0) {
            if (event.preventDefault) event.preventDefault();
            if (rows.length) focusNode(rows[0]);
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                next = rows[Math.min(pos + 1, rows.length - 1)];
                break;
            case 'ArrowUp':
                next = rows[Math.max(pos - 1, 0)];
                break;
            case 'Home':
                next = rows[0];
                break;
            case 'End':
                next = rows[rows.length - 1];
                break;
            case 'ArrowRight':
                if (here.length && node.open === false) {
                    node.open = true;
                    syncRow(node);
                } else if (here.length) {
                    next = here[0];
                }
                break;
            case 'ArrowLeft': {
                if (here.length && node.open !== false) {
                    node.open = false;
                    syncRow(node);
                } else {
                    const parent = index.byId.get(String(node.pId));
                    if (parent && rows.indexOf(parent) >= 0) next = parent;
                }
                break;
            }
            case 'Enter':
            case ' ':
                activate(event, node);
                break;
            case '*': {
                const parent = index.byId.get(String(node.pId));
                const siblings = parent ? visibleChildren(parent, index, visible) : index.roots;
                for (const sib of siblings) {
                    if (visibleChildren(sib, index, visible).length) {
                        sib.open = true;
                        syncRow(sib);
                    }
                }
                break;
            }
            default:
                return;
        }
        if (event.preventDefault) event.preventDefault();
        if (next && next !== node) focusNode(next);
    }

    container.addEventListener('keydown', onKeydown);

    // Roving tabindex has to follow the focus, not just our own key handler:
    // Tab from outside, a scripted focus(), or an assistive technology can
    // land on any row. Without this the visible focus and the tab stop drift
    // apart, and the next Tab leaves the tree from the wrong place.
    container.addEventListener('focusin', function (event) {
        const node = nodeOfEvent(event);
        if (!node) return;
        const tid = ids.get(node);
        if (tid === undefined || tid === focusTid) return;
        focusTid = tid;
        for (const row of container.querySelectorAll('li[data-tid]')) {
            row.tabIndex = Number(row.dataset.tid) === tid ? 0 : -1;
        }
    });

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
            return index.roots;
        },
        /** Direct children of a node, in insertion order. */
        childrenOf(node) {
            return index.children.get(node) || [];
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

/**
 * Drop the visits that add nothing to the tree.
 *
 * history2.html's "show less history" option: with it on, a reload is not meant
 * to appear beside the page it reloaded, and opening the same address twice (as
 * roots: no parent, no children) leaves one row, not two.
 *
 * Every rule is order-dependent, so this walks the array once in the given
 * order and decides each node against what it has kept so far. The list arrives
 * newest-first, which makes "the first occurrence" the most recent visit — the
 * one worth keeping, and the one a later search hits first.
 *
 * The loop used to splice in place and re-read `zNodes[s]` afterwards. Same
 * answer, but it takes a minute to see that the re-read lands on the row the
 * splice shifted down and not on the one it was already looking at. Building a
 * new array removes the question.
 *
 * @param {Array}  nodes flat `{ id, url, transition }`
 * @param {object} pIds  visit ids that some other node names as its parent
 * @returns {Array} the same order, minus what it dropped
 */
function collapseVisits(nodes, pIds) {
    const urls = {};
    return nodes.filter(function (node) {
        // Something links here. Dropping the row would orphan everything under
        // it, and its url is deliberately NOT recorded: a node with children
        // casts no shadow over them.
        if (pIds[node.id] == true) return true;
        // A reload is the same page again, not a step sideways.
        if (node.transition === 'reload') return false;
        if (urls[node.url] == true) return false;
        urls[node.url] = true;
        return true;
    });
}

// One `export {}` block rather than three inline `export function`s:
// tests/static.test.mjs reads this block to cross-check the module's public
// API, and it cannot see the inline form.
export { treeHtml, createTree, bindTreeSearch, collapseVisits };
