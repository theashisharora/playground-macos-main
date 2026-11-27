// ---------- Rate limiting ----------

export interface RateLimiter {
  /** Returns true when the request identified by `key` may proceed. */
  allow(key: string): Promise<boolean>;
}

/** Shape of a Cloudflare Workers Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const bindingRateLimiter = (binding: RateLimitBinding): RateLimiter => ({
  async allow(key) {
    const { success } = await binding.limit({ key });
    return success;
  }
});

/** 5 messages per IP per 10 minutes. */
export const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 } as const;

// ---------- Durable Object limiter (authoritative in production) ----------

/** Subset of Durable Object storage used by the limiter. */
export interface WindowStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface WindowDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Sliding-window check run INSIDE the per-IP Durable Object. A Durable Object
 * handles one request at a time, so this read-modify-write cannot race, and
 * every Worker instance worldwide talks to the same object for a given key.
 */
export async function slidingWindowCheck(
  storage: WindowStorage,
  max: number,
  windowMs: number,
  now: number
): Promise<WindowDecision> {
  const hits = ((await storage.get<number[]>("hits")) ?? []).filter(
    (t) => now - t < windowMs
  );
  if (hits.length >= max) {
    // Denied: no write, so floods don't burn the storage-write quota.
    return { allowed: false, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  await storage.put("hits", hits);
  // Wipe the object's storage once the window has passed since the last hit.
  await storage.setAlarm(now + windowMs);
  return { allowed: true, retryAfterMs: 0 };
}

// ---------- Duplicate-send ledger (one Durable Object per message id) ----------

export type ClaimState = "new" | "inflight" | "sent" | "uncertain";

/** How a send attempt ended. `true`/`false` are accepted for "sent"/"failed". */
export type LedgerResult = "sent" | "failed" | "uncertain";
const toResult = (r: LedgerResult | boolean): LedgerResult =>
  r === true ? "sent" : r === false ? "failed" : r;

interface LedgerRecord {
  state: "inflight" | LedgerResult;
  at: number;
}

/** How long a send attempt "owns" a message id before a retry may take over. */
export const INFLIGHT_TTL_MS = 2 * 60 * 1000;
/** How long a sent message id is remembered. */
export const LEDGER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Claims a message id before sending. Runs inside the message's own Durable
 * Object, so two Worker instances can't both get "new" for the same id.
 */
export async function claimMessageCheck(
  storage: WindowStorage,
  now: number,
  inflightTtlMs = INFLIGHT_TTL_MS
): Promise<ClaimState> {
  const rec = await storage.get<LedgerRecord>("msg");
  if (rec?.state === "sent") return "sent";
  // Possibly delivered: never send this id again (no automatic duplicates).
  if (rec?.state === "uncertain") return "uncertain";
  if (rec?.state === "inflight") {
    if (now - rec.at < inflightTtlMs) return "inflight";
    // An attempt that never reported back (e.g. the invocation was cancelled
    // mid-send) may have been accepted by the provider: treat it as uncertain.
    await storage.put<LedgerRecord>("msg", { state: "uncertain", at: now });
    return "uncertain";
  }
  await storage.put<LedgerRecord>("msg", { state: "inflight", at: now });
  await storage.setAlarm(now + LEDGER_TTL_MS);
  return "new";
}

/**
 * Records the outcome. "failed" (definitely not accepted) releases the id so
 * "Try Again" works; "sent" and "uncertain" lock it for the ledger's lifetime.
 */
export async function finishMessageCheck(
  storage: WindowStorage,
  result: LedgerResult | boolean,
  now: number
): Promise<void> {
  await storage.put<LedgerRecord>("msg", { state: toResult(result), at: now });
}

/** RPC surface of the rate-limiter Durable Objects. */
export interface RateLimiterStub {
  check(max: number, windowMs: number): Promise<WindowDecision>;
  claimMessage?(inflightTtlMs: number): Promise<ClaimState>;
  finishMessage?(result: LedgerResult | boolean): Promise<void>;
}

/** Shape of the Durable Object namespace binding we use. */
export interface RateLimiterNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): RateLimiterStub;
}

/**
 * Thrown when the rate limiter can't give a trustworthy answer. The handler
 * turns it into a generic 503 (fail closed); `cause` is only logged server-side.
 */
export class RateLimiterUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Rate limiter unavailable");
    this.name = "RateLimiterUnavailableError";
    this.cause = cause;
  }
}

/**
 * Global limiter: one Durable Object per key (per IP), shared by every Worker
 * instance. FAILS CLOSED: if the Durable Object call throws (platform incident,
 * free-plan daily quota, timeout) or returns anything other than a well-formed
 * decision, it throws RateLimiterUnavailableError and no message is sent.
 */
