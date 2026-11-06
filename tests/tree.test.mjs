// Behaviour tests for modules/tree.js — the native tree renderer that replaced
// jQuery + zTree on history2.html.
//
// The pure function (treeHtml) is imported statically: neither it nor the
// escaping helpers it pulls in from modules/helpers.js touches a browser global
// at import time. The stateful half (createTree / bindTreeSearch) needs an
// element to render into, so those tests install the DOM stand-in from ./dom.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDom } from './dom.mjs';

import { treeHtml, createTree, bindTreeSearch, collapseVisits } from '../chrome/scripts/modules/tree.js';

const dom = createDom();

const NODES = [
    { id: 1, pId: 0, name: 'Root', t: 'https://root.test/' },
    { id: 2, pId: 1, name: 'Child', t: 'https://root.test/child' },
    { id: 3, pId: 2, name: 'Grandchild', t: 'https://root.test/child/deep' },
];

/** Let a debounced filter fire. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A tree rendered into a container element, with every node click recorded.
 *
 * `container.id` has to be set: createTree() derives the element-id prefix
 * from it, which is also what ties a rendered row back to its node.
 */
function treeFixture(nodes) {
    // A FRESH element every time. createTree() registers listeners on the
    // container, and the stand-in's document is shared by the whole file:
    // reusing dom.el('treeDemo') would pile up one keydown handler per test,
    // all of them writing the roving tabindex of the same DOM. The id stays
    // 'treeDemo' because the rendered element ids (and thus the existing
    // assertions) are derived from it.
    const container = dom.makeEl('ul');
    container.id = 'treeDemo';

    const clicked = [];
    const tree = createTree(container, { onClick: (_event, _treeId, node) => clicked.push(node) });
    if (nodes) tree.setNodes(nodes);
    return { container, tree, clicked };
}

/**
 * A `<li data-tid>` row good enough for the delegated click handler.
 *
 * `closest()` in the shim resolves through `parentNode` and matches on
 * attributes, so both the id and `dataset` have to be populated: the former is
 * what `closest('li[data-tid]')` sees, the latter is what the handler reads.
 * `inSwitch` returns the switch span inside the row instead of the row itself.
 */
function row(tid, inSwitch) {
    const li = dom.makeEl('li');
    li.setAttribute('data-tid', String(tid));
    li.dataset.tid = String(tid);

    if (!inSwitch) return li;
    const span = dom.makeEl('span');
    span.className = 'button switch root_open';
    span.parentNode = li;
    return span;
}

/**
 * The rows as the renderer draws them (the DOM stand-in lifts <li data-tid>
 * out of innerHTML now), so the keyboard tests can aim at a real row and
 * read its tabindex / aria-expanded back.
 */
function drawnRows(container) {
    return container.querySelectorAll('li[data-tid]');
}

/**
 * Dispatch a keydown on the container with `target` = one of its rows.
 * Returns the drawn rows (as before). Optional `modifiers` and a `prevented`
 * array let a test assert that a key the tree does NOT own keeps its browser
 * default (Tab, chords, etc.); every preventDefault() call is pushed there.
 */
function pressKey(container, key, target, modifiers = {}, prevented = null) {
    container.dispatch('keydown', {
        key,
        target,
        preventDefault() { if (prevented) prevented.push(key); },
        ...modifiers,
    });
    return drawnRows(container);
}

test('a flat id/pId list renders as nested list items', () => {
    const html = treeHtml(NODES, { treeId: 'tree' });

    // The whole point of the page: a child lives inside its parent's <ul>.
    assert.match(html, /<ul id="tree_1_ul"[^>]*><li id="tree_2"/,
        'the child must be nested in its parent, or the tree is a flat list');
    assert.match(html, /<ul id="tree_2_ul"[^>]*><li id="tree_3"/);

    // Only one root: ids 2 and 3 have parents that exist.
    assert.equal((html.match(/class="level0"/g) || []).length, 2, 'one root li and its anchor');
});

test('a node whose parent is missing is treated as a root', () => {
    // Real data does this: the parent visit has aged out of the range the page
    // loaded, so the child arrives with a pId nobody can answer for.
    const html = treeHtml([{ id: 7, pId: 404, name: 'Orphan', t: 'https://x/' }], { treeId: 'tree' });

    assert.match(html, /<li id="tree_1"[^>]*class="level0"/, 'an orphan must still be rendered');
});

test('a pId cycle terminates instead of hanging', () => {
    const loop = [
        { id: 1, pId: 2, name: 'A', t: '' },
        { id: 2, pId: 1, name: 'B', t: '' },
    ];
    const html = treeHtml(loop, { treeId: 'tree', keyword: 'A' });
    assert.match(html, /<li id="tree_1"/, 'the ancestor walk must not loop forever');
});

