import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryClient } from "../dev/memory-supabase.mjs";
import { createFileStore } from "../server/store.mjs";
import { signToken } from "./authlib.mjs";
import { handleApp } from "./handler.mjs";

const TEST_SECRET = "booking-appeal-test-secret";
process.env.APP_SESSION_SECRET = TEST_SECRET;

const created_at = "2026-09-21T00:00:00.000Z";

function makeDb() {
  return {
    accounts: [
      { id: "admin-account", username: "admin-test", role: "admin", display_name: "管理员", email: "", created_at },
      { id: "studio-account", username: "studio-test", role: "studio", display_name: "录音棚", email: "", created_at },
      { id: "vendor-account", username: "vendor-test", role: "vendor", display_name: "供应商", email: "", created_at },
      { id: "other-vendor", username: "other-vendor-test", role: "vendor", display_name: "其他供应商", email: "", created_at },
      { id: "new-studio-account", username: "new-studio-test", role: "studio", display_name: "新录音棚", email: "", created_at },
    ],
    studios: [
      { id: "studio-id", account_id: "studio-account", name: "测试录音棚", city: "上海", address: "测试地址", email: "", created_at },
    ],
    speakers: [
      { id: "speaker-id", vendor_account_id: "vendor-account", project_name: "测试项目", stage_name: "测试角色", email: "", created_at },
    ],
    bookings: [
      {
        id: "booking-id", request_id: "request-id", speaker_id: "speaker-id", studio_id: "studio-id",
        vendor_account_id: "vendor-account", slots: ["2026-09-25 09:00"], status: "confirmed", created_at,
      },
    ],
    slots: [
      { id: "slot-id", studio_id: "studio-id", date: "2026-09-25", start: "09:00", status: "locked", booking_id: "booking-id", created_at },
    ],
    schedule_requests: [
      {
        id: "request-id", speaker_id: "speaker-id", vendor_account_id: "vendor-account",
        desired: ["2026-09-26 10:00"], status: "closed", created_at,
      },
    ],
    appeals: [],
    notifications: [],
    city_proximities: [],
  };
}

