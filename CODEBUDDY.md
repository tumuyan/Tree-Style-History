# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## 项目概述

Tree Style History —— 一个 Chrome/Edge 浏览器扩展（**Manifest V3**），把浏览历史按「点击链接跳转」的父子关系渲染成树。
扩展本体在 `chrome/` 目录下，**没有构建系统、没有运行时依赖**：源码即发布产物，直接用浏览器加载 `chrome/` 即可运行。
仓库根目录另有开发期工具链（lint + 测试 + 两套 CI），它们不进入 `chrome/`，不影响打包与加载。


## 常用命令

### 自动化校验（改动前后都应跑）

```bash
npm install     # 首次：只装 eslint + globals，两个开发依赖
npm run check   # 本地门禁：lint + test + verify，约 3 秒
```

### 命令分层

命令按**用途**而非检查项拆分；本地与 CI 执行同一套逻辑（`scripts/` 下的 Node 脚本），区别只在输出格式。

| 命令 | 用途 | 说明 |
|---|---|---|
| `npm run lint` | 通用 | ESLint，**0 error 才通过**（warning 是历史欠账，不阻塞） |
| `npm run lint:fix` | 本地 | 自动修复 |
| `npm test` | 本地 | 全部测试，spec 报告输出到终端 |
| `npm run test:static` | 本地 | 只跑静态检查（manifest / MV3 / i18n） |
| `npm run test:modules` | 本地 | 只跑模块行为测试 |
| `npm run test:only -- <file>` | 本地 | 跑单个文件，如 `npm run test:only -- tests/static.test.mjs` |
| `npm run test:watch` | 本地 | 监听变化自动重跑 |
| `npm run test:ci` | **CI** | spec 到 stdout **并**生成 `junit.xml` |
| `npm run test:e2e` | 本地 | 真实 Chromium 侧载扩展，逐个打开 6 个页面断言无 JS 错误 |
| `npm run test:e2e:ci` | **CI** | 同上，并额外生成 `junit-e2e.xml`（**不**覆盖 `junit.xml`） |
| `npm run browser:install` | **CI** | 下载 Chromium 与 apt 系统库，e2e 的前置步骤 |
| `npm run gen` | 通用 | 重新生成**全部**生成物（改完 `modules/shared/` 必跑） |
| `npm run gen:sw-utils` | 通用 | 只生成 `background-utils.js` |
| `npm run verify:json` | 通用 | 校验 manifest 与两个语言文件是合法 JSON |
| `npm run verify:syntax` | 通用 | `node --check` 全部首方脚本（含 `modules/shared/`） |
| `npm run verify:ci-parity` | 通用 | 两套 CI 的路径过滤是否等价 |
| `npm run verify:sw-sync` | 通用 | `background-utils.js` 是否与 `modules/shared/` 同步 |
| `npm run verify` | 通用 | 上面四项之和 |
| `npm run check` | 本地 | lint + test + verify |
| `npm run check:ci` | **CI** | lint + test:ci + verify |

`test:ci` 与 `test` 的**唯一区别是输出**：CI 要机器可读的 `junit.xml`，本地要可读的终端输出。**不存在"只有 CI 才跑的检查"**。

`npm run test:e2e`（`e2e/pages.spec.mjs`）是唯一**需要真实浏览器**的套件，刻意不放进 `tests/`、也不进 `npm run check`（本地门禁要保持秒级）。它已接入**两套 CI**，各自在 `verify` 之后追加两个步骤：`npm run browser:install` → `npm run test:e2e:ci`——两边同样只调 npm script，不内联命令。

`node:22` / `ubuntu-latest` 镜像都没有可用的浏览器，所以安装步骤必须在 CI 内完成，不能省。本地首次运行执行 `npm run browser:install` 即可（约 200MB，装一次）。`playwright` 包缺失时整套 e2e 自动 skip，而不是让命令失败。

### 两套 CI

