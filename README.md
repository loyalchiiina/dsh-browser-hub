# 侧边栏浏览器搜索引擎以及书签功能补丁插件（dsh-browser-hub）

内置「浏览器」Tab 增强 —— the agent harness 桌面端右侧边栏**自带浏览器**的伴随插件。

> **English**: A companion plugin for the built-in **browser** tab in the desktop right sidebar: adds a search-engine dropdown (Baidu / Bing / Google / Sogou / 360 / custom), a bookmark button with a searchable panel, multi-level folders and 360/Chrome bookmark-HTML import, plus keyword-to-search behaviour in the address bar. Adapts DSH kernel 0.2.2-rc.1.

> 只增强**自带的「浏览器」Tab**，**不再单独新增标签页**（独立的「书签」Tab 与左侧边栏入口已移除）。

在自带浏览器工具栏右侧加入：

- 🔎 **搜索引擎下拉**：百度 / Bing / Google / 搜狗 / 360 搜索 / 自定义（`{q}` 占位）
- 🔖 **书签按钮**：点开面板可实时搜索书签、点开、＋收藏当前页、＋书签、＋文件夹、导入、编辑 / 删除
- 🕘 **浏览历史**：面板顶部「书签 / 历史」胶囊页签同页切换；历史自动记录浏览器里打开过的网页，按标题/网址搜索，点开直接回到那一页，可删单条或「清空历史」（二次确认）

**地址栏增强**：在自带浏览器地址栏输入**非网址的关键词**（如「你好」）回车 → 用所选引擎搜索；输入真网址 / 域名则照常打开。

所有数据保存在本插件目录的 `data/`（书签 `store.json`、历史 `history.json`），本地保存、不联网、不上传。

> 关于网页登录态（cookie）：宿主给侧边栏浏览器分配的是**内存态隔离分区**（`dsh-sidebar-browser-<uuid>`，无 `persist:` 前缀），DSH 一退出 cookie 即清空，插件层无法改变，所以 bilibili 等站点每次重启仍需重新登录。要免重登必须改 DSH 本体。

## 效果图

内置浏览器顶部工具栏右侧：搜索框、搜索按钮、搜索引擎下拉、书签按钮。

