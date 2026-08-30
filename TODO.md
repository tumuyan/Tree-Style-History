# Tree Style History 待办清单

基于代码审查整理的缺陷修复与优化任务。优先级：`P0` 崩溃/安全/数据丢失 → `P1` 功能失效 → `P2` 可靠性 → `P3` 架构/可维护性。

状态图例：`[ ]` 未开始 · `[x]` 已完成 · `[-]` 暂缓

> **护栏已就位**：`npm run check`（ESLint + `node:test` + 4 个校验脚本）是唯一准入闸门，约 5 秒跑完，CI 强制执行。
> 当前基线：**lint 0 error / 84 测试 · 69 通过 · 15 skip · 0 失败**。
> 其中 15 个 skip 是已知缺陷的"待修规范"（函数体内写的是期望行为），与下面标注 `（有 skip 测试）` 的条目一一对应——**修完后请去掉对应 skip**。

---

## 已完成

- [x] **搭建自动化校验体系**：`package.json` + `eslint.config.mjs` + `tests/`
  - ESLint flat config，区分 classic script 与 ES module；`no-undef` 为 error（ES module 严格模式下未声明变量必抛错，是本项目崩溃 bug 的主要来源）。
  - `node:test` 零依赖测试：`tests/static.test.mjs`（manifest / MV3 约束 / 资源引用 / i18n 覆盖）、`tests/modules.test.mjs`（模块行为 + 模块图完整性）。
  - `tests/stubs.mjs` 提供浏览器环境桩，复刻 `storage-adapter.js` 的字符串化语义。
  - `.github/workflows/ci.yml`：lint + test + JSON 校验 + 21 个首方脚本语法检查。
- [x] 修复 `modules/config.js:255,257` — `downloadOptions()` 未声明的 `ve`、`i`（严格模式必抛错）
- [x] 修复 `modules/config.js:643` — `mergeList()` 未声明的 `fbl`（严格模式必抛错）
- [x] 修复 `bookmark.js:287` — `showData()` 未声明的循环变量 `i`（classic script 非严格，不崩溃但泄漏为隐式全局，与 `setInterval` 分片渲染并存时有串扰风险）
- [x] 删除 `bookmark.js` 中 3 处 `selectedItem = undefined` 死代码（复制自 `history-core.js`，但该变量是模块私有的，bookmark.js 里的写入毫无作用且只写不读）
- [x] 补齐 i18n 缺口：en 缺 `optionloadrange4` / `help22` / `help23` / `help24` / `help25`；zh_CN 缺 `deleteCacheTip`
- [x] **扩大测试覆盖面（第二轮）**
  - `tests/dom.mjs`：零依赖最小 DOM 替身（`getElementById` / 少量字面量选择器 / `createElement` + `innerHTML` / 事件派发），把选项页代码纳入纯 Node 测试。**故意不解析 HTML 树**，只提取 `id` 与 `<td>` 文本——够用且不会假装是浏览器。
  - `modules.test.mjs` 新增：favicon 全服务映射与降级链、`executeBookmarklet` 的 MV3/无标签/非小书签分支、时间格式化、选项页 `saveOptions`⇄`loadOptions` 往返与 sync 往返、过滤域名增删改。
  - `static.test.mjs` 新增：`func.js` 的 `window.*` 挂载 ↔ 模块导出双向一致性、首方脚本禁用 `eval`/`new Function`、`config.js` 引用的选项页 id 必须存在、manifest 权限与实际 `chrome.*` 调用双向覆盖、HTML 属性插值必须转义、`.lang` 类缺失检测。
  - `scripts/check-sw-sync.mjs`（接入 `npm run verify`）：比对 `background-utils.js` 与 `modules/` 的手工同步副本（10 个同名函数 + 38 键 `defaultValues`），把 P3 的"人肉记忆"变成 CI 断言。

---

## P0 — 必须尽快修复

### 安全