- **CNB**：`.cnb.yml` 
- **GitHub Actions**：`.github/workflows/ci.yml`
**路径过滤**：`push` 会跳过纯文档/图片变更, cnb和github两边的排除列表必须同步。

- CNB 用 `ifModify` 的 `!(...)` 取反语法：必须先写 `"**"` 打底，且根级文件不匹配 `**/*.md`，需额外写 `!*.md`。
- GitHub 用原生 `paths-ignore`（此处把目录级与根级都写上，避免各平台 glob 语义差异）。

两者都只调用 npm 脚本。**不要**在 CI 配置里内联 `node -e` 块：新增检查应写成 `scripts/` 下的脚本并挂到 npm script，否则两套 CI 会逐渐逻辑漂移。

### 注意事项

- Node 要求 **>= 22**（`--test` 的 glob 与多 reporter 支持），已用 `engines` 声明，两个 CI 都固定 22。
- `npm ci` 依赖已提交的 `package-lock.json`。
- **不要写 `node --test tests/`**：Node 22 会把目录当作单个文件执行并报 `MODULE_NOT_FOUND`。用 `node --test "tests/**/*.test.mjs"`。

### 测试覆盖范围与编写约定

- 测试用 Node 内置 `node:test`，**没有测试框架依赖**。`tests/stubs.mjs` 提供 `localStorage` / `chrome` / `document` 桩，并刻意复刻了 `storage-adapter.js` 的字符串化语义（所有值写进去都会变成字符串）。
- `npm test` 覆盖四类：静态检查（`tests/static.test.mjs`：manifest 合法性、MV3 约束、HTML 资源引用、i18n 覆盖）、模块行为（`tests/modules.test.mjs`）、模块图完整性（各模块公开导出仍存在）、生成物一致性（`tests/sw-sync.test.mjs`）。
- `tests/shared.test.mjs` 单测 `modules/shared/` 这一层。它可以**静态 `import`**（不像 `modules.test.mjs` 必须 `await import`），因为这些模块没有导入期副作用；唯一例外是 `calendar-storage.js`（它在导入期无条件调 `onStorageReady()`），所以没有在这里测。
- `npm run test:e2e` 是**唯一能验证"页面真的能打开"**的一层：用 Playwright 自带的 Chromium 侧载 `chrome/`，逐个打开 popup / history / history2 / closed / bookmark / options 六个页面，断言无未捕获异常、无扩展自身发出的 `console.error`。官方做法与踩坑记录都写在 `e2e/pages.spec.mjs` 文件头注释里，要点：
  - 扩展**只能在 persistent context 中加载**，且必须用 `channel: 'chromium'`——Chrome/Edge 已移除侧载用的命令行 flag，headless shell 也不支持扩展，所以 Playwright 自带的 Chromium 是唯一选择。
  - MV3 的扩展 id 从 service worker 的 URL 里取（没有 background page 可读了）。
  - **不能用 `networkidle` 判断渲染完成**：页面会持续向第三方 favicon 服务发请求，离线时全部失败，网络空闲点既晚又不稳定。改为 `goto(waitUntil:'load')` → 等 `storageAdapter.ready()` → 固定 settle 1.5s。
  - 网络错误只记录、不判失败：popup 的 favicon 走第三方服务与 `chrome://favicon/`，无外网时必然全挂，那是图标降级，不是页面坏了。只有扩展自身代码产出的错误才算数。
  - 这套断言经过**变异验证**（往 `popup.js` 注入 `throw` + `console.error`，确认只有该页面变红），不是"永远绿"的假测试。
  - 新增 e2e 用例时沿用同一模式：`collectErrors(page)` → `goto` → `settle(page)` → 断言 `jsErrors` 为空。**不要**用 `networkidle`。
  - 手工验证路径（无法自动化时）：`chrome://extensions` → 加载已解压的 `chrome/`，再逐个打开页面看控制台。
