/**
 * dsh-browser-hub — host half（宿主端，ESM）。
 *
 * 只提供书签数据的持久化路由（客户端只 fetch 根相对路径）：
 *   GET  /browser-hub/ping  → 存活探针
 *   GET  /browser-hub/data  → 读取 data/store.json（缺失时回退 data/defaults.json 种子）
 *   POST /browser-hub/data  → 整体写回（原子写，先写 tmp 再 rename）
 *
 * 任何失败都 best-effort 返回 { ok:false }，绝不让异常冒泡到宿主。
 * @module dsh-browser-hub
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const name = "dsh-browser-hub";
export const inject = ["webServer"];

const VERSION = "0.1.0";
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
