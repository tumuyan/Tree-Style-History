// Tree Style History - per-page bootstrap
//
// Every page does the same three things before it renders anything, and this
// module is where they now live:
//
//   1. fill `.lang` elements from the i18n catalogue;
//   2. apply the user's zoom (popup and full pages store it separately);
//   3. swallow clicks on placeholder `href="#"` links.
//
// It replaces what func.js did globally as a side effect of being imported.
// That layer mounted ~60 symbols onto `window` so classic page scripts could
// call them as bare globals; the page scripts are ES modules now and import
// what they use, so nothing has to be mounted.

import { $$, $ } from '../dom-helper.js';
import { returnLang, getVersion, getVersionType } from './helpers.js';

/**
 * Fill every `.lang` element with its message.
 *
 * Safe to call more than once: re-rendering after a language change is exactly
 * the case it exists for.
 */
function fillLangStrings() {
    Array.from($$('.lang')).forEach(function (el) {
        el.innerHTML = returnLang(el.getAttribute('data-lang-string'));
    });
    // Placeholders and a11y labels are text too, so they go through the same
    // catalogue as `.lang` instead of being hard-coded English in the HTML.
    Array.from($$('[data-lang-placeholder]')).forEach(function (el) {
        el.setAttribute('placeholder', returnLang(el.getAttribute('data-lang-placeholder')));
    });
    Array.from($$('[data-lang-aria-label]')).forEach(function (el) {
        el.setAttribute('aria-label', returnLang(el.getAttribute('data-lang-aria-label')));
    });
}

/**
 * Apply `popup-zoom` or `page-zoom`, whichever belongs to this document.
 *
 * Waits for `onStorageReady`, not merely for DOMContentLoaded: DOMContentLoaded
 * fires *before* storage-adapter.js has its cache, so zoom is read as
 * `undefined` and the page silently renders at 100%. It is the only one of the
 * three bootstrap steps that reads storage, so it is the only one that has to
 * wait.
 */
function applyZoom() {
    // The popup marks itself with an element no other page has.
    var zoomKey = $('popup') ? 'popup-zoom' : 'page-zoom';
    onStorageReady(function () {
        var zoom = parseInt(localStorage[zoomKey], 10);
        if (!isNaN(zoom) && zoom !== 100) {
            document.body.style.zoom = zoom + '%';
        }
    });
}

// Placeholder links: without this every `href="#"` jumps to the top of the
// page. One delegated listener on `document`, because rows are rendered after
// load and re-rendered on every filter.
function swallowHashClicks() {
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('a[href="#"]')) {
            e.preventDefault();
        }
    });
}

// Every page script calls this once, on import. The work itself waits for
// DOMContentLoaded — except applyZoom(), which additionally waits for the
// storage cache, see above.
export function initPage() {
    document.addEventListener('DOMContentLoaded', function () {
        applyZoom();
        fillLangStrings();
        swallowHashClicks();
    });
    console.log('Tree Style History v' + getVersion() + ' (' + getVersionType() + ')');
}
