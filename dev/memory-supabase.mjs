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

export function createMemoryClient(db) {
  return { from: (table) => new QueryBuilder(db, table) };
}
