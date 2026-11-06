# 侧边栏浏览器搜索引擎以及书签功能补丁插件（dsh-browser-hub）

内置「浏览器」Tab 增强 —— the agent harness 桌面端右侧边栏**自带浏览器**的伴随插件。

> 只增强**自带的「浏览器」Tab**，**不再单独新增标签页**（独立的「书签」Tab 与左侧边栏入口已移除）。

在自带浏览器工具栏右侧加入：

- 🔎 **搜索引擎下拉**：百度 / Bing / Google / 搜狗 / 360 搜索 / 自定义（`{q}` 占位）
- 🔖 **书签按钮**：点开面板可实时搜索书签、点开、＋收藏当前页、＋书签、＋文件夹、导入、编辑 / 删除

**地址栏增强**：在自带浏览器地址栏输入**非网址的关键词**（如「你好」）回车 → 用所选引擎搜索；输入真网址 / 域名则照常打开。

所有数据保存在本插件目录的 `data/store.json`，本地保存、不联网、不上传。

## 安装（桌面端 desktop profile）

> 桌面 profile 由 Electron 独占管理，只能用「手改 package.json + pnpm install」的方式装。

1. 把本目录放到 `~/.dsh/local-plugins/dsh-browser-hub`。
2. 编辑 `~/.dsh/profiles/desktop/package.json`：
   - `dependencies` 增加：
     ```json
     "dsh-browser-hub": "link:C:/Users/<你>/.dsh/local-plugins/dsh-browser-hub"
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

- 0.2.1 修复删除 ✕ 无效（删除/新增/移动改用树根解包，传整库对象也能操作）；新增「收起全部 / 展开全部」一键折叠；脱敏后发布。
- 0.2.0 移除独立「书签」Tab 与侧栏入口；改为纯内置浏览器增强（工具栏注入 + 地址栏搜索 + 面板内管理/导入）。
- 0.1.0 首版：搜索引擎 + 书签收藏 + 多级文件夹（拖拽）+ 导入书签 HTML。

MIT License.
