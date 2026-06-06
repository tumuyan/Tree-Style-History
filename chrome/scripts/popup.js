
var _popupStartTime = window._htmlStartTime || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {
        const storageReadyTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        console.info('[Popup] Storage ready at', (storageReadyTime - _popupStartTime).toFixed(1) + 'ms');

        // Updated/Installed

    if (localStorage['rh-version-' + getVersion()] !== 'true') {
        alertUser(returnLang('successfullyInstalled') + '<span>v' + getVersion() + '</span>', 'open');
        localStorage['rh-version-' + getVersion()] = 'true';
    }

    // if (localStorage['show-popup'] != 'yes') {
    //     window.open("history2.html");
    //     window.close();
    // }

    switch (localStorage['show-popup']) {
        case 'history2':
            window.open("history2.html");
            window.close();
            break;
        case 'history':
            window.open("history.html");
            window.close();
            break;

        case 'closed':
            window.open("closed.html");
            window.close();
            break;

        case 'bookmark':
            window.open("bookmark.html");
            window.close();
            break;

        case 'options':
            window.open("options.html");
            window.close();
            break;

    }


    // Ctrl listener

    document.body.addEventListener('keydown', function (e) {
        if (e.keyCode == 17 && ctrlState == 'false') {
            ctrlState = 'true';
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 17) {
            ctrlState = 'false';
        }
    });

    // Popup structure

    var rhporder = localStorage['rh-list-order'].split(',');

    for (var o in rhporder) {
        if (rhporder[o] == 'rh-order') {
            if (Number(localStorage['rh-itemsno']) > 0) {
                var el = createElement('div', { id: 'rh-inject', html: '<div id="rh-inject-title" class="popup-title"><span>' + returnLang('recentHistory') + '    - <a href="#"  id="show-all-history" target="_blank">' + returnLang('more') + '🕑</a></span></div>' });
                $('popup-insert').appendChild(el);
            }
        } else if (rhporder[o] == 'rct-order') {
            if (Number(localStorage['rct-itemsno']) > 0 ) {
                if (navigator.userAgent.toLowerCase().indexOf('edg') > 0) {
                    var el = createElement('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '    - <a href="#"  id="show-all-closed" target="_blank">' + returnLang('more') + '...</a></span></div>' });
                    $('popup-insert').appendChild(el);
                } else {
                    var el = createElement('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '</span></div>' });
                    $('popup-insert').appendChild(el);
                }
            }
        } else if (rhporder[o] == 'rb-order') {
            if (Number(localStorage['rb-itemsno']) > 0) {
                var el = createElement('div', { id: 'rb-inject', html: '<div id="rb-inject-title" class="popup-title"><span>' + returnLang('recentBookmarks') + '    - <a href="#"  id="show-all-bookmark" target="_blank">' + returnLang('more') + '...</a></span></div>' });
                $('popup-insert').appendChild(el);
            }
        } else if (rhporder[o] == 'mv-order') {
            if (Number(localStorage['mv-itemsno']) > 0) {
                var el = createElement('div', { id: 'mv-inject', html: '<div id="mv-inject-title" class="popup-title"><span>' + returnLang('mostVisited') + '</span></div>' });
                $('popup-insert').appendChild(el);
            }
        }  else if (rhporder[o] == 'rt-order') {
            // rt = recent tab
            if (Number(localStorage['rt-itemsno']) > 0) {
                // 只创建HTML元素，不立即调用showRecentTabs函数
                var el = createElement('div', { id: 'rt-inject', html: '<div id="rt-inject-title" class="popup-title"><span>' + returnLang('recentTabs') + '</span></div>' });
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
    var rhporder = localStorage['rh-list-order'].split(',');
    
    for (var o in rhporder) {
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

    // -- Scrollbar fix
    //popup_scrollbar_fix.periodical(250);

    });

    const popupEndTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    console.info('[Popup] Total popup load time:', (popupEndTime - _popupStartTime).toFixed(1) + 'ms');
});
