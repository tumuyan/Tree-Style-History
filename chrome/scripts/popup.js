// Tree Style History - popup bootstrap
//
// An ES module: everything it calls is imported, so nothing here depends on a
// `window.*` mount having happened first. See modules/page-init.js for the
// i18n/zoom/placeholder-link setup every page shares.

import { $, $$, createElement } from './dom-helper.js';
import { returnLang, chromeURL, getVersion } from './modules/helpers.js';
import {
    alertUser, recentHistory, recentlyClosedTabs, recentBookmarks,
    mostVisited, showRecentTabs, popupSearch
} from './modules/popup-core.js';
import { modifierState } from './modules/ui-state.js';
import { initPage } from './modules/page-init.js';

initPage();

var _popupStartTime = window._htmlStartTime || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {
        const storageReadyTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        console.info('[Popup] Storage ready at', (storageReadyTime - _popupStartTime).toFixed(1) + 'ms');

        // Updated/Installed
        //
        // The banner is shown now, but the flag is written at the end of this
        // callback: `localStorage[...] = ...` goes through
        // chrome.storage.local.set(), and the service worker has a
        // chrome.storage.onChanged listener, so every write wakes it and starts
        // the startup crawl. It happens once per version, but it must not sit in
        // front of the render calls below. The one exception is the redirect
        // further down, which ends this callback before the deferred write.

        var versionKey = 'rh-version-' + getVersion();
        var showInstallNotice = localStorage[versionKey] !== 'true';

    if (showInstallNotice) {
        alertUser(returnLang('successfullyInstalled') + '<span>v' + getVersion() + '</span>', 'open');
    }

    // if (localStorage['show-popup'] != 'yes') {
    //     window.open("history2.html");
    //     window.close();
    // }

    // A switch used to stand here, but every arm is the same two calls and each
    // one ends this callback with window.close(). Collapsed to a lookup so the
    // version flag can be written *before* the jump: the deferred write at the
    // end of this callback is never reached once the popup closes itself.
    var redirectPage = {
        history2: 'history2.html',
        history: 'history.html',
        closed: 'closed.html',
        bookmark: 'bookmark.html',
        options: 'options.html',
    }[localStorage['show-popup']];

    if (redirectPage) {
        if (showInstallNotice) { localStorage[versionKey] = 'true'; }
        window.open(redirectPage);
        window.close();
    }


    // Ctrl listener

    document.body.addEventListener('keydown', function (e) {
        if (e.keyCode == 17 && !modifierState.ctrl) {
            modifierState.ctrl = true;
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 17) {
            modifierState.ctrl = false;
        }
    });

    // Popup structure

    // Parsed once and reused for the init pass below: the storage value is
    // absent until the very first save, and an empty string splits into ['']
    // which would still be walked as a (harmless) unknown block.
    var rhporder = (localStorage['rh-list-order'] || '').split(',').filter(Boolean);

    for (var o in rhporder) {
        if (rhporder[o] == 'rh-order') {
            if (Number(localStorage['rh-itemsno']) > 0) {
                var el = createElement('div', { id: 'rh-inject', html: '<div id="rh-inject-title" class="popup-title"><span>' + returnLang('recentHistory') + '    - <a href="#"  id="show-all-history" target="_blank">' + returnLang('more') + '🕑</a></span></div>' });
                $('popup-insert').appendChild(el);
            }
        } else if (rhporder[o] == 'rct-order') {
            if (Number(localStorage['rct-itemsno']) > 0 ) {
                if (navigator.userAgent.toLowerCase().indexOf('edg') > 0) {
                    el = createElement('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '    - <a href="#"  id="show-all-closed" target="_blank">' + returnLang('more') + '...</a></span></div>' });
                    $('popup-insert').appendChild(el);
                } else {
                    el = createElement('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '</span></div>' });
                    $('popup-insert').appendChild(el);
                }
            }
        } else if (rhporder[o] == 'rb-order') {
            if (Number(localStorage['rb-itemsno']) > 0) {
                el = createElement('div', { id: 'rb-inject', html: '<div id="rb-inject-title" class="popup-title"><span>' + returnLang('recentBookmarks') + '    - <a href="#"  id="show-all-bookmark" target="_blank">' + returnLang('more') + '...</a></span></div>' });
                $('popup-insert').appendChild(el);
            }
        } else if (rhporder[o] == 'mv-order') {
            if (Number(localStorage['mv-itemsno']) > 0) {
                el = createElement('div', { id: 'mv-inject', html: '<div id="mv-inject-title" class="popup-title"><span>' + returnLang('mostVisited') + '</span></div>' });
                $('popup-insert').appendChild(el);
            }
        }  else if (rhporder[o] == 'rt-order') {
            // rt = recent tab
            if (Number(localStorage['rt-itemsno']) > 0) {
                // 只创建HTML元素，不立即调用showRecentTabs函数
                el = createElement('div', { id: 'rt-inject', html: '<div id="rt-inject-title" class="popup-title"><span>' + returnLang('recentTabs') + '</span></div>' });
                $('popup-insert').appendChild(el);
            }
        }
    }

    // Assign events

    if ($('show-all-history') != undefined)
        $('show-all-history').addEventListener('click', function (e) {
            e.preventDefault();
            if (localStorage['rm-click'] == 'this')
                chromeURL('/history2.html');
            else
                chromeURL('chrome://history/');
        });

    if ($('show-all-bookmark') != undefined)
        $('show-all-bookmark').addEventListener('click', function (e) {
            e.preventDefault();
            if (localStorage['rm-click'] == 'this')
                chromeURL('/bookmark.html');
            else
                chromeURL('chrome://favorites/');
        });

    if ($('show-all-closed') != undefined)
        $('show-all-closed').addEventListener('click', function (e) {
            e.preventDefault();
            if (localStorage['rm-click'] == 'this')
                chromeURL('/closed.html');
            else
                chromeURL('chrome://history/recentlyClosed');
        });

    // Popup init

    // -- Insert - 按照rh-list-order的顺序填充数据
    for (o in rhporder) {
        if (rhporder[o] == 'rh-order' && $('rh-inject')) { recentHistory(); }
        else if (rhporder[o] == 'rct-order' && $('rct-inject')) { recentlyClosedTabs(); }
        else if (rhporder[o] == 'rb-order' && $('rb-inject')) { recentBookmarks(); }
        else if (rhporder[o] == 'mv-order' && $('mv-inject')) { mostVisited(); }
        else if (rhporder[o] == 'rt-order' && $('rt-inject')) { 
            showRecentTabs();
        }
    }

    // $$("#rt-inject-title .item[target]").each(function (el, i) {
    //     if (i !== 0) {
    //         el.addEvent('click', function () {
    //             openTab(el.tabId);
    //         });
    //     }
    // });
    
    

    // -- Functions
    Array.from($$('.favicon')).forEach(function(el) {
        el.addEventListener('error', function () {
            this.src = 'images/blank.png';
        });
    });

    // -- Width
    document.body.style.width = localStorage['rh-width'];

    // -- Titles
    Array.from($$('.popup-title')).forEach(function (el, i) {
        if (i !== 0) {
            el.style.marginTop = '6px';
        }
    });

    // -- Search
    if (localStorage['rh-search'] == 'yes') {
        $('popup-search-input').addEventListener('keyup', function () {
            var sv = this.value;
            if (sv.length + sv.replace(/[0-9a-zA-Z]+/g, '').length >= 2) {
                popupSearch(sv);
                $('popup-insert').style.display = 'none';
                $('popup-search-insert').style.display = 'block';
            } else {
                $('popup-insert').style.display = 'block';
                $('popup-search-insert').style.display = 'none';
            }
        });
        $('popup-search-clear').addEventListener('click', function () {
            $('popup-search-input').value = '';
            $('popup-search-input').focus();
            $('popup-insert').style.display = 'block';
            $('popup-search-insert').style.display = 'none';
            $('popup-search-insert').textContent = '';
        });
        $('popup-search-input').focus();
    } else {
        $('popup-header').style.display = 'none';
        if ($$('.popup-title').length > 0) {
            $$('.popup-title')[0].style.marginTop = '10px';
        }
    }

    // -- Alert holder
    $('alert-holder').addEventListener('click', function () {
        this.style.display = 'none';
    });

    // -- Deferred write, see "Updated/Installed" above
    if (showInstallNotice) {
        localStorage[versionKey] = 'true';
    }

    // -- Scrollbar fix
    //popup_scrollbar_fix.periodical(250);

    });

    const popupEndTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    console.info('[Popup] Total popup load time:', (popupEndTime - _popupStartTime).toFixed(1) + 'ms');
});
