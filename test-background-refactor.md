# Background Refactor Testing Guide

## Quick Test Steps

### 1. 加载扩展
1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `chrome/` 目录

### 2. 检查Background页面
1. 在 `chrome://extensions/` 页面
2. 找到 "Tree Style History" 扩展
3. 点击 "background page" 链接（或"Service Worker"旁边的检查按钮）
4. 查看 Console 输出

**期望看到:**
```
loading...
storageAdapter: initialized with X keys in Xms
Success opening DB
```

**不应该看到:**
- 任何红色错误信息
- "XXX is not defined" 错误
- MooTools相关错误

### 3. 验证函数可用性

在Background页面的Console中运行以下命令：

```javascript
// 1. 验证基本函数
console.log('getVersion:', getVersion());
// 期望: "3.1.13"

console.log('getVersionType:', getVersionType());
// 期望: "browserAction"

console.log('returnLang test:', returnLang('name'));
// 期望: "Tree Style History"

// 2. 验证配置
console.log('defaultValues:', typeof defaultValues);
// 期望: "object"

console.log('load-range:', localStorage['load-range']);
// 期望: "7" 或其他数字

// 3. 验证数据结构
console.log('db:', typeof db);
// 期望: "object"

console.log('openedTabs:', typeof openedTabs);
// 期望: "object"

console.log('calendar_storage2:', typeof calendar_storage2);
// 期望: "object"

// 4. 验证MooTools已移除
console.log('periodical:', typeof (function(){}).periodical);
// 期望: "undefined"

console.log('JSON.encode:', typeof JSON.encode);
// 期望: "undefined"
```

### 4. 测试核心功能

#### 4.1 测试标签页跟踪
1. 打开一个新标签页
2. 在Background Console中检查：
```javascript
console.log('openedTabs count:', Object.keys(openedTabs).length);
```

#### 4.2 测试历史记录
1. 访问几个网页
2. 等待几秒钟
3. 在Background Console中检查：
```javascript
console.log('IndexedDB:', db ? 'Available' : 'Not available');
```

#### 4.3 测试定时任务
1. 打开Background Console
2. 等待3分钟
3. 应该看到 mostVisitedInit 相关的日志

#### 4.4 测试快捷键
- 按 `Ctrl+Shift+H` → 应该打开树状历史页面
- 按 `Alt+Shift+H` → 应该打开线性历史页面
- 按 `Alt+Shift+G` → 应该打开最近关闭页面
- 按 `Alt+Shift+O` → 应该打开书签页面

#### 4.5 测试右键菜单
1. 在任意网页上右键点击
2. 应该看到 "Search in Tree Style History" 菜单项
3. 点击后应该打开搜索页面

#### 4.6 测试Popup
1. 点击扩展图标
2. Popup应该正常显示
3. 显示最近历史、最近关闭等内容

### 5. 检查文件加载

在Background页面Console中检查加载的脚本：

```javascript
// 查看所有加载的脚本
performance.getEntriesByType('resource')
  .filter(r => r.name.includes('.js'))
  .forEach(r => console.log(r.name));
```

**应该看到:**
- `storage-adapter.js` ✅
- `background-utils.js` ✅
- `background.js` ✅

**不应该看到:**
- `moo.js` ❌
- `func.js` ❌

### 6. 性能对比

#### 旧版本加载时间（估算）
- storage-adapter.js: ~1ms
- moo.js: ~10ms
- func.js: ~8ms
- background.js: ~3ms
- **总计:** ~22ms

#### 新版本加载时间（估算）
- storage-adapter.js: ~1ms
- background-utils.js: ~1ms
- background.js: ~3ms
- **总计:** ~5ms

**提升:** ~77% faster

### 7. 内存使用

在Chrome Task Manager中查看：
1. 打开 Chrome > More Tools > Task Manager
2. 找到 "Extension: Tree Style History"
3. 查看内存使用

**期望:** 内存使用应该比之前减少 1-2MB

### 8. UI页面测试

