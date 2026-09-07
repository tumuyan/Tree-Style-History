// ESLint flat config for Tree Style History (Chrome MV3 extension).
//
// Design notes:
//  * The extension has no build step: files under chrome/ are shipped as-is.
//    Lint must therefore match what the browser actually executes, i.e. two
//    distinct source types coexist:
//      - classic scripts  (chrome/scripts/*.js)        sourceType: "script"
//      - ES modules       (func.js, dom-helper.js, modules/*.js)
//  * Third-party/ vendored files are ignored (see `ignores`).
//  * Rule selection favours "would have caught a real bug" over style.
//    Rules that would trigger a large stylistic diff (eqeqeq, no-implicit-coercion,
//    no-implicit-globals) are intentionally OFF: churning thousands of lines in a
//    shipped extension without tests is exactly the "越改越错" risk we avoid.

import globals from 'globals';

// Functions/objects that cross file boundaries.
//
// func.js attaches module exports onto `window`, and the classic page scripts
// (popup.js / history.js / history2.js / closed.js / bookmark.js / options.js)
// call them as bare globals. background-sw.js pulls more in via importScripts().
// None of this is statically analysable, so it is declared here.
//
// IMPORTANT: if you add a new export to modules/*.js and mount it in func.js,
// add it here too, otherwise `no-undef` will report a false positive.
const crossFileGlobals = {
    // --- injected by storage-adapter.js ---
    dbManager: 'writable',
    storageAdapter: 'writable',
    localStorageAdapter: 'writable',
    messageAdapter: 'writable',
    onStorageReady: 'writable',

    // --- dom-helper.js ---
    $: 'writable',
    $$: 'writable',
    createElement: 'writable',
    emptyElement: 'writable',
    getStyle: 'writable',

    // --- modules/helpers.js ---
    _DATE: 'writable',
    DAY: 'writable',
    TimeToStr: 'writable',
    timeNow: 'writable',
    formatDate: 'writable',
    echoLang: 'writable',
    returnLang: 'writable',
    stripScripts: 'writable',
    escapeHtmlAttr: 'writable',
    escapeHtmlText: 'writable',
    truncate: 'writable',
    extractFileName: 'writable',
    calcSize: 'writable',
    getUrlVars: 'writable',
    isBookmarkletUrl: 'writable',
    extractBookmarkletCode: 'writable',
    decodeBookmarkletCode: 'writable',
    executeBookmarklet: 'writable',
    chromeURL: 'writable',
    getVersion: 'writable',
    getVersionType: 'writable',
    Clipboard: 'writable',
    popup_scrollbar_fix: 'writable',
    get_host: 'writable',
    getFaviconUrl: 'writable',
    getFaviconOnerror: 'writable',
    setupFaviconElement: 'writable',

    // --- modules/config.js ---
    defaultValues: 'writable',
    defaultConfig: 'writable',
    loadOptions: 'writable',
    saveOptions: 'writable',
    downloadOptions: 'writable',
    loadSlider: 'writable',
    loadOptionsLang: 'writable',
    initSortable: 'writable',
    previewItem: 'writable',
    mostVisitedBlocklist: 'writable',
    filteredDomainsList: 'writable',
    addFilteredItem: 'writable',
    addList: 'writable',
    mergeList: 'writable',
    updateFilter: 'writable',
    filtUrl: 'writable',

    // --- modules/calendar.js ---
    calendar_storage2: 'writable',
    isLeapYear: 'writable',
    calendar: 'writable',
    showCalendar: 'writable',
    save_calendar_storage2: 'writable',

    // --- modules/popup-core.js ---
    leftClick: 'writable',
    rightClick: 'writable',
    formatItem: 'writable',
    popupSearch: 'writable',
    isBookmarked: 'writable',
    isPinned: 'writable',
    uiEditItems: 'writable',
    alertUser: 'writable',
    uiPinItem: 'writable',
    uiDeleteItem: 'writable',
    recentHistory: 'writable',
    recentlyClosedTabs: 'writable',
    openTab: 'writable',
    showRecentTabs: 'writable',
    showRecentTabsImpl: 'writable',
    mostVisited: 'writable',
    recentBookmarks: 'writable',
    pinned: 'writable',

    // --- modules/history-core.js ---
    historyView: 'writable',
    toggleGroup: 'writable',
    getActiveHistory: 'writable',
    getMoreItems: 'writable',
    resetColor: 'writable',
    selectHistoryItem: 'writable',
    deleteHistoryItem: 'writable',
    alertUserHistory: 'writable',
    alertLoadingHistory: 'writable',

    // --- shared mutable state declared in func.js ---
    ctrlState: 'writable',
    shiftState: 'writable',
    itemSelectedColor: 'writable',

    // --- vendored libraries loaded via <script> ---
    jQuery: 'writable',
    fuzzySearch: 'writable',

    // --- UMD guard in db-manager.js (dead branch in the browser) ---
    module: 'readonly',
};