- [ ] **修复历史记录 URL 未转义导致的 XSS**（`chrome/scripts/modules/history-core.js:237-243`、`288-295`）**（有 skip 测试，共 11 处：history-core 8 + config 3）**
  - 现状：`url` 未转义即拼进 `innerHTML`，出现在 `href` / `value` / `title` 三个属性中，可被 `"` 提前闭合属性注入事件处理器。扩展页面持有 `history`/`bookmarks`/`tabs`/`sessions` 权限，危害等级高。
  - 做法：全部改走 `escapeHtmlAttr`（`modules/helpers.js:128`），或统一迁移到 `createElement` + `textContent` 建 DOM。
  - 关联位置：`modules/config.js:556`、`578`、`616`（用户输入的域名直接进 `title="..."` 属性）。

- [ ] **修复选择器注入**（`chrome/scripts/modules/history-core.js:244`、`255`）
  - 现状：`rha[].host` 直接拼进 `querySelector('div[rel="' + host + '"]')`，含引号时抛异常导致渲染中断。
  - 做法：改用 `CSS.escape()` 或遍历比对 `getAttribute('rel')`。

- [ ] **修复用户输入直接编译为正则**（`chrome/scripts/modules/config.js:674`）**（有 skip 测试）**
  - 现状：`new RegExp('[^?=#]*(' + flist + ').*', 'i')`。`flil` 以 `|` 结尾产生空分支匹配一切；`.` 未转义。
  - **已实测**：域名列表中含正则元字符（如 `a(`）时 `new RegExp` 抛 `SyntaxError: Unterminated group`。由于 `updateFilter()` 在模块顶层被调用，这会**在 import 阶段炸掉 `func.js`，导致扩展所有页面白屏**（自我 DoS）。
  - 做法：按 `|` 切分后逐项 `escapeRegExp` 再 `join('|')`，并对 `new RegExp` 做 try/catch 兜底。

- [ ] **给 SW 的 `callFunction` 加来源校验与白名单**（`chrome/scripts/background-sw.js:877-888`）
  - 现状：不校验 `sender`，直接 `self[message.function](...message.args)` 调用任意全局函数。
  - 做法：校验 `sender.id === chrome.runtime.id`，改为显式函数白名单。

### 崩溃 / 数据丢失

- [ ] **修复 `updateFilter()` 在模块顶层执行导致过滤域名列表被清空**（`chrome/scripts/modules/config.js:665`）**（有 skip 测试）**
  - 现状：ES module 早于 `storage-adapter.js` 的 `chrome.storage.local.get` 回调执行，此刻缓存必为空 → `updateFilter()` 读到 `undefined` → 把 `'false'` 写回 `localStorage`，用户配置被持久化覆盖。连带导致 `history2.js:38`（已注释）等页面上 `flist` 恒为 `'false'`，**域名过滤功能实际失效**。
  - 做法：把顶层调用移除，改由 `onStorageReady` 触发；`updateFilter()` 增加「缓存未就绪则不回写」保护。
  - 验证：设置一个过滤域名 → 打开 `history2.html` → 回选项页确认列表未被重置。

- [ ] **修复 `downloadOptions()` 严格模式 ReferenceError**（`chrome/scripts/modules/config.js:255`、`257`）
  - 现状：`ve = result` 与 `for (i in result)` 中的 `ve`、`i` 均未声明（已确认模块作用域内无声明），ES module 恒严格模式，必抛 `ReferenceError` → 「下载参数」按钮 100% 失效。
  - 连带修复：`i.replace('_', '-')` 只替换第一个下划线，与 `saveOptions` 的 `i.replace('-', '_')` 不对称（`favicon-service-fallback` 往返后损坏）。

- [ ] **修复 `mergeList()` 严格模式 ReferenceError**（`chrome/scripts/modules/config.js:643`）
  - 现状：`fbl = cache.split('|')` 未声明（`fbl` 仅在 `filteredDomainsList()` 内有 `var`），「合并线上列表」按钮必崩。
  - 连带修复：`for (let i = 0; i < 11; i++)` 硬编码，超过 11 个分片（约 1100 域名）静默丢数据，改为遍历到无数据为止。

---

## P1 — 功能失效

