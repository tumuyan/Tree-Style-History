# Background Dependencies Extraction Details

## 从 func.js 提取到 background-utils.js 的内容

### 1. 基本信息函数

#### getVersion()
```javascript
// 位置: func.js 第3-5行
function getVersion() {
    return '3.1.13';
}
```
**用途:** 在background.js中用于创建右键菜单ID

#### getVersionType()
```javascript
// 位置: func.js 第10-12行
function getVersionType() {
    return 'browserAction';
}
```
**用途:** 在background.js中判断是否显示pageAction

---

### 2. 国际化函数

#### returnLang(str)
```javascript
// 位置: func.js 第352-354行
function returnLang(str) {
    return chrome.i18n.getMessage(str);
}
```
**用途:** 在background.js中用于右键菜单文本、alert提示等

**在background.js中的使用位置:**
- 第244行: `alert(returnLang('saveFail'))`
- 第250行: `alert(returnLang('done'))`
- 第939行: `title: returnLang('searchSite')`

---

### 3. 时间格式化函数

#### timeNow(st)
```javascript
// 位置: func.js 第264-295行
function timeNow(st) {
    var tf = localStorage['rh-timeformat'];
    if (st == 0) {
        var currentTime = new Date();
    } else {
        var currentTime = new Date(st);
    }
    var hours = currentTime.getHours() * 1;
    var minutes = currentTime.getMinutes() * 1;
    if (tf == '12') {
        if (hours > 11) {
            var te = ' ' + returnLang('PM');
        } else {
            var te = ' ' + returnLang('AM');
        }
        if (hours == 0) {
            hours = 12;
        }
        if (hours > 12) {
            hours = hours - 12;
        }
    } else if (tf == '24') {
        var te = '';
    }
    if (hours < 10) {
        hours = '0' + hours;
    }
    if (minutes < 10) {
        minutes = '0' + minutes;
    }
    return hours + ':' + minutes + te;
}
```
**用途:** 在background.js中格式化关闭标签页的时间

**在background.js中的使用位置:**
- 第25行: `openedTabs[id].time = timeNow(0);`

---

### 4. 日历存储辅助

#### calendar_storage2 变量和初始化
```javascript
// 位置: func.js 第108-114行
var calendar_storage2 = {};
onStorageReady(function() {
    var calendar_storage2_str = localStorage['calendar-storage2'];
    if (calendar_storage2_str != undefined) {
        calendar_storage2 = JSON.parse(calendar_storage2_str);
    }
});
```

#### save_calendar_storage2()
```javascript
// 位置: func.js 第116-126行
function save_calendar_storage2(obj, n, f) {
    if (obj['text'] == '' && obj['maxResults'] >= 9999 && obj['endTime'] - 86400000 == obj['startTime']) {
        if ((obj['startTime'] - _DATE + 1) % 86400000 == 0) {
            if (f || calendar_storage2[obj['startTime']] == undefined || calendar_storage2[obj['startTime']] < 1) {
                calendar_storage2[obj['startTime']] = n;
                console.log('n=' + n);
                localStorage['calendar-storage2'] = JSON.encode(calendar_storage2);
            }
        }
    }
}
```
**修改:** 将 `JSON.encode` 改为 `JSON.stringify`

**用途:** 在background.js中保存每日历史记录数量

**在background.js中的使用位置:**
- 第491行: `save_calendar_storage2(obj, hi.length, false);`

**注意:** 提取时还需要相关的常量:
```javascript
// 位置: func.js 第25-27行
var _DATE = new Date();
_DATE.setHours(0); _DATE.setMinutes(0); _DATE.setSeconds(0); _DATE.setMilliseconds(0);
var DAY = 24 * 3600 * 1000;
```

---

### 5. 配置管理

