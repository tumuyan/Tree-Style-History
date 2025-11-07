# MV3 第二轮修复

## 修复的问题

### 1. IndexedDB 在 Service Worker 中的 window 引用

**错误：**
```
Failed to initialize DB: ReferenceError: window is not defined
```

**原因：**
`db-manager.js` 中使用了 `window.indexedDB`，但 Service Worker 中没有 `window` 对象。

**修复：**
在 `db-manager.js` 中修改为：

```javascript
// 修复前
const request = window.indexedDB.open(DB_NAME, DB_VERSION);

// 修复后
const indexedDBInstance = (typeof indexedDB !== 'undefined') ? indexedDB : 
                          (typeof window !== 'undefined' ? window.indexedDB : null);
if (!indexedDBInstance) {
    reject(new Error('IndexedDB is not available in this environment.'));
    return;
}
const request = indexedDBInstance.open(DB_NAME, DB_VERSION);
```

同样修复了 `deleteDB()` 方法。

### 2. popup.js 中的 recentTabs 访问

**错误：**
```
TypeError: Cannot read properties of undefined (reading 'recentTabs')
```

**原因：**
popup.js 第85行直接使用 `chrome.extension.getBackgroundPage().recentTabs`，在 MV3 中 Service Worker 无法通过这种方式访问。

**修复：**
使用 `messageAdapter` 进行兼容处理：

```javascript
// 修复前
if ((localStorage['rt-itemsno'] * 1) > 0 && chrome.extension.getBackgroundPage().recentTabs.length > 0) {
    // ...
}

// 修复后
if ((localStorage['rt-itemsno'] * 1) > 0) {
    try {
        if (typeof messageAdapter !== 'undefined') {
            messageAdapter.getBackgroundData('recentTabs').then(recentTabs => {
                if (recentTabs && recentTabs.length > 0) {
                    // ... 创建UI元素
                }
            });
        } else if (typeof chrome !== 'undefined' && chrome.extension && chrome.extension.getBackgroundPage) {
            const bg = chrome.extension.getBackgroundPage();
            if (bg && bg.recentTabs && bg.recentTabs.length > 0) {
                // ... 创建UI元素
            }
        }
    } catch (err) {
        console.warn('Error accessing recentTabs:', err);
    }
}
```

### 3. Service Worker 消息处理

**原因：**
`messageAdapter.getBackgroundData()` 在 MV3 模式下需要 Service Worker 处理 `chrome.runtime.sendMessage`。

**修复：**
在 `background-sw.js` 中添加消息监听器：

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
        return;
    }

    switch (message.action) {
        case 'getData':
            if (message.key === 'recentTabs') {
                sendResponse(recentTabs);
            } else if (message.key === 'openedTabs') {
                sendResponse(openedTabs);
            } else {
                sendResponse(undefined);
            }
            break;

        case 'callFunction':
            if (typeof message.function === 'string' && typeof self[message.function] === 'function') {
                try {
                    const result = self[message.function](...(message.args || []));
                    sendResponse({ result });
                } catch (error) {
                    sendResponse({ error: error.message });
                }
            } else {
                sendResponse({ error: 'Function not found' });
            }
            break;

        default:
            sendResponse(undefined);
    }

    return true;  // 表示异步响应
});
```

### 4. favicon URL 警告

**警告：**
```
Not allowed to load local resource: edge://favicon/https://...
```

**原因：**
在 Edge/Chrome MV3 中，`chrome://favicon/` 和 `edge://favicon/` 的访问受到限制。

**解决方案（不需要修复代码）：**
这只是一个警告，不影响功能。浏览器会使用默认图标。如果需要修复，可以：

1. 使用 Google Favicon Service:
   ```javascript
   var furl = 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname;
   ```

2. 或使用 `chrome.favicon` API（如果可用）

但这不是紧急问题，可以暂时忽略。

## 测试验证

### 1. 重新加载扩展

```bash
chrome://extensions/ → 重新加载 Tree Style History
```

### 2. 检查 Service Worker Console

