document.addEvent('domready', function () {
    onStorageReady(function () {

        // Fade in

    var historyFx = new Fx.Morph('history-container', { duration: 250 });
    if (chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en') {
        var ho = {
            'margin-right': [150, 180],
            'opacity': [0, 1]
        };
    } else {
        var ho = {
            'margin-left': [150, 180],
            'opacity': [0, 1]
        };
    }
    historyFx.start(ho);

    // Language
    
    // Set button labels
    if ($('delete-bookmark-button')) {
        $('delete-bookmark-button').set('value', returnLang('deleteBookmarks'));
    }
    if ($('edit-bookmark-button')) {
        $('edit-bookmark-button').set('value', returnLang('editBookmark'));
    }

    // Toggle history

    if (localStorage['rh-group'] == 'no') {
        $('rh-bar-group').setStyle('background-position', 'right center');
    }
    if (localStorage['rh-orderby'] == 'title') {
        $('rh-bar-orderby').setStyle('background-position', 'right center');
        $('rh-bar-orderby').set('title', returnLang('orderByTime') ); 
    } else {       
         $('rh-bar-orderby').set('title', returnLang('orderByTitle') );   
    }
    $('rh-bar-order').set('title', returnLang('order') ); 
    if (localStorage['rh-order'] == 'asc') {
        $('rh-bar-order').setStyle('background-position', 'right center');
    }    
    $('rh-bar-group').set('title', returnLang('group') );   
    $('rh-bar-group').addEvent('click', function () {
        var rhgv = localStorage['rh-group'];
        if (rhgv == 'yes') {
            $('rh-bar-group').setStyle('background-position', 'right center');
            localStorage['rh-group'] = 'no';
        } else if (rhgv == 'no') {
            $('rh-bar-group').setStyle('background-position', 'left center');
            localStorage['rh-group'] = 'yes';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').get('value');
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-orderby').addEvent('click', function () {
        var rhgv = localStorage['rh-orderby'];
        if (rhgv == 'date') {
            $('rh-bar-orderby').setStyle('background-position', 'right center');
            $('rh-bar-orderby').set('title', returnLang('orderByTime') );  
            localStorage['rh-orderby'] = 'title';
        } else if (rhgv == 'title') {
            $('rh-bar-orderby').setStyle('background-position', 'left center');
            $('rh-bar-orderby').set('title', returnLang('orderByTitle') );       
            localStorage['rh-orderby'] = 'date';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').get('value');
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-order').addEvent('click', function () {
        var rhgv = localStorage['rh-order'];
        if (rhgv == 'desc') {
            $('rh-bar-order').setStyle('background-position', 'right center');
            localStorage['rh-order'] = 'asc';
        } else if (rhgv == 'asc') {
            $('rh-bar-order').setStyle('background-position', 'left center');
            localStorage['rh-order'] = 'desc';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').get('value');
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });


    // Shift listener

    $(document.body).addEvent('keydown', function (e) {
        if (e.event.keyCode == 16 && shiftState == 'false') {
            shiftState = 'true';
        }
    });
    $(document.body).addEvent('keyup', function (e) {
        if (e.event.keyCode == 16) {
            shiftState = 'false';
        }
    });



    //获取Location对象的search属性值
    var searchStr = location.search;

    if (searchStr.length > 1) {
        $("rh-search").set('value', searchStr);
        bookmark('search', searchStr);
    } else {
        searchStr - '';
    }

    if (searchStr == '')
        bookmark('current', '');


    // Search events


    $('rh-search').addEvent('keyup', function () {
        var sv = this.get('value');
        if (sv.length + sv.replace(/[0-9a-zA-Z]+/g, '').length >= 2) {
            if (sv != searchStr) {
                sv == searchStr;
                bookmark('search', sv);
            }
            $('rh-views-insert').setStyle('display', 'none');
            $('rh-views-search-insert').setStyle('display', 'block');

        } else {
            $('rh-views-insert').setStyle('display', 'block');
            $('rh-views-search-insert').setStyle('display', 'none');
        }
    });
    $('rh-search').focus();



    // Assign events

    $('master-check-all').addEvent('click', function () { selectBookmarkItem(this, 'all'); });
    $('delete-bookmark-button').set('value', returnLang('deleteBookmarks'));
    $('delete-bookmark-button').addEvent('click', function() { deleteBookmarkItems(); });
    $('edit-bookmark-button').set('value', returnLang('editBookmark'));
    $('edit-bookmark-button').addEvent('click', function() { editBookmarkItem(); });



    function bmtree2array(path, tree) {

        path = path + '🗁';

        let list = [];
        for (let i = 0; i < tree.length; i++) {
            if (tree[i].children == undefined) {
                let rawTitle = tree[i].title;
                if (rawTitle === undefined || rawTitle === null) {
                    rawTitle = '';
                }
                let displayTitle = rawTitle;
                if (displayTitle === '') {
                    displayTitle = tree[i].url;
                }
                let node = Object.assign({}, tree[i]);
                node.originalTitle = rawTitle;
                if (localStorage['rm-path'] == 'yes') {
                    node.title = (path).replace(/[🗁]+/, '🗁') + ' - ' + displayTitle;
                } else {
                    node.title = displayTitle;
                }
                node.bookmarkId = node.id;
                list.push(node);
            } else {
                // 使用全角字符／，避免解析html发生错误
                list = list.concat(bmtree2array(path + tree[i].title, tree[i].children));
            }
        }
        return list;
    }


    function bookmark(w, q) {

        if (w != 'search')
            w = 'yes';

        if (prh) {
            clearInterval(prh);
        }

        if (w == 'search') {
            var into = 'rh-views-search-insert';
            $('rh-views-search-insert').setStyle('display', 'block');
            $('rh-views-insert').setStyle('display', 'none');
        } else {
            var into = 'rh-views-insert';
            $('rh-views-search-insert').setStyle('display', 'none');
            $('rh-views-insert').setStyle('display', 'block');
            $('rh-search').set('value', '');
        }

        $(into).set('text', returnLang('loading'));

        /*  可以进行排序的内容有：
                按照网站分组
                添加顺序
                访问顺序
                访问时间
        */

        if (q == '') {

            chrome.bookmarks.getTree((hi) => {


                if (hi.length > 0) {
                    showData(bmtree2array('', hi), into);
                    //            alertLoadingHistory(true);
                } else {
                    // $('calendar-total-value').set('text', '0');
                    $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
                }
            })

            /* 
                        chrome.bookmarks.getRecent(10000, function (hi) {
                            // console.log(hi);
            
                            if (hi.length > 0) {
                                showData(hi,into);
                                //            alertLoadingHistory(true);
                            } else {
                                // $('calendar-total-value').set('text', '0');
                                $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
                            }
            
                        }); */

        } else {
            chrome.bookmarks.search(q, (hi) => {
                // console.log(res);

                if (hi.length > 0) {
                    showData(hi, into);
                } else {
                    $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
                }

            })
        }

    }


    function showData(hi, into) {

        alertLoadingHistory(false);
        var rha = [];
        var grp = localStorage['rh-group'];
        var oby = localStorage['rh-orderby'];
        var ord = localStorage['rh-order'];

        for (i = 0; i <= hi.length; i++) {

            if (hi[i] !== undefined) {

                if (filtUrl(hi[i].url) == false) {

                    var title = hi[i].title;
                    var url = hi[i].url;
                    var host = get_host(url);
                    var visits = hi[i].visitCount;
                    var furl = 'chrome://favicon/' + hi[i].url;
                    var bookmarkId = hi[i].bookmarkId || hi[i].id;
                    if (host == "#") {
                        url = encodeURI(url);
                        furl = 'chrome://favicon/';
                    }


                    if (title == '') {
                        title = url;
                    }

                    var originalTitle = hi[i].originalTitle;
                    if (originalTitle === undefined || originalTitle === null) {
                        originalTitle = hi[i].title;
                    }
                    if (originalTitle === undefined || originalTitle === null) {
                        originalTitle = '';
                    }

                    // if (hi[i].dateAdded >= obj['startTime'] && hi[i].dateAdded <= obj['endTime'])
                    {
                        //   rha.push({epoch: hi[i].dateAdded, url: url, host: (new URI(url).get('host')), time: timeNow(hi[i].dateAdded), date: formatDate(hi[i].dateAdded), favicon: furl, title: truncate(title_fix(title), 0, 100), visits: visits});
                        var safeTitle = title_fix(title);
                        var displayTitle = truncate(safeTitle, 0, 100);
                        rha.push({ epoch: hi[i].dateAdded, url: url, host: host, time: TimeToStr(hi[i].dateAdded, true, true, true), date: formatDate(hi[i].dateAdded), favicon: furl, title: displayTitle, visits: visits, bookmarkId: bookmarkId, originalTitle: originalTitle });

                    }

                }

            }

        }

        if (rha.length > 0) {

            $('master-check-all').set('disabled', 'disabled');

            if (into == 'rh-views-insert') {
                var rhat = rha.length;
            }

            if (oby == 'title') {
                rha.sort(function (a, b) {
                    if (grp == 'yes') {
                        var nameA = a.host.replace('www.', '');
                        var nameB = b.host.replace('www.', '');
                    } else if (grp == 'no') {
                        var nameA = a.title;
                        var nameB = b.title;
                    }
                    if (nameA < nameB) {
                        return -1;
                    } else if (nameA > nameB) {
                        return 1;
                    } else {
                        var epochA = (a.epoch === undefined || a.epoch === null) ? 0 : a.epoch * 1;
                        var epochB = (b.epoch === undefined || b.epoch === null) ? 0 : b.epoch * 1;
                        return epochB - epochA;
                    }
                });
            } else {
                rha.sort(function (a, b) {
                    var epochA = (a.epoch === undefined || a.epoch === null) ? 0 : a.epoch * 1;
                    var epochB = (b.epoch === undefined || b.epoch === null) ? 0 : b.epoch * 1;

                    if (epochA !== epochB) {
                        return epochA - epochB;
                    }

                    var titleA = (a.title || '').toLowerCase();
                    var titleB = (b.title || '').toLowerCase();
                    if (titleA < titleB) {
                        return -1;
                    } else if (titleA > titleB) {
                        return 1;
                    } else {
                        return 0;
                    }
                });
                rha.reverse();
            }

            if (ord == 'asc') {
                rha.reverse();
            }

            $(into).set('text', '');

            var ibcv = 'grey';
            var Counter = { counter: 0 };

            if (grp == 'yes') {  // 注意此处回调耗时操作
                prh = (function () {
                    var thisc = this;
                    if (thisc.counter == rha.length) {
                        clearInterval(prh);
                        //isBookmarked('#rh-views .item .link');
                        alertLoadingHistory(true);
                        $(document.body).getElement('#rh-bar-uione input').set('checked', false);
                        selectedItem = undefined;
                        new Tips('.title', { className: 'tip-holder' });
                        if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].get('title')); }
                        $('master-check-all').removeProperty('disabled');
                    } else {
                        
                        var host = rha[thisc.counter].host;
                        if (host !== undefined) {
                            if (!$(into).getElement('div[rel="' + host + '"]')) {
                                var toggleid = 'toggle-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var moreid = 'more-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var groupid = 'group-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var faviconSrc = rha[thisc.counter].favicon ? 'src="' + escapeHtmlAttr(rha[thisc.counter].favicon) + '"' : '';
                                var escapedHost = escapeHtmlAttr(host);
                                var escapedHostDisplay = escapeHtmlAttr(host.replace('www.', ''));
                                new Element('div', {
                                    title: host,
                                    rel: ibcv,
                                    'class': 'item-holder group-title ',
                                    html: '<a href="#" class="group-title-toggle group-title-toggle-bookmark" id="' + toggleid + '" data-host="' + escapedHost + '" rel="' + escapedHost + '"></a><label class="group-title-toggle-count" rel="' + escapedHost + '"></label><input type="hidden"  style="width: 0; display:none;   padding: 0 0 0 0;  margin: 0 0 0 0;    visibility: hidden;  left: 0;"  class="group-title-checkbox" id="' + moreid + '" value="' + escapedHost + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon" ' + faviconSrc + '><span id="' + groupid + '" data-host="' + escapedHost + '" class="group-title-host">' + escapedHostDisplay + '</span>'
                                }).inject(into);
                                $(toggleid).addEvent('click', function () {
                                    var host = this.getProperty('data-host');
                                    toggleGroup(host);
                                });
                                $(moreid).addEvent('click', function () {
                                    getMoreItems(this);
                                });
                                $(errorid).addEvent('error', function () {
                                    this.setProperty('src', 'images/blank.png');
                                });
                                $(groupid).addEvent('click', function () {
                                    var host = this.getProperty('data-host');
                                    toggleGroup(host);
                                })
                                new Element('div', { 'class': 'group-holder', rel: host, styles: { 'display': 'none' } }).inject(into);
                                if (ibcv == 'white') {
                                    ibcv = 'grey';
                                } else {
                                    ibcv = 'white';
                                }
                            }

                            var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var rawUrl = rha[thisc.counter].url || '';
                            var rawTime = rha[thisc.counter].time || '';
                            var displayTitleText = rha[thisc.counter].title || '';
                            var escapedUrlAttr = escapeHtmlAttr(rawUrl);
                            var escapedTimeAttr = escapeHtmlAttr(rawTime);
                            var escapedDisplayTitle = escapeHtmlAttr(displayTitleText);
                            var escapedTooltip = escapeHtmlAttr(rha[thisc.counter].url || '');
                            var item;
                            item = '<div class="item">';
                            item += '<span class="checkbox"><label><input class="chkbx bookmark-checkbox" type="checkbox" id="' + selectid + '" value="' + escapedUrlAttr + '" name="check"></label>&nbsp;</span>';
                            item += '<span class="time">' + escapedTimeAttr + '</span>';
                            item += '<a style="padding-left:0;" target="_blank" class="link" href="' + escapedUrlAttr + '">';
                            item += '<span class="title" title="' + escapedTooltip + '" rel="' +  escapedTimeAttr +  '">' + escapedDisplayTitle + '</span>';
                            item += '</a>';
                            item += '</div>';
                            var itemHolder = new Element('div', {
                                'rel': $(into).getElement('div.item-holder[title="' + host + '"]').get('rel'),
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url,
                                styles: {
                                    'background-color': $(into).getElement('div.item-holder[title="' + host + '"]').getStyle('background-color')
                                }
                            }).set('html', item + '<div class="clearitem" style="clear:both;"></div>').inject($(into).getElement('div[rel="' + host + '"]'));
                            var linkElement = itemHolder.getElement('a.link');
                            if (linkElement) {
                                linkElement.addEvent('click', function (e) {
                                    var holder = this.getParent('div.item-holder');
                                    var linkUrl = holder ? holder.getProperty('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        if (e && e.stop) {
                                            e.stop();
                                        }
                                        executeBookmarklet(linkUrl, {
                                            decode: true,
                                            fallbackToUpdate: true,
                                            onFailure: function(err) {
                                                console.warn('Bookmarklet execution failed:', err);
                                            }
                                        });
                                    }
                                });
                            }
                            $(selectid).addEvent('click', function () {
                                selectBookmarkItem(this, 'single');
                            });

                            var size = $(into).getElement('div[rel="' + host + '"]').childNodes.length;
                            var label = $(into).getElement('label[rel="' + host + '"]');
                            if (label != undefined)
                                label.set("text", size);
                        }
                    }
                    thisc.counter++;
                }).periodical(5, Counter);
            } else if (grp == 'no') {
                prh = (function () {
                    var thisc = this;
                    if (thisc.counter == rha.length) {
                        clearInterval(prh);
                        //isBookmarked('#rh-views .item .link');
                        alertLoadingHistory(true);
                        $(document.body).getElement('#rh-bar-uione input').set('checked', false);
                        selectedItem = undefined;
                        new Tips('.title', { className: 'tip-holder' });
                        if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].get('title')); }
                        $('master-check-all').removeProperty('disabled');
                    } else {
                        if (rha[thisc.counter] !== undefined) {

                            var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var rawUrl = rha[thisc.counter].url || '';
                            var rawTime = rha[thisc.counter].time || '';
                            var displayTitleText = rha[thisc.counter].title || '';
                            var escapedUrlAttr = escapeHtmlAttr(rawUrl);
                            var escapedTimeAttr = escapeHtmlAttr(rawTime);
                            var escapedDisplayTitle = escapeHtmlAttr(displayTitleText);
                            var escapedTooltip = escapeHtmlAttr(rha[thisc.counter].url || '');
                            var faviconSrc = rha[thisc.counter].favicon ? 'src="' + escapeHtmlAttr(rha[thisc.counter].favicon) + '"' : '';
                            var item;
                            item = '<div class="item">';
                            item += '<span class="checkbox"><label><input class="chkbx bookmark-checkbox" type="checkbox" id="' + selectid + '" value="' + escapedUrlAttr + '" name="check"></label>&nbsp;</span>';
                            item += '<span class="time">' + escapedTimeAttr + '</span>';
                            item += '<a target="_blank" class="link" href="' + escapedUrlAttr + '">';
                            item += '<img id="' + errorid + '" class="favicon" alt="Favicon" ' + faviconSrc +'>';
                            item += '<span class="title" title="' + escapedTooltip + '" rel="'  + escapedTimeAttr +  '">' + escapedDisplayTitle + '</span>';
                            item += '</a>';
                            item += '</div>';
                            var itemHolder = new Element('div', { 
                                'rel': ibcv, 
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url
                            });
                            itemHolder.set('html', item + '<div class="clearitem" style="clear:both;"></div>').inject(into);
                            var linkElement = itemHolder.getElement('a.link');
                            if (linkElement) {
                                linkElement.addEvent('click', function (e) {
                                    var holder = this.getParent('div.item-holder');
                                    var linkUrl = holder ? holder.getProperty('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        if (e && e.stop) {
                                            e.stop();
                                        }
                                        executeBookmarklet(linkUrl, {
                                            decode: true,
                                            fallbackToUpdate: true,
                                            onFailure: function(err) {
                                                console.warn('Bookmarklet execution failed:', err);
                                            }
                                        });
                                    }
                                });
                            }


                            if (ibcv == 'white') {
                                ibcv = 'grey';
                            } else {
                                ibcv = 'white';
                            }
                            $(selectid).addEvent('click', function () {
                                selectBookmarkItem(this, 'single');
                            });
                            $(errorid).addEvent('error', function () {
                                this.setProperty('src', 'images/blank.png');
                            });
                        }
                    }
                    thisc.counter++;
                }).periodical(5, Counter);
            }
            alertLoadingHistory(true);
        } else {
            alertLoadingHistory(true);
            // $('calendar-total-value').set('text', '0');
            $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
        }

    }


    function getActiveBookmark() {
        if ($('rh-views-insert').getStyle('display') == 'block') {
            return 'history';
        } else if ($('rh-views-search-insert').getStyle('display') == 'block') {
            return 'search';
        }
    }


    function selectBookmarkItem(el, w) {
        var grp = localStorage['rh-group'];
        if (getActiveBookmark() == 'history') {
            var into = '#rh-views-insert';
        } else if (getActiveBookmark() == 'search') {
            var into = '#rh-views-search-insert';
        }
        
        var itemSelectedColor = '#ffcbd3';
        
        if (w == 'single') {
            if (el.get('checked') == true) {
                el.getParent('div.item-holder').setStyle('background-color', itemSelectedColor);
            } else if (el.get('checked') == false) {
                var iurl = el.get('value');
                $$(into + ' .chkbx').each(function (ele) {
                    if (ele.get('value') == iurl) {
                        if (ele.getParent('div.item-holder').get('rel') == 'white') {
                            ele.getParent('div.item-holder').setStyle('background-color', '#fff');
                        } else {
                            ele.getParent('div.item-holder').setStyle('background-color', '#f1f1f1');
                        }
                    }
                });
            }
            if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
                $('master-check-all').set('checked', true);
                $('master-check-all').set('value', 'true');
            } else {
                $('master-check-all').set('checked', false);
                $('master-check-all').set('value', 'false');
            }
        } else if (w == 'all') {
            if (el.get('value') == 'false') {
                $$(into + ' .chkbx').each(function (ele) {
                    ele.set('checked', true);
                    ele.getParent('div.item-holder').setStyle('background-color', itemSelectedColor);
                });
                el.set('value', 'true');
            } else {
                $$(into + ' .chkbx').each(function (ele) {
                    ele.set('checked', false);
                    if (ele.getParent('div.item-holder').get('rel') == 'white') {
                        ele.getParent('div.item-holder').setStyle('background-color', '#fff');
                    } else {
                        ele.getParent('div.item-holder').setStyle('background-color', '#fafafa');
                    }
                });
                el.set('value', 'false');
            }
        }
        
        updateBookmarkButtons();
    }


    function updateBookmarkButtons() {
        var into = getActiveBookmark() == 'history' ? '#rh-views-insert' : '#rh-views-search-insert';
        var checkedItems = $$(into + ' .chkbx:checked');
        var checkedCount = checkedItems.length;
        
        if (checkedCount > 0) {
            $('delete-bookmark-button').setStyle('display', 'inline-block');
        } else {
            $('delete-bookmark-button').setStyle('display', 'none');
        }
        
        if (checkedCount == 1) {
            $('edit-bookmark-button').setStyle('display', 'inline-block');
        } else {
            $('edit-bookmark-button').setStyle('display', 'none');
        }
    }


    function deleteBookmarkItems() {
        var into = getActiveBookmark() == 'history' ? '#rh-views-insert' : '#rh-views-search-insert';
        var checkedItems = $$(into + ' .chkbx:checked');
        
        if (checkedItems.length > 0) {
            var confirmMsg = returnLang('ui4');
            if (confirm(confirmMsg)) {
                alertLoadingHistory(false);
                var deleteCount = 0;
                var totalCount = checkedItems.length;
                
                checkedItems.each(function(el) {
                    var holder = el.getParent('div.item-holder');
                    var bookmarkId = holder.getProperty('data-bookmark-id');
                    
                    if (bookmarkId) {
                        chrome.bookmarks.remove(bookmarkId, function() {
                            deleteCount++;
                            holder.destroy();
                            
                            if (deleteCount == totalCount) {
                                $('master-check-all').set('checked', false);
                                $('master-check-all').set('value', 'false');
                                updateBookmarkButtons();
                                alertLoadingHistory(true);
                            }
                        });
                    } else {
                        deleteCount++;
                        if (deleteCount == totalCount) {
                            alertLoadingHistory(true);
                        }
                    }
                });
            }
        }
    }


    function resetBookmarkSelectionState() {
        if ($('master-check-all')) {
            $('master-check-all').set('checked', false);
            $('master-check-all').set('value', 'false');
        }
        selectedItem = undefined;
        updateBookmarkButtons();
    }


    function refreshBookmarkView() {
        var activeView = getActiveBookmark();
        var query = $('rh-search') ? $('rh-search').get('value') : '';
        if (activeView === 'search' && query && (query.length + query.replace(/[0-9a-zA-Z]+/g, '').length >= 2)) {
            bookmark('search', query);
        } else {
            bookmark('yes', '');
        }
    }


    function getBookmarkContainerSelector() {
        return getActiveBookmark() == 'search' ? '#rh-views-search-insert' : '#rh-views-insert';
    }


    function getBookmarkDataFromCheckbox(checkbox) {
        var holder = checkbox.getParent('div.item-holder');
        if (!holder) {
            return null;
        }
        return {
            id: holder.getProperty('data-bookmark-id'),
            title: holder.getProperty('data-bookmark-title'),
            url: holder.getProperty('data-bookmark-url'),
            holder: holder
        };
    }


    function editBookmarkItem() {
        var containerSelector = getBookmarkContainerSelector();
        var checkedItems = $$(containerSelector + ' .chkbx:checked');

        if (checkedItems.length !== 1) {
            return;
        }

        var data = getBookmarkDataFromCheckbox(checkedItems[0]);
        if (!data || !data.id) {
            return;
        }

        var currentTitle = data.title || data.url || '';
        var currentUrl = data.url || '';

        var newTitle = prompt(returnLang('editBookmarkTitlePrompt'), currentTitle);
        if (newTitle === null) {
            return;
        }
        newTitle = newTitle.trim();
        if (newTitle === '') {
            newTitle = currentTitle;
        }

        var newUrl = prompt(returnLang('editBookmarkUrlPrompt'), currentUrl);
        if (newUrl === null) {
            return;
        }
        newUrl = newUrl.trim();
        if (newUrl === '') {
            newUrl = currentUrl;
        }

        if (newTitle === currentTitle && newUrl === currentUrl) {
            return;
        }

        chrome.bookmarks.update(data.id, { title: newTitle, url: newUrl }, function () {
            if (chrome.runtime.lastError) {
                alert('Error updating bookmark: ' + chrome.runtime.lastError.message);
                return;
            }
            resetBookmarkSelectionState();
            refreshBookmarkView();
        });
    }


    });
});
