
document.addEvent('domready', function () {

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

    $(document.body).addEvent('keydown', function (e) {
        if (e.event.keyCode == 17 && ctrlState == 'false') {
            ctrlState = 'true';
        }
    });
    $(document.body).addEvent('keyup', function (e) {
        if (e.event.keyCode == 17) {
            ctrlState = 'false';
        }
    });

    // Popup structure

    var rhporder = localStorage['rh-list-order'].split(',');

    for (var o in rhporder) {
        if (rhporder[o] == 'rh-order') {
            if ((localStorage['rh-itemsno'] * 1) > 0) {
                new Element('div', { id: 'rh-inject', html: '<div id="rh-inject-title" class="popup-title"><span>' + returnLang('recentHistory') + '	- <a href="#"  id="show-all-history" target="_blank">' + returnLang('more') + '🕑</a></span></div>' }).inject('popup-insert', 'bottom');
            }
        } else if (rhporder[o] == 'rct-order') {
            if ((localStorage['rct-itemsno'] * 1) > 0 && chrome.extension.getBackgroundPage().closedTabs.length > 0) {
                if (navigator.userAgent.toLowerCase().indexOf('edg') > 0) {
                    new Element('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '	- <a href="#"  id="show-all-closed" target="_blank">' + returnLang('more') + '...</a></span></div>' }).inject('popup-insert', 'bottom');
                } else {
                    new Element('div', { id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>' + returnLang('recentlyClosedTabs') + '</span></div>' }).inject('popup-insert', 'bottom');
                }
            }
        } else if (rhporder[o] == 'rb-order') {
            if ((localStorage['rb-itemsno'] * 1) > 0) {
                new Element('div', { id: 'rb-inject', html: '<div id="rb-inject-title" class="popup-title"><span>' + returnLang('recentBookmarks') + '	- <a href="#"  id="show-all-bookmark" target="_blank">' + returnLang('more') + '...</a></span></div>' }).inject('popup-insert', 'bottom');
            }
        } else if (rhporder[o] == 'mv-order') {
            if ((localStorage['mv-itemsno'] * 1) > 0) {
                new Element('div', { id: 'mv-inject', html: '<div id="mv-inject-title" class="popup-title"><span>' + returnLang('mostVisited') + '</span></div>' }).inject('popup-insert', 'bottom');
            }
        }  else if (rhporder[o] == 'rt-order') {
            // rt = recent tab
            if ((localStorage['rt-itemsno'] * 1) > 0 && chrome.extension.getBackgroundPage().recentTabs.length > 0) {
               new Element('div', { id: 'rt-inject', html: '<div id="rt-inject-title" class="popup-title"><span>' + returnLang('recentTabs') + '</span></div>' }).inject('popup-insert', 'bottom');
            }
        }
    }

    // Assign events

    if ($('show-all-history') != undefined)
        $('show-all-history').addEvent('click', function () {
            if (localStorage['rm-click'] == 'this')
                chromeURL('/history2.html');
            else
                chromeURL('chrome://history/');
        });

    if ($('show-all-bookmark') != undefined)
        $('show-all-bookmark').addEvent('click', function () {
            if (localStorage['rm-click'] == 'this')
                chromeURL('/bookmark.html');
            else
                chromeURL('chrome://favorites/');
        });

    if ($('show-all-closed') != undefined)
        $('show-all-closed').addEvent('click', function () {
            if (localStorage['rm-click'] == 'this')
                chromeURL('/closed.html');
            else
                chromeURL('chrome://history/recentlyClosed');
        });

    // Popup init

    // -- Insert
    if ($('rh-inject')) { recentHistory(); }
    if ($('rct-inject')) { recentlyClosedTabs(); }
    if ($('rt-inject')) { showRecentTabs(); }
    if ($('rb-inject')) { recentBookmarks(); }
    if ($('mv-inject')) { mostVisited(); }

    // $$("#rt-inject-title .item[target]").each(function (el, i) {
    //     if (i !== 0) {
    //         el.addEvent('click', function () {
    //             openTab(el.tabId);
    //         });
    //     }
    // });
    
    

    // -- Functions
    $$('.favicon').addEvent('error', function () {
        this.setProperty('src', 'images/blank.png');
    });

    // -- Width
    $(document.body).setStyle('width', localStorage['rh-width']);

    // -- Titles
    $$('.popup-title').each(function (el, i) {
        if (i !== 0) {
            el.setStyle('margin-top', '6px');
        }
    });

    // -- Search
    if (localStorage['rh-search'] == 'yes') {
        $('popup-search-input').addEvent('keyup', function () {
            var sv = this.get('value');
            if (sv.length + sv.replace(/[0-9a-zA-Z]+/g, '').length >= 2) {
                popupSearch(sv);
                $('popup-insert').setStyle('display', 'none');
                $('popup-search-insert').setStyle('display', 'block');
            } else {
                $('popup-insert').setStyle('display', 'block');
                $('popup-search-insert').setStyle('display', 'none');
            }
        });
        $('popup-search-clear').addEvent('click', function () {
            $('popup-search-input').set('value', '');
            $('popup-search-input').focus();
            $('popup-insert').setStyle('display', 'block');
            $('popup-search-insert').setStyle('display', 'none');
            $('popup-search-insert').set('text', '');
        });
        $('popup-search-input').focus();
    } else {
        $('popup-header').setStyle('display', 'none');
        if ($$('.popup-title').length > 0) {
            $$('.popup-title')[0].setStyle('margin-top', '10px');
        }
    }

    // -- Alert holder
    $('alert-holder').addEvent('click', function () {
        this.setStyle('display', 'none');
    });

    // -- Scrollbar fix
    //popup_scrollbar_fix.periodical(250);

});
