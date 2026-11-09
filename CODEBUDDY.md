# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## 项目概述

Tree Style History —— 一个 Chrome/Edge 浏览器扩展（**Manifest V3**），把浏览历史按「点击链接跳转」的父子关系渲染成树。
扩展本体在 `chrome/` 目录下，**没有构建系统、没有运行时依赖**：源码即发布产物，直接用浏览器加载 `chrome/` 即可运行。
仓库根目录另有开发期工具链（lint + 测试 + 两套 CI），它们不进入 `chrome/`，不影响打包与加载。


## 常用命令

### 自动化校验（改动前后都应跑）

```bash
npm install     # 首次：只装 eslint + globals，两个开发依赖
npm run check   # 本地门禁：lint + test + verify，约 15 秒
```

### 命令分层

命令按**用途**而非检查项拆分；本地与 CI 执行同一套逻辑（`scripts/` 下的 Node 脚本），区别只在输出格式。

| 命令 | 用途 | 说明 |
|---|---|---|
| `npm run lint` | 通用 | ESLint，`--max-warnings 0`：**error 与 warning 都阻塞** |
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
- `npm test` 覆盖四类：静态检查（`tests/static.test.mjs`：manifest 合法性、MV3 约束、HTML 资源引用、i18n 覆盖）、模块行为（`tests/modules.test.mjs`、`tests/tree.test.mjs`、`tests/db-manager.test.mjs` 等）、模块图完整性（各模块公开导出仍存在）、生成物一致性（`tests/sw-sync.test.mjs`）。
- `tests/tree.test.mjs` 可以**静态 `import`** `modules/tree.js`：它只依赖 `helpers.js` 里那几个纯转义函数，没有导入期副作用。`createTree` / `bindTreeSearch` 需要元素，所以那几条用例装 `tests/dom.mjs` 的替身（该替身的 `matches()` 支持 `li[data-tid]` 这类属性存在型选择器）。
- `tests/shared.test.mjs` 单测 `modules/shared/` 这一层。它可以**静态 `import`**（不像 `modules.test.mjs` 必须 `await import`），因为这些模块没有导入期副作用；唯一例外是 `calendar-storage.js`（它在导入期无条件调 `onStorageReady()`），所以没有在这里测。
- `npm run test:e2e` 是**唯一能验证"页面真的能打开"**的一层：用 Playwright 自带的 Chromium 侧载 `chrome/`，逐个打开 popup / history / history2 / closed / bookmark / options 六个页面，断言无未捕获异常、无扩展自身发出的 `console.error`；此外还覆盖真实交互（见下）。官方做法与踩坑记录都写在 `e2e/pages.spec.mjs` 文件头注释里，要点：
  - 扩展**只能在 persistent context 中加载**，且必须用 `channel: 'chromium'`——Chrome/Edge 已移除侧载用的命令行 flag，headless shell 也不支持扩展，所以 Playwright 自带的 Chromium 是唯一选择。
  - MV3 的扩展 id 从 service worker 的 URL 里取（没有 background page 可读了）。
  - **不能用 `networkidle` 判断渲染完成**：页面会持续向第三方 favicon 服务发请求，离线时全部失败，网络空闲点既晚又不稳定。统一走 `gotoPage(page, url)`（`waitUntil:'domcontentloaded'` + 15s 显式 timeout + 一次重试）→ 等 `storageAdapter.ready()` → 固定 settle 1.5s。`load` 会等所有子资源，共享 profile 变胖后曾让尾段 seed 页 30s 超时；`domcontentloaded` 时 classic script 已装好 `storageAdapter` 与 `chrome.*`，渲染完成的真信号本来就是 `settle()`。
  - 网络错误只记录、不判失败：popup 的 favicon 走第三方服务与 `chrome://favicon/`，无外网时必然全挂，那是图标降级，不是页面坏了。只有扩展自身代码产出的错误才算数。
  - 这套断言经过**变异验证**（往 `popup.js` 注入 `throw` + `console.error`，确认只有该页面变红），不是"永远绿"的假测试。
  - 只断言"没抛错"是不够的——这些页面渲染的都是空列表，渲染循环根本没跑。所以另有**喂真实数据**的用例：`bookmark.html` 建一个书签断言标题逐字渲染；两个树状页各断言 `#treeDemo` 里真的有 `li[data-tid]`、每行都带 `switch`/`ico` span、且 `window.jQuery` 已不存在（后者锁住"删掉 zTree 库"这件事，同样变异验证过：让渲染器返回空串即两条都红）。
    - 树状页那两条不需要喂数据：空库时它们渲染"没有找到记录"的占位节点，那也是渲染器必须画出来的两行。
  - 新增 e2e 用例时沿用同一模式：`collectErrors(page)` → `gotoPage(page, url)`（reload 用 `gotoPage(page, undefined, { reload: true })`）→ `settle(page)` → 断言 `jsErrors` 为空。**不要**用 `networkidle`，也不要直接写 `page.goto(..., { waitUntil: 'load' })`。
  - **`waitForFunction` 的签名是 `(fn, arg, options)`**：把 `{ timeout }` 写在第二位会被当成 arg 吞掉，实际仍用 Playwright 默认 30s。「延迟 storage」那条曾因此偶发吃满 30s（全套里出现过 37.5s 的一条绿用例）。现在统一写 `null, { timeout: ... }`，预算覆盖延迟读取 + `SETTLE_MS`。
  - **SKIP 要同时探测包和浏览器**：`import('playwright')` 只能发现包缺失；`PLAYWRIGHT_BROWSERS_PATH` 指向空目录时包能 import、但 `launchPersistentContext` 会报 `Executable doesn't exist`。所以 `SKIP` 还查 `existsSync(chromium.executablePath())`，缺失时 50 条用例真 SKIP 并提示 `npm run browser:install`，`before()` 也用同一个 `SKIP` 守卫。
  - **`seedLinearHistory()` 是幂等的**：共享 persistent context 里 10 处调用，早期每处往真实 `chrome.history` 追加 8~60 条，尾段累计 200+ 行，正是 flaky 的温床。现在每次先按 `layout-probe-` 前缀 `deleteUrl` 清掉上一批、再写固定条数；行**不**在 finally 里删——「group columns」等用例明确依赖前面用例留下的行。`chrome.history.deleteUrl` 对不存在的 URL 是 no-op，`search({text: 前缀})` 能一次捞全。
  - **核心交互已有真实用例**（issue #38 第 8 条，文件末尾 `Core interactions` 段）：往 IndexedDB 喂真实父子 `VisitItem` / `closed` 记录，断言①点击树行 `window.open` 的 URL 精确对应该行、switch 折叠/展开双向生效；②筛选保留命中项的祖先链、丢掉无关根、只高亮键入的关键字；③点击 `closed.html` 的分组一次打开组内全部页面；④在 **worker 里** `chrome.commands.onCommand.dispatch()` 派发，断言四条快捷键各打开对应页面。全部做过变异验证（改坏 `tree.js` 的 `toggle`/`byTid`/祖先链/高亮、`closed.js` 的分组批量打开、`background-sw.js` 的 `onCommand`，对应用例即变红）。
    - 喂数据走 `dbManager.putVisitItem()` / `putClosedTab()`（树状页读 IndexedDB，不是 `chrome.history`），`referringVisitId` 造父子、`oid` 造分组；用完必须删（`deleteVisitItem()`，closed 用 readwrite 事务），否则共享 context 里后续用例的行数全乱。
    - **不要写死「树上恰好 N 行」**：共享 persistent context 里前面的爬库用例已经写过 `VisitItem` / `closed`，按种子 URL 用 `:scope > a[title="…"]` 精确定位行（`:has(a)` 会连父行一起命中，`:scope >` 是必须的）。
    - 离线时真实 popup 落到 `chrome-error://chromewebdata/`，断言不出目标网址——所以 stub `window.open` 记录参数；快捷键那条派发在 `context.serviceWorkers()[0].evaluate()` 里，页面侧看不到 worker 的监听器。
  - **要驱动 SW 自己的代码，用 `context.serviceWorkers()[0].evaluate()`，不是 `page.evaluate()`**：后者跑在页面侧，看不到爬库、`urls_wait_load`、`heatDays` 这些 worker 作用域里的东西（`worker()` 这个 helper 就是干这个的）。写这类用例时给 `evaluate` 的回调加 `/* eslint-disable no-undef */`——那份代码在 worker 里求值，对 ESLint 不可见。
  - **想让历史数据落在过去，不要指望 `chrome.history.deleteRange`**。`addUrl()` 只会写「现在」，而 `deleteRange` 在真实 Chromium 里的行为不是它字面读起来的样子：一个旧的窗口会被接受却什么都不改，而一个覆盖着还在 Chrome 内存缓冲里那批数据的窗口反而会把它**冲出来**（`e2e/pages.spec.mjs` 的 `seedBackfillableVisit()` 注释里记着实测结果）。要喂「某一天的访问」，直接 stub `chrome.history.getVisits` 再跑一次 `processVisits()`。
  - 顺手记一个坑：`localStorage.removeItem()` 清的是 `chrome.storage.local`；worker 里那份解析后的 `calendar_storage2` 由 shared 层的 `chrome.storage.onChanged` 监听清空，但那个广播是**异步**的。用例要重置热力图时两处都得清（`resetAndReadStoredHeatMap()`），不能等广播，它同时把 storage 读回来，好让用例先断言地图确实是空的。
  - **要测「worker 启动时读到的存储」，`probeWorkerWithPlantedDay()` 把启动过程搬到可控介质上重放**：在干净的 `options.html` 里先写好存储，再用 `<script src>` 把 `storage-adapter.js` / `background-utils.js` / `db-manager.js` / `background-sw.js` **按 worker 自己的顺序**注进去。三个必须补的差异：页面里没有 `importScripts`（不补就在第 5 行抛错，**整个文件体都不会执行**，而报出来的却是后面某处的 TDZ）、`mostVisitedInit()` 之类由浏览器驱动的入口要补桩、以及要用没有首方模块 bundle 的页面以免 `const` 撞名。（热力图的 map 现在也会随 `onChanged` 重新 hydrate，但那是异步广播；要精确控制「启动时读到的那份」仍得用这个重放。）
  - **给页面种热力图时，`history.html` 不能当作「干净」页面**：它一加载就会为当天调一次 `history('current','')`，也就是写一次热力图，把当天种进去的值直接抹掉。种一个**过去的**日子反而稳：那个日子只有被选中时才被这个页面写。
  - 热力图的 map 在每个上下文各 hydrate 一份解析后的对象，但 shared 层（`modules/shared/calendar-storage.js`）注册了 `chrome.storage.onChanged`：`calendar-storage2` 一变就用 `change.newValue` **就地**重新 hydrate（保持对象引用，`calendar.js` 的 live binding 不会指向旧对象）。所以页面写当天、worker 随后爬库 flush，两者不再互相抹掉——这是 3.3.2 修掉的竞态，`tests/modules.test.mjs` 的「a page write and a worker flush no longer erase each other」用两个 fresh 模块实例复现。**别把这个监听删回「只在启动时读一次」**：两个写方都是把整份 map 序列化后整体覆盖，没有它丢掉的日期没人重算。
  - 断言「删除后格子颜色被清掉」这类**中间态**时注意：真实页面里选中日期的那几次 `change` 会各调一次 `history()`，其中一次已经顺手把格子清干净了——于是在 e2e 里拿掉清色代码，最终态断言依然成立（变异验证过）。要证明清色本身，得在单测里直接喂一个「已涂色」的格子给 `history()`（`tests/modules.test.mjs` 的「a day that just became empty also loses the colour it was painted with」），e2e 那条只锁「最终两处都干净」。
  - **第三方 favicon 请求在 context 级被 `route(...).abort()` 掉**（`FAVICON_SERVICE_HOSTS`，与 SW 的 `FAVICON_SERVICE_PATTERNS` 同源，漂移由 `tests/static.test.mjs` 拦住）。
    离线时这些请求不是「失败」而是**挂起**，而一个未完成的 `<img>` 请求会一直压着文档的 `load` 事件——早期用 `goto(waitUntil:'load')` 时随机超时，红在恰好第一个渲染外部 favicon 的用例上。abort 把挂起变成前端本来就会降级的 `img` error；导航另改 `domcontentloaded`，彻底不再等 `load`。
    必须挂在 context 上而不是单个 page 上：页面在 route 装好之前就已经开始发请求了。
  - **`chrome.storage.sync` 在未登录的 profile 里照常可用**，所以「保存并上传」「下载参数」能被 e2e 真正覆盖：写进去读得出来、跨 reload 存活、8KB 单键配额照常拦（`QUOTA_BYTES_PER_ITEM` = 8192，超限报 `Resource::kQuotaBytesPerItem quota exceeded`），而且和 `chrome.storage.local` 是两个独立命名空间。测不到的只有「跨设备同步」那一段网络行为——那是浏览器的职责。两条用例（`really writes the config into chrome.storage.sync` / `the download button restores the cloud copy and reloads the page`）都做过变异验证：加回 `ve = result` → 下载那条红；把 `filterlist_slices` 写成 `0` → 上传那条红；去掉 `replace(/-/g, "_")` → 上传那条红。断言 sync 的存在靠 `QUOTA_BYTES_PER_ITEM`，那是最便宜也不会被 `chrome.storage.local` 冒充的证据。
  - **冷启动会输给 Service Worker**：`options.html` 的 `DOMContentLoaded` 在 `storageAdapter.ready()` 一解析就执行，而 `defaultConfig()` 是 worker 的活。页面抢先时整表读出来都是 `undefined`，`localStorage['rh-list-order'].split(',')` 就炸——这个异常落在 handler 中段，后面所有 `addEventListener` 全部丢失，于是**整页按钮都点不动**（实测冷启动约 1/7 命中，F5 即恢复）。现在三处入口都给了兜底（`loadOptions` 的列表顺序、`mostVisitedBlocklist`、`filteredDomainsList`），但页面读到的仍是旧值——所以 e2e 里 `openOptionsPage()` 会等 worker 把 key 种进去再 reload 一次，这不是掩盖问题，是复刻用户按 F5 的动作；那个竞态本身由 `tests/modules.test.mjs` 的「loadOptions survives a cold profile」守着。
  - 手工验证路径（无法自动化时）：`chrome://extensions` → 加载已解压的 `chrome/`，再逐个打开页面看控制台。