- [ ] **过滤列表应覆盖 `www` 子域**（`chrome/scripts/modules/config.js:690-696`）**（有 skip 测试）**
  - 已实测：配置 `example.com` 后，`filtUrl('https://www.example.com/a')` 返回 `false`（不过滤）。
  - 原因：`site_r = /(.+\.){3,}/` 只对 **4 段及以上**的主机名做降段处理，`www.example.com`（3 段）不触发，于是 `flist.indexOf('www.example.com')` 落空。
  - 影响：用户添加了域名却仍能看到 `www.` 前缀站点的记录，过滤看起来"时灵时不灵"。

- [ ] **`title_fix()` 会吞掉斜杠**（`chrome/scripts/modules/helpers.js:125`）**（有 skip 测试）**
  - 现状：`.replace(/\//g, '')` 把标题里的 `/` 全部删除，`FAQ / Help` 显示为 `FAQ  Help`。
  - 这是历史遗留的防御写法（早年为防路径注入），如今已有 `escapeHtmlAttr`，可考虑只在拼接属性时用转义、显示时用原文。

- [ ] **清理 `options.html:37` 的失效 i18n 属性** **（有 skip 测试）**
  - 现状：`<div class="tab-content" data-lang-string="treeOptionsDetail">` 没有 `.lang` 类，而 `func.js` 只处理 `.lang` 元素 → 该键永不渲染，且 messages.json 里也没有它。
  - 做法：删除该属性，或补上 `.lang` 类并补键。

### 配置同步（三处错误，同一函数）

- [ ] **修复 `filterlist0..N` 写入了错误的值**（`chrome/scripts/modules/config.js:482-489`）**（有 skip 测试）**
  - 现状：`o['filterlist' + j] = so[i]`，`i` 是上一个 `for (var i in so)` 循环的残留值（最后一个键），所有分片写的都是同一个无关值，**过滤域名根本没有上传**。

- [ ] **修复域名分组逻辑**（`chrome/scripts/modules/config.js:414-421`）**（有 skip 测试）**
  - 现状：`item` 从未自增，所有域名拼进同一个 `cache`，单个 key 必然超出 `chrome.storage.sync` 8KB 配额，且 `chrome.runtime.lastError` 未检查 → 静默失败。

- [ ] **修复上传成功判定**（`chrome/scripts/modules/config.js:491-497`）**（有 skip 测试）**
  - 现状：硬编码 `c - mls.length == 26`，而 `defaultValues` 实际有 **38 个键**（同步时跳过 `rh-filtered`，写 37 次），再叠加 `filterlist` 分片写入 → 判定式恒为假，上传成功也永远显示「保存失败」。
  - 做法：用 `Promise.all` 替代 1500ms `setTimeout` 猜测，并检查每次 `set` 的 `chrome.runtime.lastError`。

### 其它

- [ ] **修复 `rh-list-order` 硬编码 5 项**（`chrome/scripts/modules/config.js:434`）**（有 skip 测试）**
  - 现状：`rhlo[0].id + ... + rhlo[4].id`，增删区块即 `TypeError`。改为动态拼接。

- [ ] **修复 `addList` 只替换第一个空格**（`chrome/scripts/modules/config.js:597`）**（有 skip 测试）**
  - 现状：`item.replace(' ', '')` → 改为 `replace(/\s+/g, '')`。
  - **已实测**：`addList(' example.com ')` 得到 `'example.com '`，尾部空格过不了 `rel.test()`，于是弹「请输入合法 URL」并**整条丢弃**——不是加了个脏数据，是加不进去。

### 新发现（第二轮测试暴露，尚未核实过真实 UI）

