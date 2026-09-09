# Tree Style History 待办清单

基于代码审查整理的缺陷修复与优化任务。优先级：`P0` 崩溃/安全/数据丢失 → `P1` 功能失效 → `P2` 可靠性 → `P3` 架构/可维护性。

状态图例：`[ ]` 未开始 · `[x]` 已完成 · `[-]` 暂缓

> **护栏已就位**：`npm run check`（ESLint + `node:test` + 4 个校验脚本）是唯一准入闸门，约 5 秒跑完，CI 强制执行。
> 当前基线：**lint 0 error / 140 warning · 133 测试 · 133 通过 · 0 skip · 0 失败**（另：e2e 9 测试 · 9 通过）。
> 2 个 skip 已在「第 3 批」消除（`rh-list-order` 硬编码与失效的 `treeOptionsDetail`）。**当前无 skip**；后续若需标注已知缺陷，沿用 `test(name, { skip: '原因' }, fn)` 写法（函数体内写期望行为，修完去掉 skip）。

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
    - **已被取代**：重复的那份改为由 `modules/shared/` 生成后，此脚本连同比对对象一起删除（见「第 1.8 批」）。留档以上描述的是当时的中间态。

### 第 1.5 批（已完成）：三个可测缺陷

- [x] **修复 `filtUrl()` 子串匹配误伤**（`chrome/scripts/modules/config.js:681`）
  - 原状：`flist.indexOf(site)` 在 `'|'` 拼接串上做子串搜索，不认标签边界。配置 `b.com` 会过滤掉 `b.co`；配置 `sub.example.com` 会过滤掉 `example.com`。
  - 做法：新增 `domainsToSet()` 把列表切成整体条目存进 `flist_set`（并转小写），`filtUrl()` 改为集合查找。当时**刻意保留 `site_r` 分支与 `flist_r` 的构造方式不变**以缩小改动面；分支随后被证实从不执行，见「第 1.7 批」。
  - 连带：`domainsToSet()` 顺手做了 `trim()`，配置里带空格的条目现在也能命中。
- [x] **修复 `te` 未初始化导致输出 `undefined`**（`chrome/scripts/modules/helpers.js:23`、`74`）
  - 原状：`var te;` 只在 `tf == '12'` / `tf == '24'` 分支里赋值，其余情况拼出 `13:05undefined`。
  - 做法：`TimeToStr()` 与 `timeNow()` 都改为 `var te = '';` 预先初始化，并删掉 `timeNow()` 里已冗余的 `else if (tf == '24') { te = ''; }` 分支。
  - 连带收益：删掉该分支后 `helpers.js` 与 `background-utils.js` 的 `timeNow()` **完全一致**，`check-sw-sync.mjs` 里最后一条 `ACCEPTED_DRIFT` 记录得以删除，同步检查现在零豁免。（该脚本后来随「第 1.8 批」的改造一起删除。）
- [x] **修复 `addList()` 只替换第一个空格**（`chrome/scripts/modules/config.js:597`）
  - 原状：`item.replace(' ', '')` → 粘贴 `" example.com "` 保留尾部空格 → 过不了 `rel.test()` → 弹「请输入合法 URL」并**整条丢弃**。
  - 做法：改为 `replace(/\s+/g, '')`，制表符/换行一并处理。

---

## P0 — 必须尽快修复

### 安全

- [x] **修复历史记录 URL 未转义导致的 XSS**（`chrome/scripts/modules/history-core.js`）— **已修复**（见「第 2.2 批」）
  - ~~现状：`url` 未转义即拼进 `innerHTML`，出现在 `href` / `value` / `title` 三个属性中，可被 `"` 提前闭合属性注入事件处理器。~~
  - 已做：`history-core.js` 两个渲染分支的 `url` 走 `escapeHtmlAttr`；`config.js` 三个列表的域名此前**全裸**，改为按属性/文本位置分别转义。
  - 关联位置：`modules/config.js` 的 `mostVisitedBlocklist()` / `filteredDomainsList()` / `addList()`。

- [x] **修复选择器注入**（`chrome/scripts/modules/history-core.js`、`bookmark.js`）— **已修复**（见「第 2.2 批」）
  - ~~现状：`rha[].host` 直接拼进 `querySelector('div[rel="' + host + '"]')`，含引号时抛异常导致渲染中断。~~
  - 已做：13 处按 host 拼 `[rel="…"]` / `[title="…"]` 的位置全部改走 `CSS.escape()`。**此前全仓零处 `CSS.escape`** —— 原记录的"13 处"并没落到 `history-core.js` / `bookmark.js` 这两条路径上，是本次补的运行时测试才暴露的。

- [x] **修复用户输入直接编译为正则**（`chrome/scripts/modules/config.js:674`）— **已修复**（见「第 1 批」）
  - ~~现状：`new RegExp('[^?=#]*(' + flist + ').*', 'i')`。`flil` 以 `|` 结尾产生空分支匹配一切；`.` 未转义。~~
  - **已实测**：域名列表中含正则元字符（如 `a(`）时 `new RegExp` 抛 `SyntaxError: Unterminated group`。由于 `updateFilter()` 在模块顶层被调用，这会**在 import 阶段炸掉 `func.js`，导致扩展所有页面白屏**（自我 DoS）。
  - 已做：`flist_r` 改由归一化后的 `flist_set` 逐条 `escapeRegExp` 拼成，空集合保留 `/^false$/` 哨兵。转义后不可能再抛 `SyntaxError`，故**未**按原计划加 try/catch 兜底（吞掉异常只会掩盖新引入的构造错误）。

- [x] **给 SW 的 `callFunction` 加来源校验与白名单** — **已修复**（见「第 3 批」）
  - ~~现状：不校验 `sender`，直接 `self[message.function](...message.args)` 调用任意全局函数。~~
  - 已做：抽出 `handleCallFunction()`，先校验 `sender.id === chrome.runtime.id`，再从显式表 `CALLABLE_FUNCTIONS` 取函数（当前唯一成员 `deleteDb`）。
  - 顺带：回复改从 promise 回调发出并 `return true` 保活端口，否则异步 `sendResponse` 会被提前关闭的端口吞掉。

### 崩溃 / 数据丢失

- [x] **修复 `updateFilter()` 在模块顶层执行导致过滤域名列表被清空**（`chrome/scripts/modules/config.js:665`）— **已修复**（见「第 1 批」）
  - ~~现状：ES module 早于 `storage-adapter.js` 的 `chrome.storage.local.get` 回调执行，此刻缓存必为空 → `updateFilter()` 读到 `undefined` → 把 `'false'` 写回 `localStorage`，用户配置被持久化覆盖。~~
  - 已做：顶层调用移除，改由 `window.onStorageReady(updateFilter)` 触发；`updateFilter()` 读到的值为 `undefined` 时直接返回，不回写；`filtUrl()` 在未就绪时惰性重试一次。
  - 验证：设置一个过滤域名 → 打开 `history2.html` → 回选项页确认列表未被重置。

- [x] **修复 `downloadOptions()` 严格模式 ReferenceError**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 2.2 批」）
  - ~~现状：`ve = result` 与 `for (i in result)` 中的 `ve`、`i` 均未声明。~~
  - 已做：`for (const i in result)`；`i.replace(/_/g, '-')` 全局替换下划线，与写入侧严格互逆（静态断言「配置键不得含下划线」锁住前提）。

