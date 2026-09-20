// Studio-scheduling application handler.
// Single Function entry: routes by ?action= and HTTP method. All authorization
// is enforced here. The browser never talks to the database directly.
import { hashPassword, verifyPassword, signToken, verifyToken, sessionSecret } from "./authlib.mjs";
import { computeMatches, slotKey } from "./matching.mjs";

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const err = (code, status) => json({ error: code }, status);

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const NOW = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// ---- validation ----
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isHalfHour = (v) => typeof v === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(v);
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optStr = (v, max) => v === undefined || v === null || (typeof v === "string" && v.length <= max);

async function readJson(request, maxBytes = 64 * 1024) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError("payload_too_large", 413);
  if (buf.byteLength === 0) return {};
  try {
    const value = JSON.parse(new TextDecoder().decode(buf));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw 0;
    return value;
  } catch {
    throw new HttpError("invalid_body", 400);
  }
}

class HttpError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ---- data helpers ----
async function findAccountByUsername(supabase, username) {
  const { data, error } = await supabase.from("accounts").select("*").eq("username", username).maybeSingle();
  if (error) throw new HttpError("database_request_failed", 503);
  return data ?? null;
}
async function findAccountById(supabase, id) {
  const { data, error } = await supabase.from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError("database_request_failed", 503);
  return data ?? null;
}
async function studioForAccount(supabase, accountId) {
  const { data, error } = await supabase.from("studios").select("*").eq("account_id", accountId).maybeSingle();
  if (error) throw new HttpError("database_request_failed", 503);
  return data ?? null;
}
async function listAll(supabase, table, order = "created_at") {
  const { data, error } = await supabase.from(table).select("*").order(order, { ascending: true });
  if (error || !Array.isArray(data)) throw new HttpError("database_request_failed", 503);
  return data;
}
async function notify(supabase, accountId, kind, message) {
  await supabase.from("notifications").insert({
    id: uuid(), account_id: accountId, kind, message, read: false, created_at: NOW(),
  });
}
async function notifyAdmins(supabase, kind, message) {
  const { data } = await supabase.from("accounts").select("id").eq("role", "admin");
  for (const a of data ?? []) await notify(supabase, a.id, kind, message);
}

// Strip sensitive fields before returning account rows to the browser.
const publicAccount = (a) => ({
  id: a.id, username: a.username, role: a.role, display_name: a.display_name, email: a.email,
});

async function authenticate(request, supabase) {
  const token = request.headers.get("x-session-token");
  if (!token) throw new HttpError("login_required", 401);
  const payload = await verifyToken(sessionSecret(), token);
  if (!payload) throw new HttpError("login_required", 401);
  const account = await findAccountById(supabase, payload.sub);
  if (!account) throw new HttpError("login_required", 401);
  return account;
}
function requireRole(account, ...roles) {
  if (!roles.includes(account.role)) throw new HttpError("forbidden", 403);
}

// ---- main dispatch ----
export async function handleApp({ request, supabase }) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  try {
    switch (action) {
      case "login": return await login(request, supabase);
      case "bootstrap": return await bootstrap(request, supabase);
      case "me": return await me(request, supabase);
      case "notifications": return await getNotifications(request, supabase);
      case "notifications/read": return await readNotification(request, supabase);
      // admin
      case "admin/overview": return await adminOverview(request, supabase);
      case "admin/create-account": return await adminCreateAccount(request, supabase);
      case "admin/delete-account": return await adminDeleteAccount(request, supabase);
      case "admin/note": return await adminNote(request, supabase);
      case "admin/resolve-appeal": return await adminResolveAppeal(request, supabase);
      // studio
      case "studio/me": return await studioMe(request, supabase);
      case "studio/setup": return await studioSetup(request, supabase);
      case "studio/slots": return await studioSlots(request, supabase);
      case "studio/slots/set": return await studioSlotsSet(request, supabase);
      case "studio/bookings": return await studioBookings(request, supabase);
      case "studio/appeal": return await studioAppeal(request, supabase);
      // vendor
      case "vendor/speakers": return await vendorSpeakers(request, supabase);
      case "vendor/speaker/create": return await vendorCreateSpeaker(request, supabase);
      case "vendor/requests": return await vendorRequests(request, supabase);
      case "vendor/request/create": return await vendorCreateRequest(request, supabase);
      case "vendor/request/matches": return await vendorRequestMatches(request, supabase);
      case "vendor/book": return await vendorBook(request, supabase);
      case "vendor/bookings": return await vendorBookings(request, supabase);
      default: return err("not_found", 404);
    }
  } catch (e) {
    if (e instanceof HttpError) return err(e.code, e.status);
    return err("database_request_failed", 503);
  }
}

