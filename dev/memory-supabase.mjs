import { randomUUID } from "node:crypto";

// Local-only in-memory stand-in for the Supabase client, implementing just the
// query-builder subset used by functions/handler.mjs. NOT used in production.
// Keeps everything in memory; data resets when the dev server restarts.

class QueryBuilder {
  constructor(db, table) {
    this.db = db;
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
    const table = this.db[this.table] ?? (this.db[this.table] = []);
    return table;
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
    } else if (this.op === "update") {
      const changed = table.filter((r) => this._match(r));
      for (const r of changed) Object.assign(r, this.payload);
      result = changed;
    } else if (this.op === "delete") {
      const removed = [];
      for (let i = table.length - 1; i >= 0; i--) {
        if (this._match(table[i])) removed.push(table.splice(i, 1)[0]);
      }
      result = removed;
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
    if (this._single) return { data: result[0] ?? null, error: result.length === 1 ? null : (result.length === 0 ? { message: "no rows" } : { message: "multiple rows" }) };
    if (this._maybe) return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }
  then(resolve, reject) {
    try { resolve(this._run()); } catch (e) { reject(e); }
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

export function createMemoryClient(db) {
  return {
    from: (table) => new QueryBuilder(db, table),
    rpc: (name, args) => name === "resolve_booking_appeal"
      ? resolveBookingAppeal(db, args)
      : { data: null, error: { message: `unknown rpc: ${name}` } },
  };
}
