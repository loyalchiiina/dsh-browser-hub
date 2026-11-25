/**
 * dsh-browser-hub — host half（宿主端，ESM）。
 *
 * 只提供书签数据的持久化路由（客户端只 fetch 根相对路径）：
 *   GET  /browser-hub/ping  → 存活探针
 *   GET  /browser-hub/data  → 读取 data/store.json（缺失时回退 data/defaults.json 种子）
 *   POST /browser-hub/data  → 整体写回（原子写，先写 tmp 再 rename）
 *   GET  /browser-hub/history → 读取 data/history.json（浏览历史，上限 800 条）
 *   POST /browser-hub/history → 整体写回（原子写，只保留 url/title/ts）
 *   GET  /browser-hub/check-update → 查 npm 上本插件最新版本（6 小时缓存，?force=1 强刷）
 *
 * 任何失败都 best-effort 返回 { ok:false }，绝不让异常冒泡到宿主。
 * @module dsh-browser-hub
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const name = "dsh-browser-hub";
export const inject = ["webServer"];

const VERSION = "0.2.14";
const ROUTE_PREFIX = "/browser-hub";

function resolvePkgRoot() {
  try {
    const here = fileURLToPath(import.meta.url); // .../lib/index.js
    return path.dirname(path.dirname(here));
  } catch {
    return process.cwd();
  }
}

const PKG_ROOT = resolvePkgRoot();
const DATA_DIR = path.join(PKG_ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SEED_FILE = path.join(DATA_DIR, "defaults.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
/** 浏览历史条数上限：超出后按时间裁掉最旧的。 */
const HISTORY_MAX = 800;

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  ensureDir();
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function loadStore() {
  let s = readJson(STORE_FILE, null);
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    s = readJson(SEED_FILE, null) || {
      version: 1,
      settings: { engine: "baidu", customEngine: "" },
      tree: { id: "root", type: "folder", name: "全部书签", children: [] },
    };
  }
  return s;
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function sendErr(res, status, msg) {
  send(res, status, { ok: false, error: String(msg) });
}

/**
 * 读取浏览历史。文件不存在或损坏时返回空集（历史是增强功能，绝不让它拖垮插件）。
 * @returns {{version:number, items:Array<{url:string,title:string,ts:number}>}}
 */
function loadHistory() {
  const h = readJson(HISTORY_FILE, null);
  if (!h || typeof h !== "object" || !Array.isArray(h.items)) return { version: 1, items: [] };
  return { version: 1, items: h.items.slice(0, HISTORY_MAX) };
}

/**
 * 规整后写回历史：只保留 url/title/ts，同 url 去重（保留先出现的，客户端已把最新的排前面），裁到上限。
 * @param {unknown} input - 客户端提交的 {items:[...]}。
 * @returns {number} 实际落盘的条数。
 */
function saveHistory(input) {
  const items = [];
  const seen = new Set();
  const src = input && typeof input === "object" && Array.isArray(input.items) ? input.items : [];
  for (const raw of src) {
    if (!raw || typeof raw !== "object") continue;
    const u = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!u || u.length > 4000 || !/^https?:\/\//i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    items.push({
      url: u,
      title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
      ts: Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    });
    if (items.length >= HISTORY_MAX) break;
  }
  writeJsonAtomic(HISTORY_FILE, { version: 1, items });
  return items.length;
}

/** 只允许同源请求（有 Origin 时其 host 必须等于 Host 头），防跨站写数据。 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.host || "");
  } catch {
    return false;
  }
}

function readBody(req, limit = 8_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (e) => reject(e));
  });
}

const NPM_NAME = "dsh-browser-hub";
/** 版本检查结果缓存 6 小时：避免每次开面板都去敲 npm（也不在客户端轮询）。 */
const UPD_TTL = 6 * 60 * 60 * 1000;
const updCache = { at: 0, latest: "" };

