const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:8000/functions/v1/app";
const j = (r) => r.json();
async function post(action, token, body) {
  const h = { "content-type": "application/json" };
  if (token) h["x-session-token"] = token;
  return j(await fetch(`${BASE}?action=${action}`, { method: "POST", headers: h, body: JSON.stringify(body ?? {}) }));
}
async function get(action, token, qs = "") {
  const h = {};
  if (token) h["x-session-token"] = token;
  return j(await fetch(`${BASE}?action=${action}${qs}`, { headers: h }));
}

const v = await post("login", null, { username: "vendor1", password: "vendor123" });
const VT = v.token;
const sp = await get("vendor/speakers", VT);
const SPID = sp.speakers[0].id;

const req = await post("vendor/request/create", VT, {
  speaker_id: SPID,
  slots: [
    { date: "2026-09-25", start: "09:00" },
    { date: "2026-09-25", start: "09:30" },
    { date: "2026-09-25", start: "10:00" },
    { date: "2026-09-25", start: "14:00" },
  ],
});
console.log("fullCover:", req.fullCover.map((x) => x.name));
console.log("partial:", req.partial.map((x) => `${x.name}(${x.covered.length})`));
console.log("combination:", JSON.stringify(req.combination?.studios.map((s) => `${s.name}->${s.assigned.length}`)), "coversAll:", req.combination?.coversAll, "uncovered:", req.combination?.uncovered);

// Book the Shanghai studio so the matching studio login below can verify the reservation.
console.log("--- booking full-cover studio ---");
const target = req.fullCover.find((studio) => studio.city === "上海") ?? req.fullCover[0] ?? req.combination.studios[0];
const book = await post("vendor/book", VT, { request_id: req.request_id, studio_id: target.studioId });
console.log("locked:", book.locked?.length, "remaining:", book.remaining);

// studio side: login as SH studio, check bookings + notifications
const s = await post("login", null, { username: "studio_sh", password: "studio123" });
const ST = s.token;
const sb = await get("studio/bookings", ST);
console.log("studio bookings:", sb.bookings.map((b) => `${b.project_name}/${b.stage_name} x${b.slots.length}`));
const nt = await get("notifications", ST);
console.log("studio notifications:", nt.items.map((n) => n.message));

// appeal flow
console.log("--- appeal ---");
const bkId = sb.bookings[0].id;
const ap = await post("studio/appeal", ST, { booking_id: bkId, reason: "档期已被线下预定" });
console.log("appeal:", ap);
const a = await post("login", null, { username: "admin", password: "admin123" });
const AT = a.token;
const ov = await get("admin/overview", AT);
console.log("appeals pending:", ov.appeals.filter((x) => x.status === "pending").length);
const res = await post("admin/resolve-appeal", AT, { appeal_id: ap.appeal_id, decision: "approved" });
console.log("resolve:", res);

// vendor should be notified and request reopened
const vn = await get("notifications", VT);
console.log("vendor notifications:", vn.items.map((n) => n.message));
const rm = await get("vendor/request/matches", VT, `&request_id=${req.request_id}`);
console.log("reopened request status:", rm.status, "desired restored:", rm.desired?.length);