- **重要约定**：`test(name, { skip: '原因' }, fn)` 表示**已知缺陷**，函数体内写的是*期望*行为。修 bug 时把对应 skip 去掉即可（先看到红，再改到绿）。当前 6 个 skip，与 `TODO.md` 条目一一对应。
- 模块在**导入期**就会读写 `localStorage`（如 `config.js` 顶层调用 `updateFilter()`），测试中必须用 `await import(...)`，静态 `import` 会被提升到装桩之前。观察导入期副作用时用 `importModuleFresh()` 绕过 ESM 缓存。

工具链只存在于仓库根目录（`package.json` / `eslint.config.mjs` / `scripts/` / `tests/` / `node_modules/`），**不会进入 `chrome/`**，因此不影响扩展的打包与加载。

### 加载 / 运行扩展（唯一的"构建"方式）
打开 `chrome://extensions`，开启右上角「开发者模式」，点「加载已解压的扩展程序」，选择仓库中的 `/workspace/chrome` 目录（不是仓库根目录）。支持 Edge 与 Chrome。

**云原生开发环境里不需要手动做上面这步**：`.cnb.yml` 的 `vscode` 阶段会跑 `scripts/dev-browser.sh`，
它把 `chromium` 换成一个自动补 `--load-extension=/workspace/chrome` 的 shim（`/usr/local/bin/chromium`），
并把 `/usr/share/applications/chromium*.desktop` 的 `Exec` 指过去。于是桌面里点 Chromium 图标、终端敲 `chromium`、
菜单里点「Tree Style History」（直接打开树状历史页），走的都是已经加载好扩展的浏览器。
脚本幂等，可反复执行；扩展 id 由 `sha256(扩展目录绝对路径)` 前 16 字节映射成 a-p 算出，路径固定为 `/workspace/chrome` 时恒为 `cnbfbkbclgbkbnnhacdidjglkknddiga`。

> 为什么必须是 `--load-extension` 而不是「把扩展写进 profile」：实测过预置 `Default/Preferences` 的
> `extensions.settings` 再启动，扩展页一律 `ERR_BLOCKED_BY_CLIENT`；在没有 flag 的进程里，
> 通过 CDP 打开扩展页也会被拦。命令行 flag 是 Chrome/Edge 目前唯一可靠的侧载途径
> （`e2e/pages.spec.mjs` 也是这么加载的，只是那里由 Playwright 传参）。

### 修改代码后重新加载
普通页面（`*.html`、`css/`、`scripts/modules/`、`popup.js`、`history*.js`、`closed.js`、`bookmark.js`、`options.js`）：回到页面按 F5 即可。
Service Worker 侧（`background-sw.js`、`background-utils.js`、`db-manager.js`、`manifest.json`）：必须在 `chrome://extensions` 点扩展卡片上的刷新图标；Service Worker 空闲 30 秒会被浏览器回收，全局变量（`openedTabs`、`recentTabs`、`openerJson` 等）会丢失，这是设计上必须容忍的。

### 查看日志
- Service Worker：`chrome://extensions` → 扩展卡片 → 「Service Worker」链接，打开 DevTools 控制台。启动时打印形如 `[SW Startup] sync=..ms | init=..ms | db=..ms` 的耗时摘要。
- Popup：popup 区域右键 → 检查。popup 关闭后即销毁，需在此窗口保持打开。
- 各页面（`history2.html` 等）：在标签页内按 F12。

### 打包分发
`cd /workspace/chrome && zip -r ../tree-style-history.zip .` —— 仓库以 zip 形式发布给用户自行解压加载。

### 版本号
版本只在 `chrome/manifest.json` 的 `version` 字段维护（`getVersion()` 直接读 manifest）。发布前需同步更新 `README.md` 顶部的 Changelog 段落。

## Manifest V3 的硬约束

本仓库已在 MV3 上，很多看似"写得奇怪"的代码其实是 MV3 限制下的妥协。**改动前先理解这些约束，否则很容易把 workaround 当成坏味道删掉。**

