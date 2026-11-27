import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  RATE_LIMIT,
  RateLimiterUnavailableError,
  durableObjectRateLimiter,
  memoryRateLimiter,
  type RateLimiterNamespace
} from "../src/guards.ts";
import {
  __resetForTests,
  handleRequest,
  missingLiveConfig,
  selectRateLimiter,
  type Env
} from "../src/handler.ts";
import { createMockTransport } from "../src/email.ts";
import { createFakeRateLimiterNamespace } from "./fakeDurableObject.ts";

const { max, windowMs } = RATE_LIMIT;

beforeEach(() => __resetForTests());

test("in-memory limiter is NOT global: two isolates together exceed the limit", async () => {
  // Documents why the in-memory limiter can't be used in production.
  const isolateA = memoryRateLimiter(max, windowMs);
  const isolateB = memoryRateLimiter(max, windowMs);
  let allowed = 0;
  for (let i = 0; i < max; i++) {
    if (await isolateA.allow("ip")) allowed++;
    if (await isolateB.allow("ip")) allowed++;
  }
  assert.equal(allowed, max * 2);
});

test("Durable Object limiter enforces one limit across many Worker instances", async () => {
  const ns = createFakeRateLimiterNamespace();
  // Each Worker isolate builds its own limiter object; they share the namespace.
  const isolates = [1, 2, 3, 4].map(() => durableObjectRateLimiter(ns));
  let allowed = 0;
  for (let i = 0; i < 12; i++)
    if (await isolates[i % 4].allow("contact:203.0.113.7")) allowed++;
  assert.equal(allowed, max);
});

test("concurrent requests can't race past the limit", async () => {
  const ns = createFakeRateLimiterNamespace();
  const limiters = Array.from({ length: 20 }, () => durableObjectRateLimiter(ns));
  const results = await Promise.all(limiters.map((l) => l.allow("contact:198.51.100.9")));
  assert.equal(results.filter(Boolean).length, max);
});

test("the window slides and alarms clean up storage", async () => {
  let now = 1_000_000;
  const ns = createFakeRateLimiterNamespace(() => now);
  const limiter = durableObjectRateLimiter(ns);
  for (let i = 0; i < max; i++) assert.equal(await limiter.allow("k"), true);
  assert.equal(await limiter.allow("k"), false);

  now += windowMs - 1;
  assert.equal(await limiter.allow("k"), false, "still inside the window");

  const { storage } = ns.objects.get("id:k")!;
  assert.equal(
    storage.alarm,
    1_000_000 + windowMs,
    "alarm set from the last allowed hit"
  );

  now = 1_000_000 + windowMs;
  await ns.runDueAlarms();
  assert.equal(storage.data.size, 0, "alarm wiped this IP's data");
  assert.equal(await limiter.allow("k"), true, "allowed again after the window");
});

test("denied requests don't write to storage", async () => {
  const ns = createFakeRateLimiterNamespace();
  const limiter = durableObjectRateLimiter(ns);
  for (let i = 0; i < max; i++) await limiter.allow("k");
  const { storage } = ns.objects.get("id:k")!;
  const writes = storage.writes;
  for (let i = 0; i < 50; i++) await limiter.allow("k");
  assert.equal(storage.writes, writes);
});

test("different IPs have independent limits", async () => {
  const ns = createFakeRateLimiterNamespace();
  const limiter = durableObjectRateLimiter(ns);
  for (let i = 0; i < max; i++) await limiter.allow("contact:a");
  assert.equal(await limiter.allow("contact:a"), false);
  assert.equal(await limiter.allow("contact:b"), true);
});

test("if the Durable Object is unreachable the limiter fails closed", async () => {
  const ns = createFakeRateLimiterNamespace();
  ns.setFail(true);
  await assert.rejects(
    durableObjectRateLimiter(ns).allow("k"),
    RateLimiterUnavailableError
  );
});

test("a malformed Durable Object response also fails closed", async () => {
  for (const bad of [undefined, null, {}, { allowed: "yes" }, { allowed: 1 }]) {
    const ns: RateLimiterNamespace = {
      idFromName: (n) => n,
      get: () => ({ check: async () => bad as any })
    };
    await assert.rejects(
      durableObjectRateLimiter(ns).allow("k"),
      RateLimiterUnavailableError,
      JSON.stringify(bad)
    );
  }
});

test("idFromName / get throwing synchronously also fails closed", async () => {
  const ns: RateLimiterNamespace = {
    idFromName: () => {
      throw new Error("binding misconfigured");
    },
    get: () => ({ check: async () => ({ allowed: true, retryAfterMs: 0 }) })
  };
  await assert.rejects(
    durableObjectRateLimiter(ns).allow("k"),
    RateLimiterUnavailableError
  );
});

// ---------- Handler wiring ----------

const ORIGIN = "https://portfolio.example";
const baseLive: Env = {
  CONTACT_MODE: "live",
  ALLOWED_ORIGINS: ORIGIN,
  CONTACT_TO_EMAIL: "owner@example.com",
  CONTACT_FROM_EMAIL: "Portfolio <contact@example.com>",
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "ts_test"
};

