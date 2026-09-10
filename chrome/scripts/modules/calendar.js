// Tree Style History - Calendar Module
// Calendar/date picker related functions extracted from func.js
//
// `calendar_storage2` / `save_calendar_storage2` live in
// `modules/shared/calendar-storage.js` — the dependency-free bottom layer that
// `scripts/gen-sw-utils.mjs` also flattens into `scripts/background-utils.js`.
// Re-exported here so the public API stays unchanged; modules that only need
// them should import the bottom layer directly rather than route through this
// one, which depends on history-core.js.

import { $, $$, createElement } from '../dom-helper.js';
import { history } from './history-core.js';
import { calendar_storage2, save_calendar_storage2 } from './shared/calendar-storage.js';

// --- Calendar storage ---

export { calendar_storage2, save_calendar_storage2 };

// --- Leap year ---

function isLeapYear() {
    var select = $('date-select-year');
    if (!select || !select.options || select.options.length === 0) return false;
    var selectedOption = select.options[select.selectedIndex];
    if (!selectedOption) return false;
    var year = Number(selectedOption.value);
    return (year % 400 == 0 || (year % 100 != 0 && year % 4 == 0));
}

// --- Show/hide calendar ---

function showCalendar() {
    var cal = document.querySelector('#calendar');
    if (cal) {
        if (cal.style.display == 'none') {
            cal.style.display = 'inline';
        } else {
            cal.style.display = 'none';
        }
    }
}

// --- Date picker ---

function calendar(w, e, clickCallback) {
    var i, ia, ii, d, mi;

    // Helper to call the appropriate click handler
    function calendarClickHandler() {
        if (typeof clickCallback === 'function') {
            clickCallback();
        } else {
            history('yes', '');
        }
    }

    if (isLeapYear()) {
        var dayarray = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    } else {
        dayarray = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    }

    if (w == 'current') {
        var cdateo = new Date();
    } else if (w == 'selected' || w == 'yes') {
        var monthSelect = $('date-select-month');
        var daySelect = $('date-select-day');
        var yearSelect = $('date-select-year');
        var mcheck = dayarray[(Number(monthSelect.options[monthSelect.selectedIndex].value) - 1)];
        var dcheck = Number(daySelect.options[daySelect.selectedIndex].value);
        if (mcheck < dcheck) {
            cdateo = new Date(Number(yearSelect.options[yearSelect.selectedIndex].value), (Number(monthSelect.options[monthSelect.selectedIndex].value) - 1), mcheck, 23, 59, 59, 999);
        } else {
            cdateo = new Date(Number(yearSelect.options[yearSelect.selectedIndex].value), (Number(monthSelect.options[monthSelect.selectedIndex].value) - 1), Number(daySelect.options[daySelect.selectedIndex].value), 23, 59, 59, 999);
        }
    }

    if (e == 'prev') {
        cdateo.setDate(cdateo.getDate() - 1);
    } else if (e == 'next') {
        cdateo.setDate(cdateo.getDate() + 1);
    }

    $('date-select-day').innerHTML = '';
    var ydatec = new Date().getFullYear();
    var mdatec = cdateo.getMonth();
    var ddatec = cdateo.getDate();
    var yeararray = [ydatec, (ydatec - 1)];

    if (w == 'current') {
        for (i = 0; i < yeararray.length; i++) {
            var opt = createElement('option', { 'value': yeararray[i], 'text': yeararray[i] });
            if (i == 0) {
                opt.selected = true;
            }
            $('date-select-year').appendChild(opt);
        }
    }

    var monthOptions = $$('#date-select-month option');
    for (mi = 0; mi < monthOptions.length; mi++) {
        if ((mdatec) + 1 == Number(monthOptions[mi].value)) {
            monthOptions[mi].selected = true;
        }
    }

    for (i = 0; i <= dayarray.length; i++) {
        if (mdatec == i) {
            for (ia = 1; ia <= dayarray[i]; ia++) {
                var iaStr = ia + '';
                if (iaStr.length == 1) {
                    iaStr = '0' + iaStr;
                }
                opt = createElement('option', { 'value': iaStr, 'text': iaStr });
                if (ia == ddatec) {
                    opt.selected = true;
                }
                $('date-select-day').appendChild(opt);
            }
        }
    }

    var fday = new Date(ydatec, mdatec, 1, 23, 59, 59, 999).getDay();
    var lday = new Date(ydatec, mdatec, dayarray[mdatec], 23, 59, 59, 999).getDay();

    $('calendar-days').textContent = '';

    for (ii = 0; ii < dayarray[mdatec]; ii++) {
        if (ii == 0) {
            for (d = 0; d < fday; d++) {
                $('calendar-days').appendChild(createElement('span', { html: '&nbsp;', 'class': 'day' }));
            }
        }
        if ((ii + 1) == ddatec) {
            var dayLink = createElement('a', {
                id: 'selected',
                href: '#',
                rel: (ii + 1) + '|' + (mdatec + 1) + '|' + ydatec,
                text: (ii + 1),
                'class': 'day'
            });
            dayLink.addEventListener('click', function () {
                var cel = this;
                var di;
                var dayOptions = $$('#date-select-day option');
                for (di = 0; di < dayOptions.length; di++) {
                    if (parseInt(dayOptions[di].value, 10) == parseInt(cel.textContent, 10)) {
                        dayOptions[di].selected = true;
                    } else {
                        dayOptions[di].selected = false;
                    }
                }
                var selectedLink = document.querySelector('#calendar-days a#selected');
                if (selectedLink) selectedLink.removeAttribute('id');
                cel.id = 'selected';
                calendarClickHandler();
            });
            $('calendar-days').appendChild(dayLink);
        } else {
            let _time = new Date(ydatec, mdatec, ii, 23, 59, 59, 999).getTime();
            // -86400000
            let rhat = calendar_storage2[_time];
            let style = '';

            // An unknown day count simply has no style: every range test below
            // is false for undefined, so it falls through untouched.
            if (rhat > 0 && rhat < 50) {
                style = ('background-color:#daf3cb');
            } else if (rhat > 49 && rhat < 100) {
                style = ('background-color:#aade8a');
            } else if (rhat > 99 && rhat < 150) {
                style = ('background-color:#6dc738');
            } else if (rhat >= 150) {
                style = ('background-color:#4e991f');
            }

            dayLink = createElement('a', {
                href: '#',
                text: (ii + 1),
                'class': 'day',
                'style': style
            });
            dayLink.addEventListener('click', function () {
                var cel = this;
                var di;
                var dayOptions = $$('#date-select-day option');
                for (di = 0; di < dayOptions.length; di++) {
                    if (parseInt(dayOptions[di].value, 10) == parseInt(cel.textContent, 10)) {
                        dayOptions[di].selected = true;
                    } else {
                        dayOptions[di].selected = false;
                    }
                }
                var selectedLink = document.querySelector('#calendar-days a#selected');
                if (selectedLink) selectedLink.removeAttribute('id');
                cel.id = 'selected';
                calendarClickHandler();
            });
            $('calendar-days').appendChild(dayLink);
        }
        if ((ii + 1) == dayarray[mdatec]) {
            for (d = 0; d < (6 - lday); d++) {
                $('calendar-days').appendChild(createElement('span', { html: '&nbsp;', 'class': 'day' }));
            }
        }
    }

}

// --- Exports ---
// `calendar_storage2` / `save_calendar_storage2` are re-exported at the top of
// this file, alongside the `import` that brings them in from the shared layer.
export {
    isLeapYear,
    calendar,
    showCalendar
};