test('filtering keeps the match and the chain above it', () => {
    const html = treeHtml(NODES, { treeId: 'tree', keyword: 'Grand' });

    // Matched by name — though the hit is wrapped in a highlight span, so the
    // assertion is on the row, not on the literal text.
    assert.match(html, /data-tid="3"/);
    // Ancestors are shown even though they do not match: a match buried under
    // a hidden branch is unreachable.
    assert.match(html, /data-tid="1"/);
    assert.match(html, /data-tid="2"/);
});

test('filtering drops branches that hold no match', () => {
    const html = treeHtml([
        { id: 1, pId: 0, name: 'Root', t: 'https://a/' },
        { id: 2, pId: 1, name: 'Other', t: 'https://b/' },
    ], { treeId: 'tree', keyword: 'nomatchhere' });

    assert.equal(html, '', 'nothing matched, so nothing is shown');
});

test('a keyword matches the URL as well as the name', () => {
    const html = treeHtml(NODES, { treeId: 'tree', keyword: 'child/deep' });
    assert.match(html, /Grandchild/, 'the filter box filters on URL too');
});

test('a keyword with regex metacharacters does not throw', () => {
    // `a(` is what broke updateFilter() the same way: a user-typed string fed
    // to new RegExp. Here it must simply not match.
    assert.doesNotThrow(() => treeHtml(NODES, { treeId: 'tree', keyword: 'a(' }));
    assert.doesNotThrow(() => treeHtml(NODES, { treeId: 'tree', keyword: '\\' }));
    // ...and it must not terminate the render loop either.
    assert.doesNotThrow(() => treeHtml(NODES, { treeId: 'tree', keyword: '{' }));
});

test('the matched text is highlighted and the name is otherwise intact', () => {
    const html = treeHtml(NODES, { treeId: 'tree', keyword: 'child' });
    assert.match(html, /<span style="color: whitesmoke;background-color: darkred;">Child<\/span>/);
    // Case-insensitive, and the rest of the name is untouched.
    assert.match(html, /Grand<span style="[^"]*">child<\/span>/);
});

test('a node title is escaped before it reaches an attribute', () => {
    const html = treeHtml(
        [{ id: 1, pId: 0, name: 'x', t: 'https://a/?q=" onclick="alert(1)' }],
        { treeId: 'tree' },
    );
    assert.ok(!html.includes('onclick="alert'), 'the URL must not close the title attribute');
    assert.match(html, /title="https:\/\/a\/\?q=&quot; onclick=&quot;alert\(1\)"/);
});

test('a custom icon replaces the folder glyph', () => {
    const html = treeHtml(
        [{ id: 1, pId: 0, name: 'x', t: 'https://a/', icon: 'https://a/favicon.ico' }],
        { treeId: 'tree' },
    );
    assert.match(html, /background:url\('https:\/\/a\/favicon\.ico'\)/);
});

test('a custom icon is scaled into the 16x16 box', () => {
    // Without this the image is painted at its natural size: favicons are
    // usually 32x32 or larger, so a 16x16 box shows only the top-left corner
    // and the row looks like it has no icon at all. zTree emitted the same
    // declaration (makeNodeIcoStyle), so its absence is a regression.
    const html = treeHtml(
        [{ id: 1, pId: 0, name: 'x', t: 'https://a/', icon: 'https://a/favicon.ico' }],
        { treeId: 'tree' },
    );
    const style = /style="([^"]*)"/.exec(html)[1];
    assert.match(style, /background-size:cover/, 'the icon must be scaled to the box');
});

test('a node without an icon carries no background style', () => {
    // The placeholder rows ("no history found") have no icon, so they must not
    // match the assertion above by accident.
    const html = treeHtml([{ id: 1, pId: 0, name: 'x', t: 'https://a/' }], { treeId: 'tree' });
    assert.ok(!html.includes('background:'), 'no icon field -> no inline background');
});