应该看到：
```
Service Worker loading...
Initializing storage state...
storageAdapter: initialized with X keys
Initializing N existing tabs
Opened tabs count: N
DB ready in service worker
Context menu ready: tree_style_history_3.1.13
Service Worker loaded
```

不应该看到：
- ❌ `window is not defined`
- ❌ `dbManager is not defined`
- ❌ `Cannot read properties of undefined`

### 3. 测试 dbManager

```javascript
// 在 Service Worker Console 中运行
console.log('dbManager:', typeof dbManager);
// 应该输出: dbManager: object

dbManager.getDB().then(db => {
    console.log('DB available:', !!db);
    console.log('Object stores:', Array.from(db.objectStoreNames));
});
// 应该输出:
// DB available: true
// Object stores: ['VisitItem', 'urls', 'closed']
```

### 4. 测试 Popup

1. 点击扩展图标打开 Popup
2. 应该正常显示，无错误
3. 如果配置了 Recent Tabs，应该显示（如果有的话）

### 5. 测试消息传递

```javascript
// 在任意 UI 页面 Console 中运行
messageAdapter.getBackgroundData('recentTabs').then(tabs => {
    console.log('Recent tabs:', tabs);
}).catch(err => {
    console.error('Error:', err);
});
```

## 已修复文件列表

1. ✅ `chrome/scripts/db-manager.js`
   - 移除 `window.indexedDB` 依赖
   - 使用全局 `indexedDB` 对象

2. ✅ `chrome/scripts/popup.js`
   - 修复 `recentTabs` 访问
   - 添加 MV2/MV3 兼容处理

3. ✅ `chrome/scripts/background-sw.js`
   - 添加消息监听器
   - 支持 getData 和 callFunction 操作

## 待测试项目

- [ ] Popup 正常打开
- [ ] Recent Tabs 显示（如果有）
- [ ] 右键菜单工作
- [ ] 历史记录保存
- [ ] 标签页跟踪
- [ ] IndexedDB 读写
- [ ] Closed.html 页面
- [ ] History2.html 页面
- [ ] Options 页面

## 已知的非错误警告

1. **favicon 警告** - 可以忽略
   ```
   Not allowed to load local resource: edge://favicon/...
   ```

2. **Storage adapter warning** - 正常行为
   ```
   storageAdapter: using background cache for initialization
   ```

## 性能指标

| 指标 | 预期值 |
|------|--------|
| Service Worker 启动时间 | < 200ms |
| DB 初始化时间 | < 100ms |
| Popup 打开时间 | < 100ms |
| 内存占用（活动） | ~5MB |
| 内存占用（休眠） | ~0MB |

## 下一步

如果以上测试都通过，MV3 版本应该可以正常使用了。

如果还有问题，请检查：
1. Service Worker Console 的完整错误日志
2. Popup/UI 页面的 Console 错误
3. 具体的功能失败场景

## 故障排除

### 如果 dbManager 还是 undefined

1. 检查 Service Worker Console，看是否有加载错误
2. 确认 `importScripts('db-manager.js')` 成功
3. 运行：
   ```javascript
   console.log('dbManager in self:', typeof self.dbManager);
   console.log('dbManager global:', typeof dbManager);
   ```

### 如果消息传递失败

1. 检查 Service Worker 是否在运行
2. 在 Service Worker Console 中添加日志：
   ```javascript
   chrome.runtime.onMessage.addListener((msg, sender, respond) => {
       console.log('Received message:', msg);
       return true;
   });
   ```

### 如果 Popup 空白

1. 打开 Popup DevTools (右键 Popup → 检查)
2. 查看 Console 错误
3. 检查 `messageAdapter` 和 `dbManager` 是否可用

## 总结

这一轮修复了：
- ✅ IndexedDB 在 Service Worker 中的兼容性
- ✅ Popup 对 recentTabs 的访问
- ✅ Service Worker 消息处理机制
- ✅ 全局对象导出问题

应该可以正常运行 MV3 版本了！
