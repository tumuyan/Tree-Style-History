// Per-page UI state that crosses a file boundary without crossing a realm.
//
// These three used to be `window.shiftState` / `window.ctrlState` /
// `window.itemSelectedColor`, installed by func.js and read as bare globals.
// In an ES module every file that imports this one shares the same instance,
// so the values reach their consumers exactly as before — except that the
// reads are now statically resolvable, and a typo is a lint error instead of
// an `undefined` that quietly disables shift-range selection.

// Held in one object rather than three exports: an ES module binding is
// read-only to its importers, so the writers need a mutable target.
export const modifierState = {
    shift: false, // written by keydown/keyup in history.js, history2.js, closed.js, bookmark.js
    ctrl: false, // written by keydown/keyup in popup.js
};

// Marks a row as selected. history-core.js and bookmark.js each carried their
// own literal, which is how they drifted into different shades.
export const ITEM_SELECTED_COLOR = '#ffcbd3';