test('a quote in a favicon URL cannot close the url() string', () => {
    // The icon sits in a style attribute, so two parsers read it. Escaping for
    // HTML alone is not enough: the entity is decoded before the CSS tokenizer
    // runs, so `'` still terminates url() and the icon silently disappears.
    const html = treeHtml(
        [{ id: 1, pId: 0, name: 'x', t: 'https://a/', icon: "https://a/b'c" }],
        { treeId: 'tree' },
    );
    const style = /style="([^"]*)"/.exec(html)[1];
    // What the CSS tokenizer actually sees: the HTML parser decodes entities
    // FIRST, so an entity-escaped quote arrives at CSS as a bare quote again.
    const seenByCss = style.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    assert.match(seenByCss, /url\('https:\/\/a\/b\\'c'\)/, 'the quote reaches CSS escaped');
    assert.doesNotMatch(seenByCss, /url\('https:\/\/a\/b'c'\)/, 'an unescaped quote would end the url() early');
});

test('a closed node renders its children hidden', () => {
    const open = treeHtml([{ id: 1, pId: 0, name: 'a', open: true }, { id: 2, pId: 1, name: 'b' }], { treeId: 't' });
    const shut = treeHtml([{ id: 1, pId: 0, name: 'a', open: false }, { id: 2, pId: 1, name: 'b' }], { treeId: 't' });
    assert.match(open, /<ul id="t_1_ul"[^>]*style="display:block"/);
    assert.match(shut, /<ul id="t_1_ul"[^>]*style="display:none"/);
    assert.match(shut, /class="button switch root_close"/);
});

test('element ids stay attached to the same node across renders', () => {
    const ids = new Map();
    const first = treeHtml(NODES, { treeId: 'tree', ids });
    const second = treeHtml(NODES, { treeId: 'tree', ids });
    assert.equal(first, second, 'a re-render must not renumber the rows');
});

// ---------------------------------------------------------------------------
// The rows carry zTree's class vocabulary
//
// history2.html keeps css/zTreeStyle.css and drops the library, so the icons,
// the connector line and the indentation all hang on these class names. A
// rename here loses them silently — the page still renders, just unstyled — so
// the contract is asserted rather than assumed.
// ---------------------------------------------------------------------------

test('the rows carry the class names zTreeStyle.css draws', () => {
    const html = treeHtml([
        { id: 1, pId: 0, name: 'root' },
        { id: 2, pId: 1, name: 'first' },
        { id: 3, pId: 1, name: 'last' },
    ], { treeId: 't' });

    assert.match(html, /class="button switch root_open"/, 'an open root with children');
    assert.match(html, /class="button ico ico_open"/);
    assert.match(html, /class="button switch center_docu"/, 'a child that is not the last one');
    assert.match(html, /class="button switch bottom_docu"/, 'the last child of a branch');
    assert.match(html, /<ul id="t_1_ul" class="level0 line"/, 'the connector line comes from .line');
});

// ---------------------------------------------------------------------------
// Escaping: the node name
//
// `name` is the page title as the browser reported it, i.e. attacker-controlled.
// It reaches the DOM as TEXT CONTENT, so it is escaped here — after the
// highlight, or a keyword can land inside an entity.
// ---------------------------------------------------------------------------

test('a node name is escaped, not executed', () => {
    const html = treeHtml(
        [{ id: 1, pId: 0, name: '<img src=x onerror=alert(1)>', t: 'https://a/' }],
        { treeId: 't' },
    );
    assert.ok(!html.includes('<img src=x'), 'the markup in the title became a real element');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'the markup must be shown, not run');
});

test('a node name keeps the characters that belong to the title', () => {
    // escapeHtmlText(), not escapeHtmlAttr(): in a text position a quote needs
    // no escaping, and escaping it would rewrite what the user actually wrote.
    const html = treeHtml([{ id: 1, pId: 0, name: 'Docs / API "v2"', t: 'u' }], { treeId: 't' });
    assert.match(html, /Docs \/ API "v2"/);
});

test('a highlight cannot cut an HTML entity in half', () => {
    // The reason escaping has to happen after the match rather than before:
    // replacing over already-escaped text turns `&amp;` into
    // `&<span…>amp</span>;` and prints a mangled row.
    const html = treeHtml([{ id: 1, pId: 0, name: 'Tom & Jerry', t: 'u' }], { treeId: 't', keyword: '&' });

    assert.match(html, /<span style="[^"]*">&amp;<\/span>/, 'the ampersand is highlighted as itself');
    assert.ok(!html.includes('&<span'), 'the highlight must not start inside the entity');
    assert.match(html, /Tom <span[^>]*>&amp;<\/span> Jerry/, 'and the rest of the name survives');
});

test('a highlight search matches what the user typed, not the escaped form', () => {
    // Searching for `<` finds the raw character in the title; the escaped text
    // it is rendered as contains no `<` at all.
    const html = treeHtml([{ id: 1, pId: 0, name: 'a < b', t: 'u' }], { treeId: 't', keyword: '<' });
    assert.match(html, /<span style="[^"]*">&lt;<\/span>/);
});

// ---------------------------------------------------------------------------
// createTree — the stateful half
// ---------------------------------------------------------------------------

test('createTree renders its nodes into the container', () => {
    const { container, tree } = treeFixture();
    tree.setNodes(NODES);

    assert.match(container.innerHTML, /<li id="treeDemo_1"/);
    assert.equal(tree.getNodes().length, 1, 'three nodes, one root');
});

test('clicking a row reports the node it was rendered from', () => {
    const { container, clicked } = treeFixture(NODES);

    container.dispatch('click', { target: row(2) });

    assert.deepEqual(clicked, [NODES[1]], 'the click maps back to the node, not to the row');
});

test('clicking the switch collapses the node in place', () => {
    const { container, clicked } = treeFixture([{ id: 1, pId: 0, name: 'a' }, { id: 2, pId: 1, name: 'b' }]);

    // The shim registers the ids out of innerHTML but parses neither class nor
    // style out of it, so the two elements it created get what the browser
    // would have given them: an open node draws its <ul> expanded.
    const list = document.getElementById('treeDemo_1_ul');
    const sw = document.getElementById('treeDemo_1_switch');
    sw.className = 'button switch root_open';
    list.style.display = 'block';

    const drawn = container.innerHTML;
    container.dispatch('click', { target: row(1, true) });

    assert.equal(list.style.display, 'none', 'the children are hidden');
    assert.match(sw.className, /root_close/, 'and the switch shows the closed glyph');
    assert.deepEqual(clicked, [], 'a switch click is not a node click');
    assert.equal(container.innerHTML, drawn,
        'no re-render: re-rendering to collapse would lose the scroll position');
});

test('addNodes appends without dropping what is already there', () => {
    const { container, tree } = treeFixture([{ id: 1, pId: 0, name: 'a' }]);
    tree.addNodes([{ id: 2, pId: 1, name: 'b' }]);

    assert.match(container.innerHTML, /data-tid="1"/);
    assert.match(container.innerHTML, /data-tid="2"/);
});

test('removeNode drops one row and clear empties the tree', () => {
    const { container, tree } = treeFixture(NODES);

    tree.removeNode(NODES[2]);
    assert.doesNotMatch(container.innerHTML, /data-tid="3"/, 'the grandchild is gone');
    assert.match(container.innerHTML, /data-tid="2"/, 'the rest of the branch stays');

    tree.clear();
    assert.equal(container.innerHTML, '');
    assert.deepEqual(tree.getNodes(), []);
});

test('childrenOf reports the direct children in insertion order', () => {
    // closed.js walks it to reopen every page under the group that was clicked.
    // It has to survive a re-render (the index is rebuilt, not cached from the
    // first one) and to report the data's order rather than the markup's.
    const branching = [
        { id: 'g', pId: 0, name: 'group', t: '#' },
        { id: 'b', pId: 'g', name: 'burst', t: '#' },
        { id: 'p2', pId: 'b', name: 'second page', t: 'https://two.test/' },
        { id: 'p1', pId: 'b', name: 'first page', t: 'https://one.test/' },
    ];
    const { tree } = treeFixture(branching);

    const group = tree.getNodes()[0];
    assert.deepEqual(tree.childrenOf(group).map((n) => n.id), ['b']);
    assert.deepEqual(tree.childrenOf(branching[1]).map((n) => n.id), ['p2', 'p1'],
        'insertion order, not the order the rows happen to be drawn in');

    tree.setNodes(branching.slice(0, 2));
    assert.deepEqual(tree.childrenOf(group).map((n) => n.id), ['b'],
        'the index follows setNodes(), otherwise a click would reopen stale rows');
    assert.deepEqual(tree.childrenOf(branching[2]), [], 'a node that is no longer in the tree has no children');
});

test('filter() narrows the tree and getKeyword() reports what is applied', () => {
    const { container, tree } = treeFixture(NODES);

    tree.filter('Grand');
    assert.equal(tree.getKeyword(), 'Grand');
    assert.match(container.innerHTML, /data-tid="3"/, 'the match is still shown');

    tree.filter('nomatchatall');
    assert.equal(container.innerHTML, '', 'a branch with no match is not shown');

    tree.filter('');
    assert.match(container.innerHTML, /data-tid="3"/, 'an empty keyword shows everything again');
});

// ---------------------------------------------------------------------------
// bindTreeSearch — the filter box and the transition tags
// ---------------------------------------------------------------------------

test('the filter box drives the tree once the debounce elapses', async () => {
    const { tree } = treeFixture(NODES);
    const input = dom.el('rh-search');
    input.value = 'Grand';

    const events = [];
    bindTreeSearch(tree, {
        input: '#rh-search',
        delay: 1,
        onStart: () => events.push('start'),
        onEnd: () => events.push('end'),
    });

    input.dispatch('input');

    assert.deepEqual(events, ['start'], 'the first keystroke announces the search too');
    assert.equal(tree.getKeyword(), '', 'and nothing is filtered before the debounce');

    await settle();

    assert.equal(tree.getKeyword(), 'Grand');
    assert.deepEqual(events, ['start', 'end']);
});

test('typing the same keyword again does not re-filter', async () => {
    const { tree } = treeFixture(NODES);
    const input = dom.el('rh-search');
    const events = [];
    bindTreeSearch(tree, { input: '#rh-search', delay: 1, onEnd: () => events.push('end') });

    input.value = 'Grand';
    input.dispatch('input');
    await settle();
    input.dispatch('input');
    await settle();

    assert.equal(tree.getKeyword(), 'Grand');
    assert.deepEqual(events, ['end'], 'the second keystroke changed nothing, so onEnd fires once');
});

test('a filter tag is a toggle: clicking it again clears the box', async () => {
    const { tree } = treeFixture(NODES);
    const input = dom.el('rh-search');
    input.value = '';

    const holder = dom.el('search-tag');
    holder.innerHTML = '';
    const tag = dom.makeEl('a');
    tag.textContent = '🔗';
    holder.appendChild(tag);

    bindTreeSearch(tree, { input: '#rh-search', tags: '#search-tag a', delay: 1 });

    tag.dispatch('click');
    await settle();
    assert.equal(input.value, '🔗', 'the tag fills the filter box');
    assert.equal(tree.getKeyword(), '🔗');

    tag.dispatch('click');
    await settle();
    assert.equal(input.value, '', 'clicking it again clears it');
    assert.equal(tree.getKeyword(), '');
});

// ---------------------------------------------------------------------------
// WAI-ARIA tree semantics + keyboard navigation (issue #48, item 9)
//
// The tree pages are the core feature. They used to be mouse-only: rows were
// <li>s with a click listener and no role, no tab stop, no expanded state.
// These pin the markup contract and the arrow-key behaviour that a screen
// reader / keyboard user depends on.
// ---------------------------------------------------------------------------

test('the markup is a labelled tree with treeitem rows, groups and expanded state', () => {
    const html = treeHtml([
        { id: 1, pId: 0, name: 'root' },
        { id: 2, pId: 1, name: 'child' },
    ], { treeId: 't' });

    assert.match(html, /<li id="t_1"[^>]*role="treeitem"/, 'the row is a treeitem');
    assert.match(html, /<li id="t_1"[^>]*aria-expanded="true"/, 'an open branch says so');
    assert.match(html, /aria-level="1"/, 'the root is level 1');
    assert.match(html, /<li id="t_2"[^>]*aria-level="2"/, 'the child is level 2');
    assert.match(html, /<ul id="t_1_ul"[^>]*role="group"/, 'children live in a group');
    // A leaf has no aria-expanded: announcing "collapsed" on a node that can
    // never expand is misleading.
    assert.doesNotMatch(html, /<li id="t_2"[^>]*aria-expanded/);
    // The switch and icon are decoration; announcing them as controls would
    // double every row for a screen reader.
    assert.match(html, /id="t_1_switch"[^>]*aria-hidden="true"/);
    assert.match(html, /id="t_1_ico"[^>]*aria-hidden="true"/);
});

test('a closed branch renders aria-expanded="false"', () => {
    const html = treeHtml([
        { id: 1, pId: 0, name: 'a', open: false },
        { id: 2, pId: 1, name: 'b' },
    ], { treeId: 't' });
    assert.match(html, /<li id="t_1"[^>]*aria-expanded="false"/);
});

test('createTree labels the container and keeps exactly one tabbable row', () => {
    const { container, tree } = treeFixture();
    tree.setNodes(NODES);

    assert.equal(container.getAttribute('role'), 'tree');
    assert.ok(!container.getAttribute('aria-label'),
        'no label was passed, so none is invented');
    const rows = drawnRows(container);
    assert.equal(rows.filter((r) => r.tabIndex === 0).length, 1,
        'a roving tabindex means one tab stop, not one per row');
    assert.equal(rows[0].tabIndex, 0, 'the first row is the initial tab stop');
});

test('createTree accepts an accessible name from the page', () => {
    const container = dom.el('labelledTree');
    container.id = 'labelledTree';
    const tree = createTree(container, { onClick() {}, label: 'Tree style history' });
    tree.setNodes(NODES);
    assert.equal(container.getAttribute('aria-label'), 'Tree style history');
});

test('ArrowDown / ArrowUp / Home / End move the roving tab stop', () => {
    const { container, tree } = treeFixture();
    tree.setNodes(NODES);
    let rows = drawnRows(container);

    rows = pressKey(container, 'ArrowDown', rows[0]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, 0, -1], 'Down goes to the child');
    rows = pressKey(container, 'ArrowDown', rows[1]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, -1, 0], 'Down goes to the grandchild');
    rows = pressKey(container, 'ArrowDown', rows[2]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, -1, 0], 'Down stops at the last row');
    rows = pressKey(container, 'ArrowUp', rows[2]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, 0, -1]);
    rows = pressKey(container, 'Home', rows[1]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1, -1]);
    rows = pressKey(container, 'End', rows[0]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, -1, 0]);
    assert.equal(rows[2].focused, true, 'the destination row is actually focused');
});