#### defaultValues 对象
```javascript
// 位置: func.js 第442-476行
var defaultValues = {
    "rh-itemsno": 16,
    "rct-itemsno": 4,
    "rt-itemsno": 6,
    "mv-itemsno": 0,
    "rb-itemsno": 3,
    "mv-blocklist": "false",
    "rh-historypage": "yes",
    "rh-date": "mm/dd/yyyy",
    "rh-width": "275px",
    "load-range": 7,
    "load-range2": 3,
    "load-range3": 120,
    "load-range4": 150,
    "less-item": "no",
    "rh-search": "yes",
    "rh-list-order": "rh-order,rct-order,rb-order,mv-order,rt-order",
    "rh-time": "yes",
    "rh-group": "yes",
    "rh-orderby": "date",
    "rh-order": "desc",
    "rh-timeformat": "24",
    "rh-click": "newtab",
    "rm-click": "default",
    "rm-path": "yes",
    'use-contextmenu': "yes",
    "rh-share": "yes",
    "rh-filtered": "false",
    "rh-pinned": "false",
    "rhs-showurl": "no",
    "rhs-showsep": "no",
    "rhs-showext": "no",
    "rhs-showbg": "no",
    "show-popup": "yes"
};
```

#### defaultConfig(clean)
```javascript
// 位置: func.js 第478-484行
function defaultConfig(clean) {
    for (var v in defaultValues) {
        if (clean || !localStorage[v] || localStorage[v] == null || localStorage[v] == '') {
            localStorage[v] = defaultValues[v];
        }
    }
}
```

**用途:** 在background.js初始化时设置默认配置值

**在background.js中的使用位置:**
- 第167行: `defaultConfig(false);`

---

## func.js 中未提取的内容 (仅UI页面需要)

以下函数依赖DOM操作或仅在UI页面中使用，因此不需要在background中：

### DOM操作函数
- `popup_scrollbar_fix()` - 弹窗滚动条修复
- `title_fix(text)` - 标题修复
- `escapeHtmlAttr(text)` - HTML属性转义
- `leftClick(url)` - 左键点击处理
- `rightClick(url)` - 右键点击处理
- `chromeURL(url)` - 打开Chrome URL
- `echoLang(str)` - 输出国际化文本到DOM

### Bookmarklet相关
- `isBookmarkletUrl(url)`
- `extractBookmarkletCode(url)`
- `decodeBookmarkletCode(code)`
- `executeBookmarklet(url, options)`

### 时间和日期格式化 (复杂版本)
- `TimeToStr(time, skip_date, skip_year, skip_clock)` - 完整的时间格式化
- `formatDate(str)` - 日期格式化
- `isLeapYear()` - 闰年判断

### 工具函数
- `truncate(str, ind, lng)` - 字符串截断
- `getUrlVars()` - 获取URL参数
- `Clipboard.copy()` - 复制到剪贴板

### 选项页面相关
- `loadOptionsLang()` - 加载选项页国际化
- `loadOptions(full)` - 加载选项
- `saveOptions(sync)` - 保存选项
- `downloadOptions()` - 下载选项
- `loadSlider()` - 加载滑块
- `previewItem()` - 预览项目
- `mostVisitedBlocklist()` - 最常访问黑名单
- `filteredDomainsList()` - 过滤域名列表
- `addFilteredItem()` - 添加过滤项

### 更新过滤器相关
- `updateFilter()` - 更新过滤器
- `getHostname(url)` - 获取主机名
- `searchResults(results)` - 搜索结果处理

---

## MooTools依赖移除

### 在 background.js 中的修改

#### 1. 定时器方法
```javascript
// 旧代码 (MooTools):
mostVisitedInit.periodical(3 * 60 * 1000);

// 新代码 (标准):
setInterval(mostVisitedInit, 3 * 60 * 1000);
```

#### 2. JSON编码方法
```javascript
// 旧代码 (MooTools):
localStorage['mv-cache'] = JSON.encode(mv);
localStorage['calendar-storage'] = JSON.encode(calendar_r);

// 新代码 (标准):
localStorage['mv-cache'] = JSON.stringify(mv);
localStorage['calendar-storage'] = JSON.stringify(calendar_r);
```