async function callWithClient(supabase, action, accountId, body, method = "POST") {
  const token = await signToken(TEST_SECRET, {
    sub: accountId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const request = new Request(`http://localhost/functions/v1/app?action=${action}`, {
    method,
    headers: { "content-type": "application/json", "x-session-token": token },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const response = await handleApp({ request, supabase });
  return { status: response.status, body: await response.json() };
}

async function call(db, action, accountId, body, method = "POST") {
  return callWithClient(createMemoryClient(db), action, accountId, body, method);
}

test("vendor appeal is owner-only, visible on both booking lists, and blocks a second pending appeal", async () => {
  const db = makeDb();

  const forbidden = await call(db, "vendor/appeal", "other-vendor", {
    booking_id: "booking-id", reason: "需要取消",
  });
  assert.equal(forbidden.status, 404);

  const submitted = await call(db, "vendor/appeal", "vendor-account", {
    booking_id: "booking-id", reason: "项目计划变化",
  });
  assert.equal(submitted.status, 200);
  assert.equal(db.appeals.length, 1);
  assert.equal(db.appeals[0].studio_id, null);
  assert.equal(db.appeals[0].vendor_account_id, "vendor-account");

  const vendorList = await call(db, "vendor/bookings", "vendor-account", null, "GET");
  assert.equal(vendorList.body.bookings[0].appeal_status, "pending");
  assert.equal(vendorList.body.bookings[0].appeal_by, "vendor");

  const studioList = await call(db, "studio/bookings", "studio-account", null, "GET");
  assert.equal(studioList.body.bookings[0].appeal_status, "pending");
  assert.equal(studioList.body.bookings[0].appeal_by, "vendor");

  const duplicate = await call(db, "studio/appeal", "studio-account", {
    booking_id: "booking-id", reason: "也需要取消",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "appeal_pending");
});

test("approving a vendor appeal releases the booking without reopening its request", async () => {
  const db = makeDb();
  db.appeals.push({
    id: "vendor-appeal", booking_id: "booking-id", studio_id: null,
    vendor_account_id: "vendor-account", reason: "项目取消", status: "pending", created_at, resolved_at: null,
  });

  const result = await call(db, "admin/resolve-appeal", "admin-account", {
    appeal_id: "vendor-appeal", decision: "approved",
  });

  assert.equal(result.status, 200);
  assert.equal(db.bookings[0].status, "released");
  assert.equal(db.slots.length, 0);
  assert.equal(db.schedule_requests[0].status, "closed");
  assert.deepEqual(db.schedule_requests[0].desired, ["2026-09-26 10:00"]);
  assert.equal(db.appeals[0].status, "approved");
  assert.deepEqual(new Set(db.notifications.map((item) => item.account_id)), new Set(["vendor-account", "studio-account"]));
});

test("approving a studio appeal reopens the request and restores booking slots", async () => {
  const db = makeDb();
  db.appeals.push({
    id: "studio-appeal", booking_id: "booking-id", studio_id: "studio-id",
    vendor_account_id: null, reason: "档期冲突", status: "pending", created_at, resolved_at: null,
  });

  const result = await call(db, "admin/resolve-appeal", "admin-account", {
    appeal_id: "studio-appeal", decision: "approved",
  });

  assert.equal(result.status, 200);
  assert.equal(db.schedule_requests[0].status, "reopened");
  assert.deepEqual(new Set(db.schedule_requests[0].desired), new Set(["2026-09-26 10:00", "2026-09-25 09:00"]));
  assert.deepEqual(new Set(db.notifications.map((item) => item.account_id)), new Set(["vendor-account", "studio-account"]));
});

test("rejecting an appeal notifies only its initiator and keeps the booking", async () => {
  const db = makeDb();
  db.appeals.push({
    id: "vendor-appeal", booking_id: "booking-id", studio_id: null,
    vendor_account_id: "vendor-account", reason: "项目变化", status: "pending", created_at, resolved_at: null,
  });

  const result = await call(db, "admin/resolve-appeal", "admin-account", {
    appeal_id: "vendor-appeal", decision: "rejected",
  });

  assert.equal(result.status, 200);
  assert.equal(db.bookings[0].status, "confirmed");
  assert.equal(db.slots.length, 1);
  assert.deepEqual(db.notifications.map((item) => item.account_id), ["vendor-account"]);
});

test("an appeal cannot be resolved twice", async () => {
  const db = makeDb();
  db.appeals.push({
    id: "vendor-appeal", booking_id: "booking-id", studio_id: null,
    vendor_account_id: "vendor-account", reason: "项目变化", status: "pending", created_at, resolved_at: null,
  });

  const first = await call(db, "admin/resolve-appeal", "admin-account", {
    appeal_id: "vendor-appeal", decision: "rejected",
  });
  const second = await call(db, "admin/resolve-appeal", "admin-account", {
    appeal_id: "vendor-appeal", decision: "approved",
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 404);
  assert.equal(db.appeals[0].status, "rejected");
  assert.equal(db.bookings[0].status, "confirmed");
  assert.equal(db.notifications.length, 1);
});

test("file store resolves appeals through the same atomic operation", async () => {
  const db = makeDb();
  db.appeals.push({
    id: "studio-appeal", booking_id: "booking-id", studio_id: "studio-id",
    vendor_account_id: null, reason: "档期冲突", status: "pending", created_at, resolved_at: null,
  });
  const store = createFileStore();
  store.db = db;

  const result = await callWithClient(store, "admin/resolve-appeal", "admin-account", {
    appeal_id: "studio-appeal", decision: "approved",
  });

  assert.equal(result.status, 200);
  assert.equal(db.bookings[0].status, "released");
  assert.equal(db.schedule_requests[0].status, "reopened");
  assert.equal(db.appeals[0].status, "approved");
});

test("email is optional for account creation, studio setup, and speaker creation", async () => {
  const db = makeDb();

  const createdVendor = await call(db, "admin/create-account", "admin-account", {
    role: "vendor", username: "created-vendor", password: "x".repeat(6), display_name: "新供应商",
  });
  assert.equal(createdVendor.status, 200);
  assert.equal(createdVendor.body.account.email, "");

  const createdStudio = await call(db, "admin/create-account", "admin-account", {
    role: "studio", username: "created-studio", password: "x".repeat(6), display_name: "新棚", city: "北京", address: "测试地址",
  });
  assert.equal(createdStudio.status, 200);
  assert.equal(createdStudio.body.studio.email, "");

  const setup = await call(db, "studio/setup", "new-studio-account", {
    name: "新录音棚", city: "广州", address: "测试地址", email: "",
  });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.studio.email, "");

  const speaker = await call(db, "vendor/speaker/create", "vendor-account", {
    project_name: "新项目", stage_name: "新角色", email: "",
  });
  assert.equal(speaker.status, 200);
  assert.equal(db.speakers.find((item) => item.id === speaker.body.speaker_id).email, "");

  const tooLong = await call(db, "vendor/speaker/create", "vendor-account", {
    project_name: "新项目", stage_name: "新角色", email: "x".repeat(257),
  });
  assert.equal(tooLong.status, 400);
});

test("admin updates business records and notifies their owners", async () => {
  const db = makeDb();

  const forbidden = await call(db, "admin/update-record", "vendor-account", {
    target_type: "studio", target_id: "studio-id", changes: { name: "越权修改", city: "上海", address: "地址", email: "" },
  });
  assert.equal(forbidden.status, 403);

  const studio = await call(db, "admin/update-record", "admin-account", {
    target_type: "studio", target_id: "studio-id",
    changes: { name: "调整后的录音棚", city: "杭州", address: "新地址", email: "studio@example.com" },
  });
  assert.equal(studio.status, 200);
  assert.equal(db.studios[0].name, "调整后的录音棚");
  assert.equal(db.notifications.at(-1).account_id, "studio-account");
  assert.equal(db.notifications.at(-1).kind, "admin_record_updated");

  const speaker = await call(db, "admin/update-record", "admin-account", {
    target_type: "speaker", target_id: "speaker-id",
    changes: { project_name: "调整后的项目", stage_name: "新角色", email: "vendor@example.com" },
  });
  assert.equal(speaker.status, 200);
  assert.equal(db.speakers[0].stage_name, "新角色");
  assert.equal(db.notifications.at(-1).account_id, "vendor-account");

  const request = await call(db, "admin/update-record", "admin-account", {
    target_type: "request", target_id: "request-id",
    changes: {
      slots: [{ date: "2026-09-28", start: "10:30" }],
      preferred_cities: ["杭州"], match_mode: "location_first", status: "reopened",
    },
  });
  assert.equal(request.status, 200);
  assert.deepEqual(db.schedule_requests[0].desired, ["2026-09-28 10:30"]);
  assert.equal(db.schedule_requests[0].status, "reopened");
  assert.equal(db.notifications.at(-1).account_id, "vendor-account");
});

test("admin adjusts booking slots atomically and notifies both sides", async () => {
  const db = makeDb();
  const result = await call(db, "admin/update-record", "admin-account", {
    target_type: "booking", target_id: "booking-id",
    changes: {
      slots: [
        { date: "2026-09-27", start: "13:00" },
        { date: "2026-09-27", start: "13:30" },
      ],
      status: "confirmed",
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(db.bookings[0].slots, ["2026-09-27 13:00", "2026-09-27 13:30"]);
  assert.deepEqual(db.slots.map((slot) => `${slot.date} ${slot.start}`), ["2026-09-27 13:00", "2026-09-27 13:30"]);
  assert.deepEqual(new Set(db.notifications.map((item) => item.account_id)), new Set(["vendor-account", "studio-account"]));
});

test("admin availability changes preserve locked bookings and notify the studio", async () => {
  const db = makeDb();
  const result = await call(db, "admin/slots/set", "admin-account", {
    studio_id: "studio-id",
    slots: [
      { date: "2026-09-25", start: "09:00", available: false },
      { date: "2026-09-26", start: "10:00", available: false },
    ],
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.skipped, [{ date: "2026-09-25", start: "09:00" }]);
  assert.equal(db.slots.find((slot) => slot.date === "2026-09-25").status, "locked");
  assert.equal(db.slots.find((slot) => slot.date === "2026-09-26").status, "blocked");
  assert.equal(db.notifications.at(-1).account_id, "studio-account");
});

test("Excel backups are role-scoped and never include password hashes", async () => {
  const db = makeDb();
  db.accounts[0].password_hash = "must-not-leak";
  db.accounts[3].display_name = "不可见的其他供应商";
  db.speakers[0].stage_name = "<测试角色>";

  const textOf = (backup) => JSON.stringify(backup.sheets);

  const admin = await call(db, "backup/export", "admin-account", {}, "POST");
  assert.equal(admin.status, 200);
  assert.match(admin.body.filename, /后台全站数据备份.*\.xlsx$/);
  assert.match(textOf(admin.body), /不可见的其他供应商/);
  assert.doesNotMatch(textOf(admin.body), /must-not-leak/);

  const vendor = await call(db, "backup/export", "vendor-account", {}, "POST");
  assert.equal(vendor.status, 200);
  assert.match(textOf(vendor.body), /测试项目/);
  assert.match(textOf(vendor.body), /<测试角色>/);
  assert.match(textOf(vendor.body), /测试录音棚/);
  assert.doesNotMatch(textOf(vendor.body), /不可见的其他供应商/);
  assert.doesNotMatch(textOf(vendor.body), /must-not-leak/);

  const studio = await call(db, "backup/export", "studio-account", {}, "POST");
  assert.equal(studio.status, 200);
  assert.match(textOf(studio.body), /测试录音棚/);
  assert.match(textOf(studio.body), /测试项目/);
  assert.doesNotMatch(textOf(studio.body), /不可见的其他供应商/);
});

test("only admins can broadcast announcements and send account messages", async () => {
  const db = makeDb();
  const forbidden = await call(db, "admin/broadcast", "vendor-account", { message: "越权公告" });
  assert.equal(forbidden.status, 403);
  assert.equal(db.notifications.length, 0);

  const broadcast = await call(db, "admin/broadcast", "admin-account", { message: "今晚维护" });
  assert.equal(broadcast.status, 200);
  assert.equal(broadcast.body.recipient_count, db.accounts.length);
  assert.equal(db.notifications.length, db.accounts.length);
  assert.ok(db.notifications.every((item) => item.kind === "announcement" && item.message === "全站公告：今晚维护"));

  const direct = await call(db, "admin/message", "admin-account", {
    account_id: "studio-account", message: "请更新本周档期",
  });
  assert.equal(direct.status, 200);
  assert.equal(db.notifications.at(-1).account_id, "studio-account");
  assert.equal(db.notifications.at(-1).kind, "direct_message");
  assert.equal(db.notifications.at(-1).message, "管理员私信：请更新本周档期");

  const missing = await call(db, "admin/message", "admin-account", {
    account_id: "missing-account", message: "测试",
  });
  assert.equal(missing.status, 404);
});