function requireMethod(request, method) {
  if (request.method !== method) throw new HttpError("method_not_allowed", 405);
}

// ---- auth actions ----
async function login(request, supabase) {
  requireMethod(request, "POST");
  const body = await readJson(request);
  if (!str(body.username, 64) || !str(body.password, 256)) throw new HttpError("invalid_credentials", 400);
  const account = await findAccountByUsername(supabase, body.username.trim());
  if (!account || !(await verifyPassword(body.password, account.password_hash))) {
    throw new HttpError("invalid_credentials", 401);
  }
  const token = await signToken(sessionSecret(), {
    sub: account.id, role: account.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  return json({ ok: true, token, account: publicAccount(account) });
}

async function me(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  return json({ ok: true, account: publicAccount(account) });
}

// One-time initialization: create the first admin only when none exists.
// Idempotent — returns 409 once any admin account is present.
async function bootstrap(request, supabase) {
  requireMethod(request, "POST");
  const body = await readJson(request);
  const { data: admins, error } = await supabase.from("accounts").select("id").eq("role", "admin").limit(1);
  if (error) throw new HttpError("database_request_failed", 503);
  if (Array.isArray(admins) && admins.length > 0) throw new HttpError("already_initialized", 409);
  if (!str(body.username, 64) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 256) {
    throw new HttpError("invalid_body", 400);
  }
  const password_hash = await hashPassword(body.password);
  await supabase.from("accounts").insert({
    id: uuid(), username: body.username.trim(), password_hash, role: "admin",
    display_name: str(body.display_name, 128) ? body.display_name.trim() : "管理员",
    email: optStr(body.email, 256) && body.email ? body.email.trim() : "",
    admin_note: "", created_at: NOW(),
  });
  return json({ ok: true });
}

// ---- notifications ----
async function getNotifications(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  const { data, error } = await supabase.from("notifications").select("*")
    .eq("account_id", account.id).order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) throw new HttpError("database_request_failed", 503);
  return json({ ok: true, items: data });
}
async function readNotification(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  const body = await readJson(request);
  if (!str(body.id, 64)) throw new HttpError("invalid_body", 400);
  await supabase.from("notifications").update({ read: true }).eq("id", body.id).eq("account_id", account.id);
  return json({ ok: true });
}

// ---- admin ----
async function adminOverview(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const [accounts, studios, speakers, slots, requests, bookings, appeals] = await Promise.all([
    listAll(supabase, "accounts"),
    listAll(supabase, "studios"),
    listAll(supabase, "speakers"),
    listAll(supabase, "slots"),
    listAll(supabase, "schedule_requests"),
    listAll(supabase, "bookings"),
    listAll(supabase, "appeals"),
  ]);
  return json({
    ok: true,
    accounts: accounts.map((a) => ({ ...publicAccount(a), admin_note: a.admin_note, created_at: a.created_at })),
    studios, speakers, slots, requests, bookings, appeals,
  });
}

async function adminCreateAccount(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  const role = body.role;
  if (!["studio", "vendor", "admin"].includes(role)) throw new HttpError("invalid_body", 400);
  if (!str(body.username, 64) || !str(body.password, 256) || body.password.length < 6) throw new HttpError("invalid_body", 400);
  if (!optStr(body.display_name, 128) || !optStr(body.email, 256)) throw new HttpError("invalid_body", 400);
  if (await findAccountByUsername(supabase, body.username.trim())) throw new HttpError("username_taken", 409);
  const id = uuid();
  const { error } = await supabase.from("accounts").insert({
    id, username: body.username.trim(), password_hash: await hashPassword(body.password), role,
    display_name: body.display_name ?? "", email: body.email ?? "", admin_note: "", created_at: NOW(),
  });
  if (error) throw new HttpError("username_taken", 409);
  return json({ ok: true, account: publicAccount({ id, username: body.username.trim(), role, display_name: body.display_name ?? "", email: body.email ?? "" }) });
}

async function adminDeleteAccount(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  if (!str(body.account_id, 64)) throw new HttpError("invalid_body", 400);
  if (body.account_id === account.id) throw new HttpError("cannot_delete_self", 400);
  const target = await findAccountById(supabase, body.account_id);
  if (!target) throw new HttpError("not_found", 404);
  // Remove owned studio and its free slots; keep historical bookings/appeals intact.
  const studio = await studioForAccount(supabase, target.id);
  if (studio) {
    await supabase.from("slots").delete().eq("studio_id", studio.id).eq("status", "free");
    await supabase.from("studios").delete().eq("id", studio.id);
  }
  await supabase.from("accounts").delete().eq("id", target.id);
  return json({ ok: true });
}

async function adminNote(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  const table = { account: "accounts", studio: "studios", speaker: "speakers" }[body.target_type];
  if (!table || !str(body.target_id, 64) || !optStr(body.admin_note, 2000)) throw new HttpError("invalid_body", 400);
  const { error } = await supabase.from(table).update({ admin_note: body.admin_note ?? "" }).eq("id", body.target_id);
  if (error) throw new HttpError("database_request_failed", 503);
  return json({ ok: true });
}

async function adminResolveAppeal(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  if (!str(body.appeal_id, 64) || !["approved", "rejected"].includes(body.decision)) throw new HttpError("invalid_body", 400);
  const { data: appeal } = await supabase.from("appeals").select("*").eq("id", body.appeal_id).maybeSingle();
  if (!appeal || appeal.status !== "pending") throw new HttpError("not_found", 404);

  if (body.decision === "rejected") {
    await supabase.from("appeals").update({ status: "rejected", resolved_at: NOW() }).eq("id", appeal.id);
    const studio = await findStudioById(supabase, appeal.studio_id);
    if (studio) await notify(supabase, studio.account_id, "appeal_rejected", `申诉已被驳回(预约 ${appeal.booking_id.slice(0, 8)}),原预约档期仍然有效。`);
    return json({ ok: true });
  }

  // approved: release the booking, free its slots, reopen the request for the vendor.
  const { data: booking } = await supabase.from("bookings").select("*").eq("id", appeal.booking_id).maybeSingle();
  if (!booking) throw new HttpError("not_found", 404);
  await supabase.from("slots").update({ status: "free", booking_id: null }).eq("booking_id", booking.id);
  await supabase.from("bookings").update({ status: "released" }).eq("id", booking.id);
  await supabase.from("appeals").update({ status: "approved", resolved_at: NOW() }).eq("id", appeal.id);

  // Reopen the schedule request with the released slots so the vendor need not re-enter.
  const { data: req } = await supabase.from("schedule_requests").select("*").eq("id", booking.request_id).maybeSingle();
  if (req) {
    const merged = [...new Set([...(req.desired ?? []), ...(booking.slots ?? [])])];
    await supabase.from("schedule_requests").update({ desired: merged, status: "reopened" }).eq("id", req.id);
    await notify(supabase, booking.vendor_account_id, "booking_released",
      `原定录音棚因申诉已释放你的档期,请重新选择录音棚(档期已为你保留,无需重新填写)。`);
  }
  const studio = await findStudioById(supabase, appeal.studio_id);
  if (studio) await notify(supabase, studio.account_id, "appeal_approved", `申诉已通过,相关档期已释放。`);
  return json({ ok: true });
}

async function findStudioById(supabase, id) {
  const { data } = await supabase.from("studios").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// ---- studio ----
async function studioMe(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  return json({ ok: true, needs_setup: !studio, studio });
}

async function studioSetup(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const body = await readJson(request);
  if (!str(body.name, 128) || !str(body.city, 64) || !str(body.address, 256) || !str(body.email, 256)) {
    throw new HttpError("invalid_body", 400);
  }
  const existing = await studioForAccount(supabase, account.id);
  if (existing) {
    // Location and name are remembered; allow correction but keep the same record.
    await supabase.from("studios").update({
      name: body.name.trim(), city: body.city.trim(), address: body.address.trim(), email: body.email.trim(),
    }).eq("id", existing.id);
    const updated = await studioForAccount(supabase, account.id);
    return json({ ok: true, studio: updated });
  }
  const id = uuid();
  await supabase.from("studios").insert({
    id, account_id: account.id, name: body.name.trim(), city: body.city.trim(),
    address: body.address.trim(), email: body.email.trim(), admin_note: "", created_at: NOW(),
  });
  const studio = await studioForAccount(supabase, account.id);
  return json({ ok: true, studio });
}

async function studioSlots(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const { data, error } = await supabase.from("slots").select("*").eq("studio_id", studio.id);
  if (error || !Array.isArray(data)) throw new HttpError("database_request_failed", 503);
  return json({ ok: true, slots: data });
}

async function studioSlotsSet(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const body = await readJson(request);
  const changes = Array.isArray(body.slots) ? body.slots : [body];
  if (changes.length === 0 || changes.length > 500) throw new HttpError("invalid_body", 400);
  for (const c of changes) {
    if (!isDate(c.date) || !isHalfHour(c.start) || typeof c.available !== "boolean") {
      throw new HttpError("invalid_body", 400);
    }
  }
  const skipped = [];
  for (const c of changes) {
    const { data: existing } = await supabase.from("slots").select("*")
      .eq("studio_id", studio.id).eq("date", c.date).eq("start", c.start).maybeSingle();
    if (c.available) {
      if (!existing) {
        await supabase.from("slots").insert({
          id: uuid(), studio_id: studio.id, date: c.date, start: c.start,
          status: "free", booking_id: null, created_at: NOW(),
        });
      }
    } else {
      // Cannot withdraw a locked slot; must appeal instead.
      if (existing && existing.status === "locked") skipped.push({ date: c.date, start: c.start });
      else if (existing) await supabase.from("slots").delete().eq("id", existing.id);
    }
  }
  const { data } = await supabase.from("slots").select("*").eq("studio_id", studio.id);
  return json({ ok: true, slots: data ?? [], skipped });
}

async function studioBookings(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const { data: bookings } = await supabase.from("bookings").select("*").eq("studio_id", studio.id);
  const speakers = await listAll(supabase, "speakers");
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const enriched = (bookings ?? []).map((b) => ({
    ...b,
    project_name: byId.get(b.speaker_id)?.project_name ?? "",
    stage_name: byId.get(b.speaker_id)?.stage_name ?? "",
  }));
  return json({ ok: true, bookings: enriched });
}

async function studioAppeal(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const body = await readJson(request);
  if (!str(body.booking_id, 64) || !str(body.reason, 1000)) throw new HttpError("invalid_body", 400);
  const { data: booking } = await supabase.from("bookings").select("*").eq("id", body.booking_id).maybeSingle();
  if (!booking || booking.studio_id !== studio.id) throw new HttpError("not_found", 404);
  if (booking.status !== "confirmed") throw new HttpError("invalid_state", 409);
  const { data: dup } = await supabase.from("appeals").select("id").eq("booking_id", booking.id).eq("status", "pending").maybeSingle();
  if (dup) throw new HttpError("appeal_pending", 409);
  const id = uuid();
  await supabase.from("appeals").insert({
    id, booking_id: booking.id, studio_id: studio.id, reason: body.reason.trim(),
    status: "pending", created_at: NOW(), resolved_at: null,
  });
  await notifyAdmins(supabase, "appeal_submitted", `录音棚「${studio.name}」提交了档期申诉,待审核。`);
  return json({ ok: true, appeal_id: id });
}

// ---- vendor (speaker side) ----
async function vendorSpeakers(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const { data } = await supabase.from("speakers").select("*").eq("vendor_account_id", account.id);
  return json({ ok: true, speakers: data ?? [] });
}

async function vendorRequests(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const { data: reqs } = await supabase.from("schedule_requests").select("*").eq("vendor_account_id", account.id);
  const speakers = await listAll(supabase, "speakers");
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const enriched = (reqs ?? []).map((r) => ({
    ...r,
    project_name: byId.get(r.speaker_id)?.project_name ?? "",
    stage_name: byId.get(r.speaker_id)?.stage_name ?? "",
  }));
  return json({ ok: true, requests: enriched });
}

async function vendorCreateSpeaker(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const body = await readJson(request);
  if (!str(body.project_name, 128) || !str(body.stage_name, 128) || !str(body.email, 256)) throw new HttpError("invalid_body", 400);
  const id = uuid();
  await supabase.from("speakers").insert({
    id, vendor_account_id: account.id, project_name: body.project_name.trim(),
    stage_name: body.stage_name.trim(), email: body.email.trim(), admin_note: "", created_at: NOW(),
  });
  return json({ ok: true, speaker_id: id });
}

function validateDesired(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) throw new HttpError("invalid_body", 400);
  const keys = new Set();
  for (const s of raw) {
    if (!s || !isDate(s.date) || !isHalfHour(s.start)) throw new HttpError("invalid_body", 400);
    keys.add(slotKey(s));
  }
  return [...keys];
}

async function vendorCreateRequest(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const body = await readJson(request);
  if (!str(body.speaker_id, 64)) throw new HttpError("invalid_body", 400);
  const { data: speaker } = await supabase.from("speakers").select("*").eq("id", body.speaker_id).maybeSingle();
  if (!speaker || speaker.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  const desired = validateDesired(body.slots);
  const id = uuid();
  await supabase.from("schedule_requests").insert({
    id, speaker_id: speaker.id, vendor_account_id: account.id,
    desired, status: "open", created_at: NOW(),
  });
  const matches = await matchesForRequest(supabase, desired);
  return json({ ok: true, request_id: id, ...matches });
}

async function vendorRequestMatches(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const id = new URL(request.url).searchParams.get("request_id");
  if (!str(id, 64)) throw new HttpError("invalid_body", 400);
  const { data: req } = await supabase.from("schedule_requests").select("*").eq("id", id).maybeSingle();
  if (!req || req.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  const matches = await matchesForRequest(supabase, req.desired ?? []);
  return json({ ok: true, request_id: id, status: req.status, desired: req.desired ?? [], ...matches });
}

async function matchesForRequest(supabase, desiredKeys) {
  if (desiredKeys.length === 0) return { fullCover: [], partial: [], combination: null, desired: [] };
  const dates = [...new Set(desiredKeys.map((k) => k.split(" ")[0]))];
  const { data: freeSlots } = await supabase.from("slots").select("*").eq("status", "free").in("date", dates);
  const studios = await listAll(supabase, "studios");
  const freeByStudio = new Map();
  for (const s of freeSlots ?? []) {
    if (!freeByStudio.has(s.studio_id)) freeByStudio.set(s.studio_id, []);
    freeByStudio.get(s.studio_id).push(`${s.date} ${s.start}`);
  }
  const studioInputs = studios
    .filter((s) => freeByStudio.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, city: s.city, address: s.address, freeKeys: freeByStudio.get(s.id) }));
  return computeMatches(desiredKeys, studioInputs);
}

async function vendorBook(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const body = await readJson(request);
  if (!str(body.request_id, 64) || !str(body.studio_id, 64)) throw new HttpError("invalid_body", 400);
  const { data: req } = await supabase.from("schedule_requests").select("*").eq("id", body.request_id).maybeSingle();
  if (!req || req.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  if (req.status !== "open" && req.status !== "reopened") throw new HttpError("invalid_state", 409);
  const studio = await findStudioById(supabase, body.studio_id);
  if (!studio) throw new HttpError("not_found", 404);

  const desired = new Set(req.desired ?? []);
  const bookingId = uuid();
  const locked = [];
  // Lock each desired slot that is still free for this studio (best-effort per slot).
  for (const key of desired) {
    const [date, start] = key.split(" ");
    const { data: rows } = await supabase.from("slots")
      .update({ status: "locked", booking_id: bookingId })
      .eq("studio_id", studio.id).eq("date", date).eq("start", start).eq("status", "free")
      .select("id");
    if (Array.isArray(rows) && rows.length > 0) locked.push(key);
  }
  if (locked.length === 0) throw new HttpError("no_availability", 409);

  await supabase.from("bookings").insert({
    id: bookingId, request_id: req.id, speaker_id: req.speaker_id, studio_id: studio.id,
    vendor_account_id: account.id, slots: locked, status: "confirmed", created_at: NOW(),
  });

  const remaining = [...desired].filter((k) => !locked.includes(k));
  const nextStatus = remaining.length === 0 ? "closed" : req.status === "reopened" ? "reopened" : "open";
  await supabase.from("schedule_requests").update({
    desired: remaining, status: nextStatus,
  }).eq("id", req.id);

  const { data: speaker } = await supabase.from("speakers").select("*").eq("id", req.speaker_id).maybeSingle();
  const label = speaker ? `${speaker.project_name} / ${speaker.stage_name}` : "发音人";
  await notify(supabase, studio.account_id, "new_booking",
    `新预约:${label},共 ${locked.length} 个半小时档期已锁定。`);

  return json({ ok: true, booking_id: bookingId, locked, remaining });
}

async function vendorBookings(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const { data: bookings } = await supabase.from("bookings").select("*").eq("vendor_account_id", account.id);
  const studios = await listAll(supabase, "studios");
  const speakers = await listAll(supabase, "speakers");
  const sById = new Map(studios.map((s) => [s.id, s]));
  const spById = new Map(speakers.map((s) => [s.id, s]));
  const enriched = (bookings ?? []).map((b) => ({
    ...b,
    studio_name: sById.get(b.studio_id)?.name ?? "",
    city: sById.get(b.studio_id)?.city ?? "",
    address: sById.get(b.studio_id)?.address ?? "",
    project_name: spById.get(b.speaker_id)?.project_name ?? "",
    stage_name: spById.get(b.speaker_id)?.stage_name ?? "",
  }));
  return json({ ok: true, bookings: enriched });
}
