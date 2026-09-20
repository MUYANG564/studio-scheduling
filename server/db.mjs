// Chooses the data store at runtime:
//   - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, use a real Supabase
//     (Postgres) project via @supabase/supabase-js. Data persists for free.
//   - Otherwise fall back to the local JSON file store (single-machine only).
// The handler talks to both through the same query-builder interface.
import { createFileStore } from "./store.mjs";

export async function createStore(dataFile) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (url && key) {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { client, mode: "supabase" };
  }
  return { client: createFileStore(dataFile), mode: "file" };
}