- [x] **修复 `mergeList()` 严格模式 ReferenceError**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 2.2 批」）
  - ~~现状：`fbl = cache.split('|')` 未声明；`for (let i = 0; i < 11; i++)` 硬编码分片数。~~
  - 已做：`const fbl`；分片数改按 `filterlist_slices` 计数读取，历史上更长的列表留下的高编号分片不再被读回。

---

## P1 — 功能失效

- [x] **过滤列表应覆盖 `www` 子域**（`chrome/scripts/modules/config.js`）
  - ~~影响：用户添加了域名却仍能看到 `www.` 前缀站点的记录，过滤看起来"时灵时不灵"。~~
  - 原因有两层：`site_r = /(.+\.){3,}/` 只对 **4 段及以上**的主机名做降段处理（`www.example.com` 是 3 段，不触发）；且降段用的 `replace(/[\.]+\./, '')` 要求**连续两个点**，真实主机名里不存在——**该分支从不执行**。改成集合查找后，分支内外两个判断完全等价，死得更彻底。
  - 做法：删掉 `site_r` 与降段分支，改为「主机未命中集合且以 `www.` 开头时，剥掉 `www.` 再查一次」。**只剥 `www`**：逐级剥所有标签会让配置的 `b.com` 误伤 `xb.com`（`filter entries match whole host labels, not substrings` 已锁定此行为）。
  - 连带：`site_r` 已从 `config.js` 导出、`func.js` 导入，以及两处测试白名单（`modules.test.mjs` 的 `VALUE_EXPORTS`、`static.test.mjs` 的 `MODULE_PRIVATE`）中一并移除。

- [x] **`title_fix()` 会吞掉斜杠**（`chrome/scripts/modules/helpers.js`）—— **已从根上消除**（见「第 2.2 批」）
  - ~~现状：`.replace(/\//g, '')` 把标题里的 `/` 全部删除，`FAQ / Help` 显示为 `FAQ  Help`。~~
  - `title_fix()` 已删除，代之以按上下文分工的两个纯转义函数（`escapeHtmlAttr` / `escapeHtmlText`），都不再删除任何字符。

- [x] **清理 `options.html` 的失效 i18n 属性** — **已修复**（见「第 3 批」）
  - ~~现状：空 div 带 `data-lang-string="treeOptionsDetail"` 却没有 `.lang` 类。~~
  - 已做：整个空 div 删掉——`treeOptionsDetail` 在两语言 messages.json 里都不存在，且 `.tab-content` 默认 `display:none`，补键也只是渲染出一个隐形盒子。
  - 解除 `static.test.mjs` 的 skip，并经变异验证（插入一个只有 `data-lang-string` 的元素 → 立刻报红）。

### 配置同步（三处错误，同一函数）

- [x] **修复 `filterlist0..N` 写入了错误的值**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 2.1 批」）
  - ~~现状：`o['filterlist' + j] = so[i]`，`i` 是上一个 `for (var i in so)` 循环的残留值（最后一个键），所有分片写的都是同一个无关值，**过滤域名根本没有上传**。~~

- [x] **修复域名分组逻辑**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 2.1 批」）
  - ~~现状：`item` 从未自增，所有域名拼进同一个 `cache`，单个 key 必然超出 `chrome.storage.sync` 8KB 配额，且 `chrome.runtime.lastError` 未检查 → 静默失败。~~

- [x] **修复上传成功判定**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 2.1 批」）
  - ~~现状：硬编码 `c - mls.length == 26`，而 `defaultValues` 实际有 **38 个键**……判定式恒为假，上传成功也永远显示「保存失败」。~~
  - 已做：`Promise.all` 替代 1500ms `setTimeout` 猜测，并逐个检查 `chrome.runtime.lastError`。

### 其它

- [x] **修复 `rh-list-order` 硬编码 5 项**（`chrome/scripts/modules/config.js`）— **已修复**（见「第 3 批」）
  - ~~现状：`rhlo[0].id + ... + rhlo[4].id`，增删区块即 `TypeError`。~~
  - 已做：`Array.from(rhlo, (li) => li.id).join(',')`。解除 `modules.test.mjs` 的 skip（用 2 个区块保存），并经变异验证。

- [x] **修复 `addList` 只替换第一个空格**（`chrome/scripts/modules/config.js:597`）
  - 做法：`item.replace(' ', '')` → `replace(/\s+/g, '')`。**已完成**，见「第 1.5 批」。
  - **已实测**：`addList(' example.com ')` 得到 `'example.com '`，尾部空格过不了 `rel.test()`，于是弹「请输入合法 URL」并**整条丢弃**——不是加了个脏数据，是加不进去。

### 第 1 批（已完成）：`updateFilter()` 竞态与正则元字符崩溃

- [x] **去掉 `config.js` 顶层的 `updateFilter()` 调用，改为 `onStorageReady` 钩子**
  - 原状：ES module 的求值早于 `storage-adapter.js` 解析完 `chrome.storage.local`，此刻读到 `undefined`，于是走进 `localStorage['rh-filtered'] = 'false'` 分支。这是一次真实的 `chrome.storage.local.set()`，与尚未返回的 `get(null)` 竞态；**写赢了就把用户的过滤列表清空**。
  - 做法：删除该写入。键的初始化归 `defaultConfig()`（SW 启动 + 选项页），**读取者不当写入者**。刷新时机改由 `window.onStorageReady(updateFilter)` 承担（与 `calendar.js:14` 既有写法一致）。
- [x] **`updateFilter()` 遇 `undefined` 提前返回，不覆盖已有状态**
  - 区分「还没读到」与「用户没配过滤」：前者由新增的 `filterLoaded` 标志让 `filtUrl()` 在**使用时**惰性重试一次。
  - 为什么两道机制都要：`window.onStorageReady` 让状态尽早正确（且不依赖是否有人调用 `filtUrl`）；惰性重试让 `filtUrl()` **不依赖脚本注册顺序**——否则就得指望 `func.js`（module，defer）永远排在 `popup.js`（defer）之前，这种隐式约束太脆。
- [x] **`flist_r` 改为由归一化后的集合构建**
  - 原状：`new RegExp('[^\?=#]*(' + flist + ').*', 'i')` 直接插值原始串 → 配置含 `a(` 时 **抛 SyntaxError**（过滤列表非空即白屏）；`.` 被当通配符；`'a.com|b.com|'` 结尾的 `|` 产生**空分支，匹配一切**。
  - 做法：新增 `escapeRegExp()`（`modules/helpers.js`，与 `escapeHtmlAttr` 同列并挂到 `window`）后逐条转义拼接；集合为空时保留 `/^false$/` 哨兵，避免编译出 `[^?=#]*().*` 这种全匹配。
- [x] 新增 6 个测试 + 解除 2 个 skip：导入无副作用、冷启动不写入、ready 后刷新、元字符不抛（含逐个字符遍历）、坏条目不牵连兄弟、空列表不全匹配、`.` 不当通配符。
  - `tests/stubs.mjs` 新增 `onStorageReady` 队列与 `fireStorageReady()`；`tests/dom.mjs` 的假 `window` 转发 `onStorageReady`（此前整体替换 `window` 导致钩子静默不注册）。

