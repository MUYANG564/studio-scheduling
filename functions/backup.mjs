const FIELD_LABELS = {
  id: "记录ID",
  username: "用户名",
  role: "角色",
  display_name: "显示名称",
  email: "联系邮箱",
  admin_note: "后台备注",
  account_id: "账号ID",
  vendor_account_id: "供应商账号ID",
  name: "名称",
  city: "城市",
  address: "地址",
  business_hours: "营业时间",
  studio_id: "录音棚ID",
  project_name: "项目名称",
  stage_name: "发音人",
  speaker_id: "发音人ID",
  request_id: "排期需求ID",
  desired: "需求档期",
  preferred_cities: "意向城市",
  match_mode: "匹配模式",
  date: "日期",
  start: "开始时间",
  booking_id: "预约ID",
  slots: "档期",
  status: "状态",
  reason: "原因",
  studio_name: "录音棚",
  kind: "消息类型",
  message: "消息内容",
  read: "是否已读",
  nearby_city: "邻近城市",
  priority: "优先级",
  created_at: "创建时间",
  resolved_at: "处理时间",
};

const SECTION_FIELDS = {
  accounts: ["id", "username", "role", "display_name", "email", "admin_note", "created_at"],
  studios: ["id", "account_id", "name", "city", "address", "email", "business_hours", "admin_note", "created_at"],
  speakers: ["id", "vendor_account_id", "project_name", "stage_name", "email", "admin_note", "created_at"],
  slots: ["id", "studio_id", "date", "start", "status", "booking_id", "created_at"],
  requests: ["id", "speaker_id", "vendor_account_id", "desired", "preferred_cities", "match_mode", "status", "created_at"],
  bookings: ["id", "request_id", "speaker_id", "studio_id", "vendor_account_id", "studio_name", "project_name", "stage_name", "slots", "status", "created_at"],
  appeals: ["id", "booking_id", "studio_id", "vendor_account_id", "reason", "status", "created_at", "resolved_at"],
  notifications: ["id", "account_id", "kind", "message", "read", "created_at"],
  city_proximities: ["id", "city", "nearby_city", "priority", "created_at"],
};

const valueText = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.join("<br>") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const cell = (value) => valueText(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("|", "\\|")
  .replaceAll("\n", "<br>");

function table(section) {
  const rows = section.rows ?? [];
  if (rows.length === 0) return "暂无记录。";
  const fields = (SECTION_FIELDS[section.key] ?? Object.keys(rows[0]))
    .filter((field) => rows.some((row) => row[field] !== undefined));
  const header = `| ${fields.map((field) => FIELD_LABELS[field] ?? field).join(" | ")} |`;
  const separator = `| ${fields.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${fields.map((field) => cell(row[field])).join(" | ")} |`).join("\n");
  return `${header}\n${separator}\n${body}`;
}

export function renderBackupMarkdown({ title, account, generatedAt, sections }) {
  const blocks = [
    `# ${title}`,
    "",
    `- 导出时间：${new Date(generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    `- 导出账号：${account.display_name || account.username}（${account.username}）`,
    `- 账号角色：${account.role}`,
    "",
    "> 本文档由录音棚档期匹配平台生成，用于升级前备份。密码哈希等安全信息不会导出。",
  ];
  for (const section of sections) {
    blocks.push("", `## ${section.title}`, "", table(section));
  }
  return blocks.join("\n");
}
