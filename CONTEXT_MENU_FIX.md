# 右键菜单修复说明

## 问题描述

在测试中发现右键菜单没有显示。经过排查，这个问题在重构之前就已经存在。

## 根本原因

原始代码将右键菜单初始化放在 `background.js` 文件的末尾直接执行：

```javascript
// 旧代码位置：background.js 末尾
chrome.contextMenus.removeAll(() => {
    // ...
    if (localStorage['use-contextmenu'] == 'yes') {
        chrome.contextMenus.create(options, () => {
            // ...
        });
    }
});
```

**问题：**
- 这段代码在脚本加载时立即执行
- 此时 `localStorage` 可能还没有被 `storage-adapter.js` 初始化
- 导致 `localStorage['use-contextmenu']` 读取失败
- 右键菜单创建失败

## 解决方案

### 1. 创建 `initContextMenu()` 函数

将右键菜单初始化代码重构为独立函数：

```javascript
function initContextMenu() {
    if (!chrome.contextMenus) {
        console.warn('Context menus API is not available.');
        return;
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.onClicked.removeListener(handleContextMenuClick);

        const options = {
            type: 'normal',
            id: 'tree_style_history_' + getVersion(),
            title: returnLang('searchSite'),
            contexts: ["link", "page"],
            visible: true,
        };

        if (localStorage['use-contextmenu'] === 'yes') {
            chrome.contextMenus.create(options, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.warn('Failed to create context menu:', chrome.runtime.lastError);
                } else {
                    console.log('Context menu ready:', options.id);
                    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
                }
            });
        }
    });
}
```

### 2. 提取事件处理函数

将事件处理逻辑提取为独立函数，方便管理监听器：

```javascript
function handleContextMenuClick(info) {
    let url = info.linkUrl;
    if (url != undefined) {
        window.open('history.html?' + url);
        return;
    }
    url = info.pageUrl;
    if (url != undefined) {
        window.open('history.html?' + url);
    }
}
```

### 3. 在 storage 就绪后调用

在 `initializeStorageState()` 函数末尾调用：

```javascript
function initializeStorageState() {
    // ... 其他初始化代码 ...
    
    defaultConfig(false);
    mostVisitedInit();
    setInterval(mostVisitedInit, 3 * 60 * 1000);
    openDb();
    
    // Initialize context menu after storage is ready
    initContextMenu();  // ← 新增
}
```

## 改进点

### 1. 错误处理增强

添加了完善的错误检查：

```javascript
// 检查 API 是否可用
if (!chrome.contextMenus) {
    console.warn('Context menus API is not available.');
    return;
}

// 检查创建是否成功
if (chrome.runtime && chrome.runtime.lastError) {
    console.warn('Failed to create context menu:', chrome.runtime.lastError);
} else {
    console.log('Context menu ready:', options.id);
}
```

### 2. 监听器管理改进

在创建新菜单前先移除旧的监听器，避免重复注册：

```javascript
chrome.contextMenus.onClicked.removeListener(handleContextMenuClick);
// ... 创建菜单 ...
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
```

### 3. 严格相等性检查

使用 `===` 替代 `==`，更加严格和安全：

```javascript
// 旧：if (localStorage['use-contextmenu'] == 'yes')
// 新：if (localStorage['use-contextmenu'] === 'yes')
```

## 验证方法

### 1. 检查配置

在 Background Console 中运行：

```javascript
// 检查配置值
console.log('use-contextmenu:', localStorage['use-contextmenu']);
// 期望: "yes"
```

### 2. 手动触发初始化

如果右键菜单仍未显示，可以在 Background Console 中手动触发：

```javascript
// 重新初始化右键菜单
initContextMenu();

// 查看输出，应该看到：
// "Context menu ready: tree_style_history_3.1.13"
```

### 3. 测试右键菜单

1. 在任意网页上右键点击
2. 应该看到菜单项：**"Search in Tree Style History"** (或其他语言的翻译)
3. 点击菜单项
4. 应该打开 `history.html?<当前页面URL>` 页面

### 4. 测试链接右键菜单

1. 在网页的某个链接上右键点击
2. 应该看到同样的菜单项
3. 点击菜单项
4. 应该打开 `history.html?<链接URL>` 页面

## 配置选项

右键菜单功能受 `use-contextmenu` 配置控制：

- `"yes"` - 启用右键菜单 (默认)
- `"no"` - 禁用右键菜单

修改配置：

### 在选项页面修改

1. 右键扩展图标 → 选项
2. 找到 "Context Menu" 设置
3. 选择 "Yes" 或 "No"
4. 点击保存

### 在 Console 中修改

```javascript
// 启用
localStorage['use-contextmenu'] = 'yes';
initContextMenu();

// 禁用
localStorage['use-contextmenu'] = 'no';
initContextMenu();
```

## 调试技巧

### 查看所有右键菜单项

```javascript
// 注意：Chrome 不提供直接列出所有菜单的 API
// 但可以检查创建状态
chrome.contextMenus.removeAll(() => {
    console.log('All context menus removed');
    initContextMenu();
});
```

### 查看菜单项 ID

```javascript
console.log('Menu ID:', 'tree_style_history_' + getVersion());
// 输出: "tree_style_history_3.1.13"
```

### 监听菜单点击事件

```javascript
// 添加临时调试监听器
chrome.contextMenus.onClicked.addListener((info) => {
    console.log('Context menu clicked:', info);
});
```

## 常见问题

### Q1: 右键菜单不显示

**可能原因：**
1. `use-contextmenu` 配置为 `"no"`
2. `storage-adapter.js` 未初始化完成
3. Chrome 扩展权限问题

**解决方法：**
```javascript
// 1. 检查配置
console.log(localStorage['use-contextmenu']);

// 2. 手动初始化
initContextMenu();

// 3. 检查权限
console.log('Permissions:', chrome.runtime.getManifest().permissions);
// 应该包含 "contextMenus"
```

### Q2: 菜单显示但点击无反应

**可能原因：**
事件监听器未正确注册

**解决方法：**
```javascript
// 重新注册监听器
chrome.contextMenus.onClicked.removeListener(handleContextMenuClick);
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
```

### Q3: Console 显示错误 "Cannot read property 'use-contextmenu' of undefined"

**可能原因：**
`localStorage` 还没有被 `storage-adapter.js` 初始化

**解决方法：**
确保 `initContextMenu()` 在 `onStorageReady()` 回调中调用，而不是直接执行。

### Q4: 菜单文本显示 "searchSite" 而不是翻译后的文本

**可能原因：**
`returnLang('searchSite')` 调用失败

**解决方法：**
```javascript
// 检查国际化功能
console.log('Translated text:', returnLang('searchSite'));
// 应该输出翻译后的文本，如 "Search in Tree Style History"
```

## 相关文件

- `chrome/scripts/background.js` - 右键菜单初始化代码
- `chrome/scripts/background-utils.js` - 包含 `getVersion()` 和 `returnLang()` 函数
- `chrome/_locales/*/messages.json` - 国际化字符串
- `chrome/manifest.json` - 权限配置 (`contextMenus`)

## 总结

修复要点：

1. ✅ 将右键菜单初始化从立即执行改为函数调用
2. ✅ 在 `storage-adapter` 初始化完成后再创建菜单
3. ✅ 添加完善的错误处理和日志
4. ✅ 改进监听器管理，避免重复注册
5. ✅ 使用严格相等性检查

这个修复不仅解决了当前重构中的问题，也改进了原有代码的健壮性。
