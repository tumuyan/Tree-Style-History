// Tree Style History - linear history page
//
// An ES module: every function it calls is imported, not read off `window`.

import { $, $$ } from './dom-helper.js';
import { returnLang, dateFormat, monthOptionsHtml } from './modules/helpers.js';
import { calendar, showCalendar } from './modules/calendar.js';
import {
    history as historyView, selectHistoryItem, deleteHistoryItem, getActiveHistory
} from './modules/history-core.js';
import { modifierState } from './modules/ui-state.js';
import { initPage } from './modules/page-init.js';
import { initSortBar } from './modules/sort-bar.js';

initPage();

document.addEventListener('DOMContentLoaded', function(){
    onStorageReady(function () {
  
        // Fade in using CSS transition
  
    var historyContainer = $('history-container');
    if (historyContainer) {
        historyContainer.style.transition = 'margin-left 0.25s, margin-right 0.25s, opacity 0.25s';
        historyContainer.style.marginLeft = '180px';
        historyContainer.style.opacity = '1';
    }
  
    // Language
    
    $('delete-button').value = returnLang('deleteItems');
    $('delete-range-button').value = returnLang('deleteItems');
    
    // Sort/group toolbar: shared by history.js and bookmark.js.
    initSortBar(historyView, getActiveHistory);

    // Shift listener
    
    document.body.addEventListener('keydown', function(e){
      if (e.keyCode == 16 && !modifierState.shift) {
        modifierState.shift = true;
      }
    });
    document.body.addEventListener('keyup', function(e){
      if (e.keyCode == 16) {
        modifierState.shift = false;
      }
    });

    var showCalEl = $$('#showCalendar');
    if (showCalEl.length > 0) {
      showCalEl[0].addEventListener('click', function (e) {
        showCalendar();
      });
    }
    
    // Date events
    
    var derhdf = dateFormat();
    derhdf = derhdf.replace('dd', 'dsdi').replace('mm', 'dsmi').replace('yyyy', 'dsyi');
    derhdf = derhdf.split('/');
    $(derhdf[0]).innerHTML = '<select class="select" id="date-select-day"></select>';
    $(derhdf[1]).innerHTML = '<select class="select" id="date-select-month">' + monthOptionsHtml() + '</select>';
    $(derhdf[2]).innerHTML = '<select class="select" id="date-select-year"></select>';
    
    $('date-select-day').addEventListener('change', function(){
      calendar('selected', '');
      historyView('yes', '');
    });
    $('date-select-month').addEventListener('change', function(){
      calendar('selected', '');
      historyView('yes', '');
    });
    $('date-select-year').addEventListener('change', function(){
      calendar('selected', '');
      historyView('yes', '');
    });
    
    // Calendar init
    
    calendar('current', '');


            // `history.html?<url>` — written by the service worker's context
            // menu, so this page can open pre-searched on a host.
            //
            // `new URL()` THROWS on a malformed input, and the throw would
            // escape this callback: everything registered after it — including
            // the range-delete toggle further down — never gets its listener.
            // `?http://[bad` used to do exactly that, from a URL a user can
            // reach by hand. An unparseable query is simply "no search".
            var searchStr = '';
            if (location.search.length > 1) {
                try {
                    // `substr(1)` drops the '?'. The query is a full URL in
                    // practice: the service worker writes `info.linkUrl` /
                    // `info.pageUrl`. A bare host typed into the address bar
                    // ('?example.com') resolves RELATIVE to this page, so its
                    // hostname is the extension id, not example.com — a known
                    // wart of the base argument, left as is because the only
                    // caller that matters never produces a relative input.
                    searchStr = new URL(location.search.substr(1), window.location.href).hostname;
                } catch (e) {
                    console.warn('Ignoring an unparseable search query:', location.search, e);
                }
            }

            if (searchStr) {
                $('rh-what').value = 'all';
                $('rh-search').value = searchStr;
                historyView('search', searchStr);
            } else {
                historyView('current', '');
            }
    
    // Calendar range toggle
    
    // The two widths and the toggle sprite now live in CSS: one attribute on
    // the calendar, read by `.linear-view #calendar[data-expanded="true"]`. The old
    // handler measured `width` back out of the DOM and used a 350ms timeout to
    // flip `backgroundPosition` after the transition, which could disagree
    // with the width if the click landed mid-animation.
    $('delete-range-toggle-button').addEventListener('click', function(){
      var cal = $('calendar');
      if (cal) {
          cal.setAttribute('data-expanded',
              cal.getAttribute('data-expanded') === 'true' ? 'false' : 'true');
      }
    });
    
    // Search events
    
    $('rh-what').addEventListener('change', function(){
      var sv = $('rh-search').value;
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
        historyView('search', sv);
      }
    });
    $('rh-search').addEventListener('keyup', function(){
      var sv = this.value;
      if(sv.length + sv.replace(/[0-9a-zA-Z]+/g,'').length >= 2){
          if(sv!=searchStr){
            searchStr=sv;
            historyView('search', sv);
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
    
  
    // Assign events
  
    $('master-check-all').addEventListener('click', function(){ selectHistoryItem(this, 'all'); });
    // The calendar's heat map is redrawn here, not in history-core.js: the
    // range delete spans whole days, so every day in the month can change
    // colour, and calendar() is the only pass that paints them. history-core.js
    // cannot import it (calendar.js imports history() — that would be a cycle),
    // so the redraw comes back as this callback.
    $('delete-range-button').addEventListener('click', function(){
        deleteHistoryItem('range', function(){ calendar('yes', ''); });
    });
    $('delete-button').addEventListener('click', function(){ deleteHistoryItem('selected'); });







    });
});