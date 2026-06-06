document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {

        //释放jquery中$定义，并直接使用jQuery代替平时的$
    var $jq = jQuery.noConflict();

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
        if (e.keyCode == 16 && shiftState == 'false') {
            shiftState = 'true';
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 16) {
            shiftState = 'false';
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
    var derhdf = localStorage['rh-date'];
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
            var today = new Date(ndc.getFullYear(), ndc.getMonth(), ndc.getDate(), 23, 59, 59, 999);
            pre_History(0, 0);
        }
    }


    // ztree
    var setting = {

        view: {
            nameIsHTML: true, //允许name支持html                
            selectedMulti: false
        },
        edit: {
            enable: false,
            editNameSelectAll: false
        },

        data: {
            key: {
                title: "t"
            },
            simpleData: {
                enable: true,
                pIdKey: "pId"
            }
        },
/*         callback: {
            beforeRightClick: function (treeId, treeNode) {
                //   var zTree = $.fn.zTree.getZTreeObj("tree");
                if (treeNode == null) {
                    // demoIframe.attr("src", treeNode.file + ".html");
                    console.log('click R null');
                    rightmenu('', 0, 0);
                    return false;
                }

                if (treeNode.isParent == true) {
                    // zTree.expandNode(treeNode);
                    console.log('click R parent');
                    return true;
                } else {
                    // demoIframe.attr("src", treeNode.file + ".html");
                    console.log('click R');
                    rightmenu('', 0, 0);
                    return false;
                }
            },
            onRightClick: zTreeOnRightClick
        } */
    };


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

    var tag = {};

    var loadzNode = false;

    $jq.fn.zTree.init($jq("#treeDemo"), setting, nNodes);
    var treeObj = $jq.fn.zTree.getZTreeObj("treeDemo");
    fuzzySearch('treeDemo', '#rh-search', null, false, '#search-tag a');

    // var Filter = fuzzySearchNow('treeDemo','#rh-search',null,false);

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
    var DAY = 24 * 3600 * 1000;

    function timeStr2(time, wait_space) {
        var datestr = localStorage['rh-date'].replace('yyyy/', '').replace('/yyyy', '');

        if (time >= date && wait_space)
            return '';

        if (new Date() - date > DAY)
            date = date + DAY;

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

        var transaction = db.transaction(["closed"], "readwrite");
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
                let t = transition_value[v.transition];

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
                        name: TimeToStr(v.closeTime, true, true) + " - " + v.title.replace(/[<>]/g, ' '),
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
                    let nodes = treeObj.getNodes();
                    while (nodes && nodes.length > 0) {
                        treeObj.removeNode(nodes[0], false);
                        // treeObj.removeNode(nodes,false);
                    }

                    if (zNodes.length > 0) {
                        treeObj.addNodes(null, zNodes, false);
                        // $('calendar-total-value').set('text',zNodes.length);
                    } else {
                        treeObj.addNodes(null, mNodes, false);
                        // $('search-tag').set('text','');
                        // $('calendar-total-value').set('text', '0');
                    }
                    $('calendar-total-value').textContent = zNodes.length;

                    // $('header-text').set('text',new Date(loadfrom-DAY*t).toLocaleString()+' - '+new Date(loadto).toLocaleString());
                    $('header-text').textContent = timeStr2(new Date(loadfrom - DAY * t), false) + ' ~ ' + timeStr2(new Date(loadto), true);
                    refreshSearchTags();
                    refreshRMenu();
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


function refreshRMenu(){
    var treeLinks = $('treeDemo').querySelectorAll('a[href="#"]');
    for (var i = 0; i < treeLinks.length; i++) {
        (function(el) {
            if (el.id != undefined) {
                el.addEventListener('click', function () {
                    var subLinks = $$('#' + this.id.replace('_a',' a'));
                    for (var j = 0; j < subLinks.length; j++) {
                        (function(em) {
                            if (em.href != undefined) {
                                if (em.href.length > 3)
                                    window.open(em.href);
                            }
                        })(subLinks[j]);
                    }
                });
            }
        })(treeLinks[i]);
    }
}





    });
});