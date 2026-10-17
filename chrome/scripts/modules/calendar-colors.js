// Tree Style History - Calendar heat-map colours
//
// Split out of calendar.js so history-core.js can paint the selected day
// without importing calendar.js: that module imports `history` from
// history-core.js, and the reverse edge would close a cycle. This module
// depends on neither — it owns the tier-to-colour mapping and the two DOM
// writes, nothing else.

import { calendarLevel } from './shared/calendar-storage.js';

// Indexed by calendarLevel(). Light to dark; index 0 means "no colour".
var LEVEL_COLORS = [null, '#daf3cb', '#aade8a', '#6dc738', '#4e991f'];

/**
 * Paint `link` for a day holding `n` history rows.
 *
 * This replaced four if/else branches written out twice in calendar.js —
 * once for the selected cell and once for all the others — plus a third copy
 * inline in history-core.js. The thresholds now live in exactly one place
 * (calendarLevel()) and so does the colour they map to.
 *
 * A level-0 day clears `style` rather than leaving it alone: the selected cell
 * previously got its colour from an inline write in history(), so "day has no
 * rows" had to actively undo that or the cell kept a stale green.
 */
export function paintDay(link, n) {
    if (link == undefined || link.style == undefined) return;
    var level = calendarLevel(n);
    if (level == 0) {
        link.style.backgroundColor = '';
        link.style.color = '';
        return;
    }
    link.style.backgroundColor = LEVEL_COLORS[level];
    // Only the two darkest tiers switch to white text; the lighter two keep
    // the default dark foreground.
    link.style.color = level > 2 ? '#fff' : '';
}

/** Paint the day the calendar currently has selected, if there is one. */
export function paintSelectedDay(n) {
    paintDay(document.querySelector('#calendar-days a#selected'), n);
}
