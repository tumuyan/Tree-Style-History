// ============================================================================
// Tree Style History - Module Entry Point
// ============================================================================
// This file imports from all domain modules and attaches functions to window
// for backward compatibility with page-specific scripts (popup.js, history.js, etc.)
// 
// Module structure:
//   modules/helpers.js      - Pure utility functions (time, strings, URL, i18n)
//   modules/config.js       - Configuration management
//   modules/calendar.js     - Calendar/date picker
//   modules/popup-core.js   - Popup UI rendering functions
//   modules/history-core.js - History page rendering functions
// ============================================================================

// Import from dom-helper (now an ES module)
import { $, $$, createElement, emptyElement, getStyle } from './dom-helper.js';

// Import from domain modules
import {
    _DATE, DAY,
    TimeToStr, timeNow, formatDate,
    echoLang, returnLang,
    stripScripts, title_fix, escapeHtmlAttr, truncate, extractFileName, calcSize,
    getUrlVars, isBookmarkletUrl, extractBookmarkletCode, decodeBookmarkletCode, executeBookmarklet,
    chromeURL, getVersion, getVersionType,
    Clipboard,
    popup_scrollbar_fix,
    get_host, getFaviconUrl
} from './modules/helpers.js';

import {
    defaultValues,
    defaultConfig,
    loadOptions,
    saveOptions,
    downloadOptions,
    loadSlider,
    loadOptionsLang,
    initSortable,
    previewItem,
    mostVisitedBlocklist,
    filteredDomainsList,
    addFilteredItem,
    addList,
    mergeList,
    updateFilter,
    filtUrl,
    flist,
    flist_r,
    site_r
} from './modules/config.js';

import {
    calendar_storage2,
    isLeapYear,
    calendar,
    showCalendar,
    save_calendar_storage2
} from './modules/calendar.js';

import {
    leftClick,
    rightClick,
    formatItem,
    popupSearch,
    isBookmarked,
    isPinned,
    uiEditItems,
    alertUser,
    uiPinItem,
    uiDeleteItem,
    recentHistory,
    recentlyClosedTabs,
    openTab,
    showRecentTabs,
    showRecentTabsImpl,
    mostVisited,
    recentBookmarks,
    pinned
} from './modules/popup-core.js';

import {
    history,
    toggleGroup,
    getActiveHistory,
    getMoreItems,
    resetColor,
    selectHistoryItem,
    deleteHistoryItem,
    alertUserHistory,
    alertLoadingHistory
} from './modules/history-core.js';

// ============================================================================
// Global variables (legacy - used by page-specific scripts)
// ============================================================================

var itemSelectedColor = '#ffcbd3';

// ============================================================================
// Attach everything to window for backward compatibility
// ============================================================================

// --- DOM helpers ---
window.$ = $;
window.$$ = $$;
window.createElement = createElement;
window.emptyElement = emptyElement;
window.getStyle = getStyle;

// --- Helpers ---
window._DATE = _DATE;
window.DAY = DAY;
window.TimeToStr = TimeToStr;
window.timeNow = timeNow;
window.formatDate = formatDate;
window.echoLang = echoLang;
window.returnLang = returnLang;
window.stripScripts = stripScripts;
window.title_fix = title_fix;
window.escapeHtmlAttr = escapeHtmlAttr;
window.truncate = truncate;
window.extractFileName = extractFileName;
window.calcSize = calcSize;
window.getUrlVars = getUrlVars;
window.isBookmarkletUrl = isBookmarkletUrl;
window.extractBookmarkletCode = extractBookmarkletCode;
window.decodeBookmarkletCode = decodeBookmarkletCode;
window.executeBookmarklet = executeBookmarklet;
window.chromeURL = chromeURL;
window.getVersion = getVersion;
window.getVersionType = getVersionType;
window.Clipboard = Clipboard;
window.popup_scrollbar_fix = popup_scrollbar_fix;
window.get_host = get_host;
window.getFaviconUrl = getFaviconUrl;

// --- Config ---
window.defaultValues = defaultValues;
window.defaultConfig = defaultConfig;
window.loadOptions = loadOptions;
window.saveOptions = saveOptions;
window.downloadOptions = downloadOptions;
window.loadSlider = loadSlider;
window.loadOptionsLang = loadOptionsLang;
window.initSortable = initSortable;
window.previewItem = previewItem;
window.mostVisitedBlocklist = mostVisitedBlocklist;
window.filteredDomainsList = filteredDomainsList;
window.addFilteredItem = addFilteredItem;
window.addList = addList;
window.mergeList = mergeList;
window.updateFilter = updateFilter;
window.filtUrl = filtUrl;

// --- Calendar ---
window.calendar_storage2 = calendar_storage2;
window.isLeapYear = isLeapYear;
window.calendar = calendar;
window.showCalendar = showCalendar;
window.save_calendar_storage2 = save_calendar_storage2;

// --- Popup core ---
window.leftClick = leftClick;
window.rightClick = rightClick;
window.formatItem = formatItem;
window.popupSearch = popupSearch;
window.isBookmarked = isBookmarked;
window.isPinned = isPinned;
window.uiEditItems = uiEditItems;
window.alertUser = alertUser;
window.uiPinItem = uiPinItem;
window.uiDeleteItem = uiDeleteItem;
window.recentHistory = recentHistory;
window.recentlyClosedTabs = recentlyClosedTabs;
window.openTab = openTab;
window.showRecentTabs = showRecentTabs;
window.showRecentTabsImpl = showRecentTabsImpl;
window.mostVisited = mostVisited;
window.recentBookmarks = recentBookmarks;
window.pinned = pinned;

// --- History core ---
window.historyView = history;
window.toggleGroup = toggleGroup;
window.getActiveHistory = getActiveHistory;
window.getMoreItems = getMoreItems;
window.resetColor = resetColor;
window.selectHistoryItem = selectHistoryItem;
window.deleteHistoryItem = deleteHistoryItem;
window.alertUserHistory = alertUserHistory;
window.alertLoadingHistory = alertLoadingHistory;

// --- Global state (used by page-specific scripts) ---
window.ctrlState = 'false';
window.shiftState = 'false';
window.itemSelectedColor = itemSelectedColor;

// ============================================================================
// DOMContentLoaded handler
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    // Display language strings
    Array.from($$('.lang')).forEach(function (el) {
        el.innerHTML = returnLang(el.getAttribute('data-lang-string'));
    });

    // Href hashes — prevent default click on empty links
    setInterval(function () {
        Array.from($$('a[href="#"]')).forEach(function (el) {
            if (el.classList.contains('hrefhash')) {
                // Already handled
            } else {
                el.addEventListener('click', function (e) {
                    e.preventDefault();
                    return false;
                });
                el.classList.add('hrefhash');
            }
        });
    }, 250);
});

// ============================================================================
// Version info
// ============================================================================

console.log('Tree Style History v' + getVersion() + ' (' + getVersionType() + ')');
console.log('Module structure: helpers.js | config.js | calendar.js | popup-core.js | history-core.js');