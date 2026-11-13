# Changelog

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