确保UI页面仍然正常工作：

#### Popup (点击扩展图标)
- [ ] 显示最近历史
- [ ] 显示最近关闭标签
- [ ] 显示书签
- [ ] 点击项目可以打开

#### 树状历史 (Ctrl+Shift+H)
- [ ] 页面正常加载
- [ ] 日历显示正常
- [ ] 树状结构显示正常
- [ ] 搜索功能正常

#### 线性历史 (Alt+Shift+H)
- [ ] 页面正常加载
- [ ] 历史记录列表显示
- [ ] 分页功能正常

#### 最近关闭 (Alt+Shift+G)
- [ ] 显示关闭的标签页
- [ ] 可以恢复标签页
- [ ] 树状结构正常

#### 书签 (Alt+Shift+O)
- [ ] 显示书签列表
- [ ] 时间线显示正常

#### 选项页面
- [ ] 打开 chrome://extensions/
- [ ] 点击 "Details" → "Extension options"
- [ ] 所有选项正常显示
- [ ] 保存功能正常

## 问题排查

### 如果看到 "XXX is not defined" 错误

1. **getVersion is not defined**
   - 检查 background-utils.js 是否正确加载
   - 检查 background.html 的脚本顺序

2. **defaultConfig is not defined**
   - 同上

3. **returnLang is not defined**
   - 同上

### 如果看到 "periodical is not a function" 错误

- background.js 没有正确更新
- 需要将 `.periodical()` 改为 `setInterval()`

### 如果看到 "JSON.encode is not a function" 错误

- background.js 或 background-utils.js 没有正确更新
- 需要将 `JSON.encode()` 改为 `JSON.stringify()`

### 如果UI页面出错

- 确认 func.js 和 moo.js 仍然被UI页面加载
- 检查各个HTML文件的脚本引用
- 不要删除或修改 func.js 和 moo.js

## 回滚方案

如果出现问题需要回滚，恢复以下更改：

### 1. 恢复 background.html
```html
<script type="text/javascript" src="scripts/storage-adapter.js"></script>
<script type="text/javascript" src="scripts/moo.js"></script>
<script type="text/javascript" src="scripts/func.js"></script>
<script type="text/javascript" src="scripts/background.js"></script>
```

### 2. 恢复 background.js 中的更改

#### 恢复定时器 (第170行)
```javascript
mostVisitedInit.periodical(3 * 60 * 1000);
```

#### 恢复JSON编码 (第311行)
```javascript
localStorage['mv-cache'] = JSON.encode(mv);
```

#### 恢复JSON编码 (第454行)
```javascript
localStorage['calendar-storage'] = JSON.encode(calendar_r);
```

### 3. 删除新文件
- 删除 `chrome/scripts/background-utils.js`

## 成功标准

✅ 所有以下条件都满足才算成功：

1. Background页面无错误加载
2. 所有验证函数测试通过
3. 标签页跟踪正常工作
4. 历史记录正常保存
5. 快捷键全部正常
6. 右键菜单正常显示
7. Popup正常工作
8. 所有UI页面正常工作
9. 选项页面正常工作
10. 无控制台错误

## 性能提升验证

在重构前后分别测试：

```javascript
// 在 Background Console 中运行
console.time('script-load');
// 重新加载扩展
// 然后在新的Background Console中运行
console.timeEnd('script-load');
```

**期望:** 新版本应该快 50-80%

## 报告模板

测试完成后填写：

```
测试日期: ____________________
Chrome版本: _________________
操作系统: ___________________

✅/❌ Background加载成功
✅/❌ 函数验证全部通过
✅/❌ 标签页跟踪正常
✅/❌ 历史记录正常
✅/❌ 快捷键正常
✅/❌ 右键菜单正常
✅/❌ Popup正常
✅/❌ UI页面全部正常
✅/❌ 选项页正常
✅/❌ 无控制台错误

性能提升: ____%
内存减少: ____MB

问题描述（如有）:
__________________________________
__________________________________

测试人: _______________________
```
