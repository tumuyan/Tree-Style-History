# Tree Style Histyle

![GitHub tag (latest by date)](https://img.shields.io/github/v/tag/tumuyan/Tree-Style-History?label=github) 
[![Microsoft Edge Addons](https://img.shields.io/badge/dynamic/json?label=%20Edge&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fgfmkhnaldbgcpoddmapciblllofekbpn)](https://microsoftedge.microsoft.com/addons/detail/gfmkhnaldbgcpoddmapciblllofekbpn) 
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/khcenbpnhbeplojhaolbpldmoppicold)](https://chrome.google.com/webstore/detail/tree-style-history/khcenbpnhbeplojhaolbpldmoppicold) 
[![CC BY-NC-ND](https://img.shields.io/badge/CC-BY--NC--ND-blue)](./chrome/License.txt)  

This extension shows your recent browser history in tree style.  
When you browser pages from internet, you always jump from one page to another by clicking hyper-text links. This extension shows such a jumping relationship through a tree structure, help you find out what you were doing, what website you visited, and whether something has been done.  

Also following features are available.  
1. Use the right-click menu to quickly search the history for current site, or the site linked to.
2. Tree view of recently closed pages. They are group by when they were closed and whether they were closed properly. 
3. Linear view of bookmarks. Usually browser shows bookmarks in tree style, this extension does the opposite, reorders and displays bookmarks by time and site.  
4. Quickly switch tabs in popup page. Sort tabs in reverse order of the time you visited.

This work is based on [Recent History](https://github.com/umarsheikh13/recent-history) and has get the permission to modify and publish the code as a new exttension, many thanks to Umar.  
Currently only Chinese and English UI are available.  

树状展示浏览器历史。
在使用浏览器访问网页时，用户往往会通过点击链接，从一个页面跳转到另一个页面。本扩展通过树状结构展示了这样的跳转关系，从而让用户能够更快地弄清楚自己当时在做什么，访问了什么网站，当时要做的事情是否已经完成。 
除此核心功能外，还有如下特色：  
1. 使用右键菜单，快速搜索当前网站，或者链接指向的网站的访问历史。
2. 树状查看最近关闭的页面。根据关闭页面的时间、是否正常关闭对页面自动分组。批量打开一个分组的全部页面。
3. 线性查看书签。通常浏览器使用树状结构展示书签；本扩展反其道而行，按照时间和网站重新排序并展示书签，方便查看和整理最新收藏的内容。
4. 快速切换最近访问的标签页。在弹窗中按照访问时刻倒序排列标签页。

灵感来自Firefox扩展[voyage](https://docs.google.com/document/d/1oaJjS9zWGQDBzy4wE403P7V2nQukMql_sfvAURl2noI/preview)，后来ff飙版本的时候这个扩展就废了，现在连发布页都被删除。  
我一直没有再见到类似的扩展，所以自己就搓了一个，算是完成多年夙愿。  
基于Umar的扩展[Recent History](https://github.com/umarsheikh13/recent-history)修改，已经获得原作者Umar的许可可以修改并且作为一个新的扩展进行发布，非常感谢他的劳动和许可。 


## Policy  

Tree Style History collects your browser history, analyzes it and stores it on your computer, and shows it when needed.   
It does not upload your browsing history to the Internet or share it with other programs. When you uninstall the extension, all saved data will be automatically erased by the browser.  

One exception worth naming: to draw the little site icons, the extension sends a page's **hostname** (not its URL, title or history) to the favicon service you pick in Options. The default (`duckduckgo`) is a third-party service; switch to the built-in `chrome://favicon/` service in Options if you would rather make no such external requests at all. Icons are cached locally, and the history itself never leaves your machine.  

Tree Style History会收集您的浏览器记录，分析并存储到您的计算机内，并在需要的时候进行展示。  
它不会把浏览记录上传到互联网或者分享给其他程序。当您卸载扩展时，所有保存的数据均会被浏览器自动清除。  

需要说明一个例外：为了显示网站图标，扩展会把页面的**主机名**（不含完整网址、标题或历史记录）发送给您在选项里选定的第三方图标服务，默认服务（`duckduckgo`）即为一例。若不想发起这类外部请求，可在选项中改用浏览器内置的 `chrome://favicon/` 服务；图标会在本地缓存，浏览记录本身始终不会离开本机。  


## Install  
I have uploaded it to Edge Add-ons
https://microsoftedge.microsoft.com/addons/detail/gfmkhnaldbgcpoddmapciblllofekbpn  

I don't have Chrome Web Store developer account, but @oXnMe uploaded it to Chrome Web Store
https://chrome.google.com/webstore/detail/tree-style-history/khcenbpnhbeplojhaolbpldmoppicold  

Or download - unzip - load the folder in developer mode.  
https://github.com/tumuyan/Tree-Style-History/issues/1  

This extension has been migrated to Manifest V3 since 3.2.0.

已经上传到Edge外接程序商店
https://microsoftedge.microsoft.com/addons/detail/gfmkhnaldbgcpoddmapciblllofekbpn  

我没有Chrome商店的开发者帐号,但是有网友代上传了Chrome商店.
https://chrome.google.com/webstore/detail/tree-style-history/khcenbpnhbeplojhaolbpldmoppicold  

或者打开浏览器的开发者模式，[下载压缩包](https://github.com/tumuyan/Tree-Style-History/archive/refs/heads/main.zip)解压并载入  
https://jingyan.baidu.com/article/ca2d939dfa5762ab6d31ce10.html  
https://github.com/tumuyan/Tree-Style-History/issues/1  


![screenshot](screen.jpg)


## Prompt
这是一个Chrome浏览器扩展。两条约定：  
chrome/scripts/background-utils.js 由 chrome/scripts/modules/shared/ 自动生成（npm run gen），不要手改。  
第三方库（MooTools、jQuery、zTree、fuzzysearch.js）已全部移除，不要再引入。

## Changlog
3.3.2 (未发布)  
Bug 修复: 冷启动时（新装、清过数据、或 Service Worker 还没把默认配置写进存储）打开选项页，按钮会全部点不动、数字框显示 `NaN`——页面假设 worker 已经把默认值写好，抢先时就整表读到空值：先是 `loadOptions()` 抛异常中断了 `DOMContentLoaded` 里后续所有事件绑定，修好抛异常之后表单仍然是空的；现在选项页自己先 `defaultConfig(false)` 再建表单，不再依赖启动顺序（实测冷启动约 1/7 命中，刷新一次即恢复）  
Bug 修复: `history.html?` 后面跟一个不完整的网址（如 `?http://[bad`）会让页面在解析时抛异常，而这个异常逃出了 `DOMContentLoaded` 回调——排在其后的监听器（「按范围删除」的开关）根本没绑上；现在解析失败只是不搜索  
Bug 修复: 删除历史时 `chrome.history.deleteUrl()` 没有回调，删除失败用户毫无感知（行已经从列表里消失了）；改为读 `runtime.lastError` 并在控制台报出具体网址  
Bug 修复: 弹窗里点「最近关闭的标签页」失败时（sessionId 过期是常态）静默无反应，点击像点空；现在会提示并写一条控制台日志  
Bug 修复: `mv-cache` / `rh-pinned` 一旦解析失败会中断整个弹窗的初始化（后面的区块全部空白且不说原因）；两处 `JSON.parse` 都加了收口，解析出非数组也按空处理  
Bug 修复: 树状历史/最近关闭页的占位节点「正在解析数据中」「没有找到…」写死中文，英文界面里照样显示中文；改走 i18n  
清理: 删除 `executeBookmarklet()` 里 MV3 不可能走到的 `chrome.tabs.executeScript` 回退分支  
清理: 删除 `formatItem()` 里两支完全相同、`history.js` 里永真的死分支，以及三个渲染文件里逐行的调试 `console.log`（`feach_History` 每次开一天打一行）  
清理: 三处裸 `catch {}` 补上「为什么可以吞掉」的说明  
重构: 收敛三样跨文件的重复：元素随机 id（14 处）、tooltip 拼接（3 份，其中两份已各自漂移）、月份下拉的 12 个 `<option>`（3 份逐字节相同）  
重构: `feach_History()` 里 `t == 0` 与 `t == n` 两支原来是同一个 `openCursor` 两种区间，合并成一个区间表达式  
新增校验: `tests/static.test.mjs` 拦住页面脚本里写死的中文（i18n 断言原来只检查「代码问的 key 存在」，看不见「根本没问 key 的字符串」）  
Bug 修复: 日历翻到上一年时整月错位（首末日的星期按「今年」算），且所有格子的热力值都按今年查，颜色与列表对不上  
Bug 修复: 弹窗的「最近浏览」与「最常访问」各少显示一条（配额攒到上限时那一条已经渲染，判断只能落在下一轮）  
Bug 修复: 线性书签/线性历史取消全选后，行被刷成第三种底色；现在改为清掉内联颜色，交回样式表（任何字面量都跟不上主题切换）  
Bug 修复: 标题含引号的页面在「最常访问」里显示成 `&amp;#34;` 这样的字面实体；写入 `mv-cache` 时不再手动转义，转义交给渲染侧  
清理: 删除零调用的 `popup_scrollbar_fix()`、`alertUser()` 里两个指向已删除按钮的分支，以及 popup.css 中只服务于它们的四段规则  
重构: 「显示更少的记录」的筛选抽出为 `collapseVisits()`：原来是边遍历边 splice 再重取当前位，答案一样但不好读；现在建成新数组  
行为变更: 历史缓存不再是启动时一次性跑完整个窗口的长任务，改为定时触发、每趟最多爬 300 个网址，没爬完的部分由下一趟接着爬；整趟爬完后记录一个时间戳，之后的每趟只爬这个时间点之后新产生的记录  
Bug 修复: 同一个 worker 里启动流程和定时器会各起一趟爬库，两趟交错执行，重叠的网址被重复爬取、热力图计数也因此写偏（那是「有值就不覆盖」的长期缓存，写偏没人纠正）；现在同一时刻只跑一趟，没跑完的由下一趟从游标续上  
Bug 修复: 爬库空趟（整趟爬完之后没有新记录）会把工具栏徽标停在「Url」上；改成定时分趟后空趟是常态，于是这个残留也变成永久  
Bug 修复: 爬库分趟后热力图按「趟」而不是按「窗口」计数：350 个网址两趟爬完时那天记的是 300 而不是 350，而热力图是「有值就不覆盖」的长期缓存，少了的那部分没有下一趟来补；现在各趟的计数先累加，整趟窗口走完才写一次  
Bug 修复: 上一行那个累加量仍会被误清：爬过的网址会带上 `loadto` 并在下一趟被 `loadHistory()` 滤掉，于是游标的 id 找不到、位置又超出剩下的列表，`restoreCrawlCursor()` 回 0，而 0 同时也是「没有未完成的窗口」——第二趟被当成全新窗口，前半程的计数被当陈旧值丢掉（350 个网址最终记成 50，比修之前更偏）；现在游标额外区分「有没有未完成的窗口」与「走了多少」，续爬以窗口为准  
Bug 修复: 游标的位置回退比 id 回退多走一条已爬的网址，重复计数会让那一天多记一次；位置统一成「已走条数」  
Bug 修复: 爬库窗口超过两趟时，热力图会永久少记整整一趟：爬过的网址带上 `loadto` 被下一趟滤掉，列表缩水后若仍长于游标里存的位置，那个「位置回退」会指向一批从没爬过的网址并把它们跳过，该趟随即被判为「窗口完成」，少掉的一段写进「有值就不覆盖」的热力图后再也没人纠正（700 个网址实测记成 400）；现在游标只认 id，id 找不到就从剩余列表的头部续爬，`pos` 不再作为恢复依据（保留它只为诊断进度）  
行为变更: 日历热力色块改由爬库缓存汇总：`history.html` 打开时当天色块已经画好，不必先点击一天  
行为变更: 热力图按历史记录逐日汇总一次并长期保存，已有数值的日期不再重新计算；删除某天的历史缓存后会在下次启动时回填  
行为变更: 热力图里的**当天**始终由页面写入，爬库只回填更早的日期；除当天外的日期，页面只填空、不覆盖  
Bug 修复: 按范围删掉某天的全部历史后，色块会留着；现在计数归零会删掉 map 里的条目，并同时清掉格子的颜色  
Bug 修复: 点击非当天的格子后再删除，该日期的色块会被页面的行数覆盖（爬库记的是访问数，同一天两个口径）  
Bug 修复: 日历热力图的目标日期错位一天（写入方与读取方的两个反向偏移互相抵消，因此长期没有显形）  
Bug 修复: 选中当天的色块只有点过一天才会出现，且任何一次日历重绘都会把它抹掉  
清理: 删除日历里重复了三遍的颜色分级，收敛到 `calendarLevel()` / `paintDay()`  
Bug 修复: 自定义页面缩放偶尔不生效；存储就绪之前写入的配置会被随后的快照覆盖回去  
Bug 修复: "最常访问"的数据少于上限时，弹窗抛异常，后面的区块不再渲染  
Bug 修复: 按范围删除历史后，日历不刷新  
Bug 修复: "最近标签页"的快照顺序异常时，整个区块空白且不说为什么  
清理: 删除三个没有任何代码读写的配置项（rh-time / rh-share / rhs-showbg），它们每次启动仍然被写入和同步  
行为变更: 点「下载参数」只恢复扩展仍有默认值的配置项；此前会连同云端残留的已删除键一起写回。被删掉的键现在会同时从本地和 `chrome.storage.sync` 里清掉，不再需要单独维护废弃键名单。清理只认配置项命名空间（`rh-` / `rhs-` 前缀与几个另起名的键），不会连热力图缓存、爬库进度、favicon 负缓存一起删掉；判断以横杠拼写的本地名为准，因此 3.3.0 及更早版本以「只把第一个横杠转成下划线」写进云端的旧键（`rh_list-order` 等）不会被误判成废弃键；每次安装写的 `rh-version-<版本>` 标记也不在清理之列  
清理: 删除 MV2 遗留的 `message-adapter.js`、弹窗每行右侧点不动的「钉住/删除」按钮，以及一批零调用的函数  
行为变更: 弹窗每行不再显示「钉住/删除」按钮（它们从未绑定过事件）；此前钉住过的条目仍然显示  
Bug 修复: favicon 备用服务把「不可验证的 opaque 响应」也写进了跨服务共享缓存（主路径只认 `response.ok`）；其他服务随后查同一主机名都会命中这个坏图标；现在两条写方统一只在 `response.ok` 为真时进共享键  
Bug 修复: `options.html?p=<任意值>` 会把整页按钮搞死——`p` 直接拼成 id 后未经校验就取 `.style`/`.classList`，未知值（以及锚点被注释掉的 `translations`）会抛异常中断 `DOMContentLoaded`，后面所有监听器全丢；现在要求面板与锚点都存在，否则回退到选项页  
破坏性变更: 最低支持的 Chrome 版本提升到 102（此前声明为 88）。低版本能安装但一运行就崩，因为需要 MV3 起才有的 `chrome.storage.session` 等 API（`manifest.json` 已于 #4 提升至 102，此处补记）  
Bug 修复: `mostVisited` 定时器每次 Service Worker 唤醒都被重新武装，倒计时不断被重置、实际几乎不会触发（连挂在它上面的 favicon 负缓存 TTL 清扫也一起失效）；现在两个周期闹钟都走同一处「已存在则不重建」收口，与分趟爬库闹钟一致  
Bug 修复: 弹窗一行坏数据会带走后面所有区块——缓存行缺 `favicon` 字段、或冷启动时 `mv-blocklist` 还没落库，都会让 `.indexOf()` 抛异常，而 popup.js 的区块循环没有 try/catch；两处读取都给了空串兜底  
文档: Policy 补明默认 favicon 服务（duckduckgo）会把页面主机名发送给第三方；浏览历史本身仍只存本地，可在选项里改用浏览器内置的 `chrome://favicon/` 服务避免这类外部请求  

3.3.1 (2026/06/19)  
修复设置丢失的bug 
优化自定义缩放的外观

3.3.0 (2026/06/07)  
重构: MooTools 完全移除，全部替换为原生 JavaScript；`func.js` 拆分为 5 个 ES6 模块  
Favicon优化: 增加服务API，缓存请求成功的图片和失败的url，增加次选机制  
新增功能: 自定义弹出窗口和其他页面的缩放比例（25-300%） 
Bug 修复: 若干

3.2.0 (2025/11/10) 修复了一些bug。在AI的协助下已经升级到manifest v3，切换默认分支到mv3-3（因为这是我第3次尝试把扩展升级到mv3）。由于MV3的限制，一些功能的体验会劣化。如：部分页面无法正常显示favicon，在弹窗中点击小书签可能不触发功能。  

3.1.13 (2024/04/29) 调整popup窗口所能显示的项目数量的上限，处理favicon 为空的情况。

3.1.12 (2022/06/23) 增加功能：在弹窗中显示最近浏览的标签页，快速切换标签页; 优化功能（弹窗中的最近关闭的标签页）：数据改为从Chrome API获取，点击改为恢复会话而不是打开网页，关闭窗口显示一笔记录点击时可以直接恢复窗口 

3.1.11 (2022/06/11) 修改选项：自定义点击图标后的动作；调整右键菜单的文本，增加是否显示右键菜单的开关(#15)  

3.1.10 (2022/06/10) 增加功能：在树状历史中点击链接时，如果已经有此网址对应的标签页，则跳转到已经打开的页面，而不新打开页面（另外在测试时发现浏览器要求升级manifest_version，试了试不太能轻松搞定，希望有朋友来帮忙完成更新！）  

3.1.9 (2022/1/27) 完善线性历史、线性书签的外观：为按钮增加提示文字，优化时间显示，去除线性书签的无效checkbox和无效提示内容，显示线性书签的域名分类下包含的书签数量  

3.1.8 (2021/8/9) 增加选项：在“弹窗设置”中增加“显示弹窗”选项，选择是（弹窗）否（打开树状历史）  

3.1.7 (2021/6/24) 修复bug：在“最近关闭”的页面点击链接，会自动打开2个页面

3.1.6 (2021/6/7) 修复bug：Chrome无法显示默认历史管理器的问题（在Edge是正常的）；线性书签无法正常显示小书签（bookmarklet）

3.1.5 (2021/5/29)  
增加功能：线性书签标签页。  
增加选项：指定在popup弹窗中点击“更多”时，打开浏览器默认的页面还是扩展内置页面。  
修复bug：设置-下载参数时弹窗顺序显示有错误；日期没有自动补零。  
已知问题：浏览器限制同一个扩展最多绑定4个快捷键，现在通过特别的方式绑定了5个快捷键，导致扩展默认快捷键无法生效，需要手动设置。

3.1.4 (2021/5/22) - 增加功能：树状历史中显示较少的历史（默认关闭，需要在设置中手动打开），批量打开最近关闭的页面。优化：微调外观，一定程度上实现了窄窗口自适应(但是使用Android kiwi浏览器测试确认手机不能实现主要功能)，统一变更过滤域名的算法  

3.1.3 (2021/5/18) - 增加功能：树状展示最近关闭的页面；修复：令日期和时间选项对树状历史同样生效；优化：微调外观，修改设置中的默认参数。 

3.1.2 (2021/5/11) - 优化搜索浏览记录功能，增加选项同步功能（跟随浏览器账户自动同步），增加快捷键设置（可以通过设置快捷键替换默认历史记录管理器），缓存访问历史的网址数量，优化部分UI的样式和命名，增加清除缓存功能，优化网址过滤功能。

3.1.1 (2021/04/26) - 为树状历史页增加访问类型筛选功能，为树状历史增加loading动画/加大行间距，增加对网址标题特殊符号的处理，历史数量较少时自动载入前日记录，调整默认的设置参数，调整Chrome设置默认历史页面的选项（Edge屏蔽此功能），增加设置页的提示文字，优化历史缓存记录，降低搜索字数限制，增加暗黑模式（根据浏览器设置自动切换），调整popup页面外观，增加右键菜单“搜索此网站的浏览记录”。

3.1.0 (2021/04/18) - Add the basic tree style function.

## License  

Tree Style History, Tree Style History (Toolbar Icon)

Copyright (c) 2021 Tumuyan <tumuyan@gmail.com>
  
This Work is based on Recent History and has get the 
permission to modify and publish the code as a new exttension.
  
----

Recent History, Recent History (Toolbar Icon)

Copyright (c) 2011-2020 Umar Sheikh <hello@umarsheikh.co.uk>

THE EXTENSION IS PROVIDED IN THE HOPE THAT IT WILL BE USEFUL,
BUT WITHOUT ANY WARRANTY. IT IS PROVIDED "AS IS" WITHOUT
WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.

IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW THE AUTHOR WILL
BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY GENERAL, SPECIAL,
INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR
INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS
OF DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED
BY YOU OR THIRD PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE
WITH ANY OTHER PROGRAMS), EVEN IF THE AUTHOR HAS BEEN ADVISED
OF THE POSSIBILITY OF SUCH DAMAGES.

Attribution-Noncommercial-No Derivative Works 3.0 Unported
http://creativecommons.org/licenses/by-nc-nd/3.0/
