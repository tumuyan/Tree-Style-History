document.addEventListener('DOMContentLoaded', function(){
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
    
    $('delete-button').value = returnLang('deleteItems');
    $('delete-range-button').value = returnLang('deleteItems');
    
    // Toggle history
    
    if(localStorage['rh-group'] == 'no'){
      $('rh-bar-group').style.backgroundPosition = 'right center';
    }
    if(localStorage['rh-orderby'] == 'title'){
      $('rh-bar-orderby').style.backgroundPosition = 'right center';
      $('rh-bar-orderby').title = returnLang('orderByTime');       
    } else {
        $('rh-bar-orderby').title = returnLang('orderByTitle'); 
        }
    $('rh-bar-order').title = returnLang('order'); 
    if(localStorage['rh-order'] == 'asc'){
      $('rh-bar-order').style.backgroundPosition = 'right center';
    }
    $('rh-bar-group').title = returnLang('group');  
    $('rh-bar-group').addEventListener('click', function(){
      var rhgv = localStorage['rh-group'];
      if(rhgv == 'yes'){
        $('rh-bar-group').style.backgroundPosition = 'right center';
        localStorage['rh-group'] = 'no';
      }else if(rhgv == 'no'){
        $('rh-bar-group').style.backgroundPosition = 'left center';
        localStorage['rh-group'] = 'yes';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').value;
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    $('rh-bar-orderby').addEventListener('click', function(){
      var rhgv = localStorage['rh-orderby'];
      if(rhgv == 'date'){
        $('rh-bar-orderby').style.backgroundPosition = 'right center';
        $('rh-bar-orderby').title = returnLang('orderByTime');
        localStorage['rh-orderby'] = 'title';
      }else if(rhgv == 'title'){
        $('rh-bar-orderby').style.backgroundPosition = 'left center';
        $('rh-bar-orderby').title = returnLang('orderByTitle');    
        localStorage['rh-orderby'] = 'date';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').value;
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    $('rh-bar-order').addEventListener('click', function(){
      var rhgv = localStorage['rh-order'];
      if(rhgv == 'desc'){
        $('rh-bar-order').style.backgroundPosition = 'right center';
        localStorage['rh-order'] = 'asc';
      }else if(rhgv == 'asc'){
        $('rh-bar-order').style.backgroundPosition = 'left center';
        localStorage['rh-order'] = 'desc';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').value;
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    
    // Scroll events
    
    window.addEventListener('scroll', function(){
      var wcv = window.scrollY || window.pageYOffset;
      if(wcv > 115){
        var cal = $('calendar');
        cal.style.position = 'fixed';
        cal.style.top = '15px';
      }else{
        var cal = $('calendar');
        cal.style.position = 'absolute';
        cal.style.top = '129px';
      }
    });
    
    // Shift listener
    
    document.body.addEventListener('keydown', function(e){
      if(e.keyCode == 16 && shiftState == 'false'){
        shiftState = 'true';
      }
    });
    document.body.addEventListener('keyup', function(e){
      if(e.keyCode == 16){
        shiftState = 'false';
      }
    });

    var showCalEl = $$('#showCalendar');
    if (showCalEl.length > 0) {
      showCalEl[0].addEventListener('click', function (e) {
        showCalendar();
      });
    }
    
    // Date events
    
    var derhdf = localStorage['rh-date'];
    derhdf = derhdf.replace('dd', 'dsdi').replace('mm', 'dsmi').replace('yyyy', 'dsyi');
    derhdf = derhdf.split('/');
    $(derhdf[0]).innerHTML = '<select class="select" id="date-select-day"></select>';
    $(derhdf[1]).innerHTML = '<select class="select" id="date-select-month"><option value="01">01</option><option value="02">02</option><option value="03">03</option><option value="04">04</option><option value="05">05</option><option value="06">06</option><option value="07">07</option><option value="08">08</option><option value="09">09</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select>';
    $(derhdf[2]).innerHTML = '<select class="select" id="date-select-year"></select>';
    
    $('date-select-day').addEventListener('change', function(){
      calendar('selected', '');
      history('yes', '');
    });
    $('date-select-month').addEventListener('change', function(){
      calendar('selected', '');
      history('yes', '');
    });
    $('date-select-year').addEventListener('change', function(){
      calendar('selected', '');
      history('yes', '');
    });
    
    // Calendar init
    
    calendar('current', '');


            //获取Location对象的search属性值
            var searchStr = location.search;

            if(searchStr.length>1){
                //由于searchStr属性值包括“?”，所以除去该字符
                console.log("searchStr"+searchStr);
                let site = new URL(searchStr.substr(1), window.location.href).hostname;
                if(site != undefined ){
                    searchStr = site.split('?')[0];
                    if(searchStr.length>0){
                           $('rh-what').value ="all";
//                         $('rh-what').getSelected().get('value');
//                             $jq('#rh-what').val("current");
                                $("rh-search").value =searchStr;
                                history('search', searchStr);
                    }
                }else{
                 searchStr='';
                 }
            }else{
                searchStr-'';
            }

            if(searchStr=='')
                 history('current', '');
    
    // Calendar range toggle
    
    $('delete-range-toggle-button').addEventListener('click', function(){
      var drtb = this;
      var drtbcs = parseInt(getStyle($('calendar'), 'width'), 10) || 0;
      var cal = $('calendar');
      if (cal) {
          cal.style.transition = 'width 0.35s linear';
          if(drtbcs == 336){
              cal.style.width = '170px';
              setTimeout(function(){
                  drtb.style.backgroundPosition = 'left top';
              }, 350);
          } else if(drtbcs == 170){
              cal.style.width = '336px';
              setTimeout(function(){
                  drtb.style.backgroundPosition = 'right top';
              }, 350);
          }
      }
    });
    
    // Search events
    
    $('rh-what').addEventListener('change', function(){
      var sv = $('rh-search').value;
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
        history('search', sv);
      }
    });
    $('rh-search').addEventListener('keyup', function(){
      var sv = this.value;
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
          if(sv!=searchStr){
            sv==searchStr;
            history('search', sv);
         }
        $('rh-views-insert').style.display = 'none';
        $('rh-views-search-insert').style.display = 'block';

      }else{
        $('rh-views-insert').style.display = 'block';
        $('rh-views-search-insert').style.display = 'none';
      }
    });
    $('rh-clear-search').addEventListener('click', function(){
      $('rh-search').value = '';
      $('rh-search').focus();
      $('rh-views-insert').style.display = 'block';
      $('rh-views-search-insert').style.display = 'none';
      $('rh-views-search-insert').textContent = '';
      var uioneInput = document.body.querySelector('#rh-bar-uione input');
      if (uioneInput) uioneInput.checked = false;
    });
    $('rh-search').focus();
    
    // Range date
    
    var rdp = [$('delete-range-one'), $('delete-range-two')];
    for(r=0;r<rdp.length;r++){
      new DatePicker(rdp[r], {format: derhdf});
    }
  
    // Assign events
  
    $('master-check-all').addEventListener('click', function(){ selectHistoryItem(this, 'all'); });
    $('delete-range-button').addEventListener('click', function(){ deleteHistoryItem('range'); });
    $('delete-button').addEventListener('click', function(){ deleteHistoryItem('selected'); });







    });
});