- **重要约定**：`test(name, { skip: '原因' }, fn)` 表示**已知缺陷**，函数体内写的是*期望*行为。修 bug 时把对应 skip 去掉即可（先看到红，再改到绿）。当前 **0 个 skip**（历史欠账已清零）。
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
- 启动诊断日志（SW 的 `[SW Startup] ...`、`[StorageAdapter] ...`、db-manager 的开库日志）默认**全部关闭**：`storage-adapter.js` 在全局装了一个 `debugLog()` 和一个 `DEBUG` 开关（`false`）。要查看时在对应上下文的 DevTools 里执行 `self.DEBUG = true`（页面用 `window.DEBUG = true`）并刷新即可；`console.warn` / `console.error` 不受开关影响，始终输出。`console.debug` 是 Chrome 的 verbose 级，本来也默认不显示。每页的版本横幅（`page-init.js`，从 `func.js` 继承来的那条）也走这个开关。**刻意留在开关外的是 popup 的三行耗时**（`popup.js` 的 Storage ready / Total load、`popup-core.js` 的 Data ready）与 `options.js` 的「Database deleted」：前者是量弹窗冷启动预算用的，被 DevTools 过滤掉就失去了意义；后者报的是用户动作。`tests/static.test.mjs` 的守卫名单写明了这个边界。
- Service Worker：`chrome://extensions` → 扩展卡片 → 「Service Worker」链接，打开 DevTools 控制台。
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
   （历史注记）zTree 曾内含一个 `eval`（仅异步加载分支）。它随库一起删掉了——两个树状页现在都由 `modules/tree.js` 渲染，`chrome/scripts/` 下已无第三方文件。
