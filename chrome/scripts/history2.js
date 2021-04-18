document.addEvent('domready', function(){

    //释放jquery中$定义，并直接使用jQuery代替平时的$
    var $jq =  jQuery.noConflict();

    // Fade in  
    var historyFx = new Fx.Morph('history-container', {duration: 250});
    if(chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en'){
      var ho = {
        'margin-right': [150, 180],
        'opacity': [0, 1]
      };
    }else{
      var ho = {
        'margin-left': [150, 180],
        'opacity': [0, 1]
      };
    }
    historyFx.start(ho);
  
    // Shift listener
    $(document.body).addEvent('keydown', function(e){
      if(e.event.keyCode == 16 && shiftState == 'false'){
        shiftState = 'true';
      }
    });
    $(document.body).addEvent('keyup', function(e){
      if(e.event.keyCode == 16){
        shiftState = 'false';
      }
    });
    
    // Date events
    var derhdf = localStorage['rh-date'];
    derhdf = derhdf.replace('dd', 'dsdi').replace('mm', 'dsmi').replace('yyyy', 'dsyi');
    derhdf = derhdf.split('/');
    $(derhdf[0]).set('html', '<select class="select" id="date-select-day"></select>');
    $(derhdf[1]).set('html', '<select class="select" id="date-select-month"><option value="01">01</option><option value="02">02</option><option value="03">03</option><option value="04">04</option><option value="05">05</option><option value="06">06</option><option value="07">07</option><option value="08">08</option><option value="09">09</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select>');
    $(derhdf[2]).set('html', '<select class="select" id="date-select-year"></select>');
    
    $('date-select-day').addEvent('change', function(){
      calendar2('selected', '');
    //   history('yes', '');
      loadHistory('yes', '');
    });
    $('date-select-month').addEvent('change', function(){
      calendar2('selected', '');
    //   history('yes', '');
    loadHistory('yes', '');
    });
    $('date-select-year').addEvent('change', function(){
      calendar2('selected', '');
    //   history('yes', '');
    loadHistory('yes', '');
    });
    
    // Calendar init
    
    calendar2('current', '');

  
    
    function calendar2(w, e){
  
        if(isLeapYear()){
          var dayarray = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        }else{
          var dayarray = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        }
      
        if(w == 'current'){
          var cdateo = new Date();
        }else if('selected'){
          var mcheck = dayarray[($('date-select-month').getSelected().get('value')*1-1)];
          var dcheck = ($('date-select-day').getSelected().get('value')*1);
          if(mcheck < dcheck){
            var cdateo = new Date(($('date-select-year').getSelected().get('value')*1), ($('date-select-month').getSelected().get('value')*1-1), mcheck, 23, 59, 59, 999);
          }else{
            var cdateo = new Date(($('date-select-year').getSelected().get('value')*1), ($('date-select-month').getSelected().get('value')*1-1), ($('date-select-day').getSelected().get('value')*1), 23, 59, 59, 999);
          }
        }
      
        if(e == 'prev'){
          cdateo.setDate(cdateo.getDate()-1);
        }else if(e == 'next'){
          cdateo.setDate(cdateo.getDate()+1);
        }
      
        $('date-select-day').set('html', '');
        var ydatec = new Date().getFullYear();
        var mdatec = cdateo.getMonth();
        var ddatec = cdateo.getDate();
        var yeararray = [ydatec, (ydatec-1)];
      
        if(w == 'current'){
          for(i=0;i<yeararray.length;i++){
            if(i == 0){
              new Element('option', {'value': yeararray[i], 'selected': 'selected', 'text': yeararray[i]}).inject('date-select-year');
            }else{
              new Element('option', {'value': yeararray[i], 'text': yeararray[i]}).inject('date-select-year');
            }
          }
        }
      
        $$('#date-select-month option').each(function(el){
          if((mdatec)+1 == (el.get('value')*1)){
            el.set('selected', 'selected');
          }
        });
      
        for(i=0;i<=dayarray.length;i++){
          if(mdatec == i){
            for(ia=1;ia<=dayarray[i];ia++){
              if(ia == ddatec){
                ia = ia+'';
                if(ia.length == 1){
                  ia = '0'+ia;
                }
                new Element('option', {'value': ia, 'selected': 'selected', 'text': ia}).inject('date-select-day');
              }else{
                ia = ia+'';
                if(ia.length == 1){
                  ia = '0'+ia;
                }
                new Element('option', {'value': ia, 'text': ia}).inject('date-select-day');
              }
            }
          }
        }
      
        var fday = new Date(ydatec, mdatec, 1, 23, 59, 59, 999).getDay();
        var lday = new Date(ydatec, mdatec, dayarray[mdatec], 23, 59, 59, 999).getDay();
      
        $('calendar-days').set('text', '');
      
        for(ii=0;ii<dayarray[mdatec];ii++){
          if(ii == 0){
            for(d=0;d<fday;d++){
              new Element('span', {html: '&nbsp;', 'class': 'day'}).inject('calendar-days');
            }
          }
          if((ii+1) == ddatec){
            new Element('a', {
              id: 'selected',
              href: '#',
              rel: (ii+1)+'|'+(mdatec+1)+'|'+ydatec,
              text: (ii+1),
              'class': 'day',
              events: {
                click: function(){
                  var cel = this;
                  $$('#date-select-day option').each(function(el){
                    if(el.get('value').toInt() == cel.get('text').toInt()){
                      el.set('selected', 'selected');
                    }else{
                      el.set('selected', '');
                    }
                  });
                  $$('#calendar-days a#selected').removeProperty('id');
                  cel.set('id', 'selected');
                //   history('yes', '');
                loadHistory('yes', '');
                }
              }
            }).inject('calendar-days');
          }else{
            new Element('a', {
              href: '#',
              text: (ii+1),
              'class': 'day',
              events: {
                click: function(){
                  var cel = this;
                  $$('#date-select-day option').each(function(el){
                    if(el.get('value').toInt() == cel.get('text').toInt()){
                      el.set('selected', 'selected');
                    }else{
                      el.set('selected', '');
                    }
                  });
                  $$('#calendar-days a#selected').removeProperty('id');
                  cel.set('id', 'selected');
                //   history('yes', '');
                loadHistory('yes', '');
                }
              }
            }).inject('calendar-days');
          }
          if((ii+1) == dayarray[mdatec]){
            for(d=0;d<(6-lday);d++){
              new Element('span', {html: '&nbsp;', 'class': 'day'}).inject('calendar-days');
            }
          }
        }
      
      }
      
      

    function loadHistory(w,q){
        if(w == 'yes'){
            var day = ($('date-select-day').getSelected().get('value')*1);
            var month = ($('date-select-month').getSelected().get('value')*1-1);
            var year = ($('date-select-year').getSelected().get('value')*1);
            var today = new Date(year, month, day, 23, 59, 59, 999);
            var today0 = new Date(year,month,day,0,0,0,0);

            pre_History(today0.getTime(),today.getTime());
          }else if(w == 'current'){
            var ndc = new Date();
            var today = new Date(ndc.getFullYear(), ndc.getMonth(), ndc.getDate(), 23, 59, 59, 999);
            pre_History(0,0);
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
            title:"t"
        },
        simpleData: {
            enable: true,
            pIdKey: "pId"  
        }
    }
/*     ,
    callback: {
        beforeClick: beforeClick,
        onClick: onClick
    } */
};

var zNodes =[];

var nNodes = [
    { id:1, pId:0, name:"正在解析数据中", t:"😴", open:true},
    { id:2, pId:1, name:"请稍后再试...", t:"🤣", open:true}
];

var mNodes = [
    { id:3, pId:1, name:"没有找到浏览历史", t:"😴", open:true}
];

var loadzNode=false;

$jq.fn.zTree.init($jq("#treeDemo"), setting, nNodes);
var treeObj = $jq.fn.zTree.getZTreeObj("treeDemo");
fuzzySearch('treeDemo','#rh-search',null,true);


var transition_value={
    link:"🔗",
    typed:"⌨",
    auto_toplevel:"☆",
    auto_bookmark:"☆",
    auto_subframe:"[auto_subframe]",
    manual_subframe:"[manual_subframe]",
    generated:"⌨",
    start_page:"⚙️",
    form_submit:"⏫",
    reload:"🔄",
    keyword:"🔍",
    keyword_generated:"🔍"

// “link”	用户通过点击页面中的链接，跳转至本URL。
// “typed”	用户通过地址栏输入网址，来访问本URL。这种类型也适用于显式的导航动作。与之相反，你可以参阅generated，它适用于用户没看到（不知道）网址URL的情况。
// “auto_bookmark”	用户通过界面的推荐到达本URL。例如，通过点击菜单项打开的页面。
// auto_toplevel： 页面在命令行中指定或是浏览器的起始页面。
// “auto_subframe”	子框架导航。这种类型是指那些非顶层框架自动加载的内容。例如，如果一个页面由许多包含广告的子框架构成，那些广告链就拥有这种过渡类型。用户可能没有意识到页面中的这些内容是个单独的框架，所以他们也可能根本没有在意这些URL（请查阅 manual_subframe)。
// “manual_subframe”	此种类型是为用户显式请求的子框架导航以及在前进/后退列表中的生成导航入口的子框架导航所设置。由于用户更关心所请求框架被加载的效果，因此显式请求的框架可能会比自动载入的框架更为重要。
// “generated”	用户通过在地址栏输入，而选择一个不像网址的入口到达的URL页面。例如，匹配结果中可能包含Google搜索结果页的URL, 但是它可能以“用Google搜索……”的形式展现。这类导航和 typed 导航是有差异的，因为用户没有输入或者看到最终的URL。请参阅 keyword。
// “start_page”	页面是在命令行中被指定（打开），或者其本身就是起始页。
// “form_submit”	
// 用户提交的表单。请注意，某些情况，诸如表单运用脚本来提交，不属于此种类型。

// “reload”	用户通过点击刷新按钮或者在地址栏输入回车键来刷新页面属于此种类型。会话重置，重开标签页都属于此种类型。
// “keyword”	URL通过可替代的关键字，而不是默认的搜索引擎产生。请查阅keyword_generated。
// “keyword_generated”	相应由关键字生成的访问。请查阅keyword。

};

var request, db;
request = window.indexedDB.open("testDB", 2);
request.onerror = function (event) {
    console.log("Error opening DB", event);
}
request.onupgradeneeded = function (event) {
    console.log("Upgrading");
    db = event.target.result;
    var objectStore = db.createObjectStore("VisitItem", { keyPath: "visitId" });
    objectStore.createIndex('url', 'url', { unique: false });
    objectStore.createIndex('visitTime', 'visitTime', { unique: false });
    objectStore.createIndex('referringVisitId', 'referringVisitId', { unique: false });
    objectStore.createIndex('title', 'title', { unique: false });
    objectStore.createIndex('transition','transition', { unique: false });

    var objectStore2 = db.createObjectStore("urls", { keyPath: "id" });
    objectStore2.createIndex('url', 'url', { unique: false });
    objectStore2.createIndex('lastVisitTime', 'lastVisitTime', { unique: false });
    // objectStore2.createIndex('visitCount', 'visitCount', { unique: false });
    objectStore2.createIndex('title', 'title', { unique: false });
    objectStore2.createIndex('from_to', ['loadfrom', 'loadto'], { unique: false });

};
request.onsuccess = function (event) {
    console.log("Success opening DB");
    db = event.target.result;
    if (db)
    // get_history_pre("34752");
    pre_History(0,0);
}



console.log("loading...");
var DAY = 24 * 3600 * 1000;
var date = new Date();
date.setHours(23); date.setMinutes(59); date.setSeconds(59); date.setMilliseconds(999);


var date = new Date();
// date.setHours(23); date.setMinutes(59); date.setSeconds(59); date.setMilliseconds(999);

date.setHours(0); date.setMinutes(0); date.setSeconds(0); date.setMilliseconds(0);
var DAY = 24 * 3600 * 1000;

function timeStr(time){

    if(new Date()-date>DAY)
      date=date+DAY;

      var currentTime = new Date(time);
      var hours = currentTime.getHours();
      var minutes = currentTime.getMinutes();
      if (hours < 10) { hours = '0' + hours; }
      if (minutes < 10) { minutes = '0' + minutes; }
      var timeStr = hours + ':' + minutes;

    //   console.log('time-date='+(time-date.getTime())+' time='+time+' date='+date.getTime());

    if(time>date.getTime()){
        return timeStr;
    }


    var month = currentTime.getMonth()+1;
    if(month<10) {month='0'+month;}

    var days = currentTime.getDate();
    if(days<10) {days='0'+days;}
    
        return month+"/"+days+' '+timeStr;
}




function pre_History(loadfrom,loadto) {

    alertUserHistory(false);

    zNodes=[];

    var transaction = db.transaction(["VisitItem"], "readwrite");
    var objectStore = transaction.objectStore("VisitItem");
    // 索引，最后的访问时间大于日期上限
    let result = objectStore.index('visitTime');
    let c;

    if(loadfrom>0 && loadto >0){
        console.log("loadHistory time from " + loadfrom.toString() + " to "+loadto.toString());
        c = result.openCursor(IDBKeyRange.bound(loadfrom,loadto), "prev");	//倒序条件查询
    }else{
        let time = (new Date()).getTime() - DAY * (localStorage["load-range2"]);
        console.log("loadHistory time from " + new Date(time).toString());
        // 打开游标
        // let c = result.openCursor(IDBKeyRange.lowerBound(0));	//查询
        c = result.openCursor(IDBKeyRange.lowerBound(time), "prev");	//倒序条件查询
    }
    

    c.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor !=undefined) {
            let v =cursor.value;

            // 路径太长会影响布局
            let node = {                
                 id: v.visitId,
                 pId: parseInt(v.referringVisitId),
                name: timeStr(v.visitTime)+" - "+ v.title +' '+transition_value[v.transition] ,
                url: v.url,
                icon: 'chrome://favicon/' + v.url,
                open: true,
                t:v.url + " "+v.referringVisitId + ">"+v.visitId
            };

            zNodes.push(node);
            cursor.continue();
        }else{
            let nodes = treeObj.getNodes();
            while (nodes && nodes.length>0) {
                treeObj.removeNode(nodes[0],false);
                // treeObj.removeNode(nodes,false);
            }


            if(zNodes.length>0){
                treeObj.addNodes(null, zNodes,  false );
                // $('calendar-total-value').set('text',zNodes.length);
            }else{
                treeObj.addNodes(null, mNodes,  false );
                // $('calendar-total-value').set('text', '0');
            }
            $('calendar-total-value').set('text',zNodes.length);

            alertUserHistory(true);

            console.log(" pre_History() finish :( ");
        }     

    }

    c.onerror = function (event) {
        console.log(" loadHistory() Error :( " + event);
        alertUserHistory(true);
    };


}



});
