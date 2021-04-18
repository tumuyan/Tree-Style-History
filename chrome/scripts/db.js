
// 测试，此测试证明 修改某项数据不能直接用put，而是需要先读后改
function put_test() {

    // set up
    var request, db;
    request = window.indexedDB.open("testDB", 2);
    request.onerror = function (event) {
        console.log("Error opening DB", event);
    }

    request.onsuccess = function (event) {
        console.log("Success opening DB");
        db = event.target.result;
    }

    // put

    var transaction = db.transaction(["urls"], "readwrite");
    transaction.oncomplete = function (event) {

        console.log("put complete");
    };

    transaction.onerror = function (event) {
        console.log("put Error :( [");
    };

    var objectStore = transaction.objectStore("urls");
    var a = { id: "10000", url: "https://github.com/espressif/arduino-esp32/tree/esp32s2/libraries/ESP32/examples/I2S/HiFreq_ADC", lastVisitTime: 1610383207104.365, visitCount: 4, title: "arduino-esp32/libraries/ESP32/examples/I2S/HiFreq_ADC at esp32s2 · espressif/arduino-esp32" }
    objectStore.put(a);


    // get

    var transaction = db.transaction(["urls"], "readwrite");
    var objectStore = transaction.objectStore("urls");

    var request2 = objectStore.get("10000");

    var r;

    request2.onsuccess = function (event) {
        r = request2.result;
        if (request2.result) {
            console.log('id: ' + request2.result.id);
            console.log('url: ' + request2.result.url);
            console.log('loadto: ' + request2.result.loadto);
        } else {
            console.log('未获得数据记录');
        }
    };
    transaction.onerror = function (event) {
        console.log("get Error :( [");
    };

    // - get and put
    var transaction = db.transaction(["urls"], "readwrite");
    var objectStore = transaction.objectStore("urls");

    var request2 = objectStore.get("10000");

    request2.onsuccess = function (event) {
        var r = request2.result;
        r.loadto = 80;
        var transaction = db.transaction(["urls"], "readwrite");
        transaction.oncomplete = function (event) {

            console.log("put complete");
        };

        transaction.onerror = function (event) {
            console.log("put Error :( [");
        };

        var objectStore = transaction.objectStore("urls");
        objectStore.put(r);
    };
    transaction.onerror = function (event) {
        console.log("get Error :( [");
    };

}


/*
function set_history(url, visitId, referringVisitId, visitTime, title) {
    if (db && visitId && url) {
        var name = url;
        console.log("referringVisitId = " + referringVisitId);

        var transaction = db.transaction(["VisitItem"], "readwrite");
        transaction.oncomplete = function (event) {
            //        console.log("Success :) ["+visitCount+"] "+url);
        };

        transaction.onerror = function (event) {
            console.log("Error :( [" + visitId + "] " + url);
        };
        var objectStore = transaction.objectStore("VisitItem");
        //
        console.log("referringVisitId = " + referringVisitId);
        objectStore.put({
            visitId: visitId,
            referringVisitId: referringVisitId,
            url: url,
            visitTime: visitTime,
            title: title
        });
    } else {
        console.log("request=null 2");
    }
}

function add_history(url, title) {

    let details = { url: url };
    chrome.history.getVisits(details, function (h) {
        for (i = 0; i < h.length; i++) {
            let ref = h[i].referringVisitId;
            let tra = h[i].transition;

            // "link", "typed", "auto_bookmark", "auto_subframe", "manual_subframe", "generated", "auto_toplevel", "form_submit", "reload", "keyword", "keyword_generated"]
            // if(h== "link"|| h== "typed"|| h== "auto_bookmark"|| h==)

            set_history(url, h[i].visitId, h[i].referringVisitId, h[i].visitTime, title);
            //   console.log("i="+i + "/"+h.length+" url="+details.url+" id="+h[i].visitId +" ref="+h[i].referringVisitId + " transition ="+h[i].transition  );
        }

    })
} */







