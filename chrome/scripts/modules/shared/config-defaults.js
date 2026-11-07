// Shared config defaults — single source of truth for background-utils.js.
//
// This file is part of `modules/shared/`, the dependency-free bottom layer that
// is mechanically concatenated (minus import/export markers) into
// `scripts/background-utils.js` by `scripts/gen-sw-utils.mjs`. Do NOT edit the
// generated `background-utils.js` by hand; change it here and regenerate.

export var defaultValues = {
    "rh-itemsno": 16,
    "rct-itemsno": 4,
    "rt-itemsno": 6,
    "mv-itemsno": 0,
    "rb-itemsno": 3,
    "mv-blocklist": "false",
    "rh-historypage": "yes",
    "rh-date": "mm/dd/yyyy",
    "rh-width": "275px",
    "load-range": 7,
    "load-range2": 3,
    "load-range3": 120,
    "load-range4": 150,
    "less-item": "no",
    "rh-search": "yes",
    "rh-list-order": "rh-order,rct-order,rb-order,mv-order,rt-order",
    "rh-group": "yes",
    "rh-orderby": "date",
    "rh-order": "desc",
    "rh-timeformat": "24",
    "rh-click": "newtab",
    "rm-click": "default",
    "rm-path": "yes",
    'use-contextmenu': "yes",
    "rh-filtered": "false",
    "rh-pinned": "false",
    "rhs-showurl": "no",
    "rhs-showsep": "no",
    "rhs-showext": "no",
    "show-popup": "yes",
    "favicon-service": "duckduckgo",
    "share-favicon-cache": "yes",
    "favicon-service-fallback": "",
    "popup-zoom": 100,
    "page-zoom": 100
};

export function defaultConfig(clean) {
    // Before the initial snapshot lands, getItem() answers `undefined` for
    // every key. Filling those "misses" would not just be redundant: the
    // writes are replayed over the snapshot at completion (see _pendingWrites),
    // so real, saved settings would be overwritten with defaults and persisted.
    // Every production caller runs inside onStorageReady(); this guard keeps a
    // caller that lands in the unready window from clobbering anything.
    if (!clean && !storageAdapter.isReady()) return;
    for (var v in defaultValues) {
        var current = storageAdapter.getItem(v);
        if (clean || !current || current == null || current == '') {
            storageAdapter.setItem(v, defaultValues[v]);
        }
    }
}
