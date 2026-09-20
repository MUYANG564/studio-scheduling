// Portable, dependency-free data store for self-hosting.
// Implements the small query-builder subset that functions/handler.mjs uses,
// backed by a single JSON file with atomic (temp-file + rename) writes.
// In-memory mode (no file) is also supported for tests.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TABLES = [
  "accounts", "studios", "speakers", "slots",
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
  // Serialized atomic write: snapshot now, queue behind any in-flight write.
  flush() {
    if (!this.file) return Promise.resolve();
    const data = JSON.stringify(this.db);
    const file = this.file;
    this._queue = this._queue.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, data, "utf8");
      await rename(tmp, file);
    }).catch((e) => {
      console.error("[store] 写入数据文件失败:", e?.message ?? e);
    });
    return this._queue;
  }
}

export function createFileStore(file) {
  return new FileStore(file);
}