/* 
function set_history(url, visitId, referringVisitId, visitTime, title) {
    if (db && visitId && url) {
        var name = url;
        console.log("referringVisitId = " + referringVisitId);

        var transaction = db.transaction(["VisitItem"], "readwrite");
        transaction.oncomplete = function (event) {
            //        console.log("Success :) ["+visitCount+"] "+url);
        };

        transaction.onerror = function (event) {
            console.log("Error :( [" + visitId + "] " + url);
        };
        var objectStore = transaction.objectStore("VisitItem");
        // 
        console.log("referringVisitId = " + referringVisitId);
        objectStore.put({
            visitId: visitId,
            referringVisitId: referringVisitId,
            url: url,
            visitTime: visitTime,
            title: title
        });
    } else {
        console.log("request=null 2");
    }
}

function add_history(url, title) {

    let details = { url: url };
    chrome.history.getVisits(details, function (h) {
        for (i = 0; i < h.length; i++) {
            let ref = h[i].referringVisitId;
            let tra = h[i].transition;

            // "link", "typed", "auto_bookmark", "auto_subframe", "manual_subframe", "generated", "auto_toplevel", "form_submit", "reload", "keyword", "keyword_generated"]
            // if(h== "link"|| h== "typed"|| h== "auto_bookmark"|| h==)

            set_history(url, h[i].visitId, h[i].referringVisitId, h[i].visitTime, title);
            //   console.log("i="+i + "/"+h.length+" url="+details.url+" id="+h[i].visitId +" ref="+h[i].referringVisitId + " transition ="+h[i].transition  );
        }

    })
}

 */
/* 

var request_url, db_url; 
    request_url = window.indexedDB.open("UrlDB", 2);
    request_url.onerror = function(event){
        console.log("Error opening Url DB", event);
    }
    request_url.onupgradeneeded   = function(event){
        console.log("Upgrading Url Db");
        db_url = event.target.result;
        var objectStore = db_url.createObjectStore("urls", { keyPath : "id" });
        objectStore.createIndex('url', 'url', { unique: false });
        objectStore.createIndex('lastVisitTime', 'lastVisitTime', { unique: false });
        objectStore.createIndex('visitCount ', 'visitCount ', { unique: false });
        objectStore.createIndex('title', 'title', { unique: false });
    };
    request_url.onsuccess  = function(event){
        console.log("Success opening Url DB");
        db_url = event.target.result;
    }
 */




function get_history(key){
    

    chrome.history.search({ text: key, maxResults: 0, startTime: (new Date()).getTime() - ((localStorage["load-range"]+1) * 24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {

        if (hi.length > 0) {

            hi.sort(function (a, b) { return b.lastVisitTime - a.lastVisitTime });

            for (i = 0; i < hi.length; i++) {

                if (hi[i] !== undefined) {

                    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(hi[i].title) == false && (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(hi[i].url) == false) {

                        var currentTime = new Date(hi[i].lastVisitTime);
                        var hours = currentTime.getHours();
                        var minutes = currentTime.getMinutes();
                        if (hours < 10) { hours = '0' + hours; }
                        if (minutes < 10) { minutes = '0' + minutes; }
                        var time = hours + ':' + minutes;

                        var title = hi[i].title;
                        var url = hi[i].url;
                        var furl = 'chrome://favicon/' + hi[i].url;

                        if (title == '') {
                            title = url;
                        }

                        //    add_history(url,title);
                        // add_url(hi[i].id, url, title, hi[i].lastVisitTime, hi[i].visitCount);
                        //    console.log("url="+url+" ");
                        mv.push({ url: url, favicon: furl, title: title.replace(/\"/g, '&#34;'), visitCount: hi[i].visitCount });

                        r++;
                    }

                }

            }

            localStorage['mv-cache'] = JSON.encode(mv);

        } else {
            localStorage['mv-cache'] = 'false';
        }

    });

}


function get_history_pre(visitId) {
    if (visitId == 0)
        return;
    var transaction = db.transaction(["VisitItem"]);
    var objectStore = transaction.objectStore("VisitItem");
    let request = objectStore.get(visitId);
    request.onerror = function (event) {
        // 异常处理!  
    };
    request.onsuccess = function (event) {

        let r = request.result;

        if(r != undefined){
            let referringVisitId = r.referringVisitId;

            let url = r.url;
/*             zNodes.push({
                id: visitId,
                pId: referringVisitId,
                name: request.result.title,
                url: url,
                icon: 'chrome://favicon/' + url,
                open: true
            });
 */
            // zNodes.push(  { id:143, pId:3, name:"测试节点x3 - 3", t:"唉，随便点我吧"});
            console.log("get_history_pre "+ r.referringVisitId +" visitId="+visitId);
            var treeObj = $jq.fn.zTree.getZTreeObj("treeDemo");
            treeObj.addNodes(null,{
                id: visitId,
                pId: referringVisitId,
                name: r.title+transition_value[r.transition] ,
                url: url,
                icon: 'chrome://favicon/' + url,
                open: true,
                t:url
            },
            false );
            // treeObj.reAsyncChildNodes(null, "refresh");
            get_history_pre(referringVisitId);
        }else{
            console.log("get_history_pre no_result visitId="+visitId);
        }

    };
}