test('Enter and Space activate the row through the same onClick the mouse uses', () => {
    const { container, clicked, tree } = treeFixture();
    tree.setNodes(NODES);
    const rows = drawnRows(container);

    pressKey(container, 'Enter', rows[1]);
    pressKey(container, ' ', rows[2]);
    assert.deepEqual(clicked.map((n) => n.name), ['Child', 'Grandchild']);
});

test('ArrowRight opens a folded branch, then steps into it; ArrowLeft folds and steps out', () => {
    const nodes = [
        { id: 1, pId: 0, name: 'root', open: false },
        { id: 2, pId: 1, name: 'child' },
    ];
    const { container, tree } = treeFixture();
    tree.setNodes(nodes);
    let rows = drawnRows(container);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'false', 'the branch starts folded');

    // Right on a folded branch: expand, keep the focus where it is.
    rows = pressKey(container, 'ArrowRight', rows[0]);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'true', 'the aria state follows the CSS state');
    assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1], 'expanding does not move the focus');

    // Right again, now open: step into the first child.
    rows = pressKey(container, 'ArrowRight', rows[0]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [-1, 0]);

    // Left on a leaf: up to its parent.
    rows = pressKey(container, 'ArrowLeft', rows[1]);
    assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1]);

    // Left on an open branch: fold it.
    rows = pressKey(container, 'ArrowLeft', rows[0]);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'false');
    assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1]);
});

