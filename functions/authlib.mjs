// Self-contained auth utilities for the studio-scheduling app.
// Runs under both Deno (production) and Node 22 (local dev) via WebCrypto.
// This app uses its own username/password accounts because studios and
// speaker vendors are external parties without Qoder accounts. All access
// control is enforced here, inside the single trusted Function.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = {
  encode(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url.encode(salt)}$${b64url.encode(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1000) return false;
  const salt = b64url.decode(parts[2]);
  const expected = b64url.decode(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Stateless signed session token: base64url(payload).base64url(HMAC).
export async function signToken(secret, payload) {
  const body = b64url.encode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64url.encode(sig)}`;
}

export async function verifyToken(secret, token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await hmacKey(secret);
  let ok;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64url.decode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(b64url.decode(body)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function sessionSecret() {
  const fromDeno = globalThis.Deno?.env?.get?.("APP_SESSION_SECRET");
  const fromNode = globalThis.process?.env?.APP_SESSION_SECRET;
  return fromDeno || fromNode || "dev-insecure-session-secret-change-me";
}