### 第 2.1 批（已完成）：修 `filterlist` 分片的写入侧与残留分片

- [x] **写入侧三处错误**（详见 P0 条目）：分片内容写了泄漏变量 `so[i]`；分组 `item` 从不自增；成功判定硬编码 `== 26`。
- [x] **`filterlist_slices` 计数键**：随上传写入，「上次上传写了几个分片」成为可查信息，读取侧不再靠猜。
- [x] **`dropStaleSlices()`**：删掉上一次更长的列表留下的高编号分片。此前同步区只增不减，列表缩短后旧分片永久滞留。
- [x] **`chrome.storage` 三个 promise 包装**（`syncSet`/`syncRemove`/`syncGet`）：逐个检查 `chrome.runtime.lastError`。原回调写法从不读它，超配额静默失败、UI 照报成功。
- [x] **新增 5 条测试**，均先红后绿：
  - `saveOptions(true) uploads the domain list sliced into groups`（解除 skip：150 域名 → 2 个分片）
  - `saveOptions(true) reports success after a successful upload`（解除 skip）
  - `saveOptions(true) reports failure when a write is rejected`（注入 `chrome.runtime.lastError`）
  - `saveOptions(true) still rebuilds the in-memory filter`（防回归：上传分支改成异步后极易 `return` 早退，把 `updateFilter()` 甩在后面）
  - `re-uploading a shorter filter list does not resurrect removed domains`（端到端：上传 150 → 缩到 1 → 清空表格 → `mergeList()`，断言只剩 1 条）
  - `mergeList ignores slices from an upload that predates the slice count`（旧数据无计数键时按 0 处理，不把垃圾当域名）
- [x] **`tests/stubs.mjs` 的 `remove` 支持数组**：真实 API 接受 string | string[]，桩只处理了单键。
- [x] 旧的「`mergeList` 读满 12 个分片」测试**改写**：它直接往 `env.syncStore` 塞合成分片、绕过 `saveOptions()`，所以写入侧是坏的它也照样绿——正是它放过了这个 bug。现在全部改走真实往返（`uploadDomains()` 辅助函数）。

### 第 1.6 批（已完成）：最常访问黑名单整条链路失效

- [x] **补回选项页缺失的 `#mvlist` / `#mvlist-table`**
  - 根因：`options.html` 里只有 CSS 引用这两个 id，HTML 从未写过对应元素；而 `option16`（Restore Items to Most Visited）与 `help16` 是**孤儿 i18n 键**（两语言都有、代码零引用）——说明这段 UI 是丢失的，不是没设计。`help16` 原文「Click on the cross next to the URL to restore it」直接描述了预期形态。
  - 做法：在 `main-options` 里紧跟 `option3`（最常访问数量）补一行，结构对齐既有 `#flist`/`#flist-table`，复用 `option16` + `help16`。
  - 该 UI 只读：条目由 popup 的 `uiDeleteItem(el,'mv')` 写入，选项页靠每行的 X 移除后保存来恢复站点。
- [x] **顺带修掉 `mostVisitedBlocklist()` 的属性注入**（`config.js:555`）
  - 为什么不留到 P0：`mostVisitedBlocklist()` 此前**从未真正执行过**（黑名单非空就抛错、为空就 no-op），是本次才启用的代码路径。启用一段已知的未转义渲染等于引入漏洞，故只修这一处；`filteredDomainsList()` 与 `addList()` 是**早已在线**的同类问题，仍归 P0 批次（11 处 → 剩 10 处）。
  - 已实测：含 `"` 的 URL 渲染为 `&quot;`，属性未被闭合。
- [x] 新增 4 个测试：渲染不崩溃、保存不清空、**点 X 移除后保存可恢复站点**、清空后写回 `'false'` 哨兵值。
  - `tests/dom.mjs` 微调：`innerHTML` 注册出的 id 元素现在挂上 `parentNode`，使 `closest('tr')` 可解析——这是 X 按钮的真实工作方式。**仅一层父级**，仍不构建嵌套树。

### 第 1.7 批（已完成）：删除 `filtUrl()` 里从不执行的降段分支

- [x] 分支守卫 `site_r`（`/(.+\.){3,}/`）要求主机名 4 段以上，其内的替换又要求连续两个点（真实主机名不存在），**两个条件不可能同时成立** → 该分支是死代码。
  - 后果：配置 `example.com` 覆盖不到 `www.example.com`。
  - 做法：改为只剥 `www.` 前缀。只剥 `www` 而非逐级上溯，以免配置的 `b.com` 误伤 `xb.com`。
  - 注：此条在提交 `005b7e3` 中已完成，当时漏建本节，导致第 1.5 批的「见『第 1.7 批』」长期悬空。

### 第 2.2 批（已完成）：删除 `title_fix`，转义改为按上下文分工

- [x] **新增 `escapeHtmlText()`**（`modules/helpers.js`）：用于文本位置（`>' + x + '<`），与 `escapeHtmlAttr()`（属性位置）配对。两个函数而非一个带模式参数的函数——函数名能被 grep 到，模式字符串不能。
  - 文本位置**不**转义引号：那里无需转义，转义了反而改写用户写的标题。
  - `&` 必须最先转义，否则会把上一轮刚生成的实体的 `&` 再转成 `&amp;`（bookmark.js 那个 `&#34;` 事故的根因）。
  - **不**删 `<script>` 块：`<` 已转义就不可能执行，删它只会丢文本——正是 `title_fix()` 的老毛病。`escapeHtmlAttr()` 同样不删，两者必须对称。
- [x] **删除 `title_fix()`**：它同时是「半个转义器」和「字符删除器」，调用方无法判断返回值是"安全的 HTML 片段"还是"纯文本"，这正是问题反复出现的根源。连带清掉 `calendar.js` 的无用 import 与 `func.js` 的 `window.title_fix` 导出（已确认无 HTML 页面调用）。
- [x] **渲染点改为存原文 + 插值点转义一次**，必须成对改（只改一半要么 XSS、要么双重转义）：
  - `history-core.js`：存储 `:119` + 渲染两个分支 + 分组标题（此前**四处全裸**，含 `href` / `value` / `title`）
  - `popup-core.js`：存储 `:81` + 渲染 `:192`
  - `bookmark.js`：第 2 批已改存储，本批把渲染点的 `escapeHtmlAttr` 换成 `escapeHtmlText`，并删掉 `:324` 残留的 `title_fix()` 调用（`no-undef` error，bookmark 页渲染循环直接崩）
  - `config.js` 三个列表（`mvlist` / `flist` / `addList`）：此前全裸
  - `truncate` 在转义**之前**：反过来会把实体从中间切断，且截断长度随转义漂移。