test('a folded branch is skipped by Down until it is opened again', () => {
    const { container, tree } = treeFixture();
    tree.setNodes([
        { id: 1, pId: 0, name: 'A', open: false },
        { id: 2, pId: 1, name: 'A1' },
        { id: 3, pId: 0, name: 'B' },
    ]);
    let rows = drawnRows(container);

    // Only A and B are reachable; ArrowDown must land on B, not on the hidden A1.
    rows = pressKey(container, 'ArrowDown', rows[0]);
    assert.equal(rows[2].tabIndex, 0, 'the hidden child was skipped');
    assert.equal(rows[1].tabIndex, -1);

    // Open A with Right, then Down from A reaches A1.
    rows = pressKey(container, 'ArrowUp', rows[2]);
    rows = pressKey(container, 'ArrowRight', rows[0]);
    rows = pressKey(container, 'ArrowDown', rows[0]);
    assert.equal(rows[1].tabIndex, 0, 'the child is reachable once the branch is open');
});

test('* expands every branch at the focused level', () => {
    const { container, tree } = treeFixture();
    tree.setNodes([
        { id: 1, pId: 0, name: 'A', open: false },
        { id: 2, pId: 1, name: 'A1' },
        { id: 3, pId: 0, name: 'B', open: false },
        { id: 4, pId: 3, name: 'B1' },
    ]);
    let rows = drawnRows(container);
    rows = pressKey(container, '*', rows[2]);
    rows = drawnRows(container);
    assert.deepEqual(rows.map((r) => r.getAttribute('aria-expanded')),
        ['true', null, 'true', null], 'both sibling branches opened');
});