- [ ] **选项页缺少 `#mvlist` / `#mvlist-table`，「最常访问黑名单」整条链路失效** **（有 2 个 skip 测试）**
  - 现状：`options.html` 只有 CSS（`options.css:325,335`）引用这两个 id，**HTML 里没有对应元素**。
  - 后果一（崩溃）：`mostVisitedBlocklist()`（`config.js:556`）执行 `$('mvlist-table').appendChild(tr)`，一旦 `mv-blocklist` 非空即 `TypeError` → **从 popup 屏蔽过任意站点后，选项页打不开**。
  - 后果二（数据丢失）：`saveOptions()`（`config.js:380`）读 `$$('#mvlist tr td:first-child')` 恒为空 → `mlil = 'false'` → **每次保存选项都会静默清空黑名单**。
  - 黑名单由 `popup-core.js:460-464` 写入，所以"屏蔽站点"能生效于 popup，但在选项页一侧既看不见也留不住。
  - 做法：在 `options.html` 补上 `#mvlist`/`#mvlist-table` 表格（对齐既有 `#flist`/`#flist-table`），或整条移除该特性。

- [ ] **`filtUrl()` 用子串匹配，过滤域名会误伤** **（有 skip 测试）**
  - 现状：`flist.indexOf(site) >= 0`（`config.js:686,693`）不做标签边界判断，且 `flist_r` 正则含空分支（`flist` 以 `|` 结尾）可匹配任意串。
  - **已实测**：配置 `b.com` 后 `filtUrl('https://b.co/x')` 返回 `true`；配置 `sub.example.com` 后 `filtUrl('https://example.com/a')` 也返回 `true`。
  - 做法：改为按 `|` 切分后精确比对（并保留 `www` 降段逻辑，见上条 P1）。

- [ ] **`timeNow()` / `TimeToStr()` 的 `te` 未初始化** **（有 2 个 skip 测试）**
  - 现状：`helpers.js:23` 与 `:74` 声明 `var te;` 但只在 `tf == '12'` / `tf == '24'` 分支赋值。
  - **已实测**：`rh-timeformat` 为其它值或未就绪时输出 `13:05undefined`（`undefined` 被字符串拼接出来）。
  - 注意：`background-utils.js:49` 的副本写作 `var te = ''`，已经没有这个问题——两侧行为不一致，`check-sw-sync.mjs` 目前把它列为已知差异。**修的时候以 background-utils 的写法为准，并同步删掉 `ACCEPTED_DRIFT` 里的 `timeNow` 条目。**
  - 触发条件：`defaultConfig()` 保证 `rh-timeformat` 有值，所以正常情况下碰不到；但在 storage 尚未就绪（`storage-adapter.js` 冷启动）的窗口内读取就会露出来。

- [ ] **给 `rh-list-order` 的 `split(',')` 加空值保护**（`chrome/scripts/popup.js:64`、`134`）
  - 现状：无空值保护，且同一表达式重复计算两次。

---

## P2 — 可靠性与 MV3 适配

- [ ] **修复 Service Worker 重启导致跳转关系链断裂**（`chrome/scripts/background-sw.js:17-38`）
  - 现状：`openerJson`/`tabUrlJson`/`tabUrl0Json`/`urlIdJson`/`idUrlJson`/`openedTabs`/`recentTabs` 均为内存变量，SW 空闲约 30 秒被回收后丢失，`add_tab_history()` 依赖的 `openerJson` 失效 → **点击链接产生的父子关系记不下来**，而这是本扩展的核心数据结构。
  - 做法：周期性落盘到 `chrome.storage.session`（MV3 会话级存储，重启浏览器才清空），启动时恢复。

- [ ] **启动期抓取改为并发分片 + 断点续传**（`chrome/scripts/background-sw.js:686-755`）
  - 现状：`processVisits()` 对 `urls_wait_load` 逐个串行 `await chrome.history.getVisits`（默认 7 天、上限 300 天，可达数万条），无进度持久化；SW 中途被杀则前功尽弃；每条都调一次 `chrome.action.setBadgeText` 未节流。
  - 做法：`Promise.allSettled` 分片并发、游标写入 storage、徽章节流更新。

- [ ] **修复 `updateClosedTabsStatus()` 重复打开游标**（`chrome/scripts/db-manager.js:372-394`）
  - 现状：对同一 index 调两次 `openCursor`，第二次只为挂 `onerror`，白白多开游标且有事务提前提交风险。应在同一次调用上同时挂 `onsuccess`/`onerror`。