- [x] **选择器注入补 `CSS.escape`**：`history-core.js` 与 `bookmark.js` 共 13 处按 host 拼 `[rel="…"]` / `[title="…"]`。host 带引号时 `querySelector` 抛 `SyntaxError`，从 5ms 分片渲染循环冒出去，页面画一半。
- [x] **`downloadOptions()` 改为全局替换下划线**（回归，本批新发现）：写入侧已把每个 `-` 换成 `_`，读取侧只换第一个 → `favicon-service-fallback` 下载回来变成 `favicon-service_fallback`，没人再读。两边必须严格互逆，新增 `no config key contains an underscore` 断言锁住前提。
- [x] **`mergeList()` 按 `filterlist_slices` 计数读取**：「硬编码 11」→「探测到第一个缺失分片」→「按计数读」。前两种都会把历史上更长的列表留下的高分片读回来，等于复活用户已删除的域名。
- [x] **`saveOptions()` 补 JSDoc**：返回值只表示"上传已结束"，不表示"上传成功"（失败已呈现在按钮上并记日志，在此吞掉以免 reject 冒到点击处理函数）。
- [x] **三层测试，全部经变异验证（先看到红，再改到绿）**：
  - 单测 5 条：`escapeHtmlText` 保住斜杠与引号、中和标签而不删除、`&` 优先转义（并断言双重转义**可见地**错，不把它归一化掉）、容忍 `undefined`/`null` 标题、`formatItem` 原样显示标题。
  - `CSS.escape` 运行时测试 4 条：钉住桩本身、真实 host 往返、不转义时抛 `SyntaxError`、5 种 host 形状。此前只有静态守卫，只能证明"写了这个调用"，证明不了"转义后还选得中"。
  - 静态守卫 2 条：①全仓不得出现 `title_fix()` 调用（**无白名单**，顺带阻止日后重新引入）；②携带标题的文本位置插值必须是 `escapeHtmlText(...)`（**无白名单**——生成值根本不匹配字段过滤器，无需豁免）。
  - e2e 双向断言：同一个标题 `Docs / API "v2" <b>x</b>` 同时覆盖两个方向的错误——不转义则 `<b>` 变成真元素（`querySelectorAll('.title b')` 命中），双重转义则文本里出现字面实体。**用 `textContent` 而非 `innerText`**：分组是否默认展开是实现细节，断言不能依赖它。
- [x] **测试基础设施四处修正**：
  - 新增 `stripJsComments()`：注释里提到 `title_fix()` 的散文被误判成调用。它**必须识别正则字面量**——`/'/g` 会把引号状态撑到文件末尾，导致剥注释静默失效（这就是第一版守卫误报的原因）。同理不能把除号当正则开头：旧写法从 `total / count` 一路扫到文件末尾，之后所有注释都不再剥离——守卫静默失效却不报红。改为先找同一行的闭合 `/`（正则字面量不能跨行），找不到就按普通字符抄过去。补 3 条自测；**变异验证**：让换行不再终止扫描，用例立刻红。
  - `tests/stubs.mjs` 新增 `CSS.escape`（CSSOM 原样实现）：Node 没有 `CSS` 全局；用恒等桩会让每个转义选择器都命中，测试会为错误的原因变绿。
  - `tests/dom.mjs` 的 `matches()` 还原引号内的 CSS 转义，并对值里带未转义引号的属性选择器抛 `SyntaxError`——两者都是浏览器行为。
  - `eslint.config.mjs` 全局声明同步（`title_fix` → `escapeHtmlText`）；e2e 的 `page.evaluate()` 体内需要 `chrome` 全局。
- [x] **`user-controlled values are escaped …` 解除 skip**：守卫此前无法区分 HTML 属性 `title="` 与 CSS 属性选择器 `[title="`，加 `(?<!\[)` 后解除。
  - 解除后随即发现它**已经失明**：判定靠 `\.url\b` / `fbl\[` 这类变量名模式识别用户数据，而插值点刚被改名成 `*Attr`，于是连裸的 `rha[thisc.counter].url` 都不再命中——它变绿是因为看不见，不是因为代码对。改为白名单判定：内联 `escapeHtmlAttr(…)`，或由它赋值的局部变量（复用文本守卫的 `escapedLocals()`），二者必居其一。
  - 顺带把 `bookmark.js` 纳入检查范围（8 处属性插值，此前无人看守）。**变异验证**：把 `href` 改回裸 URL，`history-core.js` 与 `bookmark.js` 各自报红并指出具体属性。

### 第 3 批（已完成）：配置子系统回归 + SW 消息通道收紧

- [x] **`saveOptions()` 动态拼接 `rh-list-order`**：`rhlo[0].id + … + rhlo[4].id` 改为 `Array.from(rhlo, li => li.id).join(',')`。解除对应 skip，先红后绿验证过（只喂 2 个 li，硬编码版立刻 `TypeError`）。
- [x] **`popup.js` 的顺序解析加空值保护**：`localStorage['rh-list-order']` 在首次保存前是 `undefined`，`.split()` 直接崩；且「Popup structure」与「Popup init」两段重复计算。改为算一次 + `filter(Boolean)`（空串否则拆出 `['']`，被当成未知区块白走一遍）。
- [x] **删掉 `options.html` 里那个空的 `.tab-content`**：带 `data-lang-string="treeOptionsDetail"` 却没有 `.lang`，而 `func.js` 只处理 `.lang`，所以永不渲染；两个语言文件里也都没有这个键。解除对应 skip。**变异验证**：临时插一个无 `.lang` 的 `data-lang-string` 元素，测试立刻报红。
- [x] **SW 的 `callFunction` 收紧**（P0 安全）：拆出 `handleCallFunction()` 与 `CALLABLE_FUNCTIONS` 白名单表，`sender.id !== chrome.runtime.id` 一律拒绝。
  - 新增 2 条静态守卫：①不得再出现 `self[message.function]` 形式的派发；②必须校验 `sender.id`。均经变异验证（改回 `self[...]`、删掉校验，各红一次）。
  - 守卫读的是**剥掉注释后**的源码：本文件在注释里把旧写法原样记了下来，不剥注释会被自己误伤。
  - 顺带把回复改成异步（`return true` 保持端口）：`deleteDb` 返回 Promise，直接塞进 `sendResponse` 会撞结构化克隆。
- [x] **`sw-sync.test.mjs` 的钉子从 `getVersionType` 换成 `getVersion`**：前者随 MV2 死代码一起从 SW 消失了。
- 注：原计划里的「`showOptions` 的 `typeof` 包装」已不复存在——该函数早已更名为 `loadOptions()`，现版本中也没有 `typeof` 包装问题，此项作废。

### 第 3.5 批（已完成）：P2 小修 + 解开第二组循环依赖

顺手做掉的一批——都由上一批的审查直接暴露、改动小、不值得单独排队。

- [x] `_tSW_load` 移到文件顶部 `var` 声明（TDZ 隐患）
- [x] `history2.js` 的 `let t` 改名为 `transitionIcon`，不再遮蔽 `feach_History()` 的翻页计数器
- [x] 删掉 `chrome.pageAction.show()` 这条 MV2 死分支
- [x] `updateClosedTabsStatus()` 改为单个 `cursorRequest` 同时挂 `onsuccess` / `onerror`
- [x] `func.js` 的 250ms 全表轮询 → `document` 上一次事件委托（含 e2e 注释与 CODEBUDDY.md 的同步更新）
- [x] **解开 `calendar.js` ↔ `history-core.js`**：`history-core.js` 直接 import `shared/calendar-storage.js`，不再经 `calendar.js` 绕路。新增 `the ES module graph is acyclic` 断言（解析 `from '…'` 建图 + DFS 找环，报出完整路径）；**变异验证**：把 import 改回 `./calendar.js`，测试立刻红。
### 第 1.8 批（已完成）：`background-utils.js` 改为生成 + 修跨午夜日期滚动

