
document.addEvent('domready', function(){

  // Updated/Installed

  if(localStorage['rh-version-'+getVersion()] !== 'true'){
    alertUser(returnLang('successfullyInstalled')+'<span>v'+getVersion()+'</span>', 'open');
    localStorage['rh-version-'+getVersion()] = 'true';
  }

  // Ctrl listener
  
  $(document.body).addEvent('keydown', function(e){
    if(e.event.keyCode == 17 && ctrlState == 'false'){
      ctrlState = 'true';
    }
  });
  $(document.body).addEvent('keyup', function(e){
    if(e.event.keyCode == 17){
      ctrlState = 'false';
    }
  });
  
  // Popup structure
  
  var rhporder = localStorage['rh-list-order'].split(',');
  
  for(var o in rhporder){
    if(rhporder[o] == 'rh-order'){
      if((localStorage['rh-itemsno']*1) > 0){
        new Element('div', {id: 'rh-inject', html: '<div id="rh-inject-title" class="popup-title"><span>'+returnLang('recentHistory')+'</span></div>'}).inject('popup-insert', 'bottom');
      }
    }else if(rhporder[o] == 'rct-order'){
      if((localStorage['rct-itemsno']*1) > 0 && chrome.extension.getBackgroundPage().closedTabs.length > 0){
        new Element('div', {id: 'rct-inject', html: '<div id="rct-inject-title" class="popup-title"><span>'+returnLang('recentlyClosedTabs')+'</span></div>'}).inject('popup-insert', 'bottom');
      }
    }else if(rhporder[o] == 'rb-order'){
      if((localStorage['rb-itemsno']*1) > 0){
        new Element('div', {id: 'rb-inject', html: '<div id="rb-inject-title" class="popup-title"><span>'+returnLang('recentBookmarks')+'</span></div>'}).inject('popup-insert', 'bottom');
      }
    }else if(rhporder[o] == 'mv-order'){
      if((localStorage['mv-itemsno']*1) > 0){
        new Element('div', {id: 'mv-inject', html: '<div id="mv-inject-title" class="popup-title"><span>'+returnLang('mostVisited')+'</span></div>'}).inject('popup-insert', 'bottom');
      }
    }
  }

  // Assign events

  $('show-all-history').addEvent('click', function(){ chromeURL('chrome://history/'); });
  
//   $('show-all-history2').addEvent('click', function(){ chromeURL('chrome://history/'); });
  // Popup init
  
  // -- Insert
  if($('rh-inject')){recentHistory();}
  if($('rct-inject')){recentlyClosedTabs();}
  if($('rb-inject')){recentBookmarks();}
  if($('mv-inject')){mostVisited();}

  // -- Functions
  $$('.favicon').addEvent('error', function(){
    this.setProperty('src', 'images/blank.png');
  });
  
  // -- Width
  $(document.body).setStyle('width', localStorage['rh-width']);
  
  // -- Titles
  $$('.popup-title').each(function(el,i){
    if(i !== 0){
      el.setStyle('margin-top', '6px');
    }
  });
  
  // -- Search
  if(localStorage['rh-search'] == 'yes'){
    $('popup-search-input').addEvent('keyup', function(){
      var sv = this.get('value');
      if(sv.length > 2){
        popupSearch(sv);
        $('popup-insert').setStyle('display', 'none');
        $('popup-search-insert').setStyle('display', 'block');
      }else{
        $('popup-insert').setStyle('display', 'block');
        $('popup-search-insert').setStyle('display', 'none');
      }
    });
    $('popup-search-clear').addEvent('click', function(){
      $('popup-search-input').set('value', '');
      $('popup-search-input').focus();
      $('popup-insert').setStyle('display', 'block');
      $('popup-search-insert').setStyle('display', 'none');
      $('popup-search-insert').set('text', '');
    });
    $('popup-search-input').focus();
  }else{
    $('popup-header').setStyle('display', 'none');
    if($$('.popup-title').length > 0){
      $$('.popup-title')[0].setStyle('margin-top', '10px');
    }
  }

  // -- Alert holder
  $('alert-holder').addEvent('click', function(){
    this.setStyle('display', 'none');
  });
  
  // -- Scrollbar fix
  //popup_scrollbar_fix.periodical(250);

});