#### 3. save_calendar_storage2中的修改
```javascript
// 旧代码 (MooTools):
localStorage['calendar-storage2'] = JSON.encode(calendar_storage2);

// 新代码 (标准):
localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
```

---

## 文件大小对比

| 文件 | 原始大小 | 提取内容 | 依赖关系 |
|------|---------|---------|----------|
| **func.js** | 85KB (2450行) | ~3KB (6个函数) | MooTools + jQuery + DOM |
| **background-utils.js** | - | 3KB (120行) | 仅Chrome API |
| **moo.js** | 100KB | 完全移除 | - |

---

## 依赖关系图

### 旧依赖关系
```
background.html
├── storage-adapter.js (9KB)
├── moo.js (100KB)          ← 只用了2个方法
│   ├── .periodical()
│   └── JSON.encode()
├── func.js (85KB)          ← 只用了6个函数
│   ├── getVersion()
│   ├── getVersionType()
│   ├── returnLang()
│   ├── timeNow()
│   ├── defaultConfig()
│   └── save_calendar_storage2()
└── background.js (31KB)
```

### 新依赖关系
```
background.html
├── storage-adapter.js (9KB)
├── background-utils.js (3KB)    ← 新增，只包含必要函数
│   ├── getVersion()
│   ├── getVersionType()
│   ├── returnLang()
│   ├── timeNow()
│   ├── defaultConfig()
│   ├── save_calendar_storage2()
│   └── 相关常量和变量
└── background.js (31KB)
```

**减少:** 185KB (100KB moo.js + 85KB func.js - 3KB background-utils.js)

---

## 验证清单

### 功能验证
- [ ] 扩展加载成功
- [ ] Background页面无错误
- [ ] getVersion() 返回正确版本号
- [ ] returnLang() 正确获取国际化文本
- [ ] defaultConfig() 正确初始化配置
- [ ] mostVisitedInit() 每3分钟执行
- [ ] 历史记录正确保存到IndexedDB
- [ ] 右键菜单正确显示
- [ ] 键盘快捷键正常工作

### 代码验证
```javascript
// 在 background page console 中测试:

// 1. 检查函数存在
typeof getVersion              // "function"
typeof getVersionType          // "function"
typeof returnLang              // "function"
typeof timeNow                 // "function"
typeof defaultConfig           // "function"
typeof save_calendar_storage2  // "function"

// 2. 检查对象存在
typeof defaultValues           // "object"
typeof calendar_storage2       // "object"

// 3. 检查常量
typeof DAY                     // "number"
typeof _DATE                   // "object"

// 4. 确认MooTools方法不存在
typeof (function(){}).periodical  // "undefined"
typeof JSON.encode             // "undefined"
```

---

## 注意事项

1. **func.js 仍然保留完整版本**
   - UI页面 (popup, history, options等) 仍然使用完整的func.js
   - 这些页面需要DOM操作和MooTools功能

2. **moo.js 仍然被UI页面使用**
   - popup.html, history.html, history2.html, closed.html 等仍需要MooTools
   - 只有background.html不再加载moo.js

3. **向后兼容**
   - 所有功能逻辑保持不变
   - 只是改变了加载方式

4. **为MV3准备**
   - background-utils.js 不依赖DOM
   - 使用标准Web API
   - 适合service worker环境

---

## 相关文件修改记录

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `chrome/scripts/background-utils.js` | ✅ 新建 | 提取的工具函数 |
| `chrome/scripts/background.js` | 🔧 修改 | 移除MooTools依赖 |
| `chrome/background.html` | 🔧 修改 | 更新脚本引用 |
| `chrome/scripts/func.js` | ⏸️ 保留 | UI页面仍使用 |
| `chrome/scripts/moo.js` | ⏸️ 保留 | UI页面仍使用 |