- [ ] **移除 `func.js` 的 250ms 永久轮询**（`chrome/scripts/func.js:220-232`）
  - 现状：每个扩展页面开一个永不清除的 `setInterval`，全表扫描 `a[href="#"]` 并逐个绑监听。
  - 做法：改为 `document` 上的一次事件委托（`e.target.closest('a[href="#"]')`）。

- [ ] **修复 `_tSW_load` 的 TDZ 隐患**（`chrome/scripts/background-sw.js:344` 使用，`:917` 才 `const` 声明）
  - 现状：靠同步执行顺序侥幸不触发，任何结构调整都会炸。改为文件顶部声明。

- [ ] **修复 `history2.js` 变量遮蔽**（`chrome/scripts/history2.js:289`）
  - 现状：`let t = transition_value[v.transition]` 遮蔽了 `feach_History(loadfrom, loadto, t)` 的形参 `t`，递归翻页依赖遮蔽不生效才正确。重命名局部变量。

- [ ] **清理 MV2 死代码**（`chrome/scripts/background-sw.js:515-517`）
  - 现状：`getVersionType()` 恒返回 `'browserAction'`，`chrome.pageAction.show()` 永不执行。

- [ ] **统一 `addCloseRedord` 的命名与 id 语义**（`chrome/scripts/background-sw.js:380-393`）
  - 现状：函数名拼写错误；`id: oid + '_' + tid` 与 `oid: oid - 1` 语义不一致。

- [ ] **处理 zTree 内含 `eval` 的 CSP 风险**（`chrome/scripts/jquery.ztree.core.js:1105`）
  - 现状：`newNodes = eval("(" + msg + ")")`，MV3 默认 CSP 禁用 `eval`。当前走本地 `zNodes` 未触发，属潜在风险。

---

## P3 — 架构与可维护性

- [ ] **清理 lint 警告存量**：约 90 处 `no-redeclare`（同作用域 `var` 重复声明）、61 处 `no-unused-vars`、1 处 `no-empty`、2 处 `require-atomic-updates`。
  - 现状：这些设为 warning，不阻塞 CI。`no-redeclare` 之所以不设为 error，是因为它合法无害，90 条会淹没真实错误。
  - 收尾动作：清零后把 `npm run lint` 改为 `eslint . --max-warnings 0`，彻底锁死。

- [ ] **消除 `background-utils.js` 的手工同步**（**漂移已可被 CI 发现，根治仍待做**）
  - 现状：`background-utils.js` 用注释列出与 `modules/` 的 SYNC 映射（`getVersion`/`timeNow`/`getFaviconUrl`/`defaultConfig`/`save_calendar_storage2` 等），因 MV3 的 SW 无法 `importScripts` ES module 而必须重复。
  - 已有护栏：`npm run verify:sw-sync`（`scripts/check-sw-sync.mjs`）逐函数比对两侧函数体与 38 键 `defaultValues`，单侧改动会让 CI 失败。当前仅 `timeNow` 列为已知差异。
  - 根治做法：抽成同时兼容两种加载方式的 UMD 式文件，届时连同 `check-sw-sync.mjs` 一起删除。

- [ ] **解开循环依赖（现有两组）**
  - `calendar.js` ↔ `history-core.js`：`calendar_storage2` 由前者读取、后者写入，二者互相 import，初始化顺序敏感。
  - `helpers.js` ↔ `config.js`：`helpers.js:4` 导入 `config.js` 的 `defaultValues`，而 `config.js:5` 又导入 `helpers.js` 的 `returnLang`/`get_host`。目前靠 ESM 提升侥幸可用，但依赖方向混乱。
  - 做法：把共享状态抽到独立的 `state.js`，让依赖变成单向的 `state ← helpers ← config`。

- [ ] **完成模块化，删除 `func.js` 的 window 兼容层**
  - 现状：`func.js` 把几十个函数逐个挂 `window`，`popup.js`/`history.js`/`closed.js`/`bookmark.js` 仍通过全局变量调用——物理拆了文件、逻辑仍是全局脚本。
  - 做法：页面脚本改为 `import`，删掉 `window.*` 挂载，使依赖可被静态分析。

