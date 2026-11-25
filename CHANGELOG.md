# Changelog

## 0.2.15 (2026-11-25) — 书签/历史改存用户级固定目录，卸载重装不再丢

### 修复
- 宿主端 `lib/index.js` 不再把 `store.json` / `history.json` 放在插件包内 `data/`，改到 `$DSH_HOME/browser-hub-data/`（官方端 = `~/.dsh-official/browser-hub-data`，社区版/NEXT = `~/.dsh/browser-hub-data`）。
- 首次加载自动把旧包内 `data/store.json`、`data/history.json` 复制到新目录；目标已存在时不覆盖，保护较新的数据。
- 种子文件 `defaults.json` 仍随包发布。

## 0.2.14 (2026-11-25) — ★ 改为 GitHub Star 按钮

### 修复
- 底部 ★ 不再是“收藏当前网页”（地址栏为空时会误显示“先打开网页”），改为 **去 GitHub 给插件点 Star**：点击直接打开 `https://github.com/loyalchiiina/dsh-browser-hub`。
- 图标换成 GitHub octicon 星形 SVG（金色），替代丑陋的文字 ★。

## 0.2.13 (2026-11-25) — 书签面板底部加 ★ 星标按钮

### 新增
- 书签面板底部新增 **★** 按钮（金色），点击与「收藏」一样把当前网页加入书签，成功后短暂显示 ✓。
- 「收藏」文字按钮与 ★ 按钮共用同一段收藏逻辑，不产生重复代码或重复条目。

## 0.2.12 (2026-11-25) — 双端兼容：dsh-better-sidebar 改为可选

### 修复
- 移除 `peerDependencies` 对 `dsh-better-sidebar` 的硬声明，官方端 / NEXT 端均可安装，不再受是否安装侧边栏增强插件影响。
- `lib/client.js` 不再无条件 `ctx.inject(["betterSidebar"], ...)`：宿主未提供该服务时立即激活内置浏览器工具栏（搜索引擎下拉、书签面板、历史、导入、更新提醒）；宿主提供时保持原有响应式等待语义。
- 删除「等不到 betterSidebar 就 30 秒后静默跳过」的逻辑，避免官方端插件 entry 永久 pending / 界面无注入。

## 0.2.11 (2026-11-21) — ⟳ 自动更新提醒真正落到工具栏

### 新增
- **工具栏 ⟳ 独立图标按钮**：与引擎下拉、🔖 同组同形，不再只存在于未注册的旧 `HubTab` 里；启动 3 秒后自动查一次，打开面板时若距上次检查超过 6 小时补查一次（不轮询、不打扰）。
- **状态齐全**（技能口径四态 = 检查中 / 有新版本 / 已最新 / 失败，另有 idle 常态）：
  - idle：`⟳`，tooltip「检查更新（当前 vX.Y.Z）」
  - checking：图标旋转 + `opacity .6` + `cursor:progress`，tooltip「检查中…」
  - hasUpdate：图标变 `↓`、蓝底高亮、**右上角红点**，tooltip「有新版本 vX.Y.Z，点击安装（装完需彻底退出 DSH 再启动）」
  - latest：绿点，`2s` 后自动淡出，tooltip「已是最新（vX.Y.Z）」
  - failed：红字，tooltip「检查更新失败：<原因>（点击重试）」
- **点「有新版本」**：优先委托技能浏览器的 `window.__dshUpdClick`；宿主没装它时降级为底部轻提示，明确写「装完必须彻底退出 DSH 客户端再重新启动才会生效」——不会点了毫无反应。
- **宿主端新增 `GET /browser-hub/check-update`**：由宿主去查 `https://registry.npmjs.org/dsh-browser-hub/latest`（客户端不直连外网，保持根相对路径），8 秒超时，结果缓存 6 小时，`?force=1` 强刷。网络不通时明确返回 `ok:false` + 原因，**绝不静默当成「已是最新」**。

