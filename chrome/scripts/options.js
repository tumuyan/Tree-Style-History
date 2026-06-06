
document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {

        // Fade in

    var optsEl = $('options');
    optsEl.style.transition = 'margin-left 0.25s, opacity 0.25s';
    optsEl.style.opacity = '1';
    if (chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en') {
        var oo = {
            'margin-right': [150, 180],
            'opacity': [0, 1]
        };
        optsEl.style.marginRight = oo['margin-right'][1] + 'px';
    } else {
        var oo = {
            'margin-left': [150, 180],
            'opacity': [0, 1]
        };
        optsEl.style.marginLeft = oo['margin-left'][1] + 'px';
    }


    $("version").textContent = getVersion();

    // URL Vars

    var vars = getUrlVars();

    if (vars['p'] == undefined) {
        $('tab-options-content').style.display = 'block';
        $('tab-options').classList.add('tab-current');
    } else {
        $('tab-' + vars['p'] + '-content').style.display = 'block';
        $('tab-' + vars['p']).classList.add('tab-current');
    }

    // Options tabs

    Array.from($$('.tab')).forEach(function(tab) {
        tab.addEventListener('click', function (e) {
            e.preventDefault();
            Array.from($$('.tab-content')).forEach(function(tc) {
                tc.style.display = 'none';
            });
            Array.from($$('.tab')).forEach(function(t) {
                t.classList.remove('tab-current');
            });
            $(this.id + '-content').style.display = 'block';
            this.classList.add('tab-current');
        });
    });

   // Load translated text

    loadOptionsLang();
    
    // Initialize default options if not set
    // 应该没用
    // defaultConfig(false);

    // Load saved options
    loadOptions(true);

    // Save options

    $('save').addEventListener('click', function () {
        saveOptions(false);
    });

    $('defaultConfig').value = returnLang('defaultConfig');
    $('defaultConfig').addEventListener('click', function () {
        defaultConfig(true);
        location.reload();
        // loadOptions();
        // localStorage.clear();
        // window.open('options.html');
    });

    $('deleteCache').addEventListener('click', function () {
        if (typeof messageAdapter !== 'undefined') {
            messageAdapter.deleteDB().then(() => {
                console.log('Database deleted successfully');
            }).catch(err => {
                console.error('Failed to delete database:', err);
            });
        } else {
            console.warn('Message adapter not available');
        }
    });

    $('clearFaviconCache').value = returnLang('clearFaviconCacheLabel');
    $('clearFaviconCache').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.value = returnLang('clearingFaviconCacheLabel');
        chrome.runtime.sendMessage({ action: 'clearFaviconCache' }).then(function (response) {
            btn.value = returnLang('clearFaviconCacheDoneLabel');
            setTimeout(function () {
                btn.disabled = false;
                btn.value = returnLang('clearFaviconCacheLabel');
            }, 2000);
        }).catch(function () {
            btn.disabled = false;
            btn.value = returnLang('clearFaviconCacheLabel');
        });
    });


    // $('shortcuts').set('value', returnLang('shortcuts'));
    $('shortcuts').addEventListener('click', function () {
        chromeURL('chrome://extensions/shortcuts');
    });

    $('saveUpload').value = returnLang('saveUpload');
    $('saveUpload').addEventListener('click', function () {
        saveOptions(true);
    });

    $('downloadConfig').value = returnLang('downloadConfig');
    $('downloadConfig').addEventListener('click', function () {
        downloadOptions();
    });

    $('downloadConfig2').value = returnLang('downloadConfig2');
    $('downloadConfig2').addEventListener('click', function () {
    });

    // Sliders
    // recent-history
    loadSlider('rhitemsno', 0, 100, 'rh-itemsno');
    // recent-closed
    loadSlider('rctitemsno', 0, 100, 'rct-itemsno');
    // recent-tab
    loadSlider('rtitemsno', 0, 100, 'rt-itemsno');
    // most visited
    loadSlider('mvitemsno', 0, 100, 'mv-itemsno');
    // recent-bookmark
    loadSlider('rbitemsno', 0, 100, 'rb-itemsno');
    loadSlider('rhwidth', 225, 800, 'rh-width');
    loadSlider('loadrange', 3, 300, 'load-range');
    loadSlider('loadrange2', 1, 100, 'load-range2');
    loadSlider('loadrange3', 0, 900, 'load-range3');
    loadSlider('loadrange4', 0, 9000, 'load-range4');
    // Load translations iframe
    //$('translations-iframe').set('html', '<iframe onerror="$(\'translations-iframe\').set(\'text\', \'Currently Unavailable\');" src="http://www.indezinez.com/api/recenthistory/translations.php?l='+chrome.i18n.getMessage("@@ui_locale")+'" frameborder="0" scrolling="no"></iframe>');
    //$('translations-iframe').set('html', '<a target="_blank" href="http://www.indezinez.com/api/ext/recenthistory/?l='+chrome.i18n.getMessage("@@ui_locale")+'">Click here to view form</a> (opens external link in new window)');

    // Assign events

    $('flist-add-b').addEventListener('click', function () { addFilteredItem(); });
    $('flist-add-i').addEventListener('keyup', function (event) { if (event.keyCode == 13) { addFilteredItem(); } });
    $('advance-options').addEventListener('submit', function () { return false; });

    $('deleteList').addEventListener('click', function () { $('flist-table').innerHTML = ''; });

    $('mergeList').addEventListener('click', function () {mergeList(); });
    
    

    // var UserAgent = navigator.userAgent.toLowerCase();
    // if(UserAgent.indexOf('edg')>0)
    {
        $('select_history_page').style.display = 'none';
    }

    });
});