export function durableObjectRateLimiter(
  ns: RateLimiterNamespace,
  max: number = RATE_LIMIT.max,
  windowMs: number = RATE_LIMIT.windowMs
): RateLimiter {
  return {
    async allow(key) {
      let decision: unknown;
      try {
        const stub = ns.get(ns.idFromName(key));
        decision = await stub.check(max, windowMs);
      } catch (err) {
        throw new RateLimiterUnavailableError(err);
      }
      const allowed = (decision as { allowed?: unknown } | null)?.allowed;
      if (typeof allowed !== "boolean")
        throw new RateLimiterUnavailableError(new Error("Malformed rate-limit decision"));
      return allowed;
    }
  };
}

/** Stops the same message id from being emailed twice. */
export interface MessageLedger {
  claim(messageId: string): Promise<ClaimState>;
  finish(messageId: string, result: LedgerResult | boolean): Promise<void>;
}

/**
 * Global ledger: one Durable Object per message id, so a retry that lands on a
 * different Worker instance (or arrives while the first try is still running)
 * is still recognised. This matters for Gmail, which has no idempotency key.
 * Fails closed on claim: if the ledger can't answer, nothing is sent.
 */
export function durableObjectLedger(ns: RateLimiterNamespace): MessageLedger {
  const stub = (id: string) => ns.get(ns.idFromName(`msg:${id}`));
  return {
    async claim(messageId) {
      let state: unknown;
      try {
        state = await stub(messageId).claimMessage!(INFLIGHT_TTL_MS);
      } catch (err) {
        throw new RateLimiterUnavailableError(err);
      }
      if (
        state !== "new" &&
        state !== "inflight" &&
        state !== "sent" &&
        state !== "uncertain"
      )
        throw new RateLimiterUnavailableError(new Error("Malformed ledger state"));
      return state;
    },
    async finish(messageId, result) {
      await stub(messageId).finishMessage!(toResult(result));
    }
  };
}

/** Per-isolate ledger for mock mode / local dev (not global). */
export function memoryLedger(now: () => number = Date.now): MessageLedger & {
  clear(): void;
} {
  const records = new Map<string, LedgerRecord>();
  return {
    async claim(id) {
      const t = now();
      for (const [k, r] of records) if (t - r.at > LEDGER_TTL_MS) records.delete(k);
      const rec = records.get(id);
      if (rec?.state === "sent") return "sent";
      if (rec?.state === "uncertain") return "uncertain";
      if (rec?.state === "inflight") {
        if (t - rec.at < INFLIGHT_TTL_MS) return "inflight";
        records.set(id, { state: "uncertain", at: t });
        return "uncertain";
      }
      records.set(id, { state: "inflight", at: t });
      return "new";
    },
    async finish(id, result) {
      records.set(id, { state: toResult(result), at: now() });
    },
    clear: () => records.clear()
  };
}

// ---------- In-memory limiter (local dev / tests only) ----------

/**
 * Sliding-window limiter held in ONE isolate's memory. Cloudflare runs many
 * isolates across many locations, so this does NOT enforce a global limit.
 * It's used only when no Durable Object binding exists (mock mode / local
 * dev); live mode refuses to start without the Durable Object.
 */
export function memoryRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async allow(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) hits.clear(); // bound memory
      return true;
    }
  };
}

// ---------- Ash AI usage limits (separate from the contact quota) ----------

/** Per-IP chat limits plus a global daily cap that keeps Gemini usage bounded. */
export const CHAT_RATE = {
  burst: { max: 10, windowMs: 10 * 60 * 1000 },
  daily: { max: 40, windowMs: 24 * 60 * 60 * 1000 },
  /** Default global replies per rolling 24 h (override with CHAT_DAILY_LIMIT). */
  globalDaily: 300
} as const;

export type ChatUsageVerdict = "ok" | "ip_limited" | "global_limited";

export interface ChatUsageLimiter {
  consume(ip: string): Promise<ChatUsageVerdict>;
}

/**
 * Chat quota built from three sliding windows: per-IP burst, per-IP day, and a
 * global day. `make(max, windowMs)` supplies the limiter for each window (a
 * Durable Object limiter in production). Any error propagates, so callers fail
 * closed. The chat namespace is a different Durable Object class from the
 * contact limiter, so chat traffic can never use up the contact quota.
 */
export function chatUsageLimiter(
  make: (max: number, windowMs: number) => RateLimiter,
  globalDaily: number = CHAT_RATE.globalDaily
): ChatUsageLimiter {
  const burst = make(CHAT_RATE.burst.max, CHAT_RATE.burst.windowMs);
  const daily = make(CHAT_RATE.daily.max, CHAT_RATE.daily.windowMs);
  const global = make(globalDaily, CHAT_RATE.daily.windowMs);
  return {
    async consume(ip) {
      if (!(await burst.allow(`chat:burst:${ip}`))) return "ip_limited";
      if (!(await daily.allow(`chat:day:${ip}`))) return "ip_limited";
      if (!(await global.allow("chat:global"))) return "global_limited";
      return "ok";
    }
  };
}

// ---------- Bot protection (Cloudflare Turnstile) ----------

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
  fetchImpl: FetchLike = fetch
): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);
  try {
    const res = await fetchImpl(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification failed", err);
    return false;
  }
}
