// Local-only dev server. Injects the in-memory client into the real handler so
// the full application flow runs without any cloud backend. NOT for production;
// production uses functions/index.ts (Deno) with the platform adapter.
import http from "node:http";
import { handleApp } from "../functions/handler.mjs";
import { createMemoryClient } from "./memory-supabase.mjs";
import { buildSeed } from "./seed.mjs";

const PORT = Number(process.argv[2] ?? 8000);

const db = await buildSeed();
const supabase = createMemoryClient(db);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const url = `http://127.0.0.1:${PORT}${req.url}`;
  if (!req.url.startsWith("/functions/v1/app")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method)) init.body = body;
  const request = new Request(url, init);

  let response;
  try {
    response = await handleApp({ request, supabase });
  } catch (e) {
    response = Response.json({ error: "server_error" }, { status: 500 });
  }
  const text = await response.text();
  const outHeaders = {};
  response.headers.forEach((v, k) => { outHeaders[k] = v; });
  res.writeHead(response.status, outHeaders);
  res.end(text);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev] studio-scheduling function on http://127.0.0.1:${PORT}/functions/v1/app`);
  console.log(`[dev] demo logins -> admin/admin123, studio_bj_a/studio123, vendor1/vendor123`);
});