1. **Service Worker 会被回收**。空闲约 30 秒后浏览器终止 SW，所有全局变量（`openedTabs`、`openerJson`、`urlIdJson` …）随之消失。因此：
   - 不能用 `setInterval` 做周期任务，只能用 `chrome.alarms`（`tests/static.test.mjs` 有对应断言）。
   - 需要跨 SW 生命周期存活的状态，应写入 `chrome.storage.session` 或 IndexedDB，不要依赖模块级变量。
2. **SW 没有 DOM，也没有 `window`**。SW 里不能碰 `document`。
   `localStorage` 在 SW 中根本不存在——本项目之所以能在 `background-sw.js` 里到处写 `localStorage[...]`，是因为 `importScripts('storage-adapter.js')` 用 `Object.defineProperty` 把它替换掉了。**不要移除这个 import。**
3. **CSP 禁止动态代码执行**。扩展页面内不得出现 `eval`、内联 `<script>`、内联事件处理器（`onclick=` 等）、远程托管的 `<script src>`。这几条都有自动化断言。
   注意：zTree 内部有 `eval`（`jquery.ztree.core.js:1105`），仅在其异步加载分支中，目前未触发。
4. **`importScripts` 无法加载 ES module**。SW 无法复用 `modules/` 下的 ESM，所以两侧共用的那批函数（`getVersion`/`timeNow`/`getFaviconUrl`/`defaultConfig`/`save_calendar_storage2` …）放在 `chrome/scripts/modules/shared/`——**无依赖的底层**，由 `scripts/gen-sw-utils.mjs` 机械展开成经典脚本 `background-utils.js`。**改这些函数只需改 `shared/` 下那一份**，然后 `npm run gen` 重新生成并提交；`npm run verify:sw-sync` 会拦住忘记生成的情况。见下方「架构」一节。
5. **`chrome://favicon/` 在 MV3 中已不可靠**。这是本项目要配置第三方 favicon 服务、并由 SW 拦截 `fetch` 做缓存的根本原因，也是 README 里"部分页面无法正常显示 favicon"的来源。
6. **`chrome.storage.sync` 配额很紧**：单个 key 8KB、总量 100KB。所以过滤域名要按每 100 条切片成 `filterlist0..N` 保存。
7. **扩展页与 popup 的 CSP 更严格**，在 popup 中点击小书签可能不触发脚本执行（README 已记录）。
8. **事件监听器必须在 SW 顶层同步注册**，不能放在异步回调里，否则 SW 重启后收不到事件。

## 架构

### 1. 双运行时：Service Worker 与页面

MV3 取消了后台页面，因此代码分成两套互不相通的运行时：

- **Service Worker**（`scripts/background-sw.js`，通过 `importScripts` 加载 `storage-adapter.js`、`background-utils.js`、`db-manager.js`）。它负责**采集与持久化**：监听 `tabs.onCreated/onUpdated/onActivated/onRemoved`，调用 `chrome.history.getVisits` 取访问项，把 `visitId → referringVisitId` 的父子关系写入 IndexedDB；周期性（`chrome.alarms`，3 分钟）刷新「最常访问」缓存；管理右键菜单与 4 个快捷键。
- **页面**（popup 与 5 个功能页）。它们负责**查询与渲染**，通过 `dbManager` 直连同一个 IndexedDB，或通过 `messageAdapter` 向 SW 发消息取内存态数据。

两者唯一的共享状态是 IndexedDB 和被 `storage-adapter.js` 劫持后的 `localStorage`。

### 2. 存储三件套（理解本仓库的关键）

**`scripts/storage-adapter.js`** —— 它用 `Object.defineProperty` 把全局 `localStorage` 替换成一个 Proxy，后端是 `chrome.storage.local` 的内存缓存（`localStorage` 在 MV3 Service Worker 中不可用）。所有业务代码仍然照常写 `localStorage['xxx']`，无需改动。
**重要**：读取前必须等缓存就绪，即把初始化代码包进 `onStorageReady(function () { ... })`（等价于 `storageAdapter.ready()`）。所有页面的入口脚本都是这个模式。`chrome.storage.onChanged` 会自动同步缓存，所以选项页改配置后其他页面能看到。

