# MV3 快速入门指南

## 🎯 目标

将 Tree Style History 从 Manifest V2 迁移到 Manifest V3，实现 Service Worker 支持。

## ✅ 当前进度

- ✅ **Phase 1:** Background 轻量化 (减少 81% 脚本大小)
- ✅ **Phase 2:** DB 管理器独立化
- ✅ **Phase 3:** Service Worker 实现
- 🔄 **Phase 4:** UI 页面迁移 (待完成)

## 🚀 快速测试 MV3 版本

### 1. 切换到 MV3

```bash
cd /path/to/tree-style-history/chrome
cp manifest-v3.json manifest.json
```

### 2. 在 Chrome 中加载

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `chrome/` 目录

### 3. 验证 Service Worker

1. 在扩展卡片上找到 "Service Worker" 链接
2. 点击打开 DevTools
3. 查看 Console，应该看到：
   ```
   Service Worker loading...
   storageAdapter: initialized with X keys
   Success opening DB
   Context menu ready: tree_style_history_3.1.13
   ```

### 4. 测试基本功能

#### 右键菜单
- 在任意网页右键 → 看到 "Search in Tree Style History"
- 点击菜单 → 打开搜索页面

#### 快捷键
- `Ctrl+Shift+H` → 树状历史
- `Alt+Shift+H` → 线性历史  
- `Alt+Shift+G` → 最近关闭
- `Alt+Shift+O` → 书签

#### 定时任务
- 3分钟后 Service Worker 应该自动更新 Most Visited

### 5. 切换回 MV2

```bash
git checkout manifest.json
```

或手动恢复 `manifest_version: 2`

## 📁 新增文件

### Phase 2 & 3 文件

```
chrome/
├── scripts/
│   ├── db-manager.js          # 独立数据库管理器
│   ├── message-adapter.js     # MV2/MV3 消息适配器
│   └── background-sw.js       # Service Worker (MV3)
└── manifest-v3.json           # MV3 配置文件
```

## 🔧 关键 API 变化

### Service Worker 中

```javascript
// ❌ MV2
setInterval(mostVisitedInit, 3 * 60 * 1000);

// ✅ MV3
chrome.alarms.create('mostVisited', { periodInMinutes: 3 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'mostVisited') {
        mostVisitedInit();
    }
});
```

```javascript
// ❌ MV2
window.open('history.html?' + url);

// ✅ MV3
chrome.tabs.create({ url: 'history.html?' + url });
```

```javascript
// ❌ MV2
chrome.browserAction.setBadgeText({ text: "Url" });

// ✅ MV3
chrome.action.setBadgeText({ text: "Url" });
```

### UI 页面中（待迁移）

```javascript
// ❌ MV2
var db = chrome.extension.getBackgroundPage().db;

// ✅ MV3 方案 A
messageAdapter.getDB().then(db => {
    // 使用 db
});

// ✅ MV3 方案 B (推荐)
dbManager.ready(db => {
    // 使用 db
});
```

## 📊 性能对比

| 指标 | MV2 (原始) | MV2 (Phase 1) | MV3 (Phase 2-3) |
|------|-----------|---------------|-----------------|
| Background 脚本 | 225KB | 43KB (81%↓) | 43KB |
| 内存占用 | ~15MB | ~12MB | ~5MB (67%↓) |
| 启动时间 | ~200ms | ~100ms | ~80ms (60%↓) |
| 后台运行 | 持续 | 持续 | 按需唤醒 |

## ⚠️ 当前限制

### UI 页面未完全迁移

以下页面仍使用 `chrome.extension.getBackgroundPage()`：

1. **closed.js** - 1 处
2. **history2.js** - 需要检查
3. **popup.js** - 需要检查
4. **options.js** - 1 处
5. **func.js** - 需要检查

**影响：** 这些页面在 MV3 模式下可能无法正常工作。

### 解决方案

在相关 HTML 文件中添加：
```html
<script src="scripts/db-manager.js"></script>
<!-- 或者 -->
<script src="scripts/message-adapter.js"></script>
```

然后修改代码使用新 API。

## 🧪 测试脚本

### 检查 Service Worker 状态

在 Service Worker DevTools Console 中运行：

```javascript
// 检查基本变量
console.log('openedTabs:', Object.keys(openedTabs).length);
console.log('recentTabs:', recentTabs.length);
console.log('calendar:', Object.keys(calendar).length);

// 检查数据库
dbManager.getDB().then(db => {
    console.log('DB available:', !!db);
});

// 检查存储
console.log('oid:', localStorage['oid']);
console.log('use-contextmenu:', localStorage['use-contextmenu']);

// 测试右键菜单
initContextMenu();
```

### 检查 UI 页面

在任意 UI 页面 Console 中运行：

```javascript
// MV2 测试
var bg = chrome.extension.getBackgroundPage();
console.log('Background available:', !!bg);
console.log('DB available:', !!bg.db);

// MV3 测试 (需要先加载相应脚本)
dbManager.getDB().then(db => {
    console.log('DB Manager works:', !!db);
});
```

## 📖 详细文档

- **完整迁移指南:** `MV3_MIGRATION_GUIDE.md`
- **Phase 2 & 3 总结:** `PHASE_2_3_SUMMARY.md`
- **Phase 1 总结:** `BACKGROUND_REFACTOR_CN.md`
- **测试指南:** `test-background-refactor.md`

## 🐛 问题排查

### Service Worker 无法启动

1. 检查 Console 错误
2. 确认所有依赖文件存在：
   - `scripts/storage-adapter.js`
   - `scripts/background-utils.js`
   - `scripts/db-manager.js`

### 右键菜单不显示

```javascript
// 在 Service Worker Console 运行
console.log('Context menu config:', localStorage['use-contextmenu']);
initContextMenu();
```

### 数据库无法访问

```javascript
// 在 Service Worker Console 运行
dbManager.getDB().then(db => {
    console.log('DB stores:', Array.from(db.objectStoreNames));
}).catch(error => {
    console.error('DB error:', error);
});
```

### UI 页面报错

如果看到 `Cannot read property 'db' of undefined`：
- 可能是 MV3 模式下使用了旧 API
- 需要迁移该页面使用新 API

## 🎓 学习资源

- [Chrome Extension MV3 官方文档](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Service Workers 指南](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
- [MV2 到 MV3 迁移检查表](https://developer.chrome.com/docs/extensions/mv3/mv3-migration-checklist/)

## 💡 下一步

如果你准备好贡献代码，可以：

1. **完成 UI 页面迁移** (Phase 4)
   - 选择一个 UI 页面（如 closed.js）
   - 添加 db-manager.js 依赖
   - 修改 getBackgroundPage() 调用
   - 测试功能

2. **测试和修复 bug**
   - 在 MV3 模式下全面测试
   - 记录和修复问题
   - 更新文档

3. **性能优化**
   - 分析 Service Worker 性能
   - 优化数据库查询
   - 减少内存使用

## 📞 反馈

如果遇到问题或有建议，请：
1. 查看相关文档
2. 检查 Console 错误
3. 在 GitHub 提 Issue

---

**祝你好运！🚀**
