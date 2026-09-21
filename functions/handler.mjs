// Studio-scheduling application handler.
// Single Function entry: routes by ?action= and HTTP method. All authorization
// is enforced here. The browser never talks to the database directly.
import { hashPassword, verifyPassword, signToken, verifyToken, sessionSecret } from "./authlib.mjs";
import {
  computeMatches, isWithinBusinessHours, normalizeBusinessHours, slotKey,
} from "./matching.mjs";

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const err = (code, status) => json({ error: code }, status);

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const NOW = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// ---- validation ----
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isHalfHour = (v) => typeof v === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(v);
const isClosingHalfHour = (v) => isHalfHour(v) || v === "24:00";
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optStr = (v, max) => v === undefined || v === null || (typeof v === "string" && v.length <= max);
const normalizeCity = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

function halfHourKeys(dates) {
  const keys = [];
  for (const date of dates) {
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      keys.push(`${date} ${hour}:${minute}`);
    }
  }
  return keys;
}

function validateBusinessHours(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError("invalid_business_hours", 400);
  for (let day = 0; day < 7; day += 1) {
    const entry = value[String(day)];
    if (!entry || typeof entry !== "object" || typeof entry.enabled !== "boolean") {
      throw new HttpError("invalid_business_hours", 400);
    }
    if (!isHalfHour(entry.start) || !isClosingHalfHour(entry.end) || entry.start >= entry.end) {
      throw new HttpError("invalid_business_hours", 400);
    }
  }
  return normalizeBusinessHours(value);
}

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
async function cityOptions(supabase) {
  const studios = await listAll(supabase, "studios");
  const counts = new Map();
  for (const studio of studios) {
    const city = normalizeCity(studio.city);
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, studio_count]) => ({ name, studio_count }));
}
async function requestPreferences(supabase, rawCities, rawMode) {
  if (rawCities !== undefined && (!Array.isArray(rawCities) || rawCities.length > 20)) {
    throw new HttpError("invalid_city", 400);
  }
  const preferredCities = [...new Set((rawCities ?? []).map(normalizeCity).filter(Boolean))];
  if (preferredCities.some((city) => city.length > 64)) throw new HttpError("invalid_city", 400);
  const available = new Set((await cityOptions(supabase)).map((city) => city.name));
  if (preferredCities.some((city) => !available.has(city))) throw new HttpError("invalid_city", 400);
  const matchMode = rawMode === undefined ? "schedule_first" : rawMode;
  if (!["schedule_first", "location_first"].includes(matchMode)) throw new HttpError("invalid_body", 400);
  return {
    preferredCities,
    matchMode: matchMode === "location_first" && preferredCities.length === 0 ? "schedule_first" : matchMode,
  };
}
async function notify(supabase, accountId, kind, message) {
  const { error } = await supabase.from("notifications").insert({
    id: uuid(), account_id: accountId, kind, message, read: false, created_at: NOW(),
  });
  if (error) throw new HttpError("database_request_failed", 503);
}
async function notifyAdmins(supabase, kind, message) {
  const { data, error } = await supabase.from("accounts").select("id").eq("role", "admin");
  if (error) throw new HttpError("database_request_failed", 503);
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
      case "admin/city-proximity/save": return await adminSaveCityProximity(request, supabase);
      case "admin/city-proximity/delete": return await adminDeleteCityProximity(request, supabase);
      case "admin/resolve-appeal": return await adminResolveAppeal(request, supabase);
      // studio
      case "studio/me": return await studioMe(request, supabase);
      case "studio/setup": return await studioSetup(request, supabase);
      case "studio/business-hours": return await studioBusinessHours(request, supabase);
      case "studio/slots": return await studioSlots(request, supabase);
      case "studio/slots/set": return await studioSlotsSet(request, supabase);
      case "studio/bookings": return await studioBookings(request, supabase);
      case "studio/appeal": return await studioAppeal(request, supabase);
      // vendor
      case "vendor/speakers": return await vendorSpeakers(request, supabase);
      case "vendor/speaker/create": return await vendorCreateSpeaker(request, supabase);
      case "vendor/requests": return await vendorRequests(request, supabase);
      case "vendor/match-options": return await vendorMatchOptions(request, supabase);
      case "vendor/request/create": return await vendorCreateRequest(request, supabase);
      case "vendor/request/update": return await vendorUpdateRequest(request, supabase);
      case "vendor/request/matches": return await vendorRequestMatches(request, supabase);
      case "vendor/book": return await vendorBook(request, supabase);
      case "vendor/bookings": return await vendorBookings(request, supabase);
      case "vendor/appeal": return await vendorAppeal(request, supabase);
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
  const [accounts, studios, speakers, slots, requests, bookings, appeals, cityProximities] = await Promise.all([
    listAll(supabase, "accounts"),
    listAll(supabase, "studios"),
    listAll(supabase, "speakers"),
    listAll(supabase, "slots"),
    listAll(supabase, "schedule_requests"),
    listAll(supabase, "bookings"),
    listAll(supabase, "appeals"),
    listAll(supabase, "city_proximities"),
  ]);
  return json({
    ok: true,
    accounts: accounts.map((a) => ({ ...publicAccount(a), admin_note: a.admin_note, created_at: a.created_at })),
    studios, speakers, slots, requests, bookings, appeals, city_proximities: cityProximities,
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
  if (["studio", "vendor"].includes(role) && !str(body.display_name, 128)) {
    throw new HttpError("invalid_body", 400);
  }
  const city = normalizeCity(body.city);
  if (role === "studio" && (!city || city.length > 64 || !str(body.address, 256))) {
    throw new HttpError("invalid_body", 400);
  }
  if (await findAccountByUsername(supabase, body.username.trim())) throw new HttpError("username_taken", 409);

  const id = uuid();
  const displayName = body.display_name?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const { error } = await supabase.from("accounts").insert({
    id, username: body.username.trim(), password_hash: await hashPassword(body.password), role,
    display_name: displayName, email, admin_note: "", created_at: NOW(),
  });
  if (error) throw new HttpError("username_taken", 409);

  let studio = null;
  if (role === "studio") {
    const { data, error: studioError } = await supabase.from("studios").insert({
      id: uuid(), account_id: id, name: displayName, city,
      address: body.address.trim(), email, admin_note: "",
      business_hours: normalizeBusinessHours(), created_at: NOW(),
    }).select("*").single();
    if (studioError || !data) {
      await supabase.from("accounts").delete().eq("id", id);
      throw new HttpError("database_request_failed", 503);
    }
    studio = data;
  }

  return json({
    ok: true,
    account: publicAccount({ id, username: body.username.trim(), role, display_name: displayName, email }),
    studio,
  });
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
  // Remove unbooked availability overrides; keep historical bookings/appeals intact.
  const studio = await studioForAccount(supabase, target.id);
  if (studio) {
    await supabase.from("slots").delete().eq("studio_id", studio.id).neq("status", "locked");
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

async function adminSaveCityProximity(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  const city = normalizeCity(body.city);
  const nearbyCity = normalizeCity(body.nearby_city);
  const priority = Number(body.priority);
  const available = new Set((await cityOptions(supabase)).map((item) => item.name));
  if (!city || !nearbyCity || city === nearbyCity || !available.has(city) || !available.has(nearbyCity)
    || !Number.isInteger(priority) || priority < 1 || priority > 999) {
    throw new HttpError("invalid_city", 400);
  }
  const { data: existing } = await supabase.from("city_proximities").select("*")
    .eq("city", city).eq("nearby_city", nearbyCity).maybeSingle();
  if (existing) {
    await supabase.from("city_proximities").update({ priority }).eq("id", existing.id);
    return json({ ok: true, relation_id: existing.id });
  }
  const id = uuid();
  await supabase.from("city_proximities").insert({
    id, city, nearby_city: nearbyCity, priority, created_at: NOW(),
  });
  return json({ ok: true, relation_id: id });
}

async function adminDeleteCityProximity(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  if (!str(body.relation_id, 64)) throw new HttpError("invalid_body", 400);
  await supabase.from("city_proximities").delete().eq("id", body.relation_id);
  return json({ ok: true });
}

async function adminResolveAppeal(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "admin");
  const body = await readJson(request);
  if (!str(body.appeal_id, 64) || !["approved", "rejected"].includes(body.decision)) throw new HttpError("invalid_body", 400);

  const { data, error } = await supabase.rpc("resolve_booking_appeal", {
    p_appeal_id: body.appeal_id,
    p_decision: body.decision,
  });
  if (error) throw new HttpError("database_request_failed", 503);
  if (data !== "ok") throw new HttpError("not_found", 404);
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
  if (!str(body.name, 128) || !str(body.city, 64) || !str(body.address, 256) || !optStr(body.email, 256)) {
    throw new HttpError("invalid_body", 400);
  }
  const city = normalizeCity(body.city);
  const email = body.email?.trim() ?? "";
  const existing = await studioForAccount(supabase, account.id);
  if (existing) {
    // Location and name are remembered; allow correction but keep the same record.
    await supabase.from("studios").update({
      name: body.name.trim(), city, address: body.address.trim(), email,
    }).eq("id", existing.id);
    const updated = await studioForAccount(supabase, account.id);
    return json({ ok: true, studio: updated });
  }
  const id = uuid();
  await supabase.from("studios").insert({
    id, account_id: account.id, name: body.name.trim(), city,
    address: body.address.trim(), email, admin_note: "",
    business_hours: normalizeBusinessHours(), created_at: NOW(),
  });
  const studio = await studioForAccount(supabase, account.id);
  return json({ ok: true, studio });
}

async function studioBusinessHours(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const body = await readJson(request);
  const businessHours = validateBusinessHours(body.business_hours);
  await supabase.from("studios").update({ business_hours: businessHours }).eq("id", studio.id);
  return json({ ok: true, business_hours: businessHours });
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
    if (existing?.status === "locked") {
      skipped.push({ date: c.date, start: c.start });
      continue;
    }
    const regular = isWithinBusinessHours(studio.business_hours, c.date, c.start);
    const overrideStatus = c.available ? "free" : "blocked";
    const needsOverride = c.available !== regular;
    if (!needsOverride) {
      if (existing) await supabase.from("slots").delete().eq("id", existing.id);
    } else if (existing) {
      await supabase.from("slots").update({ status: overrideStatus, booking_id: null }).eq("id", existing.id);
    } else {
      await supabase.from("slots").insert({
        id: uuid(), studio_id: studio.id, date: c.date, start: c.start,
        status: overrideStatus, booking_id: null, created_at: NOW(),
      });
    }
  }
  const { data } = await supabase.from("slots").select("*").eq("studio_id", studio.id);
  return json({ ok: true, slots: data ?? [], skipped });
}

async function pendingAppealsByBooking(supabase, bookings) {
  const bookingIds = bookings.map((booking) => booking.id);
  const appeals = [];
  for (let offset = 0; offset < bookingIds.length; offset += 100) {
    const { data, error } = await supabase.from("appeals").select("booking_id,status,studio_id,vendor_account_id")
      .in("booking_id", bookingIds.slice(offset, offset + 100)).eq("status", "pending");
    if (error) throw new HttpError("database_request_failed", 503);
    appeals.push(...(data ?? []));
  }
  return new Map(appeals.map((appeal) => [appeal.booking_id, appeal]));
}

async function studioBookings(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "studio");
  const studio = await studioForAccount(supabase, account.id);
  if (!studio) throw new HttpError("needs_setup", 409);
  const { data: bookings } = await supabase.from("bookings").select("*").eq("studio_id", studio.id);
  const bookingRows = bookings ?? [];
  const [speakers, pendingAppeals] = await Promise.all([
    listAll(supabase, "speakers"),
    pendingAppealsByBooking(supabase, bookingRows),
  ]);
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const enriched = bookingRows.map((b) => {
    const appeal = pendingAppeals.get(b.id);
    return {
      ...b,
      project_name: byId.get(b.speaker_id)?.project_name ?? "",
      stage_name: byId.get(b.speaker_id)?.stage_name ?? "",
      appeal_status: appeal?.status ?? null,
      appeal_by: appeal ? (appeal.studio_id ? "studio" : "vendor") : null,
    };
  });
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
  const { error } = await supabase.from("appeals").insert({
    id, booking_id: booking.id, studio_id: studio.id, vendor_account_id: null,
    reason: body.reason.trim(), status: "pending", created_at: NOW(), resolved_at: null,
  });
  if (error?.code === "23505") throw new HttpError("appeal_pending", 409);
  if (error) throw new HttpError("database_request_failed", 503);
  await notifyAdmins(supabase, "appeal_submitted", `录音棚「${studio.name}」提交了预约取消申请,待审核。`);
  await notify(supabase, booking.vendor_account_id, "appeal_submitted", `录音棚「${studio.name}」已申请取消预约，后台审核前预约仍然有效。`);
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
  if (!str(body.project_name, 128) || !str(body.stage_name, 128) || !optStr(body.email, 256)) throw new HttpError("invalid_body", 400);
  const id = uuid();
  await supabase.from("speakers").insert({
    id, vendor_account_id: account.id, project_name: body.project_name.trim(),
    stage_name: body.stage_name.trim(), email: body.email?.trim() ?? "", admin_note: "", created_at: NOW(),
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

async function vendorMatchOptions(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  return json({ ok: true, cities: await cityOptions(supabase), default_match_mode: "schedule_first" });
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
  const { preferredCities, matchMode } = await requestPreferences(supabase, body.preferred_cities, body.match_mode);
  const id = uuid();
  await supabase.from("schedule_requests").insert({
    id, speaker_id: speaker.id, vendor_account_id: account.id, desired,
    preferred_cities: preferredCities, match_mode: matchMode, status: "open", created_at: NOW(),
  });
  const matches = await matchesForRequest(supabase, desired, preferredCities, matchMode);
  return json({ ok: true, request_id: id, ...matches });
}

async function vendorUpdateRequest(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const body = await readJson(request);
  if (!str(body.request_id, 64)) throw new HttpError("invalid_body", 400);
  const { data: req } = await supabase.from("schedule_requests").select("*").eq("id", body.request_id).maybeSingle();
  if (!req || req.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  if (req.status !== "open" && req.status !== "reopened") throw new HttpError("invalid_state", 409);
  const desired = validateDesired(body.slots);
  const { preferredCities, matchMode } = await requestPreferences(
    supabase,
    body.preferred_cities ?? req.preferred_cities ?? [],
    body.match_mode ?? req.match_mode ?? "schedule_first",
  );
  await supabase.from("schedule_requests").update({
    desired, preferred_cities: preferredCities, match_mode: matchMode,
  }).eq("id", req.id);
  const matches = await matchesForRequest(supabase, desired, preferredCities, matchMode);
  return json({ ok: true, request_id: req.id, status: req.status, ...matches });
}

async function vendorRequestMatches(request, supabase) {
  requireMethod(request, "GET");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const id = new URL(request.url).searchParams.get("request_id");
  if (!str(id, 64)) throw new HttpError("invalid_body", 400);
  const { data: req } = await supabase.from("schedule_requests").select("*").eq("id", id).maybeSingle();
  if (!req || req.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  const preferredCities = req.preferred_cities ?? [];
  const matchMode = req.match_mode ?? "schedule_first";
  const matches = await matchesForRequest(supabase, req.desired ?? [], preferredCities, matchMode);
  return json({ ok: true, request_id: id, status: req.status, ...matches });
}

async function matchesForRequest(supabase, desiredKeys, preferredCities = [], matchMode = "schedule_first") {
  if (desiredKeys.length === 0) {
    return {
      tier: "P2", p0: [], p1: [], fullCover: [], partial: [], combination: null,
      desired: [], preferredCities, matchMode, effectiveMode: matchMode, adjustmentOptions: [],
    };
  }
  const dates = [...new Set(desiredKeys.map((key) => key.split(" ")[0]))];
  const [{ data: slotRows, error: slotError }, studios, proximities] = await Promise.all([
    supabase.from("slots").select("*").in("date", dates),
    listAll(supabase, "studios"),
    listAll(supabase, "city_proximities"),
  ]);
  if (slotError || !Array.isArray(slotRows)) throw new HttpError("database_request_failed", 503);
  const overridesByStudio = new Map();
  for (const slot of slotRows) {
    if (!overridesByStudio.has(slot.studio_id)) overridesByStudio.set(slot.studio_id, new Map());
    overridesByStudio.get(slot.studio_id).set(`${slot.date} ${slot.start}`, slot.status);
  }
  const candidateKeys = halfHourKeys(dates);
  const studioInputs = studios.map((studio) => ({
    id: studio.id, name: studio.name, city: studio.city, address: studio.address,
    freeKeys: candidateKeys.filter((key) => {
      const status = overridesByStudio.get(studio.id)?.get(key);
      if (status === "free") return true;
      if (status === "blocked" || status === "locked") return false;
      const [date, start] = key.split(" ");
      return isWithinBusinessHours(studio.business_hours, date, start);
    }),
  }));
  return computeMatches(desiredKeys, studioInputs, { preferredCities, matchMode, proximities });
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
  for (const key of desired) {
    const [date, start] = key.split(" ");
    const { data: existing } = await supabase.from("slots").select("*")
      .eq("studio_id", studio.id).eq("date", date).eq("start", start).maybeSingle();
    if (existing?.status === "blocked" || existing?.status === "locked") continue;
    if (existing?.status === "free") {
      const { data: rows } = await supabase.from("slots")
        .update({ status: "locked", booking_id: bookingId })
        .eq("id", existing.id).eq("status", "free").select("id");
      if (Array.isArray(rows) && rows.length > 0) locked.push(key);
    } else if (!existing && isWithinBusinessHours(studio.business_hours, date, start)) {
      const { data: rows, error } = await supabase.from("slots").insert({
        id: uuid(), studio_id: studio.id, date, start,
        status: "locked", booking_id: bookingId, created_at: NOW(),
      }).select("id");
      if (!error && Array.isArray(rows) && rows.length > 0) locked.push(key);
    }
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
  const bookingRows = bookings ?? [];
  const [studios, speakers, pendingAppeals] = await Promise.all([
    listAll(supabase, "studios"),
    listAll(supabase, "speakers"),
    pendingAppealsByBooking(supabase, bookingRows),
  ]);
  const sById = new Map(studios.map((s) => [s.id, s]));
  const spById = new Map(speakers.map((s) => [s.id, s]));
  const enriched = bookingRows.map((b) => {
    const appeal = pendingAppeals.get(b.id);
    return {
      ...b,
      studio_name: sById.get(b.studio_id)?.name ?? "",
      city: sById.get(b.studio_id)?.city ?? "",
      address: sById.get(b.studio_id)?.address ?? "",
      project_name: spById.get(b.speaker_id)?.project_name ?? "",
      stage_name: spById.get(b.speaker_id)?.stage_name ?? "",
      appeal_status: appeal?.status ?? null,
      appeal_by: appeal ? (appeal.studio_id ? "studio" : "vendor") : null,
    };
  });
  return json({ ok: true, bookings: enriched });
}

async function vendorAppeal(request, supabase) {
  requireMethod(request, "POST");
  const account = await authenticate(request, supabase);
  requireRole(account, "vendor");
  const body = await readJson(request);
  if (!str(body.booking_id, 64) || !str(body.reason, 1000)) throw new HttpError("invalid_body", 400);
  const { data: booking } = await supabase.from("bookings").select("*").eq("id", body.booking_id).maybeSingle();
  if (!booking || booking.vendor_account_id !== account.id) throw new HttpError("not_found", 404);
  if (booking.status !== "confirmed") throw new HttpError("invalid_state", 409);
  const { data: dup } = await supabase.from("appeals").select("id").eq("booking_id", booking.id).eq("status", "pending").maybeSingle();
  if (dup) throw new HttpError("appeal_pending", 409);
  const id = uuid();
  const { error } = await supabase.from("appeals").insert({
    id, booking_id: booking.id, studio_id: null, vendor_account_id: account.id,
    reason: body.reason.trim(), status: "pending", created_at: NOW(), resolved_at: null,
  });
  if (error?.code === "23505") throw new HttpError("appeal_pending", 409);
  if (error) throw new HttpError("database_request_failed", 503);
  await notifyAdmins(supabase, "appeal_submitted", `供应商「${account.display_name || account.username}」提交了预约取消申请,待审核。`);
  const studio = await findStudioById(supabase, booking.studio_id);
  if (studio) await notify(supabase, studio.account_id, "appeal_submitted", `供应商已申请取消预约 ${booking.id.slice(0, 8)}，后台审核前预约仍然有效。`);
  return json({ ok: true, appeal_id: id });
}