**`scripts/db-manager.js`** —— IndexedDB 单例 `dbManager`，库名 `testDB`（历史遗留命名），版本 6。三个 object store：
- `VisitItem`（keyPath `visitId`）：一次访问 = 一条记录，含 `referringVisitId`（父节点）、`url`、`visitTime`、`title`、`transition`。**树状结构就建立在这个自引用关系上**。
- `urls`（keyPath `id`）：URL 聚合记录，含 `loadfrom`/`loadto` 游标范围，用于增量抓取。
- `closed`（keyPath `id`）：关闭的标签页。`close` 字段是状态码：`-1`=正在打开、`-2`=URL/标题变更、`0`=正常关闭、负数=异常关闭。SW 每次启动调 `updateClosedTabsStatus()` 把残留的负值翻转并写入 `closeTime`，从而实现「上次浏览器崩溃/异常关闭了哪些页」的识别。

改 `DB_VERSION` 才会触发 `onupgradeneeded`，新增索引必须同时改版本号。

**`scripts/message-adapter.js`** —— 统一封装 MV2/MV3 差异。`getBackgroundData('openedTabs'|'recentTabs')`、`callBackgroundFunction(name, ...args)`、`deleteDB()`。MV3 下走 `chrome.runtime.sendMessage`，SW 端在 `background-sw.js` 末尾的 `onMessage` 里按 `action` 分发（`getData` / `callFunction` / `refreshContextMenu` / `clearFaviconCache`）。

### 3. 前端模块结构（3.3.0 重构后的新分层）

`scripts/func.js` 是**模块入口与兼容层**：它 `import` 各领域模块，再把每个函数挂到 `window` 上，供仍然使用全局函数的旧页面脚本（`popup.js`、`history.js`、`closed.js`、`bookmark.js`）调用。`func.js` 同时承担全局 DOMContentLoaded 时的 i18n 填充（`.lang` + `data-lang-string`）与页面缩放（`popup-zoom` / `page-zoom`）。

`scripts/modules/` 下五个模块，职责与依赖：

- `helpers.js` —— 纯工具，无副作用：时间格式化（`TimeToStr`/`timeNow`/`formatDate`，受 `rh-date`、`rh-timeformat` 配置控制）、i18n（`returnLang`/`echoLang`）、字符串转义（`escapeHtmlAttr`/`title_fix`）、URL 处理、bookmarklet 识别与执行、**favicon URL 生成体系**。
- `config.js` —— 配置中心。`defaultValues` 是全部配置项的默认值表，`defaultConfig(clean)` 写入、`loadOptions(full)` 回填表单、`saveOptions(sync)` 收集保存。过滤域名由 `updateFilter()` 从 `rh-filtered` 编译成正则 `flist_r`，`filtUrl(url)` 供所有列表渲染前过滤。同步到 `chrome.storage.sync` 时把 key 的 `-` 换成 `_`，且过滤列表按每 100 条切片存成 `filterlist0..N`（绕过 sync 单 key 8KB 限制）。
- `calendar.js` —— 侧边日历。`calendar_storage2` 是 `{startTime: 条数}` 映射，由 `history-core.js` 写入、本模块读取绘制热力色块，二者**循环依赖**，改动时需注意。
- `popup-core.js` —— popup 各区块的渲染：`recentHistory` / `recentlyClosedTabs`（用 `chrome.sessions`）/ `recentBookmarks` / `mostVisited`（读 SW 写的 `mv-cache`）/ `showRecentTabs`（经 `messageAdapter` 取 SW 内存中的 `openedTabs`、`recentTabs`）/ `pinned`。统一由 `formatItem()` 生成条目，`leftClick`/`rightClick` 决定行为。
- `history-core.js` —— 线性历史页渲染、分组（按 host）、排序（`rh-orderby` / `rh-order`）、`deleteHistoryItem('selected'|'range')`。**大列表用 `setInterval(..., 5)` 分片渲染**以免卡死，这是本项目反复出现的模式，新增长列表时应沿用。