- [ ] **统一前端技术栈**
  - 现状：`history2.html`/`closed.html` 用 jQuery+zTree（约 2.6k 行第三方代码，`jQuery.noConflict()` 后 `$` 让给 `dom-helper`），其余页面已原生化，两套并存且无共识。
  - 做法：制定迁移路径（原生递归渲染或轻量虚拟树替换 zTree），消除双栈与 `eval` 风险。

- [ ] **重新审视全局劫持 `localStorage`**（`chrome/scripts/storage-adapter.js:290`）
  - 现状：`Object.defineProperty` 把 `localStorage` 换成 Proxy，对所有第三方脚本生效，且 `storageAdapter.ready()` 之前读取全是 `undefined`（P0 中 `updateFilter` 的 bug 正是这个语义陷阱的产物）。至少应让未就绪时读取打出告警。

- [x] **补充最小测试 + CI**（第二轮已覆盖前两类；第三类仍未做）
  - 已覆盖：`filtUrl` 匹配、配置读写往返（`saveOptions`/`loadOptions`/`downloadOptions`/`addList`）、favicon 子系统、小书签执行、时间格式化、模块图与 `func.js` 挂载一致性、manifest 权限覆盖、SW 副本同步。
  - 仍未覆盖：`feach_History` 的树构建与翻页边界、`history()`/`popup-core.js` 的渲染层、Service Worker 采集链路。
  - **阻塞原因**：这几处都深度依赖真实 DOM（zTree / `querySelector('div[rel="' + host + '"]')` / `setInterval` 分片渲染），`tests/dom.mjs` 的替身**故意不做 HTML 树解析**，硬撑会写出一堆似是而非的断言。
  - 建议：要么引入 jsdom/happy-dom 并接受一个开发依赖，要么按 TODO.md 第 2 批先把渲染层重构成可测的纯函数。在那之前，这几处的回归只能靠手动加载扩展验证。

---

## 建议执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| ✅ 第 0 批 | 自动化护栏 + 修 4 处未声明变量/死代码 + 补 i18n | **已完成**。此后每批改动都有 `npm run check` 兜底 |
| 第 1 批 | 修 `updateFilter` 竞态与正则元字符崩溃（均有 skip 测试，去掉 skip 即可验证） | 数据丢失 + 白屏级崩溃，改动集中在 `config.js` 一个函数 |
| 第 2 批 | 修 XSS（URL 未转义拼 `innerHTML`）与选择器注入 | 安全，需逐处替换并回归各页面渲染；建议先补渲染层测试 |
| 第 3 批 | 修配置同步三处错误 + `www` 子域过滤 | 功能失效，同属配置子系统，一起回归 |
| 第 4 批 | SW 状态持久化（`chrome.storage.session`）、启动抓取异步化 | 涉及 MV3 架构调整，需先讨论方案 |
| 第 5 批 | 清理 lint 警告存量 → `--max-warnings 0`；模块化收尾、技术栈统一 | 长期收益，可渐进推进 |

执行约定：
1. 每批开始先跑 `npm run check` 确认起点是绿的。
2. 修 bug 时**先为期望行为解除对应 skip 测试**，再改代码——测试红 → 改代码 → 测试绿。
3. 每批结束再跑 `npm run check`，并**手动加载一次扩展**验证（自动化只能覆盖静态与纯逻辑，覆盖不了真实渲染）。

---

## 备注

- 版本号只在 `chrome/manifest.json` 的 `version` 字段维护，发布前需同步更新 `README.md` 的 Changelog 段落。
- 分支：`main` 为当前 MV3 主线；`master` 是已废弃的 MV2 代码；`mv3-3` 已合并。
- `README.md` 的 Changelog 记录了 MV3 带来的已知体验劣化（部分页面 favicon 无法显示、popup 中小书签可能不触发），排查「看起来像 bug」的现象前先读一遍。