### 生效方式
- 宿主端多了一条路由 + 客户端多了按钮：**彻底退出 DSH 客户端再启动**（宿主是 Node 进程，无热重载）。
- 只硬刷新的话，按钮能出现，但会显示「检查更新失败：HTTP 404」——那是旧宿主进程里还没有 `/check-update`，属预期现象，重启后自动消失。

## 0.2.10 (2026-11-21) — 真正修掉「面板收不回去」+ 加确定关闭出口

### 根因（0.2.9 只修了其中一条路径）
`openPopover` 是异步的（要先 `await tbLoad()`）。快速连点 🔖 时，两下点击都在 await 之前看到 `TB.popover === null`，于是**各建一个面板**；只有后完成的那个能存进 `TB.popover`，先建的那个**失去引用的孤儿会永久固定在屏幕上**。点 🔖 只关掉可追踪的那个，剩下的仍挂在那里 —— 用户看到的就是「怎么都收不回去」。宿主重建工具栏时同理也会叠。

### 修复
- **互斥锁**：`TB.opening` 标志，异步打开期间再点直接忽略；`openPopover` 开头先 `closePopover()` 清场。
- **孤儿清道夫** `purgeOrphanPopovers()`：扫掉所有不等于 `TB.popover` 的 `.dbh-pop`，在 `togglePopover`、`openPopover`、每次 `scanToolbars()`（约 150ms 一次）都执行，历史遗留的孤儿也会被自动回收。
- **工具栏幂等判定改准**：原来只看 `data-dshbh="1"`，React 若只清掉我们的子节点而保留 toolbar，属性还在按钮却没了；改为「属性 + `.dbh-tb-group` 真实存在」双判，并清理重复注入的旧组，不再出现两个 🔖。
- **mousedown 监听改同步挂载**（原来在 `setTimeout` 里，快速连点会漏掉关闭时机）。
- **两个确定的关闭出口**：页签行右侧新增 ✕（`margin-left:auto` 右对齐），以及面板内 **Esc** 关闭。
- **点网页区域也能关**：webview 的鼠标事件落在 guest 内不冒泡到 document，改监听 webview 的 `focus` 事件顺手关面板。

### 文档更正（发布前一致性审计发现）
0.2.7/0.2.8 宣称的 **⟳ 检查更新** 只实现在**未注册的旧 `HubTab` 组件**里，活动工具栏 `decorateToolbar` 从未渲染它 —— 用户按文档找不到按钮。同批还发现三项同类失真：「面板内可移动」（`moveNode` 仅死代码调用）、「🔖 红点提示收藏状态」（全文无 dot/badge 逻辑）、「粘贴 HTML 内容即可导入」（活动 UI 只有 `<input type="file">`）。本次一并从 README 删除，按实际保留（重命名 / 删除 / 选择 .html 文件导入）；`locale` 与 `package.json` description 补上「浏览历史」，`locale` 版本前缀由 `v0.2.2` 改为 `v0.2.10`，安装示例由 `0.2.8` 改为 `0.2.10`。⟳ 四态更新提醒待 0.2.11 搬到工具栏并自建检查。

客户端改动 → **Ctrl+Shift+R** 硬刷新即可，本次**不需要重启 DSH**（宿主端 `lib/index.js` 仅版本号变化）。

## 0.2.9 (2026-11-21) — 修复「面板收不起来」+ 新增浏览历史

### 修复：点 🔖 关不掉面板（收缩不回去）
- 根因：`onDocDown` 用**对象引用**比较 `e.target !== TB.popoverBtn`。宿主 React 重建工具栏后，新按钮节点已不是记录的旧节点，于是 mousedown 先 `closePopover()`，紧接同一按钮的 `click` 又 `togglePopover()` 见面板为空立刻重开 —— 表现为「刚关掉又弹回来，怎么都收不起来」。
- 改为按语义判定：新增 `isHubControl(el)`，用 `el.closest(".dbh-tb-btn, .dbh-tb-group")` 识别全部插件控件，命中即不关面板。
- 加自愈：`decorateToolbar` 与 `togglePopover` 检测到 `TB.popover`/`TB.popoverBtn` 已脱离文档就先清空引用，避免孤儿引用把状态锁死。
- 按钮量不到尺寸（宽高皆 0）时退回用工具栏 rect 定位，防止面板飘到左上角。