test('clicking the switch keeps aria-expanded in step with the glyph', () => {
    const { container } = treeFixture([
        { id: 1, pId: 0, name: 'a' }, { id: 2, pId: 1, name: 'b' },
    ]);
    let rows = drawnRows(container);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'true');

    // The switch is a child of the row in the real DOM; the shim resolves
    // closest('li[data-tid]') through parentNode, so aim the click at the row
    // itself with a switch-shaped target, exactly as the click handler sees it.
    const sw = dom.makeEl('span');
    sw.className = 'button switch root_open';
    sw.parentNode = rows[0];
    container.dispatch('click', { target: sw });
    rows = drawnRows(container);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'false',
        'folding by mouse updates the same aria state the keyboard does');
});

test('focusin keeps the roving tab stop on the row that actually has focus', () => {
    // Tab from outside, a scripted focus(), or an assistive technology can
    // land on any row. If the tab stop stayed on the row createTree() seeded,
    // the visible focus and the tab order would drift apart.
    const { container, tree } = treeFixture();
    tree.setNodes(NODES);
    const rows = drawnRows(container);
    assert.equal(rows[0].tabIndex, 0, 'the first row starts as the tab stop');

    container.dispatch('focusin', { target: rows[2] });
    assert.deepEqual(drawnRows(container).map((r) => r.tabIndex), [-1, -1, 0],
        'focusing a row makes it the only tab stop');
});

test('filtering keeps one tab stop, and drops it back to the first row when the focused row is filtered out', () => {
    const { container, tree } = treeFixture(NODES);
    pressKey(container, 'ArrowDown', drawnRows(container)[0]);
    pressKey(container, 'ArrowDown', drawnRows(container)[1]);
    assert.equal(drawnRows(container)[2].tabIndex, 0, 'focus was on the grandchild');

    // The grandchild is the match, so its row survives: keeping the focus on
    // it is what a keyboard user expects from a filter box.
    tree.filter('Grand');
    let rows = drawnRows(container);
    assert.equal(rows.length, 3, 'the ancestor chain is still rendered');
    assert.equal(rows.filter((r) => r.tabIndex === 0).length, 1, 'still exactly one tab stop');
    assert.equal(rows[2].tabIndex, 0, 'the focused row stayed put');

    // Now filter to a branch that does not contain the focused row. There is
    // nowhere to keep it, so the tab stop starts over at the first row.
    tree.filter('');
    pressKey(container, 'ArrowDown', drawnRows(container)[0]);
    tree.filter('nomatchatall');
    rows = drawnRows(container);
    assert.equal(rows.length, 0, 'nothing survived this filter');
    tree.filter('Root');
    rows = drawnRows(container);
    assert.equal(rows.filter((r) => r.tabIndex === 0).length, 1);
    assert.equal(rows[0].tabIndex, 0, 'the tab stop starts at the first surviving row');
});

