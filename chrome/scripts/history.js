document.addEvent('domready', function(){
  
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
  
    // Language
    
    $('delete-button').set('value', returnLang('deleteItems'));
    $('delete-range-button').set('value', returnLang('deleteItems'));
    
    // Toggle history
    
    if(localStorage['rh-group'] == 'no'){
      $('rh-bar-group').setStyle('background-position', 'right center');
    }
    if(localStorage['rh-orderby'] == 'title'){
      $('rh-bar-orderby').setStyle('background-position', 'right center');
      $('rh-bar-orderby').set('title', returnLang('orderByTime') );       
    } else {
        $('rh-bar-orderby').set('title', returnLang('orderByTitle') ); 
        }
    $('rh-bar-order').set('title', returnLang('order') ); 
    if(localStorage['rh-order'] == 'asc'){
      $('rh-bar-order').setStyle('background-position', 'right center');
    }
    $('rh-bar-group').set('title', returnLang('group') );  
    $('rh-bar-group').addEvent('click', function(){
      var rhgv = localStorage['rh-group'];
      if(rhgv == 'yes'){
        $('rh-bar-group').setStyle('background-position', 'right center');
        localStorage['rh-group'] = 'no';
      }else if(rhgv == 'no'){
        $('rh-bar-group').setStyle('background-position', 'left center');
        localStorage['rh-group'] = 'yes';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').get('value');
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    $('rh-bar-orderby').addEvent('click', function(){
      var rhgv = localStorage['rh-orderby'];
      if(rhgv == 'date'){
        $('rh-bar-orderby').setStyle('background-position', 'right center');
        $('rh-bar-orderby').set('title', returnLang('orderByTime') );
        localStorage['rh-orderby'] = 'title';
      }else if(rhgv == 'title'){
        $('rh-bar-orderby').setStyle('background-position', 'left center');
        $('rh-bar-orderby').set('title', returnLang('orderByTitle') );    
        localStorage['rh-orderby'] = 'date';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').get('value');
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    $('rh-bar-order').addEvent('click', function(){
      var rhgv = localStorage['rh-order'];
      if(rhgv == 'desc'){
        $('rh-bar-order').setStyle('background-position', 'right center');
        localStorage['rh-order'] = 'asc';
      }else if(rhgv == 'asc'){
        $('rh-bar-order').setStyle('background-position', 'left center');
        localStorage['rh-order'] = 'desc';
      }
      var gahv = getActiveHistory();
      if(gahv == 'history'){
        history('yes', '');
      }else if(gahv == 'search'){
        var gahviv = $('rh-search').get('value');
        if(gahviv.length > 0){
          history('search', gahviv);
        }else{
          history('yes', '');
        }
      }
    });
    
    // Scroll events
    
    window.addEvent('scroll', function(){
      var wcv = (this.getScroll().y)*1;
      if(wcv > 115){
        $('calendar').setStyles({
          'position': 'fixed',
          'top': '15px'
        });
      }else{
        $('calendar').setStyles({
          'position': 'absolute',
          'top': '129px'
        });
      }
    });
    
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

    $$('#showCalendar').addEvent('click', function (e) {
        showCalendar();
    });
    
    // Date events
    
    var derhdf = localStorage['rh-date'];
    derhdf = derhdf.replace('dd', 'dsdi').replace('mm', 'dsmi').replace('yyyy', 'dsyi');
    derhdf = derhdf.split('/');
    $(derhdf[0]).set('html', '<select class="select" id="date-select-day"></select>');
    $(derhdf[1]).set('html', '<select class="select" id="date-select-month"><option value="01">01</option><option value="02">02</option><option value="03">03</option><option value="04">04</option><option value="05">05</option><option value="06">06</option><option value="07">07</option><option value="08">08</option><option value="09">09</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select>');
    $(derhdf[2]).set('html', '<select class="select" id="date-select-year"></select>');
    
    $('date-select-day').addEvent('change', function(){
      calendar('selected', '');
      history('yes', '');
    });
    $('date-select-month').addEvent('change', function(){
      calendar('selected', '');
      history('yes', '');
    });
    $('date-select-year').addEvent('change', function(){
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
                let site=new URI(searchStr.substr(1)).get('host');
                if(site != undefined ){
                    searchStr = site.split('?')[0];
                    if(searchStr.length>0){
                           $('rh-what').set('value',"all");
//                         $('rh-what').getSelected().get('value');
//                             $jq('#rh-what').val("current");
                                $("rh-search").set('value',searchStr);
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
    
    $('delete-range-toggle-button').addEvent('click', function(){
      var drtb = this;
      var drtbcs = $('calendar').getStyle('width').toInt();
      var drtbfx = new Fx.Morph('calendar', {duration: 350, transition: Fx.Transitions.Linear});
      if(drtbcs == 336){
        drtbfx.start({
          'width': '170px'
        });
        (function(){
          drtb.setStyle('background-position', 'left top');
        }).delay(350);
      }else if(drtbcs == 170){
        drtbfx.start({
          'width': '336px'
        });
        (function(){
          drtb.setStyle('background-position', 'right top');
        }).delay(350);
      }
    });
    
    // Search events
    
    $('rh-what').addEvent('change', function(){
      var sv = $('rh-search').get('value');
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
        history('search', sv);
      }
    });
    $('rh-search').addEvent('keyup', function(){
      var sv = this.get('value');
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
          if(sv!=searchStr){
            sv==searchStr;
            history('search', sv);
         }
        $('rh-views-insert').setStyle('display', 'none');
        $('rh-views-search-insert').setStyle('display', 'block');

      }else{
        $('rh-views-insert').setStyle('display', 'block');
        $('rh-views-search-insert').setStyle('display', 'none');
      }
    });
    $('rh-clear-search').addEvent('click', function(){
      $('rh-search').set('value', '');
      $('rh-search').focus();
      $('rh-views-insert').setStyle('display', 'block');
      $('rh-views-search-insert').setStyle('display', 'none');
      $('rh-views-search-insert').set('text', '');
      $(document.body).getElement('#rh-bar-uione input').set('checked', false);
    });
    $('rh-search').focus();
    
    // Range date
    
    var rdp = [$('delete-range-one'), $('delete-range-two')];
    for(r=0;r<rdp.length;r++){
      new DatePicker(rdp[r], {format: derhdf});
    }
  
    // Assign events
  
    $('master-check-all').addEvent('click', function(){ selectHistoryItem(this, 'all'); });
    $('delete-range-button').addEvent('click', function(){ deleteHistoryItem('range'); });
    $('delete-button').addEvent('click', function(){ deleteHistoryItem('selected'); });






});
