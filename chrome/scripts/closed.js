// Tree Style History - closed tabs page
//
// An ES module: every function it calls is imported, not read off `window`.

import { $, $$ } from './dom-helper.js';
import { TimeToStr, dateFormat, returnLang, getFaviconUrl } from './modules/helpers.js';
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


    // 待插入的全部数据
    var zNodes = [];
    // 待插入的部分数据
    var yNodes = [];

    // 节点缓存数据 (用来避免重复添加父节点)
    // 第一层 oid
    var LaNode = {};
    // 第二层 异常关闭 和 连续关闭的时间分组  LbNode用于处理异常关闭
    var LbNode = {};

    var xNodes = [];
    var L2Id = 0;
    var L2Time = 0;

    var nNodes = [
        { id: 1, pId: 0, name: "正在解析数据中", t: "😴", open: true },
        { id: 2, pId: 1, name: "请稍后再试...", t: "🤣", open: true }
    ];

    var mNodes = [
        { id: 3, pId: 1, name: "没有找到关闭页面的记录", t: "😴", open: true }
    ];

    // A page row carries its URL in `t`; a group row — a session (🗓️), a
    // burst of quick closes (🕓), an abnormal exit (⚠️) — carries a label
    // instead, because it has no URL of its own.
    function isPageUrl(value) {
        return /^(https?|ftp|ftps|file)\:\/\//i.test(String(value));
    }

    // Clicking a group reopens every page under it: README's "批量打开一个分组
    // 的全部页面". refreshRMenu() used to wire that up by walking the
    // `<a href="#">` elements zTree had just drawn; the tree reports the node
    // now, so this walks the data instead — no dependency on the markup, and
    // it survives a re-render.
    function urlsBelow(node) {
        return tree.childrenOf(node).flatMap(function (kid) {
            return isPageUrl(kid.t) ? [kid.t] : urlsBelow(kid);
        });
    }

    function onClickNodeUrl(event, treeId, treeNode) {
        if (isPageUrl(treeNode.t)) {
            chrome.tabs.query({ url: treeNode.t }, function (tabs) {
                if (tabs.length > 0) {
                    chrome.windows.update(tabs[0].windowId, { focused: true }, function () {
                        chrome.tabs.update(tabs[0].id, { active: true });
                    });
                } else {
                    window.open(treeNode.t, "_blank");
                }
            });
            return;
        }

        for (const url of urlsBelow(treeNode)) {
            window.open(url, "_blank");
        }
    }

    // The tree: scripts/modules/tree.js renders the same class vocabulary
    // zTree did, so css/zTreeStyle.css still draws the icons, the connector
    // line and the indentation. jQuery, zTree, its locally patched exhide
    // extension and fuzzysearch.js are gone from this page — see the header
    // comment in modules/tree.js for what replaced them and why.
    var tree = createTree($('treeDemo'), { onClick: onClickNodeUrl });
    bindTreeSearch(tree, {
        input: '#rh-search',
        tags: '#search-tag a',
        onStart: function () { alertLoadingHistory(false); },
        onEnd: function () { alertLoadingHistory(true); },
    });
    tree.setNodes(nNodes);

    var tag = {};



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

        LaNode = {};
        LbNode = {};
        xNodes = [];
        L2Time = 0;

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

        var transaction = db.transaction(["closed"], "readonly");
        var objectStore = transaction.objectStore("closed");
        // 索引，最后的访问时间大于日期上限
        let result = objectStore.index('closeTime');
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

                if (filtUrl(v.url) == false && v.close >= 0) {

                    if (LaNode[v.oid] != true) {
                        LaNode[v.oid] = true;
                        LbNode = {};

                        L2Id = 0;
                        yNodes.push({
                            id: v.oid,
                            pId: 0,
                            name: '🗓️',
                            url: '#',
                            icon: '',
                            open: true,
                            t: returnLang('tidClosedTab') + v.oid
                        });
                    }

                    let node = {
                        // id: 'n' + v.id,
                        id: v.id,
                        pId: L2Id,
                        // The raw title: a page title is attacker-controlled, and
                        // escaping it is the renderer's job — it knows it is
                        // writing text content, and it has to escape after
                        // highlighting or a keyword cuts an entity in half.
                        name: TimeToStr(v.closeTime, true, true) + " - " + v.title,
                        url: v.url,
                        icon: getFaviconUrl(v.url),
                        // icon:'chrome://favicon/'+site,
                        open: true,
                        oid: v.oid,
                        t: v.url // + " "+v.referringVisitId + ">"+v.visitId
                    };

                    if (v.close == 0) {

                        if (L2Time - v.closeTime > 60000 || L2Time == 0) {

                            if (L2Time != 0) {
                                let x;
                                if (xNodes.length > 4) {
                                    x = xNodes[0];
                                    yNodes.push({
                                        id: x.pId,
                                        pId: x.oid,
                                        name: '🕓',
                                        url: '#',
                                        icon: '',
                                        open: true,
                                        t: returnLang('fastClosedTab')
                                        // t: TimeToStr(xNodes[xNodes.length-1].time,true,true)+' '+TimeToStr(x.time,true,true)
                                    });
                                    yNodes = yNodes.concat(xNodes);
                                } else {
                                    for (let n = 0; n < xNodes.length; n++) {
                                        x = xNodes[n];
                                        x.pId = x.oid;
                                        yNodes.push(x);
                                    }
                                }

                            }

                            xNodes = [];
                            L2Id = 'b' + v.closeTime;
                            node.pId = L2Id;
                        }

                        xNodes.push(node);
                        L2Time = v.closeTime;

                    } else {
                        node.pId = 'b' + v.closeTime;
                        yNodes.push(node);

                        if (LbNode[v.closeTime] != true) {
                            LbNode[v.closeTime] = true;
                            yNodes.push({
                                id: 'b' + v.closeTime,
                                pId: v.oid,
                                name: '⚠️',
                                url: '#',
                                icon: '',
                                open: true,
                                t: returnLang('abnormalClosedTab')
                            });
                        }
                    }

                }

                cursor.continue();
            } else {

                zNodes = zNodes.concat(yNodes);

                let x;
                if (xNodes.length > 4) {
                    x = xNodes[0];
                    zNodes.push({
                        id: x.pId,
                        pId: x.oid,
                        name: '🕓',
                        url: '#',
                        icon: '',
                        open: true,
                        t: returnLang('fastClosedTab')
                    });
                    zNodes = zNodes.concat(xNodes);
                } else {
                    for (let n = 0; n < xNodes.length; n++) {
                        x = xNodes[n];
                        x.pId = x.oid;
                        zNodes.push(x);
                    }
                }
                xNodes = [];

                if (zNodes.length < localStorage['load-range4'] && loadfrom - DAY * t > date - localStorage['load-range3'] * DAY) {
                    feach_History(loadfrom, loadto, t + 1);
                } else {
                    // No "remove every node first" pass: zNodes is the whole
                    // set, and setNodes() replaces it in one render. Removing
                    // them one by one re-rendered the tree once per row.
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