// ---------------------------------------------------------------------------
// Only the tree's own keys may be swallowed (PR #52 review)
//
// A keydown handler that calls preventDefault() for every key reaching a row
// traps the focus: Tab no longer leaves the tree, Ctrl+F no longer opens Find,
// Alt+Left no longer goes Back. The browser owns those, not the tree.
// ---------------------------------------------------------------------------

test('keys the tree does not handle keep their browser default', () => {
    const { container } = treeFixture(NODES);
    const prevented = [];
    const rows = drawnRows(container);
    const before = rows.map((r) => r.tabIndex);

    for (const key of ['Tab', 'PageDown', 'PageUp', 'f', 'A', 'Escape', 'Backspace']) {
        pressKey(container, key, rows[1], {}, prevented);
    }
    assert.deepEqual(prevented, [], 'an unhandled key had its default prevented');
    assert.deepEqual(drawnRows(container).map((r) => r.tabIndex), before,
        'an unhandled key moved the roving tab stop');
});

test('Shift+Tab keeps its default (reverse tab out of the tree)', () => {
    const { container } = treeFixture(NODES);
    const prevented = [];
    const rows = drawnRows(container);
    pressKey(container, 'Tab', rows[0], { shiftKey: true }, prevented);
    assert.deepEqual(prevented, [], 'Shift+Tab was swallowed');
});

test('browser/system chords are not claimed even when the bare key is ours', () => {
    const { container, clicked } = treeFixture(NODES);
    const prevented = [];
    const rows = drawnRows(container);
    const before = rows.map((r) => r.tabIndex);

    // Alt+Left is Back, Ctrl+ArrowDown / Meta+Home are browser shortcuts, and
    // Ctrl+Enter must not open the row. None of them belong to the tree.
    pressKey(container, 'ArrowLeft', rows[0], { altKey: true }, prevented);
    pressKey(container, 'ArrowDown', rows[0], { ctrlKey: true }, prevented);
    pressKey(container, 'Home', rows[1], { metaKey: true }, prevented);
    pressKey(container, 'Enter', rows[1], { ctrlKey: true }, prevented);
    pressKey(container, 'ArrowUp', rows[2], { shiftKey: true }, prevented);

    assert.deepEqual(prevented, [], 'a browser/system chord had its default prevented');
    assert.deepEqual(drawnRows(container).map((r) => r.tabIndex), before,
        'a chord moved the roving tab stop');
    assert.deepEqual(clicked, [], 'a chord activated a row');
});

test('a hidden focused row still lets Tab leave the tree', () => {
    // The pos < 0 recovery branch used to preventDefault() unconditionally:
    // once scripted focus landed on a row a folded ancestor had hidden, even
    // Tab was swallowed. It may re-seat the focus, but must never own the key.
    const { container } = treeFixture([
        { id: 1, pId: 0, name: 'A', open: false },
        { id: 2, pId: 1, name: 'A1' },
    ]);
    const hidden = drawnRows(container)[1]; // still in the DOM, under display:none
    assert.ok(hidden, 'the folded child row was not rendered');
    const prevented = [];
    pressKey(container, 'Tab', hidden, {}, prevented);
    assert.deepEqual(prevented, [], 'Tab was swallowed while recovering from a hidden focus');
});

test('handled keys still prevent the browser default so the page does not scroll', () => {
    const { container } = treeFixture(NODES);
    const prevented = [];
    const rows = drawnRows(container);
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft', 'Enter', ' ', '*']) {
        pressKey(container, key, rows[0], {}, prevented);
    }
    assert.equal(prevented.length, 9, 'a handled key stopped preventing its default');
});

// ---------------------------------------------------------------------------
// collapseVisits() — history2.html's "show less history"
//
// The page's own tests are all e2e (it takes IndexedDB and a real cursor to
// reach this function), so the decision table lives here instead. It is a pure
// function of an ordered list: that is the whole reason it was pulled out of
// the render callback.
// ---------------------------------------------------------------------------

/** A node shaped the way history2.js builds one, with only what this reads. */
const visit = (id, url, opts = {}) => ({
    id,
    url,
    transition: opts.transition || 'link',
});