![浏览器书签总览](https://raw.githubusercontent.com/loyalchiiina/dsh-browser-hub/main/docs/screenshots/01-browser-bookmarks-overview.png)

![书签多级文件夹与搜索](https://raw.githubusercontent.com/loyalchiiina/dsh-browser-hub/main/docs/screenshots/02-bookmark-folders.png)

在地址栏输入非网址的关键词（如 `NIHAO`）回车 → 用所选引擎搜索并直接在当前标签打开：

![地址栏关键词搜索](https://raw.githubusercontent.com/loyalchiiina/dsh-browser-hub/main/docs/screenshots/03-address-bar-search.png)

![搜索引擎下拉菜单](https://raw.githubusercontent.com/loyalchiiina/dsh-browser-hub/main/docs/screenshots/04-search-engine-menu.png)

## 快速上手（5 步）

1. **打开**：装好并重启 DSH 后，点右侧边栏里自带的「浏览器」Tab —— 插件增强的就是这个 Tab，不会多出新标签页。
2. **收藏**：点工具栏 **🔖** 打开书签面板 → 「＋书签」填名称与网址；「＋文件夹」建多级目录，面板里可重命名 / 删除。
3. **搜索**：在地址栏输入**非网址的关键词**回车 → 用下拉所选的搜索引擎在当前标签打开；输入真网址或域名则照常打开。
4. **换引擎**：工具栏下拉选 百度 / Bing / Google / 搜狗 / 360；要别的选「自定义」，在旁边的输入框里写模板，`{q}` 就是关键词占位（例：`https://example.com/search?q={q}`）。
5. **迁移**：已有收藏点「导入书签」→ 选择 360 / Chrome / Edge 导出的书签 `.html` 文件即可整批进来。

## 关于自动更新提醒

本插件**当前没有**工具栏「检查更新」按钮：相关实现残留在未注册的旧 Tab 组件里，活动工具栏从未渲染过它，因此不在此宣称（计划在 0.2.11 搬到工具栏并自建四态检查）。在那之前请用宿主插件市场的更新提示，或手动装新版后**彻底退出 DSH 再启动**。

## 安装（桌面端 desktop profile）

> 桌面 profile 由 Electron 独占管理，只能用「手改 package.json + pnpm install」的方式装。

1. 把本目录放到 `~/.dsh/local-plugins/dsh-browser-hub`。
2. 编辑 `~/.dsh/profiles/desktop/package.json`：
   - `dependencies` 增加：
     ```json
     "dsh-browser-hub": "0.2.10"
     ```
   - `dsh.profile.bundles` 数组增加 `"dsh-browser-hub"`。
3. 在 `~/.dsh/profiles/desktop` 目录执行 `pnpm install`。
4. **完全退出 the agent harness 再启动**（宿主无热重载）。

## 说明

- 打开网页走宿主原生浏览器：`ctx.get('sidebarRight').openTab('browser', { params: { url } })`。
  插件无法把 Edge / 360 内核塞进侧边栏（桌面端封死了 iframe / webview），这是平台限制。
- 增强通过**运行时 DOM 注入**实现（不动 `app.asar`），锚点用 CSS 语义后缀 `[class*="_toolbar"]` + `input[class*="_address"]`；
  若 the agent harness 大版本改了内置浏览器 UI 结构，可能需要重调锚点。
- 改动 `lib/client.js` 后用 **Ctrl+Shift+R** 硬刷新即可生效（无需完全重启）。

## 版本

- 0.2.10 真正修掉「面板收不回去」：`openPopover` 是异步的（先 `await tbLoad()`），快速连点 🔖 会各建一个面板，只有后完成的能被 `TB.popover` 追踪，**先建的孤儿永久挂在屏幕上**，点按钮只关掉一个、剩下的怎么都收不起来。加 `TB.opening` 互斥 + `purgeOrphanPopovers()` 孤儿清道夫（`togglePopover`/`openPopover`/每次 `scanToolbars` 都清）。工具栏幂等改为「属性 + `.dbh-tb-group` 真实存在」双判并清理重复组；mousedown 监听改同步挂载；页签行右侧加 **✕**、面板内支持 **Esc** 关闭；点网页区域靠 webview `focus` 事件关闭。纯客户端 → **Ctrl+Shift+R**，不需重启。**同版文档更正**：删除 README 中四项从未在活动 UI 生效的描述（⟳ 检查更新、面板内移动、🔖 红点、粘贴 HTML 导入）；`locale` 元数据与 `package.json` description 补上「浏览历史」，安装示例版本更新为 0.2.10。
- 0.2.9 修复「点 🔖 关不掉面板」：`onDocDown` 原来用对象引用比 `e.target !== TB.popoverBtn`，React 重建工具栏后新节点不等于旧引用 → mousedown 先关、同一按钮的 click 又开；改为 `isHubControl()` 按 `.dbh-tb-btn/.dbh-tb-group` 语义判定，并给 `decorateToolbar`/`togglePopover` 加孤儿引用自愈。新增**浏览历史**（书签/历史胶囊页签同页切换，落盘 `data/history.json`，上限 800 条，可搜索、删单条、二次确认清空）。**改动含宿主端 `lib/index.js` → 需彻底退出 DSH 再启动；客户端部分再按 Ctrl+Shift+R。**
- 0.2.8 文档补全：新增「快速上手（5 步）」与「版本提醒（⟳ 检查更新）」四态说明；安装段去掉 `link:` 教法，改为真实副本 + `dsh.profile.bundles`。
  > **注（0.2.10 核实）**：⟳ 仅在未注册的旧 `HubTab` 组件里实现，活动工具栏（`decorateToolbar`）从未渲染过它，`window.__dshUpdClick` 亦未在任何活路径被调用 —— 故 0.2.7/0.2.8 这两条描述的函数**从未生效**，0.2.10 已从功能说明与快速上手移除，待 0.2.11 搬到工具栏并自建四态检查。
- 0.2.7 工具栏（＋书签 / ＋文件夹 / 导入书签）后面新增 **⟳ 检查更新**：点一下查 npm 最新版，有新版变蓝显示「更新到 vX」，再点一下即一键装进 desktop profile；复用技能浏览器的全局更新委托 `window.__dshUpdClick`。纯客户端改动，**Ctrl+Shift+R** 硬刷新生效。
- 0.2.6 修复「启动正常但侧边栏功能失效」：上一版用 setInterval 轮询后重入 apply，而 apply 已在 fiber 激活完成后才调用，注册被**静默吞掉**；现改用 cordis 官方响应式注入 `ctx.inject(["betterSidebar"], cb)`，服务就绪时自行执行注册。
- 0.2.5 启动稳定性：服务从 declared inject 移除（避免 pending 卡住 web boot），改为安全取值器 `__safeSvc` + 最多 30s 轮询。
- 0.2.4 框架缓存修复：betterSidebar 改为**软等待**（最多 30s），不再因服务晚就绪而卡住 web boot。
- 0.2.3 新增 `screenshots.json` 与 4 张效果图（`docs/screenshots/`），插件市场卡片与详情页可显示配图；README 补英文段与效果图区；`files` 白名单纳入 `docs` 与 `screenshots.json`，npm 包同步携带配图。
- 0.2.2 新增 locale 元数据（市场显示名/描述）。
- 0.2.1 修复删除 ✕ 无效（删除/新增/移动改用树根解包，传整库对象也能操作）；新增「收起全部 / 展开全部」一键折叠；脱敏后发布。
- 0.2.0 移除独立「书签」Tab 与侧栏入口；改为纯内置浏览器增强（工具栏注入 + 地址栏搜索 + 面板内管理/导入）。
- 0.1.0 首版：搜索引擎 + 书签收藏 + 多级文件夹（拖拽）+ 导入书签 HTML。

MIT License.