4. **`importScripts` 无法加载 ES module**。SW 无法复用 `modules/` 下的 ESM，所以两侧共用的那批函数（`getVersion`/`timeNow`/`getFaviconUrl`/`defaultConfig`/`save_calendar_storage2` …）放在 `chrome/scripts/modules/shared/`——**无依赖的底层**，由 `scripts/gen-sw-utils.mjs` 机械展开成经典脚本 `background-utils.js`。**改这些函数只需改 `shared/` 下那一份**，然后 `npm run gen` 重新生成并提交；`npm run verify:sw-sync` 会拦住忘记生成的情况。见下方「架构」一节。
5. **`chrome://favicon/` 在 MV3 中已不可靠**。这是本项目要配置第三方 favicon 服务、并由 SW 拦截 `fetch` 做缓存的根本原因，也是 README 里"部分页面无法正常显示 favicon"的来源。
6. **`chrome.storage.sync` 配额很紧**：单个 key 8KB、总量 100KB。所以过滤域名要按每 100 条切片成 `filterlist0..N` 保存。
7. **扩展页与 popup 的 CSP 更严格**，在 popup 中点击小书签可能不触发脚本执行（README 已记录）。
8. **事件监听器必须在 SW 顶层同步注册**，不能放在异步回调里，否则 SW 重启后收不到事件。

## 架构

### 1. 双运行时：Service Worker 与页面

MV3 取消了后台页面，因此代码分成两套互不相通的运行时：

- **Service Worker**（`scripts/background-sw.js`，通过 `importScripts` 加载 `storage-adapter.js`、`background-utils.js`、`db-manager.js`）。它负责**采集与持久化**：监听 `tabs.onCreated/onUpdated/onActivated/onRemoved`，调用 `chrome.history.getVisits` 取访问项，把 `visitId → referringVisitId` 的父子关系写入 IndexedDB；周期性（`chrome.alarms`）刷新「最常访问」缓存（30 分钟）与分趟爬库（15 分钟）；管理右键菜单与 4 个快捷键。**两个闹钟都走 `scheduleAlarm(name, info)` 这一处收口**：闹钟活在整个浏览器会话里，而 `initializeStorageState()` 每次 SW 唤醒都会重跑，无条件 `create()` 会不断重置倒计时——被频繁唤醒的 worker 会让闹钟永远不响（负缓存的 TTL 清扫与 `retentionCleanup()` 都挂在 `mostVisited` 分支上，也会一起失效；后者以 session key 节流，每天最多真跑一次）。`tests/static.test.mjs` 锁住「只有一个 `chrome.alarms.create` 调用点、两个闹钟都调 `scheduleAlarm()`」。
- **页面**（popup 与 5 个功能页）。它们负责**查询与渲染**，数据源按页面分三类：树状页（`history2.html` / `closed.html`）通过 `dbManager` 直连同一个 IndexedDB；线性页（`history.html` / `bookmark.html`）走 `chrome.history` / `chrome.bookmarks`；**popup 两者都不碰**——它读 `chrome.history` / `chrome.sessions` / `chrome.bookmarks`，加上 SW 镜像到 `chrome.storage.session` 的 tab 列表（详见下面「前端模块结构」里 `popup-core.js` 的 `showRecentTabs`），`popup.html` 因此既不加载 `db-manager.js` 也不加载任何消息通道。**不要给 popup 加回消息通道**：一次 `sendMessage` 就会唤醒 SW 并重跑启动爬库。

两者唯一的共享状态是 IndexedDB 和被 `storage-adapter.js` 劫持后的 `localStorage`。

### 2. 存储两件套（理解本仓库的关键）

**`scripts/storage-adapter.js`** —— 它用 `Object.defineProperty` 把全局 `localStorage` 替换成一个 Proxy（挂在页面的 `window` **和** Service Worker 的 `self` 上），后端是 `chrome.storage.local` 的内存缓存（`localStorage` 在 MV3 Service Worker 中不可用）。所有业务代码仍然照常写 `localStorage['xxx']`，无需改动。
**重要**：读取前必须等缓存就绪，即把初始化代码包进 `onStorageReady(function () { ... })`（等价于 `storageAdapter.ready()`）。所有页面的入口脚本都是这个模式。`chrome.storage.onChanged` 会自动同步缓存，所以选项页改配置后其他页面能看到。

替换全局对象的代价是两个不那么显眼的语义陷阱，都已处理但改这块时要知道：

- **未就绪时的写/删除会被初始快照回冲**。`chrome.storage.local.get(null)` 在脚本求值时发出，期间发生的写删除立刻落盘，**却不在那次读的应答里**（Chrome 应答的是调用时刻的快照）。适配器因此把未就绪期间的写删除记进 `_pendingWrites`，在初始化完成时重新应用。写入方有两路，都要记：本上下文的 `setItem()` / `removeItem()`，以及别处（SW 的 `defaultConfig()`）经 `chrome.storage.onChanged` 送达的变更——漏掉后者的话洞只补了一半。两个写入方法都用 `!this._initialized` 守卫，因为初始化后该 Map 再无读取方。
- **与适配器成员同名的存储键会顶掉成员本身**。`localStorage['getItem'] = x` 走 Proxy 的 `set`，命中 `prop in target` 就把方法本身替换掉：值不会被持久化，刷新即无，而此后读这个名字只拿得到 `x`。`RESERVED_KEYS`（由 `Object.keys(adapter)` 推导）在写入时拒绝、报错，并让 `set` 返回 `false`（严格模式下赋值抛 `TypeError`）。

**迁移状态（业务侧已全面走明确 API，Proxy 保留兜底）**：上面这两个陷阱，加上「所有值强制字符串化 → 每个数字比较都得 `Number()`」这层 Proxy 假象的复利成本，随着业务侧全面走明确 API 已一并结清。迁移按模块小步走完了业务侧：页面/模块层与 Service Worker 的读写全部走 `storageAdapter`，`chrome/scripts/` 下已无 `localStorage[...]` 形状（仅剩 `storage-adapter.js` 自身与几处注释）。**Proxy 没有撤**：`storage-adapter.js` 仍替换全局 `localStorage`，作为 e2e 与任何遗留路径的兜底；撤它是后续独立一步，本轮刻意不动（两套运行时、e2e 依赖真实行为）。

- `storageAdapter.getItem(key)` / `setItem(key, value)` / `removeItem(key)` / `keys()` / `isReady()` —— 与 Proxy 的 trap 同一份 `_cache`、同一套字符串化与 `_pendingWrites` 语义，页面 ESM 与 SW 经典脚本都能直接调（全局单例，已在 eslint `crossFileGlobals` 里登记）。`keys()` 供 `config.js` 枚举待清理的配置键，免得迁移后还得借 Proxy 的 `ownKeys`。`isReady()` 报告初始快照是否已填充缓存：未就绪时 `getItem()` 对每个键都答 `undefined`，与「真正未设置」无法区分，所以会按「缺失」批量写默认值的 `defaultConfig(false)` 用它做守卫（未就绪直接 no-op，否则那些写会经 `_pendingWrites` 在初始化完成时盖掉真实配置并落盘）。`clean=true` 是显式「恢复默认」，不受该守卫阻挡。
- `storageAdapter.getNumber(key)` —— 在存储边界做 `Number(getItem(key))`，业务侧不再需要 `Number(localStorage[k])`。冷启动/未设置键返回 `NaN`、空串返回 `0`，与原先调用点的 `Number(undefined)` / `Number('')` 完全一致；它照样走 `getItem()`，所以未就绪读仍会被记进 `_unreadyReads`。`parseInt(..., 10)` 保留在 `rh-width` 这类带单位的值上（`getNumber` 对 `"275px"` 会给 `NaN`），别一刀切替换。
- 新代码优先用这套 API。业务侧已无 `localStorage[...]` 形状，原先那道「数字读是否包 `Number()`」的形状守卫（脚本 + 静态套件第二份实现 + parity + 探针）已随之删除；盯行为的守卫（`getNumber()` 的转换、冷启动、unready 读）照旧保留。
- 测试桩 `tests/stubs.mjs` 的 `storageAdapter` 与 `localStorage` 共用一个 `store`，两侧读写互通；`tests/background-sw.test.mjs` 的 vm 桩同样让两个表面共享 `store`（并保留 favicon 负缓存的写计数）。`tests/storage-adapter.test.mjs` 覆盖 `getNumber()` 的转换、冷启动与 unready 读。

**`scripts/db-manager.js`** —— IndexedDB 单例 `dbManager`，库名 `testDB`（历史遗留命名），版本 6。三个 object store：
- `VisitItem`（keyPath `visitId`）：一次访问 = 一条记录，含 `referringVisitId`（父节点）、`url`、`visitTime`、`title`、`transition`。**树状结构就建立在这个自引用关系上**。
- `urls`（keyPath `id`）：URL 聚合记录，含 `loadfrom`/`loadto` 游标范围，用于增量抓取。
- `closed`（keyPath `id`）：关闭的标签页。`close` 字段是状态码：`-1`=正在打开、`-2`=URL/标题变更、`0`=正常关闭、负数=异常关闭。SW 每次启动调 `updateClosedTabsStatus()` 把残留的负值翻转并写入 `closeTime`，从而实现「上次浏览器崩溃/异常关闭了哪些页」的识别。

改 `DB_VERSION` 才会触发 `onupgradeneeded`，新增索引必须同时改版本号。

**消息通道**（`chrome.runtime.sendMessage`）只剩两处真正在用：选项页的「清除图标缓存」与 `config.js` 保存后的「刷新右键菜单」，SW 端在 `background-sw.js` 末尾的 `onMessage` 里按 `action` 分发（`refreshContextMenu` / `clearFaviconCache`）。曾经封装这套差异的 `scripts/message-adapter.js` 已删除：它的 `useServiceWorker` 由 `manifest_version >= 3` 推出、恒为 true，MV2 那半边永远不可达，而它唯一剩下的 `deleteDB()` 走的本来就是 `dbManager.deleteDB()`——选项页现在直接调后者。曾经那套按名字调用 SW 全局函数的 `CALLABLE_FUNCTIONS` / `callFunction` / `getData` / `deleteDb` 分发表也已整体删除：全仓库没有发送方，留着只会把 worker 内部暴露给消息通道；现在 `onMessage` 只按 `action` 分发这两个真正在用的动作。

### 3. 前端模块结构（3.3.0 重构后的新分层）

六个页面脚本（`popup.js`、`history.js`、`history2.js`、`closed.js`、`bookmark.js`、`options.js`）**都是 ES module**，各自 `import` 需要的符号——曾经那个把几十个函数逐个挂 `window` 的 `func.js` 兼容层已经删除。

`scripts/modules/page-init.js` 承担每页都要做的三件事（由页面脚本 `initPage()` 调用）：填充 `.lang`（按 `data-lang-string`）、应用 `popup-zoom` / `page-zoom`、吞掉 `href="#"` 的点击。**别把它挪到模块顶层执行**：模块先于 `storage-adapter.js` 灌好缓存求值，那时读 `localStorage` 全是 `undefined`，且会被记成一次 unready read。
其中只有 `applyZoom()` 读存储，所以它挂在 `onStorageReady()` 而不是 `DOMContentLoaded` 上——后者**早于** 缓存就绪，缩放会静默失效（不抛错、不告警，页面按 100% 渲染）。

`scripts/modules/ui-state.js` 放跨文件的页面状态：`modifierState.{shift,ctrl}`（由各页的 keydown/keyup 写、由 `popup-core.js` / `history-core.js` 读）、`ITEM_SELECTED_COLOR`（选中行底色）与 `RENDER_BUDGET_MS`（分片渲染每片的时长预算，`history-core.js` 与 `bookmark.js` 共用——两个文件各写一份 `8` 加一句「保持同步」注释，注释管不住漂移）。

`scripts/modules/` 下的领域模块（`page-init.js` 与 `ui-state.js` 是其中两个，职责如上），依赖关系：

- `helpers.js` —— 纯工具，无副作用：时间格式化（`TimeToStr`/`timeNow`/`formatDate`，受 `rh-date`、`rh-timeformat` 配置控制）、i18n（`returnLang`）、字符串转义（`escapeHtmlAttr` 用于属性 / `escapeHtmlText` 用于文本，`title_fix` 已删除）/ `escapeRegExp`/`truncate`、URL 处理、bookmarklet 识别与执行、**favicon URL 生成体系**。
- `config.js` —— 配置中心。`defaultValues` 是全部配置项的默认值表，`defaultConfig(clean)` 写入、`loadOptions(full)` 回填表单、`saveOptions(sync)` 收集保存。过滤域名由 `updateFilter()` 从 `rh-filtered` 编译成正则 `flist_r`（模块内部变量，不导出），`filtUrl(url)` 供所有列表渲染前过滤。同步到 `chrome.storage.sync` 时把 key 的 `-` 换成 `_`，且过滤列表按每 100 条切片存成 `filterlist0..N`（绕过 sync 单 key 8KB 限制）。**`saveOptions()` 只写选项页有控件的键**：`rh-group` / `rh-orderby` / `rh-order` 由页面上的排序按钮实时改、`rh-pinned` 等已无界面，把它们写回去会用默认/旧值覆盖用户刚做的选择（`tests/modules.test.mjs` 有断言）。
- `calendar.js` —— 侧边日历。`calendar_storage2` 是 `{当天23:59:59.999: 条数}` 映射（key 是**当天结束**，不是 0 点；`dayKey()` 统一推导，写读两侧都用它），由 `history-core.js`（当天）与 SW 的爬库（更早的日期）写入、本模块读取着色。它与 `history-core.js` **循环依赖**，所以涂色与分级拆在 `calendar-colors.js`（`paintDay` / `paintSelectedDay`，只依赖 `calendarLevel`）。
  - **热力图是「历史缓存」，不是「快照」**：更早的日期不会再变，所以只写一次。**爬库不过 `save_calendar_storage2()`**：它走 `saveCrawledHeat()`（在 `background-sw.js` 里），逐日判断，已有数值就跳过。
  - **`history()` 是 `save_calendar_storage2()` 的唯一调用方**，而且**只对当天传 `overwrite: true`**：`dayKey(obj.endTime) === dayKey(Date.now())`。日历下方那个下拉框不一定停在今天（点一格就会改写它），所以「页面在看的那一天」跟「今天」是两件事——把前者当权威，就用页面的**行数**盖掉了爬库给那天写的**访问数**，同一列色块的两个数字开始换着口径。非当天一律走 `{overwrite: false}`，与爬库同一个补缺口径。
  - **`save_calendar_storage2()` 的调用点在 `if (rha.length > 0)` 结构之外，且在收集 `rha` 的循环之后**：`n < 1` 时它会**删掉**条目，而「删掉」只可能发生在「这里原本有数」的地方；放进「有行才写」的分支里等于让条目再也没人清理，放到循环**之前**则永远报 0、每天都变成「删掉这天」。`tests/static.test.mjs` 有一条守卫同时盯着这两点（与 `isToday` 同深度 + 在 `rha.push(` 之后）。
  - **归零的日子要连格子颜色一起清**：map 与 DOM 是两处，只删 map 会留下「总数 0、格子深绿」。`history()` 的空结果分支调 `paintSelectedDay(0)`（level 0 会清 `style`，没有另一条「去色」路径要同步）。范围删除的调用顺序让这一步必须落在这里：`deleteHistoryItem('range')` 先跑 `calendar('yes','')` 按**旧值**重画整月，再跑 `history('yes','')` 才把条目删掉。
  - **今天归页面**：`saveCrawledHeat()` 显式跳过 `dayKey(Date.now())`（`countHeatVisit()` 照常把今天的访问计进 `heatDays`，丢弃发生在写入时）。不跳过的话，空地图（新装、清过历史）会被爬库用「爬库开始那一刻的条数」填上今天，而那个数是非零的——之后每次爬库都会因为「已有数值」而跳过今天，页面写的新数值一旦丢失就再也没人纠正。
  - 由此，**页面看不到的日期靠爬库补**：能补多远取决于 `load-range`（默认 7 天）。`load-range3` 是**缓存保留天数**（默认 120，0 = 永久保留）：两个树状页用它作往前翻的查询边界，SW 的 `retentionCleanup()` 挂在 `mostVisited` 闹钟上（session key 节流每天一次），按同一边界调 `dbManager.purgeExpired()` 清掉 `VisitItem` / `urls` / `closed` 三个 store 里更旧的记录，并同步删掉 `calendar_storage2` 里过期的日期；翻到更早的月份时那些格子可能是空的，这是已知取舍。**两处边界不是同一个数值**：DB sweep 用瞬时 cutoff（`now - days*DAY`，按 `visitTime` 切），热力图的 key 是 `dayKey()` 的「当天 23:59:59.999」整天桶，所以 `retentionCleanup()` 先把 cutoff 向下对齐到当天 00:00 再传给 `pruneHeatMap()`——当天下午的访问还在，那天的格子就该留；对齐值不能减 1ms，否则会落到前一天 23:59:59.999、少删一天。
  - **爬库的记录口径是「访问数」，页面是「行数」**（`chrome.history.search` 按 URL 去重），两者只在「一天里一次开一页」时相等；跨档位足以改变颜色。爬库不套 `filtUrl()`（那是页面侧 `config.js` 的东西），所以被过滤的主机也会计入。
  - **只有 `history.html` 会写热力图**：`history2.js` / `closed.js` 用 `calendar('current', …, loadHistory)` 传了自己的回调，走 IndexedDB 树，从不调 `history()`，所以它们的当天格子由爬库决定——而爬库又不写今天，于是**这两个页面的当天格子是空的**。这是取舍不是 bug（让它们各写一次，会在同一天上多出一个「树节点数」口径的写入方）；为避免误读，这两页的 `#calendar-total` 标签换成了 `totalTabsInTree`（「树节点条数」），它显示的是节点数，不是 `history.html` 那个按 URL 去重的行数。
  - `background-sw.js` 的爬库常量（`VISIT_CONCURRENCY` / `CRAWL_STATE_KEY` / `CRAWL_STATE_VERSION` / `CRAWL_CHECKPOINT_URLS` / `CRAWL_CURSOR_TTL` / `CRAWL_SWEEP_TTL`）集中在 `loadHistory()` **之前**声明。`const` 在 TDZ 里，而 `loadHistory()` 正是调 `processVisits()` 的那个——把它们放到调用方后面，只有实际走到爬库那一刻才会炸，且报的是「某个更靠后的符号 TDZ」这种误导性的错。
  - **跨 SW 生命周期的爬库状态收敛成一个带版本号的对象**：`chrome.storage.session` 里只有 `crawl-state` 一个 key，形状 `{ v, cursor: {id,pos,at}|null, heat: {<dayKey>:count}, sweepAt }`。此前游标、热力累加量、sweep 时间戳是三个独立 key，各有自己的读写路径和 TTL，worker 在任意两次写之间被回收就会留下「游标没有计数」「sweep 谎称已爬完」这类半截状态（#34/#36/#37 连续三个修复都落在这里）。现在 **一次读**（`restoreCrawlState()` 是纯读，全文件唯一的 `area.get`）喂饱整趟 `processVisits()`：续爬索引由纯函数 `resumeIndex(state)` 推导、增量过滤读 `state.sweepAt`；pass 开头用 `hydrateHeat(state.cursor ? state.heat : {})` **就地**把模块级 `heatDays` 定成本趟唯一真源（不换引用，e2e 的 `heatDays = {}` 与 `countHeatVisit()` 仍指向同一个对象）——新窗口顺带清掉同一个 worker 里上一窗口留下的 live 计数。**一次写**（`saveCrawlState()`，全文件唯一的 `area.set`）用 `session.set()` 原子提交整个对象，checkpoint 与收尾都构造新对象而非 mutate 那份 await 来的 state（避开 `require-atomic-updates`）；**`heat` 是必填字段**：每个写点都显式传（`heatDays` 或收尾的 `{}`），`saveCrawlState()` 不再有「忘传就隐式快照 live `heatDays`」的回退，杜绝把上一窗口计数带进新窗口。版本不匹配整份丢弃；cursor 过期时连它的 `heat` 一起丢（计数只对那次未完成的窗口有意义）；收尾那次写显式传 `heat: {}` 而**不清空 live `heatDays`**——e2e 要读它证明爬库真的数过，下一趟 pass 开头的 `hydrateHeat()` 反正会清空重建。空 pass（`walked === 0 && !cursor.resumed`）**不写 state**：restore 出来的对象已经是这个新窗口的形状，写它纯属冗余，且正是「漏传 heat」的风险入口。`tests/static.test.mjs` 有守卫钉死「一个 key、一次读、一次写、每次写显式传 heat、空 pass 不写、旧 key/旧函数不得回来」，并附三条**经 `vm.Script` 语法校验**的变异探针（旧版第三条探针把 `await` 塞进非 async 的 `filter(function(){})`，生成的是非法 JS，等于从未验证过）；`tests/background-sw.test.mjs` 有行为用例覆盖版本丢弃、孤儿计数、TTL 连带、原子提交、sweep 不与活游标共存，以及「空 pass 不落盘 / 不回写上一窗口 live 计数」。e2e 里手工驱动 `processVisits()` 前要 `await saveCrawlState(emptyCrawlState())` 重置窗口：启动那趟留下的 sweep watermark 现在在 state 里（旧代码它是 `processVisits(sweepAt)` 的参数，不传就是全量），不重置会把 seed URL 增量过滤掉。
- `popup-core.js` —— popup 各区块的渲染：`recentHistory` / `recentlyClosedTabs`（用 `chrome.sessions`）/ `recentBookmarks` / `mostVisited`（读 SW 写的 `mv-cache`；**必须同时用 `MOST_VISITED_MAX` 和 `mvd.length` 界**，缓存通常比上限短，越界读会把后面所有区块一起吃掉）/ `showRecentTabs`（读 SW 镜像到 `chrome.storage.session` 的 `tab-list`；取不到才退回 `chrome.tabs.query`，**不再**走消息通道——一次 `sendMessage` 就会唤醒 SW 并重跑启动爬库）/ `pinned`（只读：`rh-pinned` 里只剩历史遗留的条目）。统一由 `formatItem()` 生成条目，`leftClick`/`rightClick` 决定行为。**每行右侧曾经画着「钉住/删除」两个按钮，但没有任何代码给它们绑事件**（`uiPinItem`/`uiDeleteItem`/`uiEditItems` 已删除，`tests/static.test.mjs` 有守卫）——删 UI 就要连带删 CSS 与图片，别只删函数留按钮。`isPinned()` / `isBookmarked()` 是同类：它们给行加星标/图钉底色，唯一调用点就在被删的 `uiPinItem()` 里，随之同删（`css/history.css` 的 `.item .bookmark` / `.item .pin` / `.bookmarked` / `.pinned` 规则，以及 `star-grey.png` / `pin-grey.png` 等一批孤儿图片已随之删除，`tests/static.test.mjs` 有「无孤儿图片」守卫）。**`showRecentTabsImpl` 不导出**：`showRecentTabs()` 是做了 `rhhistory` / `rt` 归一的那一层（`rt` 必须是数组，`rhhistory` 必须是对象），把 `Impl` 挂进 export 就等于给下一个调用方留一条绕过收口的近路，所以它只留给同文件的两个调用点，测试也一律走 `showRecentTabs()`（`tests/static.test.mjs` 有守卫盯着 export 块里不得出现它）。
- 顺带记两处「只有特定形状才能证明」的收口，改 `showRecentTabsImpl()` 的正则/判空时留意：①**证明 `rt` 被强制成数组**，不能用普通对象——普通对象没有 `.length`，包不包都渲染 0 行；要用**类数组**（数字键 + `length`，即截断快照的 `JSON.parse` 形状），且让其中一个 id 在 `rhhistory` 里真实存在，未收口时会渲染出那一行；②**证明 `rhhistory` 被判空**，`undefined` 与字符串都读不炸（前者得 `undefined`、后者没这个键），只有 `null` 会在属性读时抛异常，所以用例里列表是 `undefined` / `null` / 字符串 / 数字四种一起喂。
- `chunked-render.js` —— 两个线性页（history / bookmark）共用的分片渲染器。`renderInChunks(items, { draw, into, onFinish })` 持有游标、每片 `RENDER_BUDGET_MS` 时间预算，以及「画完」后的固定收尾（清全选、开首个分组、恢复 master checkbox）：`opts.into` 无论带不带 `#` 都归一成裸 id，`draw()` 抛错时靠 `catch` 停掉循环、靠 `finally` 保证收尾只跑一次，避免旧句柄无人可取消。页面只提供 `draw(i)`，history 页额外给 `onFinish` 重置选中行；`toggleGroup` / `alertLoadingHistory` 由渲染器自己从 `list-view.js` import，**不**作为调用方配置（曾让四个调用点各重复 4~5 行样板）。此前 history-core.js 与 bookmark.js 各有两份分组/非分组的 `setInterval(..., 5)` 循环体，改动要同步四处。
- `list-view.js` —— 页面共用的 DOM 叶子：`getActiveHistory()` / `alertLoadingHistory()` / `toggleGroup()`，只依赖 `dom-helper.js`。其中 `alertLoadingHistory()` 被四个页面共用（两个线性页 + 两个树状页），另两个只服务线性页与渲染器收尾。抽出来是为解环：`history-core.js` 已 import `chunked-render.js`，而渲染器收尾要用这三个函数，反向 import 会构成 `chunked-render → history-core → chunked-render`（`tests/static.test.mjs` 的 acyclic 守卫会拦）；与 `calendar-colors.js` 同一个套路。`history-core.js` 原样 re-export 这三个名字，`bookmark.js` / `history.js` / `closed.js` / `history2.js` 的 import 不变。
- `history-core.js` —— 线性历史页渲染、分组（按 host）、排序（`rh-orderby` / `rh-order`）、`deleteHistoryItem('selected'|'range', redraw)`。它渲染完列表后把条数写进热力图——**空列表也写**（`n = 0` 表示「删掉这个条目」），`overwrite` 只有当天为 `true`；空结果的收口走 `finishEmptyDay()`，它同时清掉选中格的颜色（见上文）。`redraw` 是范围删除完成后的回调，由 **history.js 传入 `calendar('yes','')`**：整月的热力块只有 `calendar()` 会重画（`history()` 只重涂选中日与总数），而本文件 import 不了它（`calendar.js` 反过来 import `history()`，会成环），所以走参数而不是 import——`tests/static.test.mjs` 有一条守卫盯着 history.js 传了它。大列表走 `chunked-render.js` 的 `renderInChunks()` 分片渲染以免卡死（`setInterval(..., 5)` 加每片时间预算），新增长列表时沿用这个入口，别再复制循环体。
- `tree.js` —— 两个树状页的原生渲染器（已完全取代 jQuery + zTree）。`treeHtml(nodes, opts)` 是纯函数（扁平 `{id, pId}` → 嵌套 `<li>/<ul>` 字符串，可按关键字过滤并保留命中项的祖先链）；`createTree(container, opts)` 是有状态包装，负责渲染进元素、`toggle` 折叠与点击回调；`bindTreeSearch(tree, opts)` 接筛选框与 transition 标签（取代 `fuzzysearch.js`）。它**沿用 zTree 的 class 词汇**（`root_/center_/bottom_ × open/close/docu`、`ico_*`），所以 `css/zTreeStyle.css` 仍然负责图标、连接线与缩进——只丢库，不丢样式。节点 `name` 是**纯文本**（原始页面标题），转义在这里做：先按原文定位高亮、再分段 `escapeHtmlText()`，否则关键字会把 `&amp;` 之类的实体切成两半。
  - **可访问性**：`treeHtml()` 输出 WAI-ARIA tree 词汇（`role="treeitem"`、`aria-level`、`aria-expanded`、子列表 `role="group"`，装饰性 switch/ico 加 `aria-hidden`）；`createTree()` 把容器设为 `role="tree"`（页面传入双 locale 的 `aria-label`），维护 **roving tabindex**（任意时刻只有一行 `tabIndex=0`），并在容器上**委托** `keydown` / `focusin`——行每次筛选都整体重绘，逐行绑定监听器会丢。方向键上下移动、左右折叠展开与进出层级、Enter/Space 走同一个 `onClick`、Home/End 跳首尾、`*` 展开同级；折叠后隐藏的行不参与导航。`focusin` 让 Tab / 脚本 `.focus()` / 读屏聚焦任意行时 tab stop 跟着走，否则可见焦点与 tab 顺序会漂移。
  - **只认领自己的按键**：`onKeydown` 用 `HANDLED_KEYS` 白名单（方向键 / Home / End / Enter / Space / `*`）+ 修饰键判断收口——`Tab` / `Shift+Tab` / `PageDown` / `Ctrl+F` 一律放行，带 `altKey` / `ctrlKey` / `metaKey` 的和弦（如 `Alt+←` 后退、`Ctrl+↓`）也放行，只有「无修饰的已绑定键」才 `preventDefault()` 并移动焦点；`*` 在多数键盘上由 `Shift+8` 打出，故 `shiftKey` 只对它例外。委托在容器上的 handler 会先于浏览器默认行为听到任何键，无条件 `preventDefault()` 会把焦点困在树里，与「键盘可达」正好相反。`pos < 0`（脚本焦点落在被折叠隐藏的行）那条恢复分支同样不能吞掉未处理的键。`tests/static.test.mjs` 钉住白名单与守卫顺序，`tests/tree.test.mjs` 与 e2e 的 keyboard 用例都做过变异验证。
  - **「可见行」必须只有一份定义**：`visibleSet()` / `visibleChildren()` / `visibleRows()` 是模块级纯函数，`treeHtml()` 用它们决定画什么、`onKeydown` 用它们决定焦点能去哪。不要把过滤或展开判断在渲染与键盘两侧各写一遍，否则筛选/折叠后箭头键会走进 DOM 里看不见的行。`syncRow()` 是 `toggle` 与键盘折叠共用的那一处：它同时改 `<ul>` 的 `display`、switch 的 class 和行的 `aria-expanded`，漏一处读屏就会听到相反的展开状态。
  - `zTreeStyle.css` 给所有 `li` 设了 `outline:0`，所以 `history.css` 另有一条更具体的 `li[role="treeitem"]:focus-visible` 规则恢复焦点环；静态守卫要求选择器后紧跟 `{`（只匹配前缀会被 `:focus-visible-DISABLED` 这种改名骗过去）。

