/**
 * dsh-browser-hub — client bundle（手写，无构建步骤）v0.1.0
 *
 * 运行时增强内置「浏览器」Tab：工具栏注入搜索引擎下拉 + 🔖 书签面板；地址栏输入关键词回车即搜索（不再单独新增标签页）
 * + 导入 360 / Chrome / Edge 导出的书签 HTML；点条目用侧边栏原生浏览器打开。
 * 全部数据经宿主端 /browser-hub/* 路由读写（根相对路径 fetch）。
 *
 * ⚠️ 打开网页到宿主原生浏览器 Tab 的唯一正确方式（'browser' 不在插件 registry 里）：
 *     ctx.get('sidebarRight').openTab('browser', { params: { url } })
 *
 * @module dsh-browser-hub/client
 */
window.__ModuleLoader__.load({
  id: "dsh-browser-hub",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo } = React;

    const NAME = "dsh-browser-hub";
    const VERSION = "0.2.1";
    const ROUTE = "/browser-hub";

    /* ============================ 搜索引擎 ============================ */
    const ENGINES = [
      { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd={q}" },
      { id: "bing", name: "Bing", url: "https://www.bing.com/search?q={q}" },
      { id: "google", name: "Google", url: "https://www.google.com/search?q={q}" },
      { id: "sogou", name: "搜狗", url: "https://www.sogou.com/web?query={q}" },
      { id: "so360", name: "360搜索", url: "https://www.so.com/s?q={q}" },
      { id: "custom", name: "自定义", url: "" },
    ];

    function engineById(id) {
      return ENGINES.find((e) => e.id === id) || ENGINES[0];
    }

    function buildSearchUrl(settings, q) {
      const e = engineById(settings && settings.engine);
      let tpl = e.id === "custom" ? (settings && settings.customEngine) || "" : e.url;
      if (!tpl || tpl.indexOf("{q}") < 0) tpl = ENGINES[0].url;
      return tpl.replace(/\{q\}/g, encodeURIComponent(q));
    }

    /* ============================ 基础工具 ============================ */
    const uid = (p) => (p || "n") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function hashCode(s) {
      let hash = 0;
      for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(hash);
    }
    function favColor(s) {
      const hue = hashCode(String(s || "?")) % 360;
      return "hsl(" + hue + ",58%,52%)";
    }
    function initial(s) {
      const t = String(s || "?").trim();
      return t ? t.slice(0, 1).toUpperCase() : "?";
    }
    function normalizeHost(url) {
      try {
        return new URL(url).host.replace(/^www\./, "");
      } catch (e) {
        return String(url || "").replace(/^https?:\/\//i, "").split("/")[0];
      }
    }
    function normalizeUrl(u) {
      u = String(u || "").trim();
      if (!u) return "";
      if (/^https?:\/\//i.test(u)) return u;
      if (!/\s/.test(u) && /^[^\s]+\.[^\s]+$/.test(u)) return "https://" + u;
      return u;
    }

    async function getJson(url) {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    }
    async function postJson(url, obj) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(obj),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    }

    /* ============================ 书签树纯函数（可测试） ============================ */
    function findLocation(node, id, parent) {
      if (!node || typeof node !== "object") return null;
      if (node.id === id) return { node: node, parent: parent || null };
      if (Array.isArray(node.children)) {
        for (const c of node.children) {
          const r = findLocation(c, id, node);
          if (r) return r;
        }
      }
      return null;
    }

    function isDescendant(node, id) {
      if (!node || !Array.isArray(node.children)) return false;
      for (const c of node.children) {
        if (c.id === id || isDescendant(c, id)) return true;
      }
      return false;
    }

    function treeOf(x) {
      return x && typeof x === "object" && x.tree && x.tree.type === "folder" ? x.tree : x;
    }

    function addNode(root, parentId, newNode) {
      const r = treeOf(root);
      const loc = parentId && parentId !== "root" ? findLocation(r, parentId, null) : { node: r };
      if (!loc || !loc.node || loc.node.type !== "folder") return false;
      if (!Array.isArray(loc.node.children)) loc.node.children = [];
      loc.node.children.push(newNode);
      return true;
    }

    function removeNode(root, id) {
      const loc = findLocation(treeOf(root), id, null);
      if (!loc || !loc.parent || !Array.isArray(loc.parent.children)) return null;
      const arr = loc.parent.children;
      const i = arr.indexOf(loc.node);
      if (i >= 0) arr.splice(i, 1);
      return loc.node;
    }

    function moveNode(root, dragId, targetFolderId) {
      if (!dragId || !targetFolderId || dragId === targetFolderId) return false;
      const r = treeOf(root);
      const dl = findLocation(r, dragId, null);
      const tl = findLocation(r, targetFolderId, null);
      if (!dl || !dl.parent || !tl || !tl.node || tl.node.type !== "folder") return false;
      // 不能把文件夹拖进它自己或它的子孙里
      if (dl.node.type === "folder" && (dl.node.id === targetFolderId || isDescendant(dl.node, targetFolderId))) return false;
      const arr = dl.parent.children;
      const i = arr.indexOf(dl.node);
      if (i < 0) return false;
      arr.splice(i, 1);
      if (!Array.isArray(tl.node.children)) tl.node.children = [];
      tl.node.children.push(dl.node);
      return true;
    }

    function collectBookmarks(node, out) {
      out = out || [];
      if (!node || typeof node !== "object") return out;
      if (node.type === "bookmark") out.push(node);
      else if (Array.isArray(node.children)) node.children.forEach((c) => collectBookmarks(c, out));
      return out;
    }

    function countBookmarks(node) {
      if (!node || typeof node !== "object") return 0;
      if (node.type === "bookmark") return 1;
      return Array.isArray(node.children) ? node.children.reduce((a, c) => a + countBookmarks(c), 0) : 0;
    }

    function flattenFolders(node, depth, out) {
      out = out || [];
      depth = depth || 0;
      if (!node || node.type !== "folder") return out;
      out.push({ id: node.id, name: node.name, depth: depth });
      if (Array.isArray(node.children)) {
        node.children.forEach((c) => {
          if (c.type === "folder") flattenFolders(c, depth + 1, out);
        });
      }
      return out;
    }

    function ensureIds(node) {
      if (!node || typeof node !== "object") return;
      if (!node.id) node.id = uid(node.type === "folder" ? "f" : "b");
      if (Array.isArray(node.children)) node.children.forEach(ensureIds);
    }

    function normalizeStore(d) {
      const s = d && typeof d === "object" && !Array.isArray(d) ? d : {};
      if (!s.settings || typeof s.settings !== "object") s.settings = { engine: "baidu", customEngine: "" };
      if (!s.tree || typeof s.tree !== "object" || s.tree.type !== "folder") {
        s.tree = { id: "root", type: "folder", name: "全部书签", children: [] };
      }
      if (!Array.isArray(s.tree.children)) s.tree.children = [];
      s.tree.id = s.tree.id || "root";
      if (!s.version) s.version = 1;
      ensureIds(s.tree);
      return s;
    }

    /* ============================ 书签 HTML 解析（360/Chrome/Edge） ============================ */
    function htmlClean(s) {
      return String(s || "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();
    }

    /**
     * Netscape Bookmark 文件格式解析：<DT><H3>文件夹</H3> 之后紧跟 <DL> 表示进入该文件夹；
     * <DT><A HREF="url">名称</A> 为书签；</DL> 退出当前文件夹。
     * 返回一个 folder 根节点（name='导入的书签'）。
     */
    function parseBookmarkHtml(text) {
      const root = { id: uid("f"), type: "folder", name: "导入的书签", children: [] };
      const stack = [root];
      let pending = null;
      const cur = () => stack[stack.length - 1];
      const re = /<DT>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<DT>\s*<A\s[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<DL[^>]*>|<\/DL>/gi;
      let m;
      while ((m = re.exec(String(text || ""))) !== null) {
        const tag = m[0];
        if (/^<DL/i.test(tag)) {
          if (pending) {
            stack.push(pending);
            pending = null;
          }
        } else if (/^<\/DL/i.test(tag)) {
          if (stack.length > 1) stack.pop();
        } else if (m[1] !== undefined) {
          const f = { id: uid("f"), type: "folder", name: htmlClean(m[1]) || "文件夹", children: [] };
          cur().children.push(f);
          pending = f;
        } else if (m[2] !== undefined) {
          const linkUrl = m[2];
          if (/^javascript:/i.test(linkUrl)) continue;
          const nm = htmlClean(m[3]) || linkUrl;
          cur().children.push({ id: uid("b"), type: "bookmark", name: nm, url: linkUrl });
        }
      }
      return root;
    }

    /* ============================ 打开网页（侧边栏原生浏览器） ============================ */
    function openUrl(ctx, url) {
      url = String(url || "").trim();
      if (!url) return false;
      // 唯一正确方式：宿主原生 browser Tab
      try {
        const sr = ctx && ctx.get && ctx.get("sidebarRight");
        if (sr && typeof sr.openTab === "function") {
          sr.openTab("browser", { params: { url: url } });
          return true;
        }
      } catch (e) {
        /* 宿主没有 browser tab（被设置禁用）时会抛错，降级处理 */
      }
      // 兜底：外部打开
      try {
        window.open(url, "_blank");
        return true;
      } catch (e) {
        /* ignore */
      }
      return false;
    }

    /* ============================ 样式（主题无关，仅用半透明中性色） ============================ */
    function ensureStyles() {
      try {
        if (typeof document === "undefined" || document.getElementById("dbh-style")) return;
        const css = [
          ".dbh-root{position:relative;height:100%;display:flex;flex-direction:column;font-size:13px;color:inherit;overflow:hidden}",
          ".dbh-top{padding:10px 10px 8px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid rgba(128,128,128,.22)}",
          ".dbh-search{display:flex;gap:6px;align-items:center}",
          ".dbh-search select{padding:7px 6px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:rgba(127,127,127,.08);color:inherit;outline:none;font-size:12px;max-width:92px}",
          ".dbh-search input{flex:1;min-width:0;padding:7px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:rgba(127,127,127,.08);color:inherit;outline:none;font-size:13px}",
          ".dbh-search input:focus{border-color:#4d6bfe}",
          ".dbh-btn{padding:6px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:rgba(127,127,127,.08);color:inherit;cursor:pointer;font-size:12px;white-space:nowrap}",
          ".dbh-btn:hover{background:rgba(77,107,254,.14);border-color:#4d6bfe}",
          ".dbh-btn.pri{background:#4d6bfe;border-color:#4d6bfe;color:#fff}",
          ".dbh-btn.pri:hover{filter:brightness(1.05)}",
          ".dbh-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
          ".dbh-body{flex:1;overflow:auto;padding:6px 6px 24px}",
          ".dbh-folder{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;cursor:pointer;user-select:none}",
          ".dbh-folder:hover{background:rgba(127,127,127,.1)}",
          ".dbh-folder.drop{outline:2px dashed #4d6bfe;outline-offset:-2px;background:rgba(77,107,254,.12)}",
          ".dbh-chev{width:14px;text-align:center;opacity:.65;transition:transform .12s;font-size:10px}",
          ".dbh-chev.open{transform:rotate(90deg)}",
          ".dbh-fname{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          ".dbh-count{font-size:11px;opacity:.55;padding:0 4px}",
          ".dbh-children{margin-left:12px;border-left:1px dashed rgba(128,128,128,.25);padding-left:4px}",
          ".dbh-bm{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer}",
          ".dbh-bm:hover{background:rgba(127,127,127,.1)}",
          ".dbh-fav{width:18px;height:18px;border-radius:5px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;line-height:1}",
          ".dbh-bm-main{flex:1;min-width:0}",
          ".dbh-bm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          ".dbh-bm-host{font-size:11px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          ".dbh-act{display:flex;gap:4px;opacity:0;transition:opacity .1s}",
          ".dbh-bm:hover .dbh-act,.dbh-folder:hover .dbh-act{opacity:1}",
          ".dbh-mini{font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;cursor:pointer;white-space:nowrap}",
          ".dbh-mini:hover{background:rgba(77,107,254,.16);border-color:#4d6bfe}",
          ".dbh-mini.danger:hover{background:rgba(229,72,77,.18);border-color:#e5484d}",
          ".dbh-empty{padding:30px 16px;text-align:center;opacity:.55;line-height:1.8;font-size:12px}",
          ".dbh-msg{padding:2px 2px;font-size:11px;color:#e5484d}",
          ".dbh-modal{position:absolute;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:14px;z-index:20}",
          ".dbh-card{width:100%;max-width:380px;background:#fff;color:#222;border-radius:12px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:10px;max-height:100%;overflow:auto}",
          ".dbh-card h3{margin:0;font-size:14px}",
          ".dbh-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#444}",
          ".dbh-field input,.dbh-field select,.dbh-field textarea{padding:7px 9px;border-radius:8px;border:1px solid #d5d8de;background:#fff;color:#222;font-size:12px;outline:none;font-family:inherit}",
          ".dbh-field textarea{min-height:96px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}",
          ".dbh-card-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}",
          ".dbh-hint{font-size:11px;opacity:.6;line-height:1.6}",
        ].join("\n");
        const el = document.createElement("style");
        el.id = "dbh-style";
        el.textContent = css;
        document.head.appendChild(el);
      } catch (e) {
        /* ignore */
      }
    }

    /* ============================ Tab 图标 ============================ */
    function tabIcon(size) {
      size = size || 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
        h("circle", { cx: 12, cy: 12, r: 9 }),
        h("path", { d: "M3 12h18" }),
        h("path", { d: "M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" }),
      );
    }

    /* ============================ 弹窗表单 ============================ */
    function EditForm(props) {
      const dialog = props.dialog;
      const store = props.store;
      const [name, setName] = useState(dialog.name || "");
      const [url, setUrl] = useState(dialog.url || "");
      const [folderId, setFolderId] = useState(dialog.folderId || "root");
      const [parentId, setParentId] = useState(dialog.parentId || "root");
      const [text, setText] = useState("");
      const folders = useMemo(() => flattenFolders(store ? store.tree : null), [store]);

      function folderOptions(selected, onPick) {
        return h(
          "select",
          { value: selected, onChange: (e) => onPick(e.target.value) },
          folders.map((f) =>
            h(
              "option",
              { key: f.id, value: f.id },
              new Array(f.depth + 1).join("　") + (f.id === "root" ? "（根）" : f.name),
            ),
          ),
        );
      }

      const close = () => props.onCancel();

      if (dialog.mode === "import") {
        return h(
          "div",
          { className: "dbh-modal", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
          h(
            "div",
            { className: "dbh-card" },
            h("h3", null, "导入书签（360 / Chrome / Edge 导出的 HTML）"),
            h("div", { className: "dbh-hint" }, "在浏览器里「书签管理 → 导出书签」得到 .html 文件，选择它或把内容粘贴到下面。"),
            h(
              "div",
              { className: "dbh-field" },
              h("input", {
                type: "file",
                accept: ".html,.htm,text/html",
                onChange: (e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setText(String(r.result || ""));
                  r.readAsText(f);
                },
              }),
            ),
            h(
              "div",
              { className: "dbh-field" },
              h("textarea", {
                value: text,
                placeholder: '<DL><DT><A HREF="https://...">名称</A> ...',
                onChange: (e) => setText(e.target.value),
              }),
            ),
            h(
              "div",
              { className: "dbh-card-actions" },
              h("button", { className: "dbh-btn", onClick: close }, "取消"),
              h("button", { className: "dbh-btn pri", onClick: () => props.onSubmit({ html: text }) }, "导入"),
            ),
          ),
        );
      }

      if (dialog.mode === "folder") {
        return h(
          "div",
          { className: "dbh-modal", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
          h(
            "div",
            { className: "dbh-card" },
            h("h3", null, "新建文件夹"),
            h("div", { className: "dbh-field" }, h("label", null, "名称"), h("input", { value: name, autoFocus: true, onChange: (e) => setName(e.target.value) })),
            h("div", { className: "dbh-field" }, h("label", null, "放在"), folderOptions(parentId, setParentId)),
            h(
              "div",
              { className: "dbh-card-actions" },
              h("button", { className: "dbh-btn", onClick: close }, "取消"),
              h("button", { className: "dbh-btn pri", onClick: () => props.onSubmit({ name: name, parentId: parentId }) }, "创建"),
            ),
          ),
        );
      }

      // bookmark / edit
      const isEdit = dialog.mode === "edit";
      return h(
        "div",
        { className: "dbh-modal", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
        h(
          "div",
          { className: "dbh-card" },
          h("h3", null, isEdit ? "编辑书签" : "新建书签"),
          h("div", { className: "dbh-field" }, h("label", null, "名称"), h("input", { value: name, autoFocus: true, placeholder: "例如：百度首页", onChange: (e) => setName(e.target.value) })),
          h("div", { className: "dbh-field" }, h("label", null, "网址"), h("input", { value: url, placeholder: "https://www.baidu.com", onChange: (e) => setUrl(e.target.value) })),
          isEdit ? null : h("div", { className: "dbh-field" }, h("label", null, "放在"), folderOptions(folderId, setFolderId)),
          h(
            "div",
            { className: "dbh-card-actions" },
            h("button", { className: "dbh-btn", onClick: close }, "取消"),
            h("button", { className: "dbh-btn pri", onClick: () => props.onSubmit({ name: name, url: url, folderId: folderId }) }, isEdit ? "保存" : "创建"),
          ),
        ),
      );
    }

    /* ============================ 主面板 ============================ */
    function HubTab(props) {
      const ctx = props.ctx;
      const [store, setStore] = useState(null);
      const [status, setStatus] = useState("loading");
      const [err, setErr] = useState("");
      const [q, setQ] = useState("");
      const [expanded, setExpanded] = useState({});
      const [dialog, setDialog] = useState(null);
      const [dragId, setDragId] = useState(null);
      const [dragOver, setDragOver] = useState(null);
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        ensureStyles();
        let alive = true;
        getJson(ROUTE + "/data")
          .then((r) => {
            if (!alive) return;
            const d = r && r.data ? r.data : r;
            setStore(normalizeStore(d));
            setStatus("ready");
          })
          .catch((e) => {
            if (!alive) return;
            setErr("读取书签失败：" + ((e && e.message) || e));
            setStatus("error");
          });
        return () => {
          alive = false;
        };
      }, []);

      const clone = () => JSON.parse(JSON.stringify(store));

      function persist(next) {
        setStore(next);
        setBusy(true);
        postJson(ROUTE + "/data", next)
          .then(() => setErr(""))
          .catch((e) => setErr("保存失败：" + ((e && e.message) || e)))
          .then(() => setBusy(false));
      }

      function setSetting(patch) {
        if (!store) return;
        const n = clone();
        n.settings = Object.assign({}, n.settings, patch);
        persist(n);
      }

      function toggle(id) {
        setExpanded((prev) => {
          const open = prev[id] !== false;
          const n = Object.assign({}, prev);
          if (open) n[id] = false;
          else delete n[id];
          return n;
        });
      }

      const results = useMemo(() => {
        const t = (q || "").trim().toLowerCase();
        if (!t) return null;
        if (!store) return [];
        return collectBookmarks(store.tree).filter(
          (b) => String(b.name || "").toLowerCase().indexOf(t) >= 0 || String(b.url || "").toLowerCase().indexOf(t) >= 0,
        );
      }, [q, store]);

      function doOpen(url) {
        openUrl(ctx, url);
      }

      function doSearch() {
        const raw = (q || "").trim();
        if (!raw) return;
        let target;
        if (/^https?:\/\//i.test(raw)) target = raw;
        else if (!/\s/.test(raw) && /^[^\s]+\.[^\s]+$/.test(raw)) target = "https://" + raw;
        else target = buildSearchUrl(store && store.settings, raw);
        doOpen(target);
      }

      function newBookmark() {
        setDialog({ mode: "bookmark", name: "", url: "", folderId: "root" });
      }
      function newFolder() {
        setDialog({ mode: "folder", name: "", parentId: "root" });
      }
      function editBookmark(b) {
        setDialog({ mode: "edit", id: b.id, name: b.name || "", url: b.url || "" });
      }
      function openImport() {
        setDialog({ mode: "import" });
      }

      function doDelete(node) {
        const extra = node.type === "folder" ? "（含其中书签）" : "";
        if (!window.confirm("删除「" + (node.name || node.url || "") + "」" + extra + "？")) return;
        const n = clone();
        removeNode(n, node.id);
        persist(n);
      }

      function commitDialog(v) {
        if (!store) return;
        const n = clone();
        if (dialog.mode === "bookmark") {
          const url = normalizeUrl(v.url);
          if (!url) {
            setErr("网址不能为空");
            return;
          }
          const name = String(v.name || "").trim() || url;
          addNode(n, v.folderId || "root", { id: uid("b"), type: "bookmark", name: name, url: url });
        } else if (dialog.mode === "folder") {
          const name = String(v.name || "").trim();
          if (!name) {
            setErr("文件夹名不能为空");
            return;
          }
          addNode(n, v.parentId || "root", { id: uid("f"), type: "folder", name: name, children: [] });
        } else if (dialog.mode === "edit") {
          const loc = findLocation(n, dialog.id, null);
          if (loc) {
            if (String(v.name || "").trim()) loc.node.name = String(v.name).trim();
            const u = normalizeUrl(v.url);
            if (u) loc.node.url = u;
          }
        } else if (dialog.mode === "import") {
          const html = String(v.html || "");
          if (!html.trim()) {
            setErr("请先粘贴或选择书签 HTML");
            return;
          }
          const parsed = parseBookmarkHtml(html);
          parsed.name = "导入的书签 " + new Date().toLocaleDateString();
          n.tree.children.push(parsed);
        }
        setDialog(null);
        persist(n);
      }

      function onDragStart(e, node) {
        setDragId(node.id);
        try {
          e.dataTransfer.setData("text/plain", node.id);
          e.dataTransfer.effectAllowed = "move";
        } catch (_) {
          /* ignore */
        }
      }
      function onDropFolder(e, folder) {
        e.preventDefault();
        e.stopPropagation();
        let id = dragId;
        if (!id) {
          try {
            id = e.dataTransfer.getData("text/plain");
          } catch (_) {
            id = "";
          }
        }
        setDragOver(null);
        setDragId(null);
        if (!id || !store) return;
        const n = clone();
        if (moveNode(n, id, folder.id)) persist(n);
      }

      function renderNode(node, depth) {
        if (!node || typeof node !== "object") return null;
        if (node.type === "folder") {
          const open = expanded[node.id] !== false;
          const cnt = countBookmarks(node);
          return h(
            "div",
            { key: node.id },
            h(
              "div",
              {
                className: "dbh-folder" + (dragOver === node.id ? " drop" : ""),
                title: node.name,
                onClick: () => toggle(node.id),
                onDragOver: (e) => {
                  e.preventDefault();
                  setDragOver(node.id);
                },
                onDragLeave: () => {
                  if (dragOver === node.id) setDragOver(null);
                },
                onDrop: (e) => onDropFolder(e, node),
              },
              h("span", { className: "dbh-chev" + (open ? " open" : "") }, "▶"),
              h("span", { className: "dbh-fname" }, node.name),
              h("span", { className: "dbh-count" }, String(cnt)),
              h(
                "div",
                { className: "dbh-act" },
                h("button", {
                  className: "dbh-mini",
                  title: "在此文件夹新建书签",
                  onClick: (e) => {
                    e.stopPropagation();
                    setDialog({ mode: "bookmark", name: "", url: "", folderId: node.id });
                  },
                }, "＋书签"),
                node.id !== "root"
                  ? h("button", {
                      className: "dbh-mini danger",
                      title: "删除文件夹",
                      onClick: (e) => {
                        e.stopPropagation();
                        doDelete(node);
                      },
                    }, "删")
                  : null,
              ),
            ),
            open ? h("div", { className: "dbh-children" }, (node.children || []).map((c) => renderNode(c, depth + 1))) : null,
          );
        }
        // bookmark
        return h(
          "div",
          {
            key: node.id,
            className: "dbh-bm",
            title: node.url,
            draggable: true,
            onDragStart: (e) => onDragStart(e, node),
            onClick: () => doOpen(node.url),
          },
          h("span", { className: "dbh-fav", style: { background: favColor(node.url || node.name || "") } }, initial(node.name)),
          h(
            "div",
            { className: "dbh-bm-main" },
            h("div", { className: "dbh-bm-name" }, node.name || node.url),
            h("div", { className: "dbh-bm-host" }, normalizeHost(node.url)),
          ),
          h(
            "div",
            { className: "dbh-act" },
            h("button", {
              className: "dbh-mini",
              title: "在侧边栏浏览器打开",
              onClick: (e) => {
                e.stopPropagation();
                doOpen(node.url);
              },
            }, "打开"),
            h("button", {
              className: "dbh-mini",
              title: "编辑",
              onClick: (e) => {
                e.stopPropagation();
                editBookmark(node);
              },
            }, "编辑"),
            h("button", {
              className: "dbh-mini danger",
              title: "删除",
              onClick: (e) => {
                e.stopPropagation();
                doDelete(node);
              },
            }, "删"),
          ),
        );
      }

      if (status === "loading") {
        return h("div", { className: "dbh-root" }, h("div", { className: "dbh-empty" }, "正在读取书签…"));
      }
      if (status === "error" && !store) {
        return h(
          "div",
          { className: "dbh-root" },
          h("div", { className: "dbh-empty" }, "读取失败：" + err, h("div", { style: { marginTop: 10 } }, h("button", { className: "dbh-btn", onClick: () => location.reload() }, "重试"))),
        );
      }

      const s = (store && store.settings) || { engine: "baidu", customEngine: "" };
      const children = store && store.tree && store.tree.children ? store.tree.children : [];

      return h(
        "div",
        { className: "dbh-root" },
        h(
          "div",
          { className: "dbh-top" },
          h(
            "div",
            { className: "dbh-search" },
            h(
              "select",
              { value: s.engine || "baidu", title: "搜索引擎", onChange: (e) => setSetting({ engine: e.target.value }) },
              ENGINES.map((en) => h("option", { key: en.id, value: en.id }, en.name)),
            ),
            h("input", {
              value: q,
              placeholder: "搜索或输入网址，回车打开",
              onChange: (e) => setQ(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") doSearch();
              },
            }),
            h("button", { className: "dbh-btn pri", onClick: doSearch }, "搜索"),
          ),
          s.engine === "custom"
            ? h(
                "div",
                { className: "dbh-field", style: { flexDirection: "row", alignItems: "center", gap: 6 } },
                h("span", { className: "dbh-hint", style: { whiteSpace: "nowrap" } }, "自定义引擎（用 {q} 占位）："),
                h("input", {
                  style: { flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.3)", background: "transparent", color: "inherit", outline: "none" },
                  value: s.customEngine || "",
                  placeholder: "https://example.com/search?q={q}",
                  onChange: (e) => setSetting({ customEngine: e.target.value }),
                }),
              )
            : null,
          h(
            "div",
            { className: "dbh-tools" },
            h("button", { className: "dbh-btn", onClick: newBookmark }, "＋ 书签"),
            h("button", { className: "dbh-btn", onClick: newFolder }, "＋ 文件夹"),
            h("button", { className: "dbh-btn", onClick: openImport }, "导入书签"),
            // 0.2.7 — 工具栏加 ⟳ 检查更新（复用技能浏览器全局委托 window.__dshUpdClick）
            h(
              "button",
              {
                className: "dbh-btn",
                type: "button",
                "data-dsh-upd": "dsh-browser-hub",
                title: "检查更新（有新版可一键安装到 desktop profile，装完需彻底退出 DSH 再启动）",
                onClick: (ev) => {
                  try {
                    if (window.__dshUpdClick) window.__dshUpdClick(ev.currentTarget, "dsh-browser-hub");
                  } catch (e) {}
                },
              },
              "⟳",
            ),
            h("span", { style: { flex: 1 } }),
            busy ? h("span", { className: "dbh-hint" }, "保存中…") : null,
          ),
          err ? h("div", { className: "dbh-msg" }, err) : null,
        ),
        h(
          "div",
          { className: "dbh-body" },
          results !== null
            ? results.length
              ? results.map((b) =>
                  h(
                    "div",
                    { key: b.id, className: "dbh-bm", title: b.url, onClick: () => doOpen(b.url) },
                    h("span", { className: "dbh-fav", style: { background: favColor(b.url || b.name || "") } }, initial(b.name)),
                    h(
                      "div",
                      { className: "dbh-bm-main" },
                      h("div", { className: "dbh-bm-name" }, b.name || b.url),
                      h("div", { className: "dbh-bm-host" }, normalizeHost(b.url)),
                    ),
                  ),
                )
              : h("div", { className: "dbh-empty" }, "没有匹配「" + q + "」的书签")
            : children.length
              ? children.map((c) => renderNode(c, 0))
              : h("div", { className: "dbh-empty" }, "还没有书签。点上方「＋ 书签」添加，或「导入书签」导入 360 / Chrome 的书签 HTML。"),
        ),
        dialog ? h(EditForm, { dialog: dialog, store: store, onCancel: () => setDialog(null), onSubmit: commitDialog }) : null,
      );
    }

    /* ============================ 启动按钮（侧栏脚部） ============================ */
    function openHub(ctx) {
      try {
        if (ctx.layout && ctx.layout.openRightbar) ctx.layout.openRightbar(true, false);
      } catch (e) {
        /* ignore */
      }
      try {
        if (__safeSvc(ctx, "betterSidebar") && __safeSvc(ctx, "betterSidebar").openTab) __safeSvc(ctx, "betterSidebar").openTab({ type: NAME, title: "书签", reveal: true });
      } catch (e) {
        /* ignore */
      }
    }

    function LaunchButton(props) {
      return h(
        "div",
        {
          role: "button",
          tabIndex: 0,
          title: "打开书签中心",
          onClick: () => openHub(props.ctx),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") openHub(props.ctx);
          },
          style: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 6, borderRadius: 8, cursor: "pointer", fontSize: 12 },
        },
        tabIcon(16),
        h("span", null, "书签"),
      );
    }

    /* ============================ 内置浏览器增强（工具栏注入） ============================ */
    // 内置「浏览器」Tab 是 @deepseek-ai/dsh-client-ui-sidebar-browser（编译进 app.asar 的
    // client 插件），不能改源码；这里用运行时 DOM 增强：向它的工具栏注入备用控件，并拦截
    // 地址栏回车做「搜索引擎」跳转。锚点用 CSS Modules 的语义后缀（_toolbar/_address），
    // 不用哈希前缀（ji1KYa_ 会随版本变）。
    const TB_TOOLBAR_SEL = '[class*="_toolbar"]';
    const TB_ADDRESS_SEL = 'input[class*="_address"]';

    const TB_CSS = [
      ".dbh-tb-group{display:flex;align-items:center;gap:4px;flex:none;margin-left:4px}",
      ".dbh-tb-engine{height:24px;max-width:86px;border:1px solid var(--dsw-alias-border-l2,#d0d3da);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);border-radius:6px;font-size:11px;padding:0 2px;outline:none;cursor:pointer}",
      ".dbh-tb-btn{height:24px;min-width:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,#d0d3da);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);border-radius:6px;cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center}",
      ".dbh-tb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
      ".dbh-pop{position:fixed;z-index:9999;width:330px;max-height:70vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,#d0d3da);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.28);overflow:hidden;font-size:13px}",
      ".dbh-pop-search{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08))}",
      ".dbh-pop-search input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,#d0d3da);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;outline:none;font-size:12px;box-sizing:border-box}",
      ".dbh-pop-search button{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;cursor:pointer;font-size:12px;flex:none}",
      ".dbh-pop-list{overflow:auto;padding:6px;flex:1;min-height:60px;max-height:46vh}",
      ".dbh-pop-folder{padding:4px 6px;font-size:11px;opacity:.6;font-weight:600;margin-top:4px}",
      ".dbh-pop-bm{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;overflow:hidden}",
      ".dbh-pop-bm:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
      ".dbh-pop-fav{width:16px;height:16px;border-radius:4px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;line-height:1}",
      ".dbh-pop-bm .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dbh-pop-bm .ho{font-size:10px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dbh-pop-foot{display:flex;gap:6px;padding:8px;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08))}",
      ".dbh-pop-foot button{flex:1;height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d0d3da);background:transparent;color:inherit;cursor:pointer;font-size:12px}",
      ".dbh-pop-foot button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
    ].join("\n");

    const TB = {
      ctx: null,
      observer: null,
      popover: null,
      popoverBtn: null,
      store: null,
      settings: { engine: "baidu" },
      scanTimer: null,
      _open: {},
      isOpen(id) {
        return this._open[id] !== false;
      },
      toggleFolder(id) {
        this._open[id] = this._open[id] === false ? true : false;
      },
    };

    function isLikelyUrl(s) {
      s = String(s || "").trim();
      if (!s) return false;
      if (/^https?:\/\//i.test(s)) return true;
      if (/\s/.test(s)) return false;
      return /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(s);
    }

    function ensureToolbarStyles() {
      try {
        if (typeof document === "undefined" || document.getElementById("dbh-tb-style")) return;
        const el = document.createElement("style");
        el.id = "dbh-tb-style";
        el.textContent = TB_CSS;
        document.head.appendChild(el);
      } catch (e) {
        /* ignore */
      }
    }

    async function tbLoad() {
      try {
        const r = await getJson(ROUTE + "/data");
        TB.store = normalizeStore(r && r.data ? r.data : r);
      } catch (e) {
        if (!TB.store) TB.store = normalizeStore(null);
      }
      if (TB.store && TB.store.settings) TB.settings = TB.store.settings;
      try {
        window.__dshbhSettings = TB.settings;
      } catch (e) {
        /* ignore */
      }
      return TB.store;
    }
    async function tbSave(next) {
      TB.store = next;
      if (next && next.settings) TB.settings = next.settings;
      try {
        window.__dshbhSettings = TB.settings;
      } catch (e) {
        /* ignore */
      }
      try {
        await postJson(ROUTE + "/data", next);
      } catch (e) {
        /* ignore */
      }
    }

    function findToolbars() {
      const out = [];
      try {
        const list = document.querySelectorAll(TB_TOOLBAR_SEL);
        for (let i = 0; i < list.length; i++) {
          const el = list[i];
          try {
            if (el.querySelector(TB_ADDRESS_SEL)) out.push(el);
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
      return out;
    }

    function addrOf(toolbar) {
      try {
        const inp = toolbar.querySelector(TB_ADDRESS_SEL);
        return inp ? String(inp.value || "") : "";
      } catch (e) {
        return "";
      }
    }

    function decorateToolbar(toolbar) {
      if (!toolbar || toolbar.getAttribute("data-dshbh") === "1") return;
      toolbar.setAttribute("data-dshbh", "1");
      const group = document.createElement("div");
      group.className = "dbh-tb-group";

      const sel = document.createElement("select");
      sel.className = "dbh-tb-engine";
      sel.title = "搜索引擎";
      ENGINES.forEach((en) => {
        const o = document.createElement("option");
        o.value = en.id;
        o.textContent = en.name;
        sel.appendChild(o);
      });
      sel.value = (TB.settings && TB.settings.engine) || "baidu";
      sel.addEventListener("change", async () => {
        const st = TB.store || (await tbLoad());
        const n = JSON.parse(JSON.stringify(st));
        n.settings = Object.assign({}, n.settings, { engine: sel.value });
        await tbSave(n);
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dbh-tb-btn";
      btn.title = "书签 / 搜索";
      btn.textContent = "🔖";
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePopover(TB.ctx, toolbar, btn);
      });

      group.appendChild(sel);
      group.appendChild(btn);
      toolbar.appendChild(group);
    }

    function onDocDown(e) {
      if (TB.popover && !TB.popover.contains(e.target) && e.target !== TB.popoverBtn) closePopover();
    }
    function closePopover() {
      if (TB.popover) {
        try {
          TB.popover.remove();
        } catch (e) {
          /* ignore */
        }
        TB.popover = null;
        TB.popoverBtn = null;
        try {
          document.removeEventListener("mousedown", onDocDown, true);
        } catch (e) {
          /* ignore */
        }
      }
    }
    function togglePopover(ctx, toolbar, btn) {
      if (TB.popover) {
        closePopover();
        return;
      }
      openPopover(ctx, toolbar, btn);
    }

    function bmRow(b, ctx) {
      const row = document.createElement("div");
      row.className = "dbh-pop-bm";
      const fav = document.createElement("span");
      fav.className = "dbh-pop-fav";
      fav.style.background = favColor(b.url || b.name || "");
      fav.textContent = initial(b.name);
      const main = document.createElement("div");
      main.style.minWidth = "0";
      main.style.flex = "1";
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = b.name || b.url;
      const ho = document.createElement("div");
      ho.className = "ho";
      ho.textContent = normalizeHost(b.url);
      main.appendChild(nm);
      main.appendChild(ho);
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "✎";
      editBtn.title = "重命名";
      editBtn.style.cssText = "flex:none;border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;padding:0 2px";
      editBtn.addEventListener("mousedown", (e) => e.preventDefault());
      editBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!TB.openEditor) return;
        TB.openEditor(TB.popover, [{ key: "name", label: "重命名", value: b.name || "" }], async (v) => {
          const nn = String(v.name || "").trim();
          if (!nn) return false;
          const st = await tbLoad();
          const n = JSON.parse(JSON.stringify(st));
          const loc = findLocation(n, b.id);
          if (loc) loc.node.name = nn;
          await tbSave(n);
          if (TB.rerenderList) TB.rerenderList();
          return true;
        });
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "✕";
      delBtn.title = "删除";
      delBtn.style.cssText = "flex:none;border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;padding:0 2px";
      delBtn.addEventListener("mousedown", (e) => e.preventDefault());
      delBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const st = await tbLoad();
        const n = JSON.parse(JSON.stringify(st));
        removeNode(n, b.id);
        await tbSave(n);
        if (TB.rerenderList) TB.rerenderList();
      });
      row.appendChild(fav);
      row.appendChild(main);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      row.addEventListener("click", (e) => {
        e.preventDefault();
        openUrl(ctx, b.url);
        closePopover();
      });
      return row;
    }

    function renderTreeInto(container, node, ctx, depth) {
      if (!node || node.type !== "folder") return;
      (node.children || []).forEach((c) => {
        if (c.type === "folder") {
          const open = TB.isOpen(c.id);
          const d = document.createElement("div");
          d.className = "dbh-pop-folder";
          d.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;padding-left:" + (8 + depth * 10) + "px";
          const chev = document.createElement("span");
          chev.textContent = open ? "▾" : "▸";
          chev.style.cssText = "width:12px;text-align:center;opacity:.7;flex:0 0 auto";
          const label = document.createElement("span");
          label.textContent = "📁 " + c.name;
          label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
          const cnt = document.createElement("span");
          cnt.textContent = String(countBookmarks(c));
          cnt.style.cssText = "font-size:10px;opacity:.5;flex:0 0 auto";
          d.appendChild(chev);
          d.appendChild(label);
          d.appendChild(cnt);
          const delF = document.createElement("span");
          delF.textContent = "✕";
          delF.title = "删除文件夹";
          delF.style.cssText = "flex:0 0 auto;opacity:.4;font-size:11px;padding:0 2px;cursor:pointer";
          delF.addEventListener("mousedown", (e) => e.preventDefault());
          delF.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const st = await tbLoad();
            const n = JSON.parse(JSON.stringify(st));
            removeNode(n, c.id);
            await tbSave(n);
            if (TB.rerenderList) TB.rerenderList();
          });
          d.appendChild(delF);
          d.addEventListener("mousedown", (e) => e.preventDefault());
          d.addEventListener("click", (e) => {
            e.preventDefault();
            TB.toggleFolder(c.id);
            if (TB.rerenderList) TB.rerenderList();
          });
          container.appendChild(d);
          if (open) {
            if ((c.children || []).length) {
              renderTreeInto(container, c, ctx, depth + 1);
            } else {
              const emp = document.createElement("div");
              emp.textContent = "（空）";
              emp.style.cssText = "font-size:11px;opacity:.4;padding:2px 8px 2px " + (8 + (depth + 1) * 10) + "px";
              container.appendChild(emp);
            }
          }
        } else {
          container.appendChild(bmRow(c, ctx));
        }
      });
    }

    function renderList(container, tree, ctx, query) {
      const q = String(query || "").trim().toLowerCase();
      if (q) {
        const hits = collectBookmarks(tree).filter(
          (b) => String(b.name || "").toLowerCase().indexOf(q) >= 0 || String(b.url || "").toLowerCase().indexOf(q) >= 0,
        );
        if (!hits.length) {
          const e = document.createElement("div");
          e.style.cssText = "padding:16px 8px;text-align:center;opacity:.5;font-size:12px";
          e.textContent = "没有匹配「" + query + "」的书签";
          container.appendChild(e);
          return;
        }
        hits.forEach((b) => container.appendChild(bmRow(b, ctx)));
        return;
      }
      renderTreeInto(container, tree, ctx, 0);
    }

    async function openPopover(ctx, toolbar, btn) {
      await tbLoad();
      const pop = document.createElement("div");
      pop.className = "dbh-pop";

      const srow = document.createElement("div");
      srow.className = "dbh-pop-search";
      const inp = document.createElement("input");
      inp.placeholder = "搜索书签，或输入关键词/网址回车打开";
      const go = document.createElement("button");
      go.type = "button";
      go.textContent = "搜索";
      const doSearch = () => {
        const raw = String(inp.value || "").trim();
        if (!raw) return;
        const target = /^https?:\/\//i.test(raw) ? raw : isLikelyUrl(raw) ? "https://" + raw : buildSearchUrl(TB.settings, raw);
        openUrl(ctx, target);
        closePopover();
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          doSearch();
        }
      });
      go.addEventListener("mousedown", (e) => e.preventDefault());
      go.addEventListener("click", (e) => {
        e.preventDefault();
        doSearch();
      });
      srow.appendChild(inp);
      srow.appendChild(go);

      const list = document.createElement("div");
      list.className = "dbh-pop-list";
      const rerender = () => {
        list.innerHTML = "";
        const q = String(inp.value || "").trim();
        if (TB.store && TB.store.tree && (TB.store.tree.children || []).length) {
          renderList(list, TB.store.tree, ctx, q);
        } else {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:18px 10px;text-align:center;opacity:.5;font-size:12px;line-height:1.7";
          empty.textContent = "还没有书签。用下方「＋书签」添加，或「导入」。";
          list.appendChild(empty);
        }
      };
      TB.rerenderList = rerender;
      rerender();
      inp.addEventListener("input", () => {
        try {
          rerender();
        } catch (e) {
          /* ignore */
        }
      });

      const openEditor = (host, fields, onSubmit) => {
        const ed = document.createElement("div");
        ed.style.cssText = "margin:6px 8px 2px;background:rgba(127,127,127,.12);border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px";
        const inputs = {};
        fields.forEach((f) => {
          const wrap = document.createElement("label");
          wrap.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px";
          const sp = document.createElement("span");
          sp.textContent = f.label;
          sp.style.cssText = "flex:0 0 auto;opacity:.75";
          const ip = document.createElement("input");
          ip.type = "text";
          ip.value = f.value == null ? "" : String(f.value);
          ip.style.cssText = "flex:1;min-width:0;padding:6px 8px;border-radius:7px;border:1px solid rgba(128,128,128,.3);background:rgba(127,127,127,.08);color:inherit;outline:none;font-size:12px";
          wrap.appendChild(sp);
          wrap.appendChild(ip);
          ed.appendChild(wrap);
          inputs[f.key] = ip;
        });
        const bar = document.createElement("div");
        bar.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
        const okB = document.createElement("button");
        okB.type = "button";
        okB.textContent = "确定";
        okB.style.cssText = "padding:5px 12px;border-radius:7px;border:1px solid #4d6bfe;background:#4d6bfe;color:#fff;cursor:pointer;font-size:12px";
        const cancelB = document.createElement("button");
        cancelB.type = "button";
        cancelB.textContent = "取消";
        cancelB.style.cssText = "padding:5px 12px;border-radius:7px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:12px";
        okB.addEventListener("mousedown", (e) => e.preventDefault());
        cancelB.addEventListener("mousedown", (e) => e.preventDefault());
        const closeEd = () => {
          try {
            ed.remove();
          } catch (e) {
            /* ignore */
          }
        };
        cancelB.addEventListener("click", (e) => {
          e.preventDefault();
          closeEd();
        });
        okB.addEventListener("click", async (e) => {
          e.preventDefault();
          const vals = {};
          Object.keys(inputs).forEach((k) => (vals[k] = inputs[k].value));
          try {
            const keep = await onSubmit(vals);
            if (keep !== false) closeEd();
          } catch (err) {
            /* ignore */
          }
        });
        bar.appendChild(okB);
        bar.appendChild(cancelB);
        ed.appendChild(bar);
        host.appendChild(ed);
        try {
          const first = Object.values(inputs)[0];
          if (first) first.focus();
        } catch (e) {
          /* ignore */
        }
        return { close: closeEd };
      };
      TB.openEditor = openEditor;
      const foot = document.createElement("div");
      foot.className = "dbh-pop-foot";
      foot.style.flexWrap = "nowrap";
      foot.style.overflowX = "auto";
      const mkBtn = (label, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (title) b.title = title;
        b.style.cssText = "flex:0 0 auto;white-space:nowrap;font-size:11px;line-height:1.4;padding:4px 7px;border-radius:8px;border:1px solid rgba(128,128,128,.32);background:rgba(127,127,127,.08);color:inherit;cursor:pointer";
        b.addEventListener("mousedown", (e) => e.preventDefault());
        return b;
      };
      const addBtn = mkBtn("收藏", "把当前网页加入书签");
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = normalizeUrl(addrOf(toolbar));
        if (!url) {
          addBtn.textContent = "先打开网页";
          setTimeout(() => (addBtn.textContent = "收藏"), 1200);
          return;
        }
        const st = await tbLoad();
        const n = JSON.parse(JSON.stringify(st));
        addNode(n, "root", { id: uid("b"), type: "bookmark", name: normalizeHost(url), url: url });
        await tbSave(n);
        if (TB.rerenderList) TB.rerenderList();
        addBtn.textContent = "✓收藏";
        setTimeout(() => (addBtn.textContent = "收藏"), 1200);
      });
      const addBmBtn = mkBtn("＋书签", "新建书签");
      addBmBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openEditor(pop, [{ key: "name", label: "名称", value: "" }, { key: "url", label: "网址", value: addrOf(toolbar) || "" }], async (v) => {
          if (!String(v.url || "").trim()) return false;
          const st = await tbLoad();
          const n = JSON.parse(JSON.stringify(st));
          addNode(n, "root", { id: uid("b"), type: "bookmark", name: String(v.name || "").trim() || normalizeHost(v.url), url: normalizeUrl(v.url) });
          await tbSave(n);
          if (TB.rerenderList) TB.rerenderList();
          return true;
        });
      });
      const addFolderBtn = mkBtn("＋文件夹", "新建文件夹");
      addFolderBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openEditor(pop, [{ key: "name", label: "文件夹名", value: "新文件夹" }], async (v) => {
          const nn = String(v.name || "").trim();
          if (!nn) return false;
          const st = await tbLoad();
          const n = JSON.parse(JSON.stringify(st));
          addNode(n, "root", { id: uid("f"), type: "folder", name: nn, children: [] });
          await tbSave(n);
          if (TB.rerenderList) TB.rerenderList();
          return true;
        });
      });
      const impBtn = mkBtn("导入", "从 HTML 导入书签");
      const fileInp = document.createElement("input");
      fileInp.type = "file";
      fileInp.accept = ".html,.htm,text/html";
      fileInp.style.display = "none";
      impBtn.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          fileInp.click();
        } catch (err) {
          /* ignore */
        }
      });
      fileInp.addEventListener("change", () => {
        const f = fileInp.files && fileInp.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            const parsed = parseBookmarkHtml(String(rd.result || ""));
            const st = await tbLoad();
            const n = JSON.parse(JSON.stringify(st));
            parsed.name = "导入的书签 " + new Date().toLocaleDateString();
            n.tree.children.push(parsed);
            await tbSave(n);
            if (TB.rerenderList) TB.rerenderList();
          } catch (err) {
            /* ignore */
          }
        };
        rd.readAsText(f);
        fileInp.value = "";
      });
      const foldBtn = mkBtn("收起全部", "一键收起 / 展开所有文件夹");
      foldBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const st = await tbLoad();
          const ids = flattenFolders(st.tree).map((f) => f.id);
          const anyOpen = ids.some((id) => TB.isOpen(id));
          ids.forEach((id) => {
            TB._open[id] = anyOpen ? false : true;
          });
          if (TB.rerenderList) TB.rerenderList();
          foldBtn.textContent = anyOpen ? "展开全部" : "收起全部";
        } catch (err) {
          /* ignore */
        }
      });
      foot.appendChild(foldBtn);
      foot.appendChild(addBtn);
      foot.appendChild(addBmBtn);
      foot.appendChild(addFolderBtn);
      foot.appendChild(impBtn);

      pop.appendChild(srow);
      pop.appendChild(list);
      pop.appendChild(foot);
      pop.appendChild(fileInp);
      document.body.appendChild(pop);

      let rect = { bottom: 40, right: 40 };
      try {
        rect = btn.getBoundingClientRect();
      } catch (e) {
        /* ignore */
      }
      pop.style.top = Math.round(Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 120))) + "px";
      pop.style.right = Math.round(Math.max(8, window.innerWidth - rect.right)) + "px";
      TB.popover = pop;
      TB.popoverBtn = btn;
      setTimeout(() => {
        try {
          document.addEventListener("mousedown", onDocDown, true);
        } catch (e) {
          /* ignore */
        }
      }, 0);
      setTimeout(() => {
        try {
          inp.focus();
        } catch (e) {
          /* ignore */
        }
      }, 0);
    }

    // 地址栏回车增强：输入非网址关键词 → 用当前搜索引擎跳转（真 URL 让宿主自己处理）
    function onAddrKeyDown(e) {
      if (e.key !== "Enter" || e.isComposing) return;
      const t = e.target;
      if (!t || !t.matches || !t.matches(TB_ADDRESS_SEL)) return;
      const raw = String(t.value || "").trim();
      if (!raw) return;
      if (/^https?:\/\//i.test(raw)) return;
      if (isLikelyUrl(raw)) return;
      e.preventDefault();
      e.stopPropagation();
      openUrl(TB.ctx, buildSearchUrl(TB.settings, raw));
    }

    function scanToolbars() {
      try {
        findToolbars().forEach((tb) => decorateToolbar(tb));
      } catch (e) {
        /* ignore */
      }
    }

    function startToolbarAdapter(ctx) {
      try {
        if (typeof window !== "undefined" && typeof window.__dshbhToolbarDispose === "function") {
          try {
            window.__dshbhToolbarDispose();
          } catch (e) {
            /* ignore */
          }
        }
        TB.ctx = ctx;
        ensureToolbarStyles();
        tbLoad();
        scanToolbars();
        const onMutate = () => {
          if (TB.scanTimer) return;
          TB.scanTimer = setTimeout(() => {
            TB.scanTimer = null;
            scanToolbars();
          }, 150);
        };
        if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
          TB.observer = new MutationObserver(onMutate);
          TB.observer.observe(document.body, { childList: true, subtree: true });
        }
        try {
          document.addEventListener("keydown", onAddrKeyDown, true);
        } catch (e) {
          /* ignore */
        }
        try {
          window.__dshbhToolbarDispose = () => {
            try {
              if (TB.observer) TB.observer.disconnect();
            } catch (e) {
              /* ignore */
            }
            try {
              document.removeEventListener("keydown", onAddrKeyDown, true);
            } catch (e) {
              /* ignore */
            }
            if (TB.scanTimer) {
              clearTimeout(TB.scanTimer);
              TB.scanTimer = null;
            }
            closePopover();
          };
        } catch (e) {
          /* ignore */
        }
      } catch (e) {
        /* ignore —— 增强失败不影响侧栏标签页本身 */
      }
    }

    /* ============================ apply ============================ */
    // 2026-11-12：cordis 在服务未就绪时裸读 ctx.<service> 会抛，直接导致本 entry 判
    // "failed"；shared 服务名统一走这个安全取值器（取不到返回 undefined）。
    function __safeSvc(ctx, name) {
      try { return ctx[name]; } catch (e) { return undefined; }
    }
    // 官方扩展点写法（与 dsh-univer-office 一致）：服务晚到时用响应式注入，
    // cordis 会在 betterSidebar 就绪后自行运行回调；不再写进 exports.inject，
    // 否则服务慢就绪会让本 entry 永远 pending，整个 web boot 超时（11-12 崩溃）。
    function apply(ctx) {
      ctx.inject(["betterSidebar"], function (__sbCtx) {
        try { __applyReal(__sbCtx); }
        catch (e) { try { console.warn("[dsh] activate with betterSidebar failed:", e); } catch (e2) {} }
      });
    }

    function __applyReal(ctx) {
      if (__safeSvc(ctx, "betterSidebar") === undefined) {
        // 软依赖：服务晚到时最多等 30s 再挂，等不到就静默跳过，绝不把整个
        // web boot 拖死（2026-11-12 崩溃：declared inject 缺服务 → pending → 启动超时）。
        var __t = 0;
        var __tm = setInterval(function () {
          var __s = __safeSvc(ctx, "betterSidebar");
          if (__s === undefined && (++__t) < 60) return;
          try { clearInterval(__tm); } catch (e) {}
          if (__s !== undefined) { try { apply(ctx); } catch (e) {} }
        }, 500);
        return;
      }
      ensureStyles();
      // 只保留「内置浏览器增强」（工具栏注入 + 地址栏搜索引擎）。
      // 独立「书签」Tab 与左侧栏 / 侧边栏的单独入口已按用户要求移除。
      try {
        startToolbarAdapter(ctx);
      } catch (e) {
        /* ignore */
      }
    }

    exports.name = NAME;
    exports.inject = ["slots", "layout"];
    exports.apply = apply;
    exports.__test = {
      findLocation: findLocation,
      addNode: addNode,
      removeNode: removeNode,
      moveNode: moveNode,
      isDescendant: isDescendant,
      flattenFolders: flattenFolders,
      countBookmarks: countBookmarks,
      collectBookmarks: collectBookmarks,
      parseBookmarkHtml: parseBookmarkHtml,
      buildSearchUrl: buildSearchUrl,
      normalizeUrl: normalizeUrl,
      normalizeStore: normalizeStore,
      isLikelyUrl: isLikelyUrl,
    };
    return module.exports;
  },
});