- [x] **消除 `background-utils.js` 的手工同步**（对应 P3 同名条目）
  - 无依赖的底层函数抽到 `chrome/scripts/modules/shared/`（`config-defaults.js`/`format.js`/`url.js`/`favicon.js`/`calendar-storage.js`），由 `scripts/gen-sw-utils.mjs` 按拓扑序去掉 import/export 标记拼接成 `background-utils.js`。
  - `scripts/check-sw-sync.mjs` 删除；`verify:sw-sync` 改为 `gen-sw-utils.mjs --check`，生成与校验共用同一份逻辑。
  - 生成器在生成前校验模块图：`shared/` 有文件未登记进 `FILES`、或 import 指向未拼接/更晚拼接的文件，均显式报错——后者会退化成隐式全局，语法自检看不见，只在 SW 运行时炸。
  - 生成器派发 `/* exported ... */` 指令（名单由各模块真实导出推导，不会漂移）：SW 经 `importScripts()` 取用这些符号是静态分析看不见的，否则 `no-unused-vars` 会误报全部未被本文件调用的函数。
- [x] **修 `TimeToStr()` 跨午夜滚动把 `_DATE` 变成字符串**（`modules/helpers.js`）
  - 原状：`_DATE = _DATE + DAY`，`Date` 被强制转为字符串，次日首次调用后 `_DATE.getTime()` 抛 `TypeError`。
  - 做法：抽成 `advanceDateToToday()`，改用 `new Date(_DATE.getTime() + DAY)` 并补上循环；`window._DATE` 也由一次性快照变成随滚动更新的 live binding。
  - 测试：`tests/shared.test.mjs`。该层无导入期副作用，可静态 `import`（`calendar-storage.js` 除外，它导入期会调 `onStorageReady()`）。
- [x] **`tests/sw-sync.test.mjs` 的检查集合改为从 `shared/` 源码自动提取**
  - 手写版漏了 `background-sw.js:515` 调用的 `getVersionType`。自动提取后零误报，且新增导出会自动纳入。
- [x] 顺带解开 `helpers.js` ↔ `config.js` 循环依赖（P3 同名条目已更新为「已解开 1 组」）。

### 第 3 批（已完成）：两个 skip 的收尾 + 四项小缺陷

- [x] **`rh-list-order` 不再硬编码 5 个区块**（`modules/config.js`）
  - `Array.from(rhlo, (li) => li.id).join(',')`。解除 `modules.test.mjs` 的 skip，变异验证：改回 `rhlo[0..2]` 立刻红。
- [x] **删除 `options.html` 里永不渲染的 `treeOptionsDetail`**（含其空 div）
  - 解除 `static.test.mjs` 的 skip，变异验证：插入一个只有 `data-lang-string` 的元素立刻红。该文件注释里写了被禁的写法，所以守卫先 `stripJsComments()` 再匹配——否则会匹配到散文。
- [x] **`popup.js` 顺序列表只解析一次并防空值**，顺带消掉一处 `var` 重复声明（142 → 141 warning）。
- [x] **SW 的 `callFunction` 收紧**（P0 安全）：`handleCallFunction()` 先校验 `sender.id === chrome.runtime.id`，再从显式表 `CALLABLE_FUNCTIONS` 取函数。
  - 白名单当前只有 `deleteDb`——这是 `messageAdapter` 唯一会传的名字，其余全局函数不再可按名调用。
  - 两条静态守卫均经变异验证（改回 `self[message.function]` / 删掉 sender 校验，各自报红）。
  - 注意：回复从 promise 回调发出，所以 `case 'callFunction'` 必须 `return true`，否则端口先关、`sendResponse` 失效。
- [x] **`_tSW_load` 提到文件顶部声明**（消 TDZ）、**`history2.js` 的 `t` 改名 `transitionIcon`**（消遮蔽）、**删掉恒假的 `pageAction` 分支**（MV2 死代码）、**`updateClosedTabsStatus()` 只开一个游标**。
- [x] **`func.js` 的 250ms 轮询换成事件委托**，连带更新 `e2e/pages.spec.mjs` 与 `CODEBUDDY.md` 里已经失效的「不能用 `networkidle`」理由。

### 新发现（由测试暴露）

- [x] **选项页缺少 `#mvlist` / `#mvlist-table`，「最常访问黑名单」整条链路失效** — **已修复**（见「第 1.6 批」）
  - ~~现状：`options.html` 只有 CSS（`options.css:325,335`）引用这两个 id，HTML 里没有对应元素。~~
  - ~~后果一（崩溃）：`mostVisitedBlocklist()` 执行 `$('mvlist-table').appendChild(tr)`，一旦 `mv-blocklist` 非空即 `TypeError` → 从 popup 屏蔽过任意站点后选项页打不开。~~
  - ~~后果二（数据丢失）：`saveOptions()` 读 `$$('#mvlist tr td:first-child')` 恒为空 → `mlil = 'false'` → 每次保存静默清空黑名单。~~

- [ ] **`filtUrl()` 用子串匹配，过滤域名会误伤** — **已修复**（见「第 1.5 批」）
  - ~~现状：`flist.indexOf(site) >= 0`（`config.js:686,693`）不做标签边界判断，且 `flist_r` 正则含空分支（`flist` 以 `|` 结尾）可匹配任意串。~~
  - **残余已消除**：见「第 1 批」——`flist_r` 现由归一化后的集合逐条 `escapeRegExp` 拼成，「空分支」与「元字符崩溃」均已解决，上方 P0 对应条目已标记完成。

- [ ] **`timeNow()` / `TimeToStr()` 的 `te` 未初始化** — **已修复**（见「第 1.5 批」）
  - ~~现状：`helpers.js:23` 与 `:74` 声明 `var te;` 但只在 `tf == '12'` / `tf == '24'` 分支赋值。~~
  - 修法要点（供回看）：以 `background-utils.js` 的 `var te = ''` 为准统一，并删掉 `helpers.js` 里冗余的 `else if (tf == '24')` 分支，使 `check-sw-sync.mjs` 的 `ACCEPTED_DRIFT` 清空。（该脚本后来随「第 1.8 批」的改造一起删除。）
  - 触发条件：`defaultConfig()` 保证 `rh-timeformat` 有值，所以正常情况下碰不到；但在 storage 尚未就绪（`storage-adapter.js` 冷启动）的窗口内读取就会露出来。

- [x] **给 `rh-list-order` 的 `split(',')` 加空值保护**（`chrome/scripts/popup.js`）— **已修复**（见「第 3 批」）
  - ~~现状：无空值保护，且同一表达式重复计算两次。~~
  - 已做：只在「Popup structure」处解析一次（`(localStorage['rh-list-order'] || '').split(',').filter(Boolean)`），初始化循环复用同一变量——顺带消掉一处 `var rhporder` 重复声明。

---

## P2 — 可靠性与 MV3 适配

- [ ] **修复 Service Worker 重启导致跳转关系链断裂**（`chrome/scripts/background-sw.js:17-38`）
  - 现状：`openerJson`/`tabUrlJson`/`tabUrl0Json`/`urlIdJson`/`idUrlJson`/`openedTabs`/`recentTabs` 均为内存变量，SW 空闲约 30 秒被回收后丢失，`add_tab_history()` 依赖的 `openerJson` 失效 → **点击链接产生的父子关系记不下来**，而这是本扩展的核心数据结构。
  - 做法：周期性落盘到 `chrome.storage.session`（MV3 会话级存储，重启浏览器才清空），启动时恢复。

