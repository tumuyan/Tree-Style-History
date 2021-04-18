if(chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en'){
  document.write('<link rel="stylesheet" href="css/options-rtl.css">');
}