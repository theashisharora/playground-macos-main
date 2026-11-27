// HMAC-SHA256 helpers (Web Crypto, available in Workers and Node 22).
// Used for Ashish AI sessions and for signing assistant replies, so a visitor
// can't forge "assistant" turns in the history they send back.

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

const hmacKey = (secret: string) => {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    keys.set(secret, key);
  }
  return key;
};

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const toBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sign(secret: string, data: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return toBase64Url(new Uint8Array(mac));
}

/** Constant-time verification (crypto.subtle.verify). */
export async function verify(
  secret: string,
  data: string,
  sig: string
): Promise<boolean> {
  const mac = fromBase64Url(sig);
  if (!mac || mac.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), mac, enc.encode(data));
}

// ---------- Chat sessions ----------

export const SESSION_TTL_MS = 30 * 60 * 1000;

interface SessionClaims {
  sid: string;
  exp: number;
}

/** Issued after a successful Turnstile check; lets the next messages skip it. */
export async function issueSession(
  secret: string,
  now: number,
  ttlMs = SESSION_TTL_MS
): Promise<{ token: string; expiresAt: number }> {
  const claims: SessionClaims = {
    sid: toBase64Url(crypto.getRandomValues(new Uint8Array(12))),
    exp: now + ttlMs
  };
  const body = toBase64Url(enc.encode(JSON.stringify(claims)));
  return {
    token: `${body}.${await sign(secret, `session|${body}`)}`,
    expiresAt: claims.exp
  };
}

/** Returns the claims if the token is authentic and unexpired, else null. */
export async function readSession(
  secret: string,
  token: unknown,
  now: number
): Promise<SessionClaims | null> {
  if (typeof token !== "string" || token.length > 512) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!(await verify(secret, `session|${body}`, sig))) return null;
  try {
    const bytes = fromBase64Url(body);
    if (!bytes) return null;
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as SessionClaims;
    if (typeof claims.exp !== "number" || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Signature that marks a reply as genuinely produced by this Worker. */
export const signReply = (secret: string, text: string) => sign(secret, `reply|${text}`);
export const verifyReply = (secret: string, text: string, sig: string) =>
  verify(secret, `reply|${text}`, sig);