### 新增：浏览历史（书签 / 历史 胶囊页签同页切换）
- 面板顶部新增「书签 / 历史」两个胶囊页签，同页切换，不跳转、不滚动。
- 历史自动记录：监听侧边栏浏览器所有 `webview` 的 `did-navigate`、`did-navigate-in-page`、`did-finish-load`、`page-title-updated`，落盘到插件 `data/history.json`（上限 800 条，同 URL 去重提前）。
- 历史页：搜索框按标题/网址过滤、显示「共 N 条」、每条显示 `域名 · 相对时间`（刚刚 / n 分钟前 / n 小时前 / n 天前 / M月D日），点击直接用浏览器打开，右侧 ✕ 删单条，底部「清空历史」需二次点击确认。
- 搜索框提示语随页签切换；历史页隐藏书签专用按钮组（展开全部 / 收藏 / ＋书签 / ＋文件夹 / 导入）。

### 说明：网页登录态（cookie）为什么还没法靠插件保住
数据库根因在宿主，不在本插件：宿主主进程 `/lib/browser-guests-D7lKsFoG.js` 的 `DesktopBrowserGuests.acquire()` 生成的分区名是 `dsh-sidebar-browser-${randomUUID()}`，**没有 `persist:` 前缀**，Electron 按内存 session 处理，DSH 一退出 cookie 即销毁；且 `will-attach-webview` 强校验 `params.partition !== lease.partition` 就 `preventDefault()`，插件无法替换分区。要让 bilibili 等免重登，只能改宿主（把分区改成稳定的 `persist:` 名）——这属于改 DSH 本体，需单独评估。

## 0.2.8 (2026-11-13) — 文档补全：快速上手 + 版本提醒

### 文档补全（功能一致性审计）
- 新增「快速上手（5 步）」：自带浏览器 Tab、收藏、地址栏搜索、引擎下拉（含自定义 `{q}`）、导入 360/Chrome/Edge 书签 HTML。
- 新增「版本提醒（⟳ 检查更新）」四态表 + 「再点一下装进 desktop profile、装完需彻底退出 DSH 再启动」。
- 版本段补齐 0.2.4 ~ 0.2.7 四条。
- 安装段去掉 `link:` 教法（会触发 DSH 安装恢复死循环），改为真实副本 + 依赖版本号 + `dsh.profile.bundles`。

## 0.2.7 (2026-11-12) — 工具栏新增 ⟳ 检查更新

- 书签管理工具栏（＋书签 / ＋文件夹 / 导入书签）后面新增 ⟳：查 npm 最新版 → 有新版变蓝「更新到 vX」→ 再点一键安装到 desktop profile。
- 复用技能浏览器的全局更新委托（window.__dshUpdClick）。
- 纯客户端改动：Ctrl+Shift+R 硬刷新生效。

## 0.2.6
- 修复「启动正常但侧边栏功能失效」：上一版用 setInterval 轮询后重入 apply，而 apply 已经在 fiber 激活完成后才调用，注册被静默吞掉。现改用 cordis 官方响应式注入 ctx.inject(["betterSidebar"], cb)，服务就绪时自行执行注册。

## 0.2.5
- 启动稳定性：服务从 declared inject 移除（避免 pending 卡住 web boot），改为安全取值器 __safeSvc 加最多 30s 轮询。

## 0.2.4
- 框架缓存修复：betterSidebar 改为软等待（最多 30s），不再因服务晚就绪而卡住 web boot。
