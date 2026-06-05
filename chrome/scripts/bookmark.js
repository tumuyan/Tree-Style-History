document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {

        // Fade in using CSS transition

    var historyContainer = $('history-container');
    if (historyContainer) {
        historyContainer.style.transition = 'margin-left 0.25s, margin-right 0.25s, opacity 0.25s';
        if (chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en') {
            historyContainer.style.marginRight = '180px';
        } else {
            historyContainer.style.marginLeft = '180px';
        }
        historyContainer.style.opacity = '1';
    }

    // Language
    
    // Set button labels
    if ($('delete-bookmark-button')) {
        $('delete-bookmark-button').value = returnLang('deleteBookmarks');
    }
    if ($('edit-bookmark-button')) {
        $('edit-bookmark-button').value = returnLang('editBookmark');
    }

    // Toggle history

    if (localStorage['rh-group'] == 'no') {
        $('rh-bar-group').style.backgroundPosition = 'right center';
    }
    if (localStorage['rh-orderby'] == 'title') {
        $('rh-bar-orderby').style.backgroundPosition = 'right center';
        $('rh-bar-orderby').title = returnLang('orderByTime'); 
    } else {       
         $('rh-bar-orderby').title = returnLang('orderByTitle');   
    }
    $('rh-bar-order').title = returnLang('order'); 
    if (localStorage['rh-order'] == 'asc') {
        $('rh-bar-order').style.backgroundPosition = 'right center';
    }    
    $('rh-bar-group').title = returnLang('group');   
    $('rh-bar-group').addEventListener('click', function () {
        var rhgv = localStorage['rh-group'];
        if (rhgv == 'yes') {
            $('rh-bar-group').style.backgroundPosition = 'right center';
            localStorage['rh-group'] = 'no';
        } else if (rhgv == 'no') {
            $('rh-bar-group').style.backgroundPosition = 'left center';
            localStorage['rh-group'] = 'yes';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-orderby').addEventListener('click', function () {
        var rhgv = localStorage['rh-orderby'];
        if (rhgv == 'date') {
            $('rh-bar-orderby').style.backgroundPosition = 'right center';
            $('rh-bar-orderby').title = returnLang('orderByTime');  
            localStorage['rh-orderby'] = 'title';
        } else if (rhgv == 'title') {
            $('rh-bar-orderby').style.backgroundPosition = 'left center';
            $('rh-bar-orderby').title = returnLang('orderByTitle');       
            localStorage['rh-orderby'] = 'date';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-order').addEventListener('click', function () {
        var rhgv = localStorage['rh-order'];
        if (rhgv == 'desc') {
            $('rh-bar-order').style.backgroundPosition = 'right center';
            localStorage['rh-order'] = 'asc';
        } else if (rhgv == 'asc') {
            $('rh-bar-order').style.backgroundPosition = 'left center';
            localStorage['rh-order'] = 'desc';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });


    // Shift listener

    document.body.addEventListener('keydown', function (e) {
        if (e.keyCode == 16 && shiftState == 'false') {
            shiftState = 'true';
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 16) {
            shiftState = 'false';
        }
    });



    //获取Location对象的search属性值
    var searchStr = location.search;

    if (searchStr.length > 1) {
        $("rh-search").value = searchStr;
        bookmark('search', searchStr);
    } else {
        searchStr = '';
    }

    if (searchStr == '')
        bookmark('current', '');


    // Search events


    $('rh-search').addEventListener('keyup', function () {
        var sv = this.value;
        if (sv.length + sv.replace(/[0-9a-zA-Z]+/g, '').length >= 2) {
            if (sv != searchStr) {
                searchStr = sv;
                bookmark('search', sv);
            }
            $('rh-views-insert').style.display = 'none';
            $('rh-views-search-insert').style.display = 'block';

        } else {
            $('rh-views-insert').style.display = 'block';
            $('rh-views-search-insert').style.display = 'none';
        }
    });
    $('rh-search').focus();



    // Assign events

    $('master-check-all').addEventListener('click', function () { selectBookmarkItem(this, 'all'); });
    $('delete-bookmark-button').value = returnLang('deleteBookmarks');
    $('delete-bookmark-button').addEventListener('click', function() { deleteBookmarkItems(); });
    $('edit-bookmark-button').value = returnLang('editBookmark');
    $('edit-bookmark-button').addEventListener('click', function() { editBookmarkItem(); });



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


    var prh;

    function bookmark(w, q) {

        if (w != 'search')
            w = 'yes';

        if (prh) {
            clearInterval(prh);
        }

        if (w == 'search') {
            var into = 'rh-views-search-insert';
            $('rh-views-search-insert').style.display = 'block';
            $('rh-views-insert').style.display = 'none';
        } else {
            var into = 'rh-views-insert';
            $('rh-views-search-insert').style.display = 'none';
            $('rh-views-insert').style.display = 'block';
            $('rh-search').value = '';
        }

        $(into).textContent = returnLang('loading');

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
                    $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
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
                    $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
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
                    var originalUrl = hi[i].url;
                    var url = originalUrl;
                    var host = get_host(originalUrl);
                    var visits = hi[i].visitCount;
                    var isBookmarklet = isBookmarkletUrl(originalUrl);
                    var furl = getFaviconUrl(originalUrl);
                    var bookmarkId = hi[i].bookmarkId || hi[i].id;
                    if (host == "#") {
                        url = encodeURI(originalUrl);
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

            $('master-check-all').disabled = 'disabled';

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

            $(into).textContent = '';

            var ibcv = 'grey';
            var Counter = { counter: 0 };

            if (grp == 'yes') {  // 注意此处回调耗时操作
                prh = setInterval((function () {
                    var thisc = this;
                    if (thisc.counter == rha.length) {
                        clearInterval(prh);
                        //isBookmarked('#rh-views .item .link');
                        alertLoadingHistory(true);
                        var uioneInput = document.body.querySelector('#rh-bar-uione input');
                        if (uioneInput) uioneInput.checked = false;
                        selectedItem = undefined;
                        // Tips removed - native title provides tooltip
                        var gts = $$('#' + into + ' div.group-title');
                        if (gts.length > 0) { toggleGroup(gts[0].getAttribute('title')); }
                        $('master-check-all').removeAttribute('disabled');
                    } else {
                        
                        var host = rha[thisc.counter].host;
                        if (host !== undefined) {
                            if (!$(into).querySelector('div[rel="' + host + '"]')) {
                                var toggleid = 'toggle-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var moreid = 'more-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var groupid = 'group-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var faviconSrc = rha[thisc.counter].favicon ? 'src="' + escapeHtmlAttr(rha[thisc.counter].favicon) + '"' : '';
                                var escapedHost = escapeHtmlAttr(host);
                                var escapedHostDisplay = escapeHtmlAttr(host.replace('www.', ''));
                                var groupEl = createElement('div', {
                                    title: host,
                                    rel: ibcv,
                                    'class': 'item-holder group-title ',
                                    html: '<a href="#" class="group-title-toggle group-title-toggle-bookmark" id="' + toggleid + '" data-host="' + escapedHost + '" rel="' + escapedHost + '"></a><label class="group-title-toggle-count" rel="' + escapedHost + '"></label><input type="hidden"  style="width: 0; display:none;   padding: 0 0 0 0;  margin: 0 0 0 0;    visibility: hidden;  left: 0;"  class="group-title-checkbox" id="' + moreid + '" value="' + escapedHost + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon" ' + faviconSrc + '><span id="' + groupid + '" data-host="' + escapedHost + '" class="group-title-host">' + escapedHostDisplay + '</span>'
                                });
                                $(into).appendChild(groupEl);
                                $(toggleid).addEventListener('click', function () {
                                    var host = this.getAttribute('data-host');
                                    toggleGroup(host);
                                });
                                $(moreid).addEventListener('click', function () {
                                    getMoreItems(this);
                                });
                                $(errorid).addEventListener('error', function () {
                                    this.src = 'images/blank.png';
                                });
                                $(groupid).addEventListener('click', function () {
                                    var host = this.getAttribute('data-host');
                                    toggleGroup(host);
                                })
                                var groupHolder = createElement('div', { 'class': 'group-holder', rel: host, styles: { 'display': 'none' } });
                                $(into).appendChild(groupHolder);
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

                            var tooltipParts = [];
                            if (displayTitleText) {
                                tooltipParts.push(displayTitleText);
                            }
                            if (!isBookmarkletUrl(rawUrl) && rawUrl) {
                                tooltipParts.push(rawUrl);
                            }
                            if (rawTime) {
                                tooltipParts.push(rawTime);
                            }
                            var tooltipText = tooltipParts.join(' | ');
                            if (!tooltipText) {
                                tooltipText = isBookmarkletUrl(rawUrl) ? '[Bookmarklet]' : rawUrl;
                            }
                            var escapedTooltip = escapeHtmlAttr(tooltipText);

                            var item;
                            item = '<div class="item">';
                            item += '<span class="checkbox"><label><input class="chkbx bookmark-checkbox" type="checkbox" id="' + selectid + '" value="' + escapedUrlAttr + '" name="check"></label>&nbsp;</span>';
                            item += '<span class="time">' + escapedTimeAttr + '</span>';
                            item += '<a style="padding-left:0;" target="_blank" class="link" href="' + escapedUrlAttr + '">';
                            item += '<span class="title" title="' + escapedTooltip + '" rel="' +  escapedTimeAttr +  '">' + escapedDisplayTitle + '</span>';
                            item += '</a>';
                            item += '</div>';
                            var existingHolder = $(into).querySelector('div.item-holder[title="' + host + '"]');
                            var itemHolder = createElement('div', {
                                'rel': existingHolder.getAttribute('rel'),
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url,
                                styles: {
                                    'background-color': getStyle(existingHolder, 'background-color')
                                }
                            });
                            itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                            var groupDiv = $(into).querySelector('div[rel="' + host + '"]');
                            groupDiv.appendChild(itemHolder);
                            var linkElement = itemHolder.querySelector('a.link');
                            if (linkElement) {
                                linkElement.addEventListener('click', function (e) {
                                    var holder = this.closest('div.item-holder');
                                    var linkUrl = holder ? holder.getAttribute('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        e.preventDefault();
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
                            $(selectid).addEventListener('click', function () {
                                selectBookmarkItem(this, 'single');
                            });

                            var size = $(into).querySelector('div[rel="' + host + '"]').childNodes.length;
                            var label = $(into).querySelector('label[rel="' + host + '"]');
                            if (label != undefined)
                                label.textContent = size;
                        }
                    }
                    thisc.counter++;
                }).bind(Counter), 5);
            } else if (grp == 'no') {
                prh = setInterval((function () {
                    var thisc = this;
                    if (thisc.counter == rha.length) {
                        clearInterval(prh);
                        //isBookmarked('#rh-views .item .link');
                        alertLoadingHistory(true);
                        var uioneInput = document.body.querySelector('#rh-bar-uione input');
                        if (uioneInput) uioneInput.checked = false;
                        selectedItem = undefined;
                        // Tips removed - native title provides tooltip
                        var gts = $$('#' + into + ' div.group-title');
                        if (gts.length > 0) { toggleGroup(gts[0].getAttribute('title')); }
                        $('master-check-all').removeAttribute('disabled');
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

                            var tooltipParts = [];
                            if (displayTitleText) {
                                tooltipParts.push(displayTitleText);
                            }
                            if (!isBookmarkletUrl(rawUrl) && rawUrl) {
                                tooltipParts.push(rawUrl);
                            }
                            if (rawTime) {
                                tooltipParts.push(rawTime);
                            }
                            var tooltipText = tooltipParts.join(' | ');
                            if (!tooltipText) {
                                tooltipText = isBookmarkletUrl(rawUrl) ? '[Bookmarklet]' : rawUrl;
                            }
                            var escapedTooltip = escapeHtmlAttr(tooltipText);

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
                            var itemHolder = createElement('div', { 
                                'rel': ibcv, 
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url
                            });
                            itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                            $(into).appendChild(itemHolder);
                            var linkElement = itemHolder.querySelector('a.link');
                            if (linkElement) {
                                linkElement.addEventListener('click', function (e) {
                                    var holder = this.closest('div.item-holder');
                                    var linkUrl = holder ? holder.getAttribute('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        e.preventDefault();
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
                            $(selectid).addEventListener('click', function () {
                                selectBookmarkItem(this, 'single');
                            });
                            $(errorid).addEventListener('error', function () {
                                this.src = 'images/blank.png';
                            });
                        }
                    }
                    thisc.counter++;
                }).bind(Counter), 5);
            }
            alertLoadingHistory(true);
        } else {
            alertLoadingHistory(true);
            // $('calendar-total-value').set('text', '0');
            $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
        }

    }


    function getActiveBookmark() {
        if (getStyle($('rh-views-insert'), 'display') == 'block') {
            return 'history';
        } else if (getStyle($('rh-views-search-insert'), 'display') == 'block') {
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
            if (el.checked == true) {
                var parent = el.closest('div.item-holder');
                if (parent) parent.style.backgroundColor = itemSelectedColor;
            } else if (el.checked == false) {
                var iurl = el.value;
                var items = $$(into + ' .chkbx');
                for (var i = 0; i < items.length; i++) {
                    (function(ele) {
                        if (ele.value == iurl) {
                            var parent = ele.closest('div.item-holder');
                            if (parent.getAttribute('rel') == 'white') {
                                parent.style.backgroundColor = '#fff';
                            } else {
                                parent.style.backgroundColor = '#f1f1f1';
                            }
                        }
                    })(items[i]);
                }
            }
            if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
                $('master-check-all').checked = true;
                $('master-check-all').value = 'true';
            } else {
                $('master-check-all').checked = false;
                $('master-check-all').value = 'false';
            }
        } else if (w == 'all') {
            if (el.value == 'false') {
                var items = $$(into + ' .chkbx');
                for (var i = 0; i < items.length; i++) {
                    (function(ele) {
                        ele.checked = true;
                        var parent = ele.closest('div.item-holder');
                        if (parent) parent.style.backgroundColor = itemSelectedColor;
                    })(items[i]);
                }
                el.value = 'true';
            } else {
                var items = $$(into + ' .chkbx');
                for (var i = 0; i < items.length; i++) {
                    (function(ele) {
                        ele.checked = false;
                        var parent = ele.closest('div.item-holder');
                        if (parent.getAttribute('rel') == 'white') {
                            parent.style.backgroundColor = '#fff';
                        } else {
                            parent.style.backgroundColor = '#fafafa';
                        }
                    })(items[i]);
                }
                el.value = 'false';
            }
        }
        
        updateBookmarkButtons();
    }


    function updateBookmarkButtons() {
        var into = getActiveBookmark() == 'history' ? '#rh-views-insert' : '#rh-views-search-insert';
        var checkedItems = $$(into + ' .chkbx:checked');
        var checkedCount = checkedItems.length;
        
        if (checkedCount > 0) {
            $('delete-bookmark-button').style.display = 'inline-block';
        } else {
            $('delete-bookmark-button').style.display = 'none';
        }
        
        if (checkedCount == 1) {
            $('edit-bookmark-button').style.display = 'inline-block';
        } else {
            $('edit-bookmark-button').style.display = 'none';
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
                
                for (var i = 0; i < checkedItems.length; i++) {
                    (function(el) {
                        var holder = el.closest('div.item-holder');
                        var bookmarkId = holder.getAttribute('data-bookmark-id');
                        
                        if (bookmarkId) {
                            chrome.bookmarks.remove(bookmarkId, function() {
                                deleteCount++;
                                holder.remove();
                                
                                if (deleteCount == totalCount) {
                                    $('master-check-all').checked = false;
                                    $('master-check-all').value = 'false';
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
                    })(checkedItems[i]);
                }
            }
        }
    }


    function resetBookmarkSelectionState() {
        if ($('master-check-all')) {
            $('master-check-all').checked = false;
            $('master-check-all').value = 'false';
        }
        selectedItem = undefined;
        updateBookmarkButtons();
    }


    function refreshBookmarkView() {
        var activeView = getActiveBookmark();
        var query = $('rh-search') ? $('rh-search').value : '';
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
        var holder = checkbox.closest('div.item-holder');
        if (!holder) {
            return null;
        }
        return {
            id: holder.getAttribute('data-bookmark-id'),
            title: holder.getAttribute('data-bookmark-title'),
            url: holder.getAttribute('data-bookmark-url'),
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