- [ ] **启动期抓取改为并发分片 + 断点续传**（`chrome/scripts/background-sw.js:686-755`）
  - 现状：`processVisits()` 对 `urls_wait_load` 逐个串行 `await chrome.history.getVisits`（默认 7 天、上限 300 天，可达数万条），无进度持久化；SW 中途被杀则前功尽弃；每条都调一次 `chrome.action.setBadgeText` 未节流。
  - 做法：`Promise.allSettled` 分片并发、游标写入 storage、徽章节流更新。

- [x] **修复 `updateClosedTabsStatus()` 重复打开游标**（`chrome/scripts/db-manager.js`）— **已修复**（见「第 3 批」）
  - ~~现状：对同一 index 调两次 `openCursor`，第二次只为挂 `onerror`。~~
  - 已做：保留一个 `cursorRequest`，`onsuccess`/`onerror` 挂在同一请求上。

- [x] **移除 `func.js` 的 250ms 永久轮询**（`chrome/scripts/func.js`）— **已修复**（见「第 3 批」）
  - ~~现状：每个扩展页面开一个永不清除的 `setInterval`，全表扫描 `a[href="#"]` 并逐个绑监听。~~
  - 已做：改为 `document` 上一次 click 事件委托。
  - 连带：e2e 与 CODEBUDDY.md 里「页面永远不安静所以不能用 `networkidle`」的理由失效，已改为「第三方 favicon 请求让网络空闲点既晚又不稳定」——`goto` + `settle` 的写法不变。

- [x] **修复 `_tSW_load` 的 TDZ 隐患**（`chrome/scripts/background-sw.js`）— **已修复**（见「第 3 批」）
  - 已做：并入顶部 `var _tSW_init, _tSW_db, _tSW_load;`，文件末尾改为赋值。

- [x] **修复 `history2.js` 变量遮蔽**（`chrome/scripts/history2.js`）— **已修复**（见「第 3 批」）
  - 已做：局部变量改名 `transitionIcon`（含 `tag[transitionIcon]` 与节点名拼接），形参 `t` 不再被遮蔽。

- [x] **清理 MV2 死代码**（`chrome/scripts/background-sw.js`）— **已修复**（见「第 3 批」）
  - 已做：`getVersionType() == 'pageAction'` 分支与 `chrome.pageAction.show()` 删除（函数恒返回 `'browserAction'`）。`getVersionType` 本身保留——`func.js` 与 `popup-core.js` 仍在用。
  - 连带：`tests/sw-sync.test.mjs` 里「background-sw.js 调用了 `getVersionType`」这条回归断言换成 `defaultConfig`（原断言指向的调用点已随本条删除）。

- [ ] **统一 `addCloseRedord` 的命名与 id 语义**（`chrome/scripts/background-sw.js:380-393`）
  - 现状：函数名拼写错误；`id: oid + '_' + tid` 与 `oid: oid - 1` 语义不一致。

- [ ] **处理 zTree 内含 `eval` 的 CSP 风险**（`chrome/scripts/jquery.ztree.core.js:1105`）
  - 现状：`newNodes = eval("(" + msg + ")")`，MV3 默认 CSP 禁用 `eval`。当前走本地 `zNodes` 未触发，属潜在风险。

---

## P3 — 架构与可维护性

- [ ] **清理 lint 警告存量**：共 140 处 — 88 处 `no-redeclare`（同作用域 `var` 重复声明，其中 16 处是 `background-utils.js` 与 `eslint.config.mjs` 的 `crossFileGlobals` 同名，属生成文件的固有重复）、54 处 `no-unused-vars`（多为 `catch (e)` 未使用绑定）、1 处 `no-empty`、2 处 `require-atomic-updates`。
  - 现状：这些设为 warning，不阻塞 CI。`no-redeclare` 之所以不设为 error，是因为它合法无害，90 条会淹没真实错误。
  - 收尾动作：清零后把 `npm run lint` 改为 `eslint . --max-warnings 0`，彻底锁死。

- [x] **消除 `background-utils.js` 的手工同步** — **已根治**（见「第 1.8 批」）
  - ~~现状：`background-utils.js` 用注释列出与 `modules/` 的 SYNC 映射（`getVersion`/`timeNow`/`getFaviconUrl`/`defaultConfig`/`save_calendar_storage2` 等），因 MV3 的 SW 无法 `importScripts` ES module 而必须重复。~~
  - ~~中间态护栏：`npm run verify:sw-sync`（`scripts/check-sw-sync.mjs`）逐函数比对两侧函数体与 38 键 `defaultValues`。~~ 该脚本已删除，重复的那份不再是手写的，无需再比对。
  - 现状：无依赖的底层函数抽到 `chrome/scripts/modules/shared/`，由 `scripts/gen-sw-utils.mjs` 机械拼接成 `background-utils.js`。改函数只改 `shared/` 下那一份，`npm run gen` 重新生成并提交；`npm run verify:sw-sync` 改为 `gen-sw-utils.mjs --check`，生成与校验共用同一份逻辑。

- [ ] **解开循环依赖（原有两组，已全部解开）**
  - [x] `helpers.js` ↔ `config.js` — **已解开**：`defaultValues`/`defaultConfig` 下沉到 `modules/shared/config-defaults.js`，`helpers.js` 不再 import `config.js`，依赖方向变为单向。
  - [x] `calendar.js` ↔ `history-core.js` — **已解开**（见「第 3.5 批」）：`history-core.js` 改为直接 `import { save_calendar_storage2 } from './shared/calendar-storage.js'`，不再经 `calendar.js` 绕一圈。剩下 `calendar.js → history-core.js` 单向，环消失。
    - 未采用原计划的 `state.js`：共享状态本体（`calendar_storage2`）早已在 `modules/shared/` 里，真正的环只是一条绕道的 import，抽新模块反而多一层。
    - 新增 `the ES module graph is acyclic` 静态断言锁住：解析 `from '…'` 建图 + DFS 找环，环存在即报出完整路径。

- [ ] **完成模块化，删除 `func.js` 的 window 兼容层**
  - 现状：`func.js` 把几十个函数逐个挂 `window`，`popup.js`/`history.js`/`closed.js`/`bookmark.js` 仍通过全局变量调用——物理拆了文件、逻辑仍是全局脚本。
  - 做法：页面脚本改为 `import`，删掉 `window.*` 挂载，使依赖可被静态分析。

- [ ] **统一前端技术栈**
  - 现状：`history2.html`/`closed.html` 用 jQuery+zTree（约 2.6k 行第三方代码，`jQuery.noConflict()` 后 `$` 让给 `dom-helper`），其余页面已原生化，两套并存且无共识。
  - 做法：制定迁移路径（原生递归渲染或轻量虚拟树替换 zTree），消除双栈与 `eval` 风险。

- [ ] **重新审视全局劫持 `localStorage`**（`chrome/scripts/storage-adapter.js:290`）
  - 现状：`Object.defineProperty` 把 `localStorage` 换成 Proxy，对所有第三方脚本生效，且 `storageAdapter.ready()` 之前读取全是 `undefined`（P0 中 `updateFilter` 的 bug 正是这个语义陷阱的产物）。至少应让未就绪时读取打出告警。