`scripts/dom-helper.js` 是 ES module 版的 `$`/`$$`/`createElement`，用来取代 3.3.0 中移除的 MooTools。

**`scripts/background-utils.js` 是生成文件，不要手改**：MV3 的 Service Worker 不能用 `importScripts` 加载 ES module，所以 SW 与页面共用的那批**无依赖**函数放在 `chrome/scripts/modules/shared/`（`config-defaults.js`、`format.js`、`url.js`、`favicon.js`、`calendar-storage.js`），由 `scripts/gen-sw-utils.mjs` 去掉 import/export 标记后按拓扑顺序拼接成 `background-utils.js`。

- 改这些函数 → 只改 `shared/` 下那一份 → `npm run gen` → 提交重新生成的文件。
- `npm run verify:sw-sync`（即 `gen-sw-utils.mjs --check`）在 `verify` 里跑，文件过期即失败。
- 生成器只认**单行** `import ...;` / `export ...;` / `export { ... };`；`export default`、跨行的 `import` 或 `export {` 会让生成**直接失败**并给出提示，不会产出坏文件（`vm.Script` 解析自检是兜底的第二道）。
- 生成器会在生成前校验模块图，两种错误都会**显式报错**而不会静默产出缺斤少两的文件：①`modules/shared/` 里有文件没登记进 `gen-sw-utils.mjs` 的 `FILES`（否则它永远不会进入生成物）；②某个 shared 模块 import 了不在 `FILES` 里、或排在它后面的文件（import 行是被删掉的，一旦目标没被更早拼接，引用就退化成隐式全局，语法检查看不见，只在 SW 运行时炸）。**往 `shared/` 加文件必须同时加进 `FILES` 并按依赖顺序放好。**
- 生成器只规范化各模块**拼接处**的换行，不动模块内部的空行——它们可能在模板字符串里。因此删掉 import 行后留下的连续空行会保留，这是刻意的。
- 生成器会在文件头派发 `/* exported ... */`（ESLint 指令），名单由各模块真实导出推导。SW 经 `importScripts()` 取用这些符号是静态分析看不见的，没有它 `no-unused-vars` 会把所有未被本文件调用的函数都报一遍。注意该指令**只对 `function` 与 `var` 生效**，`const`/`let`/`class` 无效。
- 页面侧照常通过 `modules/helpers.js`、`modules/config.js`、`modules/calendar.js` 的 `export ... from` 转出，公开 API 不变。

**新增生成器的做法**（与本仓库其他命令家族一致的约定）：裸名跑全部、`:子项`跑单个。写 `scripts/gen-<name>.mjs`，加 `"gen:<name>"` 成员，再把裸名改成
`"gen": "npm run gen:sw-utils && npm run gen:<name>"`（照 `verify` 的写法用 `&&` 串，不另建聚合脚本）。
校验侧对应加 `verify:<name>` 并串进 `verify`。成员名保持稳定，文档/CI 里已有的引用不会失效。

放入 `shared/` 的前提是**无依赖**：不能 import `dom-helper.js`、`config.js`，也不能碰 `document`。有这些依赖的函数留在各自的领域模块里，SW 用不到它们。

### 4. 页面与数据流