/** 比较 x.y.z 的数字段，a 比 b 新返回 1，相同 0，更旧 -1。 */
function cmpVersion(a, b) {
  const pa = String(a).split(/[.\-+]/);
  const pb = String(b).split(/[.\-+]/);
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 查 npm 上本插件最新版本。任何网络/格式异常都抛错，由调用方转成失败态。 */
async function fetchLatestVersion() {
  if (typeof fetch !== "function") throw new Error("当前 Node 没有全局 fetch");
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctl.abort();
    } catch {
      /* ignore */
    }
  }, 8000);
  try {
    const r = await fetch("https://registry.npmjs.org/" + NPM_NAME + "/latest", {
      signal: ctl.signal,
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("npm registry 返回 HTTP " + r.status);
    const j = await r.json();
    const v = j && typeof j.version === "string" ? j.version.trim() : "";
    if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error("npm 返回的版本号不可用");
    return v;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("连接 npm registry 超时（8 秒）");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url, "http://" + host);
    let p = url.pathname;
    if (p.startsWith(ROUTE_PREFIX)) p = p.slice(ROUTE_PREFIX.length) || "/";

    if (req.method === "GET" && (p === "/ping" || p === "/")) {
      return send(res, 200, { ok: true, name, version: VERSION });
    }

    if (!sameOrigin(req)) return sendErr(res, 403, "cross-origin blocked");

    if (p === "/data") {
      if (req.method === "GET") return send(res, 200, { ok: true, data: loadStore() });
      if (req.method === "POST") {
        const ct = req.headers["content-type"] || "";
        if (!ct.includes("application/json")) return sendErr(res, 415, "application/json required");
        let raw;
        try {
          raw = await readBody(req);
        } catch (e) {
          return sendErr(res, 413, (e && e.message) || "body error");
        }
        let obj;
        try {
          obj = JSON.parse(raw);
        } catch {
          return sendErr(res, 400, "invalid json");
        }
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return sendErr(res, 400, "bad payload");
        writeJsonAtomic(STORE_FILE, obj);
        return send(res, 200, { ok: true, savedAt: new Date().toISOString() });
      }
      return sendErr(res, 405, "method not allowed");
    }

    if (p === "/check-update") {
      if (req.method !== "GET") return sendErr(res, 405, "method not allowed");
      const force = url.searchParams.get("force") === "1";
      const now = Date.now();
      if (!force && updCache.latest && now - updCache.at < UPD_TTL) {
        return send(res, 200, {
          ok: true,
          current: VERSION,
          latest: updCache.latest,
          hasUpdate: cmpVersion(updCache.latest, VERSION) > 0,
          checkedAt: new Date(updCache.at).toISOString(),
          cached: true,
        });
      }
      try {
        const latest = await fetchLatestVersion();
        updCache.at = now;
        updCache.latest = latest;
        return send(res, 200, {
          ok: true,
          current: VERSION,
          latest,
          hasUpdate: cmpVersion(latest, VERSION) > 0,
          checkedAt: new Date(now).toISOString(),
          cached: false,
        });
      } catch (e) {
        // 网络不通 ≠ 已是最新：明确回失败态，让客户端显示原因并可重试。
        return send(res, 200, { ok: false, current: VERSION, error: (e && e.message) || "network error" });
      }
    }

    if (p === "/history") {
      if (req.method === "GET") return send(res, 200, { ok: true, data: loadHistory() });
      if (req.method === "POST") {
        const ct = req.headers["content-type"] || "";
        if (!ct.includes("application/json")) return sendErr(res, 415, "application/json required");
        let raw;
        try {
          raw = await readBody(req);
        } catch (e) {
          return sendErr(res, 413, (e && e.message) || "body error");
        }
        let obj;
        try {
          obj = JSON.parse(raw);
        } catch {
          return sendErr(res, 400, "invalid json");
        }
        let saved = 0;
        try {
          saved = saveHistory(obj);
        } catch (e) {
          return sendErr(res, 500, (e && e.message) || "write failed");
        }
        return send(res, 200, { ok: true, saved, savedAt: new Date().toISOString() });
      }
      return sendErr(res, 405, "method not allowed");
    }

    return sendErr(res, 404, "not found");
  } catch (e) {
    return sendErr(res, 500, (e && e.message) || "internal error");
  }
}

export function apply(ctx) {
  const webServer = ctx && ctx.webServer;
  if (!webServer) return;
  ctx.effect(() =>
    webServer.register({
      kind: "prefix",
      path: ROUTE_PREFIX,
      handler,
    }),
  );
}