let n = 0;
const post = (ip: string, token = "tok") =>
  new Request("https://worker.example/contact", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip
    },
    body: JSON.stringify({
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Hello Ashish, this is a test message.",
      website: "",
      elapsedMs: 8000,
      turnstileToken: token,
      messageId: `rl-${String(++n).padStart(16, "0")}`
    })
  });

test("live mode requires the Durable Object binding", async () => {
  assert.deepEqual(missingLiveConfig(baseLive), ["CONTACT_RATE_LIMITER_DO"]);
  const res = await handleRequest(post("203.0.113.1"), baseLive, {
    transport: createMockTransport(),
    verifyBot: async () => true
  });
  assert.equal(res.status, 503);
  const health = await handleRequest(
    new Request("https://worker.example/health"),
    baseLive
  );
  assert.equal(((await health.json()) as any).ready, false);
});

test("handler uses the Durable Object when bound and returns 429 past the limit", async () => {
  const ns = createFakeRateLimiterNamespace();
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  assert.equal(missingLiveConfig(env).length, 0);
  const transport = createMockTransport();
  const statuses: number[] = [];
  for (let i = 0; i < max + 1; i++) {
    const res = await handleRequest(post("203.0.113.2"), env, {
      transport,
      verifyBot: async () => true
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [...Array(max).fill(200), 429]);
  assert.equal(transport.sent.length, max);
});

test("requests failing the bot check never reach the rate limiter", async () => {
  const ns = createFakeRateLimiterNamespace();
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  for (let i = 0; i < 20; i++) {
    const res = await handleRequest(post("203.0.113.3", ""), env, {
      transport: createMockTransport(),
      verifyBot: async (token) => token !== ""
    });
    assert.equal(res.status, 400);
  }
  assert.equal(ns.calls(), 0);
});

test("limiter selection prefers the Durable Object", () => {
  const ns = createFakeRateLimiterNamespace();
  const binding = { limit: async () => ({ success: true }) };
  const withBoth = selectRateLimiter({
    CONTACT_RATE_LIMITER_DO: ns,
    CONTACT_RATE_LIMITER: binding
  });
  const memOnly = selectRateLimiter({});
  assert.notEqual(withBoth, memOnly);
});

// ---------- Fail-closed behaviour in the handler ----------

const silenceErrors = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => logged.push(a);
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = orig;
  }
};

test("Durable Object outage: 503, generic message, and NO email sent", async () => {
  const ns = createFakeRateLimiterNamespace();
  ns.setFail(true);
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  const transport = createMockTransport();

  const { value: res, logged } = await silenceErrors(() =>
    handleRequest(post("203.0.113.4"), env, { transport, verifyBot: async () => true })
  );

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { ok: false, error: "temporarily_unavailable" });
  for (const internal of [
    "Durable Object",
    "RateLimiterUnavailableError",
    "stack",
    "at "
  ])
    assert.ok(!text.includes(internal), `no internal details leaked (${internal})`);
  assert.equal(transport.sent.length, 0, "no email may be sent");
  assert.equal(logged.length, 1, "details are logged server-side");
});

test("malformed Durable Object response: 503 and NO email sent", async () => {
  const ns: RateLimiterNamespace = {
    idFromName: (n) => n,
    get: () => ({ check: async () => ({ unexpected: true }) as any })
  };
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  const transport = createMockTransport();
  const { value: res } = await silenceErrors(() =>
    handleRequest(post("203.0.113.5"), env, { transport, verifyBot: async () => true })
  );
  assert.equal(res.status, 503);
  assert.equal(transport.sent.length, 0);
});

test("after an outage recovers, messages flow again within the same limit", async () => {
  const ns = createFakeRateLimiterNamespace();
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  const transport = createMockTransport();
  const send = () =>
    handleRequest(post("203.0.113.6"), env, { transport, verifyBot: async () => true });

  ns.setFail(true);
  const { value: down } = await silenceErrors(send);
  assert.equal(down.status, 503);
  ns.setFail(false);
  const statuses: number[] = [];
  for (let i = 0; i < max + 1; i++) statuses.push((await send()).status);
  assert.deepEqual(statuses, [...Array(max).fill(200), 429]);
  assert.equal(transport.sent.length, max);
});

test("a failing bot check still wins over a down limiter (400, not 503)", async () => {
  const ns = createFakeRateLimiterNamespace();
  ns.setFail(true);
  const env: Env = { ...baseLive, CONTACT_RATE_LIMITER_DO: ns };
  const res = await handleRequest(post("203.0.113.7", ""), env, {
    transport: createMockTransport(),
    verifyBot: async (t) => t !== ""
  });
  assert.equal(res.status, 400);
  assert.equal(ns.calls(), 0);
});

test("mock/dev mode without a Durable Object is unchanged (in-memory limiter)", async () => {
  const transport = createMockTransport();
  const res = await handleRequest(
    post("203.0.113.8"),
    { ALLOWED_ORIGINS: ORIGIN },
    { transport }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: false, mode: "mock" });
  assert.equal(transport.sent.length, 1);
});
