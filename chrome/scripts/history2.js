// Tree Style History - tree-shaped history page
//
// An ES module: every function it calls is imported, not read off `window`.

import { $, $$ } from './dom-helper.js';
import { TimeToStr, dateFormat, getFaviconUrl } from './modules/helpers.js';
import { filtUrl } from './modules/config.js';
import { calendar, showCalendar } from './modules/calendar.js';
import { alertLoadingHistory } from './modules/history-core.js';
import { createTree, bindTreeSearch } from './modules/tree.js';
import { modifierState } from './modules/ui-state.js';
import { initPage } from './modules/page-init.js';

initPage();

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

    // Shift listener
    document.body.addEventListener('keydown', function (e) {
        if (e.keyCode == 16 && !modifierState.shift) {
            modifierState.shift = true;
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 16) {
            modifierState.shift = false;
        }
    });

    var calBtns = $$('#showCalendar');
    for (var i = 0; i < calBtns.length; i++) {
        calBtns[i].addEventListener('click', function (e) {
            showCalendar();
        });
    }

    // updateFilter();

    // Date events
    var derhdf = dateFormat();
    derhdf = derhdf.replace('dd', 'dsdi').replace('mm', 'dsmi').replace('yyyy', 'dsyi');
    derhdf = derhdf.split('/');
    $(derhdf[0]).innerHTML = '<select class="select" id="date-select-day"></select>';
    $(derhdf[1]).innerHTML = '<select class="select" id="date-select-month"><option value="01">01</option><option value="02">02</option><option value="03">03</option><option value="04">04</option><option value="05">05</option><option value="06">06</option><option value="07">07</option><option value="08">08</option><option value="09">09</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select>';
    $(derhdf[2]).innerHTML = '<select class="select" id="date-select-year"></select>';

    $('date-select-day').addEventListener('change', function () {
        calendar('selected', '', function() { loadHistory('yes', ''); });
        //   historyView('yes', '');
        loadHistory('yes', '');
    });
    $('date-select-month').addEventListener('change', function () {
        calendar('selected', '', function() { loadHistory('yes', ''); });
        //   historyView('yes', '');
        loadHistory('yes', '');
    });
    $('date-select-year').addEventListener('change', function () {
        calendar('selected', '', function() { loadHistory('yes', ''); });
        //   historyView('yes', '');
        loadHistory('yes', '');
    });

    // Calendar init

    calendar('current', '', function() { loadHistory('yes', ''); });

    function loadHistory(w, q) {
        if (w == 'yes') {
            var day = Number($('date-select-day').value);
            var month = Number($('date-select-month').value) - 1;
            var year = Number($('date-select-year').value);
            var today = new Date(year, month, day, 23, 59, 59, 999);
            var today0 = new Date(year, month, day, 0, 0, 0, 0);

            pre_History(today0.getTime(), today.getTime());
        } else if (w == 'current') {
            var ndc = new Date();
            today = new Date(ndc.getFullYear(), ndc.getMonth(), ndc.getDate(), 23, 59, 59, 999);
            pre_History(0, 0);
        }
    }


    // Named for what it does now: there is no zTree callback any more, just a
    // click on a node carrying a URL.
    function onClickNodeUrl(event, treeId, treeNode) {
        chrome.tabs.query({ url: treeNode.t }, function (tabs) {
            if (tabs.length > 0) {
                chrome.windows.update(tabs[0].windowId, { focused: true }, function () {
                    chrome.tabs.update(tabs[0].id, { active: true } );
                });
            } else {
                window.open(treeNode.t, "_blank");
            }
        });
    }; 

    // 待插入的全部数据
    var zNodes = [];
    // 待插入的部分数据
    var yNodes = [];

    var nNodes = [
        { id: 1, pId: 0, name: "正在解析数据中", t: "😴", open: true },
        { id: 2, pId: 1, name: "请稍后再试...", t: "🤣", open: true }
    ];

    var mNodes = [
        { id: 3, pId: 1, name: "没有找到浏览历史", t: "😴", open: true }
    ];

    var tag = {};

    var pIDs = {};

    var showLessItem = localStorage['less-item'];


    // The tree itself: scripts/modules/tree.js renders the same class
    // vocabulary zTree did, so css/zTreeStyle.css still draws the icons, the
    // connector line and the indentation. jQuery, zTree, its locally patched
    // exhide extension and fuzzysearch.js are gone from this page — see the
    // header comment in modules/tree.js for what replaced them and why.
    var tree = createTree($('treeDemo'), { onClick: onClickNodeUrl });
    bindTreeSearch(tree, { input: '#rh-search', tags: '#search-tag a' });
    tree.setNodes(nNodes);

    var transition_value = {
        link: "🔗",
        typed: "⌨",
        auto_toplevel: "☆",
        auto_bookmark: "☆",
        auto_subframe: "🧭",
        manual_subframe: "🧭",
        generated: "⌨",
        start_page: "🏠",
        form_submit: "⏫",
        reload: "🔄",
        keyword: "🔍",
        keyword_generated: "🔍"

        // “link”    用户通过点击页面中的链接，跳转至本URL。
        // “typed”    用户通过地址栏输入网址，来访问本URL。这种类型也适用于显式的导航动作。与之相反，你可以参阅generated，它适用于用户没看到（不知道）网址URL的情况。
        // “auto_bookmark”    用户通过界面的推荐到达本URL。例如，通过点击菜单项打开的页面。
        // auto_toplevel： 页面在命令行中指定或是浏览器的起始页面。
        // “auto_subframe”    子框架导航。这种类型是指那些非顶层框架自动加载的内容。例如，如果一个页面由许多包含广告的子框架构成，那些广告链就拥有这种过渡类型。用户可能没有意识到页面中的这些内容是个单独的框架，所以他们也可能根本没有在意这些URL（请查阅 manual_subframe)。
        // “manual_subframe”    此种类型是为用户显式请求的子框架导航以及在前进/后退列表中的生成导航入口的子框架导航所设置。由于用户更关心所请求框架被加载的效果，因此显式请求的框架可能会比自动载入的框架更为重要。
        // “generated”    用户通过在地址栏输入，而选择一个不像网址的入口到达的URL页面。例如，匹配结果中可能包含Google搜索结果页的URL, 但是它可能以“用Google搜索……”的形式展现。这类导航和 typed 导航是有差异的，因为用户没有输入或者看到最终的URL。请参阅 keyword。
        // “start_page”    页面是在命令行中被指定（打开），或者其本身就是起始页。
        // “form_submit”    
        // 用户提交的表单。请注意，某些情况，诸如表单运用脚本来提交，不属于此种类型。

        // “reload”    用户通过点击刷新按钮或者在地址栏输入回车键来刷新页面属于此种类型。会话重置，重开标签页都属于此种类型。
        // “keyword”    URL通过可替代的关键字，而不是默认的搜索引擎产生。请查阅keyword_generated。
        // “keyword_generated”    相应由关键字生成的访问。请查阅keyword。

    };

    console.log("loading...");
    var DAY = 24 * 3600 * 1000;
    var date_e = new Date();
    date_e.setHours(23); date_e.setMinutes(59); date_e.setSeconds(59); date_e.setMilliseconds(999);


    var date = new Date();
    // date.setHours(23); date.setMinutes(59); date.setSeconds(59); date.setMilliseconds(999);

    date.setHours(0); date.setMinutes(0); date.setSeconds(0); date.setMilliseconds(0);
    DAY = 24 * 3600 * 1000;

    function timeStr2(time, wait_space) {
        var datestr = dateFormat().replace('yyyy/', '').replace('/yyyy', '');

        if (time >= date && wait_space)
            return '';

        // `date + DAY` is string concatenation: `+` turns the Date into
        // "Wed Sep 10 2026 ...86400000", which then breaks `time >= date`
        // (it silently becomes a string compare) and any later getTime().
        if (new Date() - date > DAY)
            date = new Date(date.getTime() + DAY);

        var currentTime = new Date(time);
        var hours = currentTime.getHours();
        var minutes = currentTime.getMinutes();

        if (hours < 10) { hours = '0' + hours; }
        if (minutes < 10) { minutes = '0' + minutes; }
        var timeStr = hours + ':' + minutes;

        if (hours == 0 && minutes == 0) {
            timeStr = "";
        } else if (hours == 23 && minutes == 59) {
            timeStr = "";
        }


        // var month = currentTime.getMonth()+1;
        // if(month<10) {month='0'+month;}

        // var days = currentTime.getDate();
        // if(days<10) {days='0'+days;}


        return datestr.replace('dd', currentTime.getDate())
            .replace('mm', currentTime.getMonth() + 1)
            + ' ' + timeStr;
    }


    var db;

    dbManager.ready(function(database) {
        db = database;
        if (db != undefined)
            pre_History(0, 0);
        else {
            console.warn('IndexedDB is not available.');
            alertLoadingHistory(true);
        }
    }).catch(function(error) {
        console.error('Failed to initialize database:', error);
        alertLoadingHistory(true);
    });

    function pre_History(loadfrom, loadto) {
        alertLoadingHistory(false);

        zNodes = [];
        tag = {};
        pIDs = {};

        if (loadfrom > 0 && loadto > 0) {
            console.log("loadHistory time from " + loadfrom.toString() + " to " + loadto.toString());
            feach_History(loadfrom, loadto, 0);
        } else {
            let time = (date).getTime() - DAY * (localStorage["load-range2"]);
            console.log("loadHistory time from " + new Date(time).toString());
            feach_History(time, (date_e).getTime(), 0);
        }


    }




    function feach_History(loadfrom, loadto, t) {

        var transaction = db.transaction(["VisitItem"], "readonly");
        var objectStore = transaction.objectStore("VisitItem");
        // 索引，最后的访问时间大于日期上限
        let result = objectStore.index('visitTime');
        yNodes = [];
        let c;

        if (t == 0) {
            console.log("feach_History " + t + " from " + loadfrom.toString() + " to " + loadto.toString());
            c = result.openCursor(IDBKeyRange.bound(loadfrom, loadto), "prev");    //倒序条件查询
        } else {
            console.log("feach_History " + t + " from " + loadfrom.toString() + " to " + loadto.toString());
            c = result.openCursor(IDBKeyRange.bound(loadfrom - DAY * t, loadfrom - DAY * (t - 1)), "prev");    //倒序条件查询
        }

        c.onsuccess = function (e) {
            var cursor = e.target.result;
            if (cursor != undefined) {
                let v = cursor.value;
                // Not `t`: that name is feach_History()'s page counter, and the
                // recursion in the branch below depends on reaching it.
                let transitionIcon = transition_value[v.transition];

                if (filtUrl(v.url) == false) {
                    let node = {
                    id: v.visitId,
                    pId: parseInt(v.referringVisitId),
                    // The raw title: a page title is attacker-controlled,
                    // and escaping it is the renderer's job — it knows it
                    // is writing text content, and it has to escape after
                    // highlighting or a keyword cuts an entity in half.
                    name: TimeToStr(v.visitTime, true, true) + " - " + v.title + ' ' + transitionIcon,
                        // url: v.url,
                        icon: getFaviconUrl(v.url.replace(/(?<![\/])\/[^\/].+/, "")),
                        open: true,
                        transition: v.transition,
                        t: v.url //+ " "+v.referringVisitId + ">"+v.visitId
                    };

                    tag[transitionIcon] = true;

                    pIDs[v.referringVisitId] = true;

                    yNodes.push(node);
                }

                cursor.continue();
            } else {

                zNodes = zNodes.concat(yNodes);

                if (zNodes.length < localStorage['load-range4'] && loadfrom - DAY * t > date - localStorage['load-range3'] * DAY) {
                    feach_History(loadfrom, loadto, t + 1);
                } else {
                    // No "remove every node first" pass: zNodes is the whole
                    // set, and setNodes() replaces it in one render. Removing
                    // them one by one re-rendered the tree once per row.
                    if (zNodes.length > 0 && showLessItem == 'yes') {

                        let urls = {};

                        for (let s = 0; s < zNodes.length; s++) {
                            let ss = zNodes[s];
                            while (pIDs[ss.id] != true) {
                                if (ss.transition == 'reload' || urls[ss.url] == true) {
                                    zNodes.splice(s, 1);
                                } else {
                                    urls[ss.url] = true;
                                    break;
                                }

                                if (s < zNodes.length)
                                    ss = zNodes[s];
                                else
                                    break;
                            }
                        }
                    }

                    tree.setNodes(zNodes.length > 0 ? zNodes : mNodes);
                    $('calendar-total-value').textContent = zNodes.length;

                    // $('header-text').set('text',new Date(loadfrom-DAY*t).toLocaleString()+' - '+new Date(loadto).toLocaleString());
                    $('header-text').textContent = timeStr2(new Date(loadfrom - DAY * t), false) + ' ~ ' + timeStr2(new Date(loadto), true);
                    refreshSearchTags();
                    // 
                    alertLoadingHistory(true);
                    console.log(" pre_History() finish :( ");
                }



            }

        }

        c.onerror = function (event) {
            console.log(" loadHistory() Error :( " + event);
            alertLoadingHistory(true);
        };


    }


    function refreshSearchTags() {
        /*     for()
        
            let
            name: timeStr(v.visitTime)+" - "+ v.title +' '+transition_value[v.transition] ,
            url: v.url,
            icon: getFaviconUrl(v.url),
            open: true,
            t:v.url + " "+v.referringVisitId + ">"+v.visitId
            };
        
        tag[v.transition]=true;
         */




        var searchTagLinks = $$('#search-tag a');
        for (var i = 0; i < searchTagLinks.length; i++) {
            (function(e) {
                if (tag[e.textContent]) {
                    e.style.cssText = '';
                } else {
                    e.style.cssText = 'display:none';
                }
            })(searchTagLinks[i]);
        }

    }





    });
});