`scripts/dom-helper.js` 是 ES module 版的 `$`/`$$`/`createElement`，用来取代 3.3.0 中移除的 MooTools。

**`scripts/background-utils.js` 是生成文件，不要手改**：MV3 的 Service Worker 不能用 `importScripts` 加载 ES module，所以 SW 与页面共用的那批**无依赖**函数放在 `chrome/scripts/modules/shared/`（`config-defaults.js`、`format.js`、`url.js`、`favicon.js`、`calendar-storage.js`、`sw-pure.js`），由 `scripts/gen-sw-utils.mjs` 去掉 import/export 标记后按拓扑顺序拼接成 `background-utils.js`。

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

`sw-pure.js` 是 3.3.2 之后从 `background-sw.js` 下沉的一批**纯** SW 逻辑：第一批是负缓存淘汰/过期、爬库状态校验、续爬索引、热力累加、过期日期筛选；第二批（分析评论第 6 条「再走一步」）是 favicon 服务匹配与主机名提取、most-visited 排名、以及 `isNavigatingTransition()` 这条被 `crawlUrlVisits()` / `add_tab_history()` 各写了一遍的四态判断。它们不读 `localStorage`、不碰 `chrome.*`、不带跨生命周期状态；`rankMostVisited()` 是唯一有 import 的（用 `url.js` 的 `INTERNAL_URL`，生成器会按拓扑顺序把 `url.js` 拼在前面），其余只依赖入参。SW 里只留包装层与唯一的那次 `area.get()` / `area.set()`，形状守卫（一次读一次写等）因此仍能看见原来的结构。`FAVICON_SERVICE_PATTERNS` 仍留在 worker 里——e2e 要从源码里把它读回去做请求拦截，抽走会让两边漂移。`tests/sw-pure.test.mjs` 直接静态 import 这一层做行为测试，不必再启一整个 worker；`tests/static.test.mjs` 另有一条守卫钉住 worker 确实委托到这些函数（把包装层改回内联即变红）。`chunked-render.js` 同理，是页面侧分片渲染的收口（见下）。

### 4. 页面与数据流

| 页面 | 脚本 | 渲染方式 | 数据来源 |
|---|---|---|---|
| `popup.html` | `popup.js` | 原生 DOM 字符串拼接，按 `rh-list-order` 顺序插入区块 | chrome.history / sessions / bookmarks / SW 内存 |
| `history2.html` | `history2.js` | **原生树渲染**（`modules/tree.js`，核心功能） | IndexedDB `VisitItem` |
| `history.html` | `history.js` | 原生 DOM 分片渲染 | `chrome.history.search` |
| `closed.html` | `closed.js` | **原生树渲染**（`modules/tree.js`） | IndexedDB `closed` |
| `bookmark.html` | `bookmark.js` | 原生 DOM 分片渲染 | `chrome.bookmarks` |
| `options.html` | `options.js` | 表单 | localStorage / `chrome.storage.sync` |

两个树状页的数据形状相同：`id = visitId`，`pId = referringVisitId`，节点名拼上时间、标题和 transition 对应的 emoji（见 `history2.js` 中的 `transition_value` 表）。

