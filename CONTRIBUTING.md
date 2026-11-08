# Contributing

短版开发约定。完整背景（架构、MV3 约束、测试写法、踩坑记录）见 [CODEBUDDY.md](./CODEBUDDY.md)。

## 项目形状

`chrome/` 就是发布产物：**源码即产物，没有构建步骤**。用浏览器加载 `chrome/` 目录即可运行；
根目录的 `package.json` / `scripts/` / `tests/` 只是开发期工具链，不进入 `chrome/`，也不影响打包。

Node 要求 >= 22。首次：

```bash
npm ci
npm run check   # lint + test + verify，约 15 秒；提交前必跑
```

`check` 是本地门禁，CI（`.cnb.yml` 与 `.github/workflows/ci.yml`）跑同一套 npm script，
不存在「只有 CI 才跑的检查」。

## 三条最短路径

**改 shared 函数** → 只改 `chrome/scripts/modules/shared/` 里那一份，然后：
```bash
npm run gen      # 重新生成 background-utils.js 等生成物，并把结果一并提交
```
`background-utils.js` 是生成文件，**不要手改**。`npm run verify:sw-sync` 会拦住「改了 shared 忘记生成」。
往 `shared/` 加文件必须同时登记进 `scripts/gen-sw-utils.mjs` 的 `FILES`，并按依赖顺序放好
（生成器只认单行 `import` / `export`，且要求无依赖：不能碰 `document`、`config.js` 等）。

**新增一项校验** → 写成 `scripts/check-xxx.mjs`，加一条 `"verify:xxx"` 到 `package.json`，
再用 `&&` 串进 `verify`（裸名跑全部、`:子项`跑单个的写法与 `verify` 一致）。
**不要在 CI 配置里内联 `node -e` 块**：两套 CI 都只调 npm script，逻辑写在脚本里才不会漂移。
能用行为测试（喂数据、断言结果）表达的，优先放 `tests/`，别再叠形状断言。

**改文案** → `chrome/_locales/en/messages.json` 与 `chrome/_locales/zh_CN/messages.json` **两边都补**，
`.lang` 元素由 `page-init.js` 按 `data-lang-string` 自动填充，不用手写。新增开关类配置还要同时加进
`modules/config.js` 的 `defaultValues` / `loadOptions` / `saveOptions` 与 `options.html` 表单。

## 几条容易踩的约定

- 版本只在 `chrome/manifest.json` 的 `version` 维护；发版前同步 README 顶部的 Changelog。
- Service Worker 侧（`background-sw.js`、`background-utils.js`、`db-manager.js`、`manifest.json`）改动后，
  要在 `chrome://extensions` 点扩展卡片的刷新图标；普通页面按 F5 即可。
- 读存储前等 `storageAdapter.ready()`（或 `onStorageReady()`）；新代码用 `storageAdapter` 的明确 API，
  不要写 `localStorage[...]` 下标。
- 测试用 Node 内置 `node:test`，无测试框架依赖；跑单个文件用 `npm run test:only -- tests/static.test.mjs`。
- `npm run test:e2e` 需要真实 Chromium，首次先 `npm run browser:install`。
- lint 的 `--max-warnings 0` 会让 warning 也阻塞，`npm run lint:fix` 可自动修复。

## 提交

提交/PR 标题用 `type(scope): 描述`（如 `fix(tree): 修正折叠态`）。PR 描述写清「现状问题 / 方案 / 改动点」。
分支从 `main` 开，改动只落在功能分支，合并交给平台。