export default [
    {
        ignores: [
            'node_modules/**',
            // Vendored third-party code — do not lint, do not edit.
            'chrome/scripts/jquery-3.6.0.min.js',
            'chrome/scripts/jquery.ztree.core.js',
            'chrome/scripts/jquery.ztree.exhide.js',
            'chrome/scripts/fuzzysearch.js',
        ],
    },

    // ---------------------------------------------------------------------
    // Base config: everything under chrome/scripts
    // ---------------------------------------------------------------------
    {
        files: ['chrome/scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.serviceworker,
                ...crossFileGlobals,
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'warn',
        },
        rules: {
            // ---- correctness: these catch real defects ----
            'no-undef': 'error',
            // `no-redeclare` is a warning, not an error: re-declaring `var` in the
            // same scope is legal JS and harmless at runtime. There are ~90 such
            // sites; failing the build on them would drown out real defects.
            // Tighten to "error" once the backlog is cleaned up.
            'no-redeclare': 'warn',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-dupe-class-members': 'error',
            'no-unreachable': 'error',
            'no-self-assign': 'error',
            'no-cond-assign': 'error',
            'no-constant-condition': 'error',
            'no-fallthrough': 'error',
            'no-sparse-arrays': 'error',
            'no-unsafe-negation': 'error',
            'no-obj-calls': 'error',
            'no-global-assign': 'error',
            'no-extra-boolean-cast': 'error',
            'no-return-assign': 'error',
            'no-throw-literal': 'error',
            'no-sequences': 'off',
            'valid-typeof': 'error',
            'use-isnan': 'error',
            'array-callback-return': 'warn',
            'require-atomic-updates': 'warn',

            // ---- dead code / hygiene (visible but non-blocking) ----
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-console': 'off', // the SW relies on console for diagnostics

            // ---- deliberately OFF: style-only, would cause mass churn ----
            eqeqeq: 'off',
            'no-implicit-coercion': 'off',
            'no-implicit-globals': 'off',
            'no-var': 'off',
            'prefer-const': 'off',
            'no-plusplus': 'off',
            'no-multi-spaces': 'off',
            indent: 'off',
            quotes: 'off',
            semi: 'off',
        },
    },

    // ---------------------------------------------------------------------
    // ES modules: strict by definition, imports are statically known, so
    // `no-undef` is fully reliable here. This is where the crash-level bugs
    // (undeclared `ve` / `i` / `fbl`) get caught.
    // ---------------------------------------------------------------------
    {
        files: [
            'chrome/scripts/func.js',
            'chrome/scripts/dom-helper.js',
            'chrome/scripts/modules/*.js',
            'chrome/scripts/modules/shared/*.js',
        ],
        languageOptions: {
            sourceType: 'module',
        },
        rules: {
            // In a module, an assignment to an undeclared identifier is a
            // guaranteed ReferenceError at runtime (strict mode).
            'no-undef': 'error',
        },
    },

    // ---------------------------------------------------------------------
    // Service worker: additional globals from the SW global scope.
    // ---------------------------------------------------------------------
    {
        files: ['chrome/scripts/background-sw.js'],
        languageOptions: {
            globals: {
                ...globals.serviceworker,
                importScripts: 'readonly',
                // pulled in via importScripts()
                defaultConfig: 'readonly',
                dbManager: 'writable',
                onStorageReady: 'readonly',
            },
        },
    },

    // ---------------------------------------------------------------------
    // Repo tooling: the Node scripts that both CIs invoke (npm run verify:*).
    // Plain Node ESM with no browser globals.
    // ---------------------------------------------------------------------
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },

    // ---------------------------------------------------------------------
    // End-to-end smoke tests (needs a real browser, see npm run test:e2e).
    //
    // Kept out of `tests/**` on purpose: `npm test` must stay runnable in the
    // bare node:22 CI image, which has no browser. If playwright is missing
    // the suite self-skips rather than failing the install-less run.
    // ---------------------------------------------------------------------
    {
        files: ['e2e/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
                // Injected into the page, not the runner: page.evaluate() bodies
                // run inside the extension, where chrome.* is a global.
                chrome: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },

    // ---------------------------------------------------------------------
    // Test files (Node, zero-dependency node:test)
    // ---------------------------------------------------------------------
    {
        files: ['tests/**/*.mjs', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
];
