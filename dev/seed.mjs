// Local-only seed data. Passwords here are demo-only.
import { hashPassword } from "../functions/authlib.mjs";

const NOW = () => new Date().toISOString();

function slotRows(studioId, date, starts) {
  return starts.map((start) => ({
    id: crypto.randomUUID(), studio_id: studioId, date, start,
    status: "free", booking_id: null, created_at: NOW(),
  }));
}

// Half-hour starts between from and to (exclusive of `to`).
function range(from, to) {
  const out = [];
  let [h, m] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  while (h < th || (h === th && m < tm)) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) { m = 0; h += 1; }
  }
  return out;
}

export async function buildSeed() {
  const db = {
    accounts: [], studios: [], speakers: [], slots: [],
    schedule_requests: [], bookings: [], appeals: [], notifications: [],
  };

  const mkAccount = async (username, password, role, display_name, email) => {
    const id = crypto.randomUUID();
    db.accounts.push({
      id, username, password_hash: await hashPassword(password), role,
      display_name, email, admin_note: "", created_at: NOW(),
    });
    return id;
  };

  await mkAccount("admin", "admin123", "admin", "平台管理员", "admin@example.com");
  const bjA = await mkAccount("studio_bj_a", "studio123", "studio", "朝阳录音棚", "bja@example.com");
  const bjB = await mkAccount("studio_bj_b", "studio123", "studio", "海淀录音棚", "bjb@example.com");
  const sh = await mkAccount("studio_sh", "studio123", "studio", "徐汇录音棚", "sh@example.com");
  const vendor = await mkAccount("vendor1", "vendor123", "vendor", "示例供应商", "vendor@example.com");

  const mkStudio = (accountId, name, city, address) => {
    const id = crypto.randomUUID();
    db.studios.push({ id, account_id: accountId, name, city, address, email: "", admin_note: "", created_at: NOW() });
    return id;
  };

  const sBjA = mkStudio(bjA, "声界·朝阳棚", "北京", "北京市朝阳区建国路88号");
  const sBjB = mkStudio(bjB, "回声·海淀棚", "北京", "北京市海淀区中关村大街1号");
  const sSh = mkStudio(sh, "静音·徐汇棚", "上海", "上海市徐汇区漕溪北路100号");

  const D1 = "2026-09-25";
  const D2 = "2026-09-26";
  db.slots.push(...slotRows(sBjA, D1, range("09:00", "12:00")));
  db.slots.push(...slotRows(sBjB, D1, range("14:00", "17:00")));
  db.slots.push(...slotRows(sBjB, D2, range("09:00", "11:00")));
  db.slots.push(...slotRows(sSh, D1, range("09:00", "18:00")));

  // one demo speaker under the vendor
  db.speakers.push({
    id: crypto.randomUUID(), vendor_account_id: vendor, project_name: "示例项目A",
    stage_name: "小夜", email: "voice@example.com", admin_note: "", created_at: NOW(),
  });

  return db;
}