test('collapseVisits keeps the first visit to each url', () => {
    // The list is newest-first, so "first" is the most recent visit — also the
    // first a later search hits.
    const nodes = [visit(3, 'https://a.test/'), visit(2, 'https://b.test/'), visit(1, 'https://a.test/')];
    const kept = collapseVisits(nodes, {});

    assert.deepEqual(kept.map((n) => n.id), [3, 2]);
    assert.equal(kept[0], nodes[0], 'the kept object is the original, not a copy');
});

test('collapseVisits drops reloads whoever reloaded them', () => {
    const nodes = [
        visit(4, 'https://a.test/', { transition: 'reload' }),
        visit(3, 'https://a.test/'),
        visit(2, 'https://b.test/', { transition: 'reload' }),
    ];
    assert.deepEqual(collapseVisits(nodes, {}).map((n) => n.id), [3],
        'a reload is the same page again, so only the real visit survives');
});

test('collapseVisits leaves a node that someone links to alone', () => {
    // Dropping it would orphan its whole subtree, and its url is NOT recorded:
    // a parent must not shadow the children carrying the same address.
    const nodes = [visit(1, 'https://a.test/'), visit(2, 'https://a.test/')];
    assert.deepEqual(collapseVisits(nodes, { 1: true, 2: true }).map((n) => n.id), [1, 2]);

    // Whereas a node with no children and no parent does shadow a repeat.
    assert.deepEqual(collapseVisits(nodes, { 2: true }).map((n) => n.id), [1, 2]);
    assert.deepEqual(collapseVisits(nodes, {}).map((n) => n.id), [1]);
});

test('collapseVisits lets a parent keep the children carryings its own url', () => {
    // The parent rule is a `return`, not a `continue`: its url must not be
    // recorded, or it would shadow the children below it that were opened from
    // the same address (a page linking to itself). Reading it as "skip this
    // check for parents" is a one-word edit that nothing above would notice —
    // the reference-loop test included, because the loop it mirrors does the
    // same thing and would be changed the same way.
    const nodes = [
        visit(1, 'https://a.test/'),
        visit(2, 'https://a.test/'),
        visit(3, 'https://a.test/'),
    ];
    for (const pIds of [{ 1: true, 2: true, 3: true }, { 1: true, 2: true }, { 1: true, 3: true }]) {
        assert.deepEqual(collapseVisits(nodes, pIds).map((n) => n.id), [1, 2, 3],
            `three rows from one address all survive while they are parents (${Object.keys(pIds)})`);
    }
    // And one root does not: without a parent anywhere, older visits collapse.
    assert.deepEqual(collapseVisits(nodes, {}).map((n) => n.id), [1],
        'with nothing linking to them, only the newest of the three remains');
});

test('collapseVisits keeps its input order and never mutates it', () => {
    const nodes = [visit(9, 'https://c.test/'), visit(8, 'https://a.test/'), visit(7, 'https://b.test/')];
    const before = nodes.slice();
    const kept = collapseVisits(nodes, {});

    assert.deepEqual(nodes, before, 'the caller still holds the full set');
    assert.deepEqual(kept.map((n) => n.url),
        ['https://c.test/', 'https://a.test/', 'https://b.test/'],
        'order drives which occurrence wins, so it must survive');
});

test('collapseVisits on an empty set is an empty set', () => {
    assert.deepEqual(collapseVisits([], {}), []);
});

test('collapseVisits matches the loop it replaced, over random input', () => {
    // The old code spliced in place and re-read the shifted slot. A prior
    // review called that an off-by-one; 20k random cases against it showed zero
    // differences, which is why this is a readability change and not a bug
    // fix. Worth pinning: if they ever disagree, one of the two readings above
    // is wrong.
    const reference = (input, pIds) => {
        const list = input.slice();
        const urls = {};
        for (let s = 0; s < list.length; s++) {
            let ss = list[s];
            while (pIds[ss.id] != true) {
                if (ss.transition == 'reload' || urls[ss.url] == true) {
                    list.splice(s, 1);
                } else {
                    urls[ss.url] = true;
                    break;
                }
                if (s < list.length) ss = list[s];
                else break;
            }
        }
        return list;
    };

    const urlPool = ['https://a.test/', 'https://b.test/', 'https://c.test/'];
    let seed = 20260701;
    const rnd = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };

    for (let run = 0; run < 2000; run++) {
        const nodes = Array.from({ length: rnd(9) }, (_, i) => visit(
            i + 1,
            urlPool[rnd(urlPool.length)],
            { transition: rnd(4) === 0 ? 'reload' : 'link' },
        ));
        // Half the ids are "linked to": that is the interesting branch, and it
        // is also what stops the loop early.
        const pIds = {};
        for (const n of nodes) {
            if (rnd(2) === 0) pIds[n.id] = true;
        }

        assert.deepEqual(
            collapseVisits(nodes, pIds).map((n) => n.id),
            reference(nodes, pIds).map((n) => n.id),
            `case ${run}: ${JSON.stringify(nodes)} ${JSON.stringify(pIds)}`,
        );
    }
});
