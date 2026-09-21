// Portable, dependency-free data store for self-hosting.
// Implements the small query-builder subset that functions/handler.mjs uses,
// backed by a single JSON file with atomic (temp-file + rename) writes.
// In-memory mode (no file) is also supported for tests.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TABLES = [
  "accounts", "studios", "speakers", "slots", "city_proximities",
  "schedule_requests", "bookings", "appeals", "notifications",
];

const emptyDb = () => Object.fromEntries(TABLES.map((t) => [t, []]));

class QueryBuilder {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.op = "select";
    this.payload = null;
    this.wantReturn = false;
    this.orderSpec = null;
    this.rangeSpec = null;
    this.limitN = null;
    this._single = false;
    this._maybe = false;
    this._mutated = false;
  }
  select() { if (this.op !== "select") this.wantReturn = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }
  in(col, arr) { const s = new Set(arr); this.filters.push((r) => s.has(r[col])); return this; }
  gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }
  lte(col, val) { this.filters.push((r) => r[col] <= val); return this; }
  order(col, opts = { ascending: true }) { this.orderSpec = { col, ascending: opts.ascending !== false }; return this; }
  range(a, b) { this.rangeSpec = [a, b]; return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybe = true; return this; }

  _rows() {
    const db = this.store.db;
    return db[this.table] ?? (db[this.table] = []);
  }
  _match(r) { return this.filters.every((f) => f(r)); }

  _run() {
    const table = this._rows();
    let result;
    if (this.op === "insert") {
      const clones = this.payload.map((r) => ({ ...r }));
      if (this.table === "appeals" && clones.some((row) => row.status === "pending"
        && table.some((existing) => existing.booking_id === row.booking_id && existing.status === "pending"))) {
        return { data: null, error: { code: "23505", message: "pending appeal already exists" } };
      }
      table.push(...clones);
      result = clones;
      this._mutated = true;
    } else if (this.op === "update") {
      const changed = table.filter((r) => this._match(r));
      for (const r of changed) Object.assign(r, this.payload);
      result = changed;
      this._mutated = true;
    } else if (this.op === "delete") {
      const removed = [];
      for (let i = table.length - 1; i >= 0; i--) {
        if (this._match(table[i])) removed.push(table.splice(i, 1)[0]);
      }
      result = removed;
      this._mutated = true;
    } else {
      result = table.filter((r) => this._match(r));
      if (this.orderSpec) {
        const { col, ascending } = this.orderSpec;
        result = [...result].sort((a, b) => {
          if (a[col] < b[col]) return ascending ? -1 : 1;
          if (a[col] > b[col]) return ascending ? 1 : -1;
          return 0;
        });
      }
      if (this.rangeSpec) result = result.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
      if (this.limitN != null) result = result.slice(0, this.limitN);
    }
    if (this._single) {
      return { data: result[0] ?? null, error: result.length === 1 ? null : { message: result.length === 0 ? "no rows" : "multiple rows" } };
    }
    if (this._maybe) return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }

  then(resolve, reject) {
    try {
      const result = this._run();
      if (this._mutated) {
        this.store.flush().then(() => resolve(result), reject);
      } else {
        resolve(result);
      }
    } catch (e) {
      reject(e);
    }
  }
}

function addNotification(db, accountId, kind, message, createdAt) {
  db.notifications.push({
    id: randomUUID(), account_id: accountId, kind, message, read: false, created_at: createdAt,
  });
}