| 页面 | 脚本 | 渲染方式 | 数据来源 |
|---|---|---|---|
| `popup.html` | `popup.js` | 原生 DOM 字符串拼接，按 `rh-list-order` 顺序插入区块 | chrome.history / sessions / bookmarks / SW 内存 |
| `history2.html` | `history2.js` | **jQuery + zTree**（核心功能） | IndexedDB `VisitItem` |
| `history.html` | `history.js` | 原生 DOM 分片渲染 | `chrome.history.search` |
| `closed.html` | `closed.js` | **jQuery + zTree** | IndexedDB `closed` |
| `bookmark.html` | `bookmark.js` | 原生 DOM 分片渲染 | `chrome.bookmarks` |
| `options.html` | `options.js` | 表单 | localStorage / `chrome.storage.sync` |

`history2.html` / `closed.html` 用 zTree 渲染树：`id = visitId`，`pId = referringVisitId`，节点名拼上时间、标题和 transition 对应的 emoji（见 `history2.js` 中的 `transition_value` 表）。`fuzzySearch` 提供树内模糊过滤。

这两个页面的脚本用 `jQuery.noConflict()` 后以 `$jq` 引用 jQuery，而 `$` 保留给 `dom-helper` 的 `getElementById` —— **不要在这两个页面里混用**。

`scripts/` 下的 `jquery-3.6.0.min.js`、`jquery.ztree.core.js`、`jquery.ztree.exhide.js`、`fuzzysearch.js` 是第三方库，不要修改（`jquery.ztree.exhide.js` 已被本地定制以支持搜索隐藏，非上游原版）。

### 5. favicon 子系统（跨三层，改动需通盘考虑）

1. `modules/helpers.js` 的 `getFaviconUrl(url, opts)` 按 `localStorage['favicon-service']` 选择服务（chrome / google / duckduckgo / favicon_im / faviconkit / faviconsnap），`setupFaviconElement` 挂 error/load 监听做一次降级（Google 的 404 会返回 16×16 默认图，靠 `naturalWidth <= 16` 判定失败）。
2. **Service Worker 的 `fetch` 拦截**：命中 `FAVICON_SERVICE_PATTERNS` 的请求走 Cache API。除按完整 URL 缓存外，还会从服务 URL 里 `extractHostnameFromFaviconUrl` 抽主机名，用 `https://favicon-cache.internal/shared/<host>` 做**跨服务共享缓存**（受 `share-favicon-cache` 开关控制）。只有 `response.ok` 的响应才写入共享缓存，避免 opaque 响应污染降级链。
3. **负缓存**：请求失败（`!ok` 或 opaque）的 URL 写入 `localStorage['favicon-negative-cache']`，TTL 1 小时，期间直接跳过网络并尝试 `favicon-service-fallback` 备用服务。

选项页的「清除图标缓存」通过 `chrome.runtime.sendMessage({action:'clearFaviconCache'})` 清空 Cache API 与负缓存。

### 6. 约定与陷阱

- `localStorage` 里所有值都是**字符串**，`storageAdapter` 强制 `String(value)`。比较数量时务必 `Number(localStorage['rh-itemsno'])`，比较开关时用 `=== 'yes'` / `!== 'no'`（注意 `share-favicon-cache` 是反向的 `!== 'no'`）。
- 配置键用连字符（如 `load-range`），同步到 `chrome.storage.sync` 时转下划线。新增开关类配置需同时加进 `modules/config.js` 的 `defaultValues`、`loadOptions`、`saveOptions` 与 `options.html` 的表单，以及 `_locales/*/messages.json`。
- i18n 文案写在 `chrome/_locales/en/messages.json` 与 `chrome/_locales/zh_CN/messages.json`，两边都要补。`.lang` 元素由 `func.js` 自动填充，无需手写。
- 渲染用户可控的标题/URL 时一律经过 `escapeHtmlAttr` / `title_fix`，本项目多处直接拼 HTML 字符串。
- 分支：`main` 是当前 MV3 主线（`mv3-3` 已合并，`master` 是旧的 MV2 代码，已废弃）。
- README 的 Changelog 段落记录了每个版本的行为变更与已知问题（例如 MV3 导致部分页面 favicon 无法显示、popup 中点击小书签可能不触发），排查"看起来像 bug"的现象前先读一遍。
