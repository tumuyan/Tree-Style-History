# Background页面重构说明

## 概述

本次重构是为Manifest V3迁移做准备。主要目标是从background页面中移除不必要的依赖，特别是MooTools框架和过于庞大的func.js文件。

## 主要改动

### 1. 新增 background-utils.js

**位置:** `chrome/scripts/background-utils.js`

这是一个专门为background页面准备的轻量级工具文件，只包含background真正需要的函数：

```javascript
// 核心函数:
- getVersion()          // 版本号
- getVersionType()      // 版本类型
- returnLang(str)       // 国际化
- timeNow(st)          // 时间格式化
- defaultConfig(clean)  // 配置初始化
- defaultValues        // 默认配置对象
```

**优势:**
- 从85KB压缩到3KB
- 无DOM操作
- 适合service worker环境

### 2. 移除MooTools依赖

**位置:** `chrome/scripts/background.js`

#### 改动1: 定时器
```javascript
// 旧代码 (第170行):
mostVisitedInit.periodical(3 * 60 * 1000);

// 新代码:
setInterval(mostVisitedInit, 3 * 60 * 1000);
```

#### 改动2: JSON编码
```javascript
// 旧代码 (第311行):
localStorage['mv-cache'] = JSON.encode(mv);

// 新代码:
localStorage['mv-cache'] = JSON.stringify(mv);
```

```javascript
// 旧代码 (第454行):
localStorage['calendar-storage'] = JSON.encode(calendar_r);

// 新代码:
localStorage['calendar-storage'] = JSON.stringify(calendar_r);
```

### 3. 更新background.html

**位置:** `chrome/background.html`

移除了moo.js和func.js的引用，改为使用background-utils.js：

```html
<!-- 旧代码: -->
<script src="scripts/storage-adapter.js"></script>
<script src="scripts/moo.js"></script>          <!-- 删除 -->
<script src="scripts/func.js"></script>          <!-- 删除 -->
<script src="scripts/background.js"></script>

<!-- 新代码: -->
<script src="scripts/storage-adapter.js"></script>
<script src="scripts/background-utils.js"></script>  <!-- 新增 -->
<script src="scripts/background.js"></script>
```

## 为什么要这样重构？

### 问题1: MooTools在MV3中的问题

MooTools的`.periodical()`方法在service worker中不适用，因为service worker会休眠。我们使用标准的`setInterval()`替代。

### 问题2: func.js过于庞大

- **大小:** 85KB
- **内容:** 包含大量DOM操作、UI相关函数
- **问题:** background页面不需要这些功能
- **解决:** 提取必要函数到background-utils.js (3KB)

### 问题3: 依赖关系混乱

之前background页面依赖：
- storage-adapter.js (9KB) ✅ 需要
- moo.js (100KB) ❌ 几乎不使用
- func.js (85KB) ❌ 大部分不需要
- background.js (31KB) ✅ 核心逻辑

现在background页面依赖：
- storage-adapter.js (9KB) ✅
- background-utils.js (3KB) ✅
- background.js (31KB) ✅

**总大小:** 225KB → 43KB (减少81%)

## 不影响的部分

以下部分保持不变：

1. **UI页面** - popup.html、history.html等仍然使用完整的func.js和moo.js
2. **功能逻辑** - background.js的核心功能逻辑完全不变
3. **API调用** - 所有Chrome API调用保持不变
4. **数据结构** - IndexedDB结构和数据格式不变

## 测试要点

重构后需要测试以下功能：

1. **标签页管理**
   - 打开新标签页
   - 关闭标签页
   - 标签页切换

2. **历史记录**
   - 自动加载历史记录
   - 历史记录缓存
   - 日期筛选

3. **快捷键**
   - Ctrl+Shift+H (打开树状历史)
   - Alt+Shift+H (打开线性历史)
   - Alt+Shift+G (最近关闭)
   - Alt+Shift+O (书签)

4. **右键菜单**
   - 页面右键搜索
   - 链接右键搜索

5. **定时任务**
   - Most Visited每3分钟更新

6. **数据存储**
   - localStorage读写
   - IndexedDB读写
   - 日历数据缓存

## 下一步计划

1. **阶段2:** 创建独立的db-manager.js
   - 将IndexedDB操作提取为独立模块
   - 减少其他页面对background的依赖

2. **阶段3:** 实现消息传递机制
   - 使用chrome.runtime.sendMessage
   - 替代getBackgroundPage()

3. **阶段4:** 迁移到Service Worker
   - 修改manifest.json为MV3格式
   - 使用chrome.alarms替代定时器
   - 处理service worker生命周期

## 注意事项

1. **兼容性:** 本次重构完全向后兼容
2. **性能:** background页面加载更快
3. **维护性:** 依赖关系更清晰
4. **可测试性:** 模块更独立，易于测试

## 相关文件

- `chrome/background.html` - 入口文件
- `chrome/scripts/background.js` - 核心逻辑
- `chrome/scripts/background-utils.js` - 新增工具文件
- `chrome/scripts/storage-adapter.js` - 存储适配器
- `chrome/scripts/func.js` - UI公共函数（未修改）
- `chrome/scripts/moo.js` - MooTools（UI仍使用）

## 如何验证

1. 加载扩展到Chrome
2. 打开Chrome DevTools
3. 检查background页面的Console
4. 确认以下消息：
   - "loading..."
   - "Success opening DB"
   - 没有错误信息

5. 测试各个功能页面：
   - Popup (点击扩展图标)
   - 树状历史 (Ctrl+Shift+H)
   - 线性历史 (Alt+Shift+H)
   - 最近关闭 (Alt+Shift+G)
   - 书签 (Alt+Shift+O)

6. 检查右键菜单功能

7. 等待3分钟，确认Most Visited更新

## 问题排查

如果遇到问题：

1. **检查Console错误**
   - 打开chrome://extensions/
   - 找到Tree Style History
   - 点击"background page"
   - 查看Console

2. **检查函数是否存在**
   ```javascript
   // 在background page console输入:
   typeof getVersion        // 应该是 "function"
   typeof returnLang        // 应该是 "function"
   typeof defaultConfig     // 应该是 "function"
   ```

3. **检查依赖加载**
   ```javascript
   // 检查对象是否定义:
   typeof localStorage      // 应该是 "object"
   typeof chrome           // 应该是 "object"
   typeof db               // 应该是 "object" (DB打开后)
   ```

## 总结

本次重构是MV3迁移的第一步，主要成果：

✅ 移除background对MooTools的依赖  
✅ 减少81%的脚本加载量  
✅ 使用标准Web API  
✅ 代码更简洁、清晰  
✅ 为service worker迁移做好准备  
✅ 保持完全向后兼容  

这为后续的MV3完整迁移奠定了良好的基础。
