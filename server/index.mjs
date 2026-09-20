// Self-hosted, dependency-free server for the studio-scheduling app.
// Serves the built frontend from dist/ (with SPA fallback) and routes
// /functions/v1/app to the same handler used in the Qoder Sites Function.
// Run with: npm start  (after: npm run build)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApp } from "../functions/handler.mjs";
import { sessionSecret } from "../functions/authlib.mjs";
import { createStore } from "./db.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = process.env.DATA_FILE || join(ROOT, "data", "store.json");

const { client: store, mode: storeMode } = await createStore(DATA_FILE);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

async function handleFunction(req, res, body) {
  const url = `http://${req.headers.host || "localhost"}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method)) init.body = body;
  const request = new Request(url, init);

  let response;
  try {
    response = await handleApp({ request, supabase: store });
  } catch {
    response = Response.json({ error: "server_error" }, { status: 500 });
  }
  const text = await response.text();
  const out = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(response.status, out);
  res.end(text);
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(DIST, rel);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
    return;
  } catch {
    // Fall through to SPA fallback.
  }
  try {
    const html = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", hint: "先运行 npm run build 生成 dist/ 目录" }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/functions/v1/app")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await handleFunction(req, res, Buffer.concat(chunks));
      return;
    }
    await serveStatic(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "server_error" }));
    console.error("[server]", e?.message ?? e);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`录音棚排期系统已启动: http://${HOST}:${PORT}`);
  console.log(storeMode === "supabase" ? "数据存储: Supabase 在线数据库" : `数据存储: 本地文件 ${DATA_FILE}`);
  if (sessionSecret() === "dev-insecure-session-secret-change-me") {
    console.warn("警告: 未设置 APP_SESSION_SECRET 环境变量，正在使用不安全的默认密钥。");
    console.warn("      正式部署前请设置一个随机的长字符串作为 APP_SESSION_SECRET。");
  }
});