- 两个页面都**不再加载 jQuery / zTree**，改由 `modules/tree.js` 原生渲染，筛选框与 transition 标签走 `bindTreeSearch()`（取代 `fuzzysearch.js`）。两者都保留了 `css/zTreeStyle.css`，因为渲染器输出的是 zTree 的那套 class——只丢库，不丢样式。
- `closed.html` 的分组行（🗓️ 会话 / 🕓 连续关闭 / ⚠️ 异常关闭）没有自己的 URL，`t` 字段是 `'#'`。点击这类行会批量打开它下面所有页面：判断靠 `isPageUrl()`，遍历靠 `tree.childrenOf()`——走数据而不是走 DOM，所以重渲染后依然成立（`refreshRMenu()` 当年是遍历 zTree 刚画出来的 `<a href="#">`，重渲染就失效）。

`chrome/scripts/` 下已无第三方文件：`jquery-3.6.0.min.js`、`jquery.ztree.core.js`、`jquery.ztree.exhide.js`、`fuzzysearch.js` 随最后一个加载它们的页面一起删除。`tests/static.test.mjs` 有两条守卫：页面不得再引用这些文件，`chrome/scripts/` 下不得再出现同名文件；首方脚本里也不得再出现 `$.fn.*` / `$jq` / `jQuery` / `fuzzySearch(`。

### 5. favicon 子系统（跨三层，改动需通盘考虑）

1. `modules/helpers.js` 的 `getFaviconUrl(url, opts)` 按 `localStorage['favicon-service']` 选择服务（chrome / google / duckduckgo / favicon_im / faviconkit / faviconsnap），`setupFaviconElement` 挂 error/load 监听做一次降级（Google 的 404 会返回 16×16 默认图，靠 `naturalWidth <= 16` 判定失败）。**远程 `src` 必须等文档的 `load` 事件之后再赋**（`beginLoad()`）：服务不可达而非返回错误时 `<img>` 请求会一直挂起，而在 `load` 之前挂起的请求会把文档卡在 `interactive`——Chrome 是在 `load` 上给 popup 气泡定尺寸、收打开动画的，于是行早就画好了（<100ms），气泡却要等满 `FAVICON_TIMEOUT_MS`（4s）才弹完，就是 issue #64 的「数秒」。`load` 之后再发请求，气泡与这次网络等待彻底脱钩；本地图标（`images/…`、`data:`、`chrome://favicon/`）和 `load` 之后才渲染的行走同步路径。`tests/static.test.mjs` 有守卫、`e2e/pages.spec.mjs` 有真实浏览器用例（把 `src` 改回立即赋值即变红：4252ms → 263ms），别把这层 defer 删回原样。
2. **Service Worker 的 `fetch` 拦截**：命中 `FAVICON_SERVICE_PATTERNS` 的请求走 Cache API。除按完整 URL 缓存外，还会从服务 URL 里 `extractHostnameFromFaviconUrl` 抽主机名，用 `https://favicon-cache.internal/shared/<host>` 做**跨服务共享缓存**（受 `share-favicon-cache` 开关控制）。只有 `response.ok` 的响应才写入共享缓存，避免 opaque 响应污染降级链——**主路径与 `fetchFaviconFallback()` 两条写方必须用同一个判定**，opaque 只在 `response.ok` 为真时才进共享键（精确 URL 缓存不受限，两条路径都可写）。
3. **负缓存**：请求失败（`!ok` 或 opaque）的 URL 写入 `localStorage['favicon-negative-cache']`，TTL 1 小时，期间直接跳过网络并尝试 `favicon-service-fallback` 备用服务。

选项页的「清除图标缓存」通过 `chrome.runtime.sendMessage({action:'clearFaviconCache'})` 清空 Cache API 与负缓存。

### 6. 约定与陷阱

- `localStorage` 里所有值都是**字符串**，`storageAdapter` 强制 `String(value)`。比较数量时用 `storageAdapter.getNumber('rh-itemsno')`（原先是 `Number(localStorage['rh-itemsno'])`），比较开关时用 `=== 'yes'` / `!== 'no'`（注意 `share-favicon-cache` 是反向的 `!== 'no'`）。**数字比较先 `Number()`，但别把它当 bug 修**：`localStorage` 里存的是字符串，而 `>` 与 `-` 会先把操作数转成数字，所以 `11 > "10"` 本来就是 true、`"120" - 3` 本来就是 117——漏写 `Number()` 在这里不会改变结果。真正会出错的是 `+`（拼串）与 `===`（严格相等不转换）。`Number()` 该写，它是把隐式转换显式化，不是修 bug。业务侧改走 `storageAdapter.getNumber()` 后，这道形状检查已无对象，脚本、静态套件里的第二份实现、parity 与探针清单一并删除；不要为已迁移模块重新引入同类形状守卫。
- 配置键用连字符（如 `load-range`），同步到 `chrome.storage.sync` 时转下划线。新增开关类配置需同时加进 `modules/config.js` 的 `defaultValues`、`loadOptions`、`saveOptions` 与 `options.html` 的表单，以及 `_locales/*/messages.json`。没有任何代码读写的键必须连 `defaultValues` 一起删（`static.test.mjs` 有断言）：它每次启动仍被写入、每次保存仍被同步、每次恢复仍被写回，占着 100KB 配额里的一个位置——`rh-time` / `rh-share` / `rhs-showbg` 就这样躺了几年。守卫爬的是 `modules/shared/config-defaults.js` **和它的生成副本 `background-utils.js`**：生成副本逐行复制了整张表，只排源文件会让每个键都"有读取方"，守卫就此恒绿。
- i18n 文案写在 `chrome/_locales/en/messages.json` 与 `chrome/_locales/zh_CN/messages.json`，两边都要补。`.lang` 元素由 `page-init.js` 自动填充，无需手写。
- 目前只有 `en` / `zh_CN` 两个 locale，均为 `ltr`。整套 RTL 分支（三个 `*-rtl.js` 的 `document.write`、三个 `*-rtl.css`、页面里的 `@@bidi_dir` 判断）已删除——没有 locale 能到达它，将来真要支持阿拉伯语/希伯来语时改用 CSS `:dir(rtl)` 重建，别把 `document.write` 搬回来（`tests/static.test.mjs` 有守卫）。
- `chrome/images/` 与 `chrome/css/img/` 下每一张图片都必须被 HTML / CSS / JS / manifest 引用，`tests/static.test.mjs` 的「无孤儿图片」守卫按完整 basename（词边界，避免 `2.png` 被 `tree-32.png` 误命中）扫描；新增图片记得同时加引用，删 UI 记得连图片一起删。
- 渲染用户可控的标题/URL 时一律经过 `escapeHtmlAttr`（属性位置）或 `escapeHtmlText`（文本位置），本项目多处直接拼 HTML 字符串。`title_fix` 已删除（`tests/static.test.mjs` 有断言禁止它重新出现）。
- 分支：`main` 是当前 MV3 主线（`mv3-3` 已合并，`master` 是旧的 MV2 代码，已废弃）。
- README 的 Changelog 段落记录了每个版本的行为变更与已知问题（例如 MV3 导致部分页面 favicon 无法显示、popup 中点击小书签可能不触发），排查"看起来像 bug"的现象前先读一遍。