- [x] **补充最小测试 + CI**（第二轮已覆盖前两类；第三类仍未做）
  - 已覆盖：`filtUrl` 匹配、配置读写往返（`saveOptions`/`loadOptions`/`downloadOptions`/`addList`）、favicon 子系统、小书签执行、时间格式化、模块图与 `func.js` 挂载一致性、manifest 权限覆盖、SW 副本同步、**`dbManager` 的连接生命周期**（`tests/db-manager.test.mjs`，见「第 5 批」）。
  - 仍未覆盖：`feach_History` 的树构建与翻页边界、`history()`/`popup-core.js` 的渲染层、Service Worker 采集链路。
  - **阻塞原因**：这几处都深度依赖真实 DOM（zTree / `querySelector('div[rel="' + host + '"]')` / `setInterval` 分片渲染），`tests/dom.mjs` 的替身**故意不做 HTML 树解析**，硬撑会写出一堆似是而非的断言。
  - 建议：要么引入 jsdom/happy-dom 并接受一个开发依赖，要么按 TODO.md 第 2 批先把渲染层重构成可测的纯函数。
  - 更新：**阻塞已降级**。见下方「端到端冒烟测试」——现在有真实 Chromium 可用，上面这几处可以直接写真实交互断言（访问页面产生历史 → 打开 `history2.html` → 断言树节点），不再需要 jsdom，也不必为可测性重构渲染层。

- [x] **端到端冒烟测试（真实浏览器，已进两套 CI）**
  - `e2e/pages.spec.mjs` + `npm run test:e2e`：Playwright 自带 Chromium 侧载 `chrome/`，逐个打开 popup / history / history2 / closed / bookmark / options **六个页面**，断言无未捕获异常、无扩展自身发出的 `console.error`。8 个用例约 12 秒。
  - 按官方扩展测试指南实现（`e2e/pages.spec.mjs` 文件头注释有完整要点）：扩展只能装在 **persistent context**，且必须用 `channel: 'chromium'`（Chrome/Edge 已移除侧载 flag，headless shell 不支持扩展）；MV3 的扩展 id 从 service worker URL 取。
  - CI 接入：两套流水线在 `verify` 之后都追加 `npm run browser:install` → `npm run test:e2e:ci`。`node:22` 与 `ubuntu-latest` 均无可用浏览器，安装步骤不可省。e2e 报告写入 **`junit-e2e.xml`**，与单元测试的 `junit.xml` 分开上传（`path: junit*.xml`），避免互相覆盖。
  - 断言经过**变异验证**：临时往 `popup.js` 注入 `throw` + `console.error`，确认只有 `popup.html` 变红且两条错误都被列出，其余 7 条不受影响——证明不是"永远绿"的假测试。
  - 刻意**不进 `npm run check`**（本地门禁要保持秒级），`playwright` 缺失时整套自动 skip。

---

### 第 5 批（已完成）：四项 P1 修复

- [x] **`dbManager.deleteDB()` / `close()` 未作废缓存的连接**（`chrome/scripts/db-manager.js`）
  - 原状：两者都清了 `db` 与 `isReady`，却留下 `_readyPromise`。`init()` 开头 `if (this._readyPromise) return this._readyPromise;` 于是把**已 close 的连接**再发一遍，之后 `transaction()` 抛 `InvalidStateError`。选项页「清除数据」点一次，当前 SW 生命周期内采集链路就永久失效。
  - 已做：两个方法都补 `this._readyPromise = null;`。
  - 测试：`tests/db-manager.test.mjs`（新增）。`db-manager.js` 是 classic script，只能用 `node:vm` + 最小 fake IndexedDB 加载；fake db 在 `close()` 后让 `transaction()` 抛 `InvalidStateError`，这才让「缓存 promise」的后果可观测——否则 `getDB()` 返回什么都一样绿。3 条：正常复用同一连接（防回归）、`deleteDB()` 后重开、`close()` 后重开。
- [x] **`date = date + DAY` 把 Date 变成字符串**（`background-sw.js:797`、`history2.js:201`、`closed.js:220`）
  - 原状：`+` 对 Date 走 ToPrimitive(default)，优先字符串 → `date` 变成 `"Wed Sep 10 2026 …86400000"`。此后 `date.getTime()` 抛（SW 侧 `loadDate()` 的异常被 `.catch` 吞掉，抓取静默失败），`time >= date` 退化成字符串字典序比较。是「第 1.8 批」修掉的 `_DATE + DAY` 的同型漏网之鱼。
  - 已做：三处统一改为 `new Date(date.getTime() + DAY)`。
  - 静态守卫：`no Date object is advanced by adding a day count`（匹配 `X = X + DAY`，**无白名单**）+ 一条变异自测钉住正则本身：既不放过坏写法，也不误伤 `new Date(x.getTime() + DAY)` 与 `loadDate()` 里那个**数字**版本的 `date + DAY`（那里是普通算术，不是 bug）。
- [x] **`minimum_chrome_version` 与代码实际要求对齐**（`chrome/manifest.json`）
  - 原状：声明 `88`，但 `background-sw.js` 用了 `Object.hasOwn`（93+）、`helpers.js` 用了 `executeScript({ world: 'MAIN' })`（95+）。88–92 能装但一跑就崩；95 以下 `world` 被静默丢弃，小书签在 isolated world 里失效。
  - 已做：提升到 `"96"`。
  - **坑（e2e 暴露，静态检查全绿）**：该字段必须写成**字符串**。写成数字 `96` 时 Chrome 直接拒绝整个 manifest —— 扩展静默加载失败、SW 从不注册，而 lint、`node --check`、JSON 校验、`gen-sw-utils --check` 全部照常通过。新增守卫 `minimum_chrome_version is a string, as Chrome parses it` 钉住，注释里写明症状是「只有 e2e 会红，且看起来像 SW 没启动」。
  - 守卫 `minimum_chrome_version covers the newest API the code uses`：维护一张「API → 首次支持版本」表，声明值低于代码所需即报红并列出证据。已变异验证（改回 88 → 红，列出 `Object.hasOwn` 与 `world:'MAIN'` 两处）。表只收**能靠源码形状可靠识别**的 API，避免过度匹配变成噪音。
  - 待办：发布下个版本时需在 README 的 Changelog 记录「最低 Chrome 版本提升到 96」。
- [x] **渲染层 `closest()` 未防空 + 按范围删除的输入未校验**（`chrome/scripts/modules/history-core.js`）
  - `closest()`：`el.closest('div.item-holder').style.*` 共 6 处未判空。`deleteHistoryItem('selected')` 会摘掉 `div.item-holder`，之后任何遍历 `.chkbx` 的重绘都会撞上 `null.style`，一抛就中断整次重绘、列表停在半更新状态。
    - 已做：新增模块私有 `paintClosest(el, selector, color)`，6 处改走它。刻意**不**统一各分支配色（`#f1f1f1` 与 `#fafafa` 本就不一致），只做防空，零行为变化。
  - `deleteHistoryItem('range')`：`localStorage['rh-date']` 在 storage 就绪前是 `undefined`，`.split('/')` 直接抛；两个输入框为空时同理。已做：缺任一输入即警告返回。
    - 顺带堵住一条**数据丢失**路径：字段按位置映射，若 `rh-date` 是 `yyyy/mm/dd` 而输入框写成 `mm/dd/yyyy`，日被塞进年槽 → `new Date(9, …)` → 1909 → `startRange < endRange` 成立 → **删掉全部历史**。现改为解析后校验 `Number.isFinite` 且非负（早于 1970 一律拒绝）；字段缺失走 NaN 分支，一并覆盖。
  - 测试：`tests/modules.test.mjs` 新增 6 条 —— 3 条 `closest`（单条、全选、`getMoreItems`）+ 3 条 range（正常路径仍删对且范围精确、未就绪不删也不抛、字段错位不删）。

