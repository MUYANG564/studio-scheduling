// Local-only seed data. Passwords here are demo-only.
import { hashPassword } from "../functions/authlib.mjs";

const NOW = () => new Date().toISOString();
const BUSINESS_HOURS = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [
  String(day), { enabled: true, start: "08:00", end: "22:00" },
]));

export async function buildSeed() {
  const db = {
    accounts: [], studios: [], speakers: [], slots: [], city_proximities: [],
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
    db.studios.push({
      id, account_id: accountId, name, city, address, email: "", admin_note: "",
      business_hours: structuredClone(BUSINESS_HOURS), created_at: NOW(),
    });
    return id;
  };

  mkStudio(bjA, "声界·朝阳棚", "北京", "北京市朝阳区建国路88号");
  mkStudio(bjB, "回声·海淀棚", "北京", "北京市海淀区中关村大街1号");
  mkStudio(sh, "静音·徐汇棚", "上海", "上海市徐汇区漕溪北路100号");

  // one demo speaker under the vendor
  db.speakers.push({
    id: crypto.randomUUID(), vendor_account_id: vendor, project_name: "示例项目A",
    stage_name: "小夜", email: "voice@example.com", admin_note: "", created_at: NOW(),
  });

  return db;
}