function resolveBookingAppeal(db, { p_appeal_id: appealId, p_decision: decision }) {
  const appeal = db.appeals.find((item) => item.id === appealId && item.status === "pending");
  if (!appeal) return { data: "not_found", error: null };

  const resolvedAt = new Date().toISOString();
  if (decision === "rejected") {
    appeal.status = "rejected";
    appeal.resolved_at = resolvedAt;
    if (appeal.studio_id) {
      const studio = db.studios.find((item) => item.id === appeal.studio_id);
      if (studio) addNotification(db, studio.account_id, "appeal_rejected", `申诉已被驳回(预约 ${appeal.booking_id.slice(0, 8)}),原预约档期仍然有效。`, resolvedAt);
    } else {
      addNotification(db, appeal.vendor_account_id, "appeal_rejected", `取消申诉已被驳回(预约 ${appeal.booking_id.slice(0, 8)}),原预约档期仍然有效。`, resolvedAt);
    }
    return { data: "ok", error: null };
  }

  const booking = db.bookings.find((item) => item.id === appeal.booking_id);
  if (!booking) return { data: null, error: { message: "booking not found" } };
  db.slots = db.slots.filter((item) => item.booking_id !== booking.id);
  booking.status = "released";

  const studio = db.studios.find((item) => item.id === booking.studio_id);
  if (appeal.studio_id) {
    const request = db.schedule_requests.find((item) => item.id === booking.request_id);
    if (request) {
      request.desired = [...new Set([...(request.desired ?? []), ...(booking.slots ?? [])])];
      request.status = "reopened";
    }
    addNotification(db, booking.vendor_account_id, "booking_released", "原定录音棚因申诉已释放你的档期,请重新选择录音棚(档期已为你保留,无需重新填写)。", resolvedAt);
    if (studio) addNotification(db, studio.account_id, "appeal_approved", "申诉已通过,相关档期已释放。", resolvedAt);
  } else {
    addNotification(db, booking.vendor_account_id, "booking_cancelled", `取消申诉已通过,预约 ${booking.id.slice(0, 8)} 已取消。`, resolvedAt);
    if (studio) addNotification(db, studio.account_id, "booking_cancelled", `供应商取消申诉已通过,预约 ${booking.id.slice(0, 8)} 已取消,相关档期已释放。`, resolvedAt);
  }

  appeal.status = "approved";
  appeal.resolved_at = resolvedAt;
  return { data: "ok", error: null };
}

function adminAdjustBooking(db, { p_booking_id: bookingId, p_slots: slots, p_status: status }) {
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) return { data: "not_found", error: null };
  const conflict = status === "confirmed" && slots.some((key) => {
    const [date, start] = key.split(" ");
    return db.slots.some((slot) => slot.studio_id === booking.studio_id && slot.date === date && slot.start === start && slot.status === "locked" && slot.booking_id !== booking.id);
  });
  if (conflict) return { data: "slot_conflict", error: null };

  const changedAt = new Date().toISOString();
  db.slots = db.slots.filter((item) => item.booking_id !== booking.id);
  if (status === "confirmed") {
    for (const key of slots) {
      const [date, start] = key.split(" ");
      const existing = db.slots.find((slot) => slot.studio_id === booking.studio_id && slot.date === date && slot.start === start);
      if (existing) Object.assign(existing, { status: "locked", booking_id: booking.id });
      else db.slots.push({ id: randomUUID(), studio_id: booking.studio_id, date, start, status: "locked", booking_id: booking.id, created_at: changedAt });
    }
  }
  booking.slots = [...new Set(slots)];
  booking.status = status;
  if (status === "released") {
    for (const appeal of db.appeals.filter((item) => item.booking_id === booking.id && item.status === "pending")) {
      appeal.status = "rejected";
      appeal.resolved_at = changedAt;
    }
  }
  const message = `后台已调整预约 ${booking.id.slice(0, 8)} 的档期或状态，请进入系统查看最新内容。`;
  addNotification(db, booking.vendor_account_id, "admin_record_updated", message, changedAt);
  const studio = db.studios.find((item) => item.id === booking.studio_id);
  if (studio) addNotification(db, studio.account_id, "admin_record_updated", message, changedAt);
  return { data: "ok", error: null };
}

class FileStore {
  constructor(file) {
    this.file = file || null;
    this.db = emptyDb();
    if (this.file && existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        if (parsed && typeof parsed === "object") this.db = { ...emptyDb(), ...parsed };
      } catch {
        // Corrupt or unreadable file: start empty rather than crash.
      }
    }
    this._queue = Promise.resolve();
  }
  from(table) { return new QueryBuilder(this, table); }
  async rpc(name, args) {
    if (!["resolve_booking_appeal", "admin_adjust_booking"].includes(name)) {
      return { data: null, error: { message: `unknown rpc: ${name}` } };
    }
    const snapshot = structuredClone(this.db);
    const result = name === "resolve_booking_appeal"
      ? resolveBookingAppeal(this.db, args)
      : adminAdjustBooking(this.db, args);
    if (result.error || result.data !== "ok") return result;
    try {
      await this.flush();
      return result;
    } catch (error) {
      this.db = snapshot;
      return { data: null, error };
    }
  }
  // Serialized atomic write: snapshot now, queue behind any in-flight write.
  flush() {
    if (!this.file) return Promise.resolve();
    const data = JSON.stringify(this.db);
    const file = this.file;
    this._queue = this._queue.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, data, "utf8");
      await rename(tmp, file);
    });
    return this._queue;
  }
}

export function createFileStore(file) {
  return new FileStore(file);
}