### 第 5 批评审收尾（已完成）

提交前评审发现的遗留项，均已在同批内处理：

- [x] **`bookmark.js` 还有 3 处同类 `closest()` 未判空**（`:678`、`:711`、`:759`）
  - 第 5 批只清了 `history-core.js` 的 6 处，漏了这三个——它们形状相同（`var x = …closest(…)` 后直接 `x.getAttribute(...)`）。`:759` 尤其真实：`holder.remove()` 在 `chrome.bookmarks.remove()` 的**异步回调**里执行，二次 sweep 必然可能撞上已摘除的行。
  - 已做：三处加 `if (!x) return;`（都在 IIFE 内，可直接返回），与文件内既有写法一致。
  - **测试策略**：`bookmark.js` 的所有函数都在 `document.addEventListener('DOMContentLoaded', …)` 闭包里（`:1`），没有可调用的句柄，无法单测。改用静态守卫 `every closest() result is null-checked before it is dereferenced`：检查 `var x = …closest(…)` 之后两行内若解引用了 `x`，则必须出现 `if (x)` / `if (!x)` / `x &&` / `x ?` 之一——正好是代码库已在用的四种形状。无白名单。
  - 两个实现细节：①检测跑在 `stripJsComments()` 之后（避免散文被当代码），但**报错用原始行号**——剥注释会偏移几十行，错行号比没行号更糟；②同一段声明文本在文件里出现两次，所以按**出现次序**映射行号，否则两处都报成第一行。
- [x] **守卫措辞自相矛盾**：`minimum_chrome_version must be a number` 与相邻那条「必须是字符串」冲突。改为 `must parse as a number`（语义是 `Number()` 之后可解析）。
- [x] **测试重复调用被测函数**：`deleteHistoryItem("range") does nothing before storage has loaded` 里调了两次。合并为一次调用 + 两个断言。
- [x] **测试 fixture 污染共享状态**：`seedOrphanCheckbox()` 写 `rh-group`、`seedRangeInputs()` 写 `rh-date`，都不还原，而这个文件的 `localStorage` / `dom` 是全测试共享的。新增 `restoreStorage(t, keys)`，用 `t.after()` 还原；已用探针确认 6 次清理全部执行（3×`rh-group` + 3×`rh-date`）。
- [x] **`DATE_ADVANCE` 守卫的边界写进注释**：只覆盖 `x = x + DAY`，**不**覆盖 `x += DAY`——后者在数字上是普通算术且常见，纳入即噪音。写清楚，避免后人误以为守卫是全覆盖。

## 建议执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| ✅ 第 0 批 | 自动化护栏 + 修 4 处未声明变量/死代码 + 补 i18n | **已完成**。此后每批改动都有 `npm run check` 兜底 |
| ✅ 第 1 批 | 修 `updateFilter` 竞态与正则元字符崩溃 | **已完成**（92 测试 · 7 skip）。数据丢失 + 白屏级崩溃两项均已消除 |
| ✅ 第 2 批 | 修 XSS 与选择器注入 | **已完成**。URL / 域名 / 标题三类插值点全部按上下文转义 |
| ✅ 第 2.1 批 | 修 `filterlist` 写入侧三处错误 + 残留分片清理 + 成功判定 | **已完成**。原「第 3 批」主体已并入 |
| ✅ 第 2.2 批 | 删 `title_fix`、转义按上下文分工、`CSS.escape` 运行时测试、`downloadOptions` 下划线、`mergeList` 计数读取 | **已完成**。第 2 批的审查收尾 |
| ✅ 第 3 批 | `rh-list-order` 硬编码、失效的 `treeOptionsDetail`、`popup.js` 空值保护、SW `callFunction` 收紧，外加 5 项小缺陷（TDZ / 变量遮蔽 / MV2 死代码 / 重复游标 / 250ms 轮询） | **已完成**。2 个 skip 全部消除，当前 0 skip |
| 第 4 批 | SW 状态持久化（`chrome.storage.session`）、启动抓取并发分片与断点续传 | 涉及 MV3 架构调整，需先讨论方案。**树状结构的可靠性取决于此** |
| ✅ 第 5 批 | `dbManager` 缓存连接未作废、`date = date + DAY` 三处、`minimum_chrome_version` 对齐、`closest()` 与按范围删除的输入校验 | **已完成**。13 条新测试 + 3 条静态守卫，均先红后绿。插队在第 4 批之前：都是小改动且已有测试兜底 |
| 第 6 批 | `addCloseRedord` 命名与 id 语义、zTree `eval` 风险；清理 lint 警告存量 → `--max-warnings 0`；模块化收尾、技术栈统一 | 长期收益，可渐进推进 |

> **插队说明**：第 1.5 / 1.6 / 1.7 批是顺手做掉的——它们都由新写的测试或 review 直接暴露，且改动小、有 skip 测试兜底，不值得单独排队。
> 1.5 = `filtUrl` 子串误伤 + `te` 未初始化 + `addList` 空格；1.6 = 选项页 `#mvlist` 缺失（**会导致选项页打不开**）+ 其附带的属性注入；1.7 = `filtUrl` 降段死分支 + `www` 子域过滤。

## 已消除的白屏 / 数据丢失路径

以下三类此前均可由用户配置直接触发，现已全部有测试覆盖：

| 触发条件 | 原后果 | 现状 |
|---|---|---|
| 过滤列表非空 | `new RegExp()` 抛 SyntaxError → 页面白屏 | 逐条转义，坏条目不影响兄弟项 |
| 过滤列表含 `a(` 等元字符 | 同上 | 同上 |
| 页面加载瞬间 | `updateFilter()` 写入 `'false'` 覆盖用户列表 | 读取者不写入，改由 ready 钩子刷新 |

执行约定：
1. 每批开始先跑 `npm run check` 确认起点是绿的。
2. 修 bug 时**先为期望行为解除对应 skip 测试**，再改代码——测试红 → 改代码 → 测试绿。
3. 每批结束再跑 `npm run check`，并**手动加载一次扩展**验证（自动化只能覆盖静态与纯逻辑，覆盖不了真实渲染）。

---

## 备注

- 版本号只在 `chrome/manifest.json` 的 `version` 字段维护，发布前需同步更新 `README.md` 的 Changelog 段落。
- 分支：`main` 为当前 MV3 主线；`master` 是已废弃的 MV2 代码；`mv3-3` 已合并。
- `README.md` 的 Changelog 记录了 MV3 带来的已知体验劣化（部分页面 favicon 无法显示、popup 中小书签可能不触发），排查「看起来像 bug」的现象前先读一遍。
