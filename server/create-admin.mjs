// Create the first administrator account.
// Usage:
//   node server/create-admin.mjs <用户名> <密码> [显示名称] [邮箱]
// Reuses the handler's idempotent "bootstrap" action: it only succeeds when no
// admin exists yet, so it is safe to run more than once.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApp } from "../functions/handler.mjs";
import { createStore } from "./db.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(ROOT, "data", "store.json");

const [username, password, displayName, email] = process.argv.slice(2);

if (!username || !password) {
  console.error("用法: node server/create-admin.mjs <用户名> <密码> [显示名称] [邮箱]");
  console.error("说明: 密码至少 8 位。");
  process.exit(1);
}

const { client: store } = await createStore(DATA_FILE);
const request = new Request("http://localhost/functions/v1/app?action=bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username,
    password,
    display_name: displayName || "管理员",
    email: email || "",
  }),
});

const response = await handleApp({ request, supabase: store });
const text = await response.text();
if (typeof store.flush === "function") await store.flush();

if (response.status === 200) {
  console.log(`已创建管理员账号: ${username}`);
} else if (response.status === 409) {
  console.error("已存在管理员账号，无需重复创建。如需重置请删除数据文件后重试。");
  process.exit(1);
} else {
  console.error(`创建失败 (HTTP ${response.status}): ${text}`);
  process.exit(1);
}
