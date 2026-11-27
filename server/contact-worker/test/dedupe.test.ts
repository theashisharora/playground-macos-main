import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { __resetForTests, handleRequest, type Env } from "../src/handler.ts";
import {
  INFLIGHT_TTL_MS,
  claimMessageCheck,
  finishMessageCheck,
  memoryRateLimiter
} from "../src/guards.ts";
import type { EmailTransport, OutgoingEmail } from "../src/email.ts";
import { FakeStorage, createFakeRateLimiterNamespace } from "./fakeDurableObject.ts";

const ORIGIN = "https://portfolio.example";
const env = (ns = createFakeRateLimiterNamespace()): Env => ({
  CONTACT_MODE: "live",
  ALLOWED_ORIGINS: ORIGIN,
  CONTACT_TO_EMAIL: "owner@example.com",
  CONTACT_FROM_EMAIL: "Portfolio <owner@example.com>",
  RESEND_API_KEY: "re",
  TURNSTILE_SECRET_KEY: "ts",
  CONTACT_RATE_LIMITER_DO: ns
});

const req = (messageId: string, ip = "203.0.113.70") =>
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
      message: "Hello Ashish, duplicate test message.",
      website: "",
      elapsedMs: 8000,
      turnstileToken: "tok",
      messageId
    })
  });

/** A slow "live" transport, like a real provider round-trip. */
function slowTransport(ms = 20, ok = true): EmailTransport & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    kind: "live",
    sent,
    async send(e) {
      await new Promise((r) => setTimeout(r, ms));
      if (!ok) return { ok: false, error: "provider_error" };
      sent.push(e);
      return { ok: true, id: "x" };
    }
  };
}

const deps = (transport: EmailTransport) => ({
  transport,
  verifyBot: async () => true,
  rateLimiter: memoryRateLimiter(100, 60_000)
});

beforeEach(() => __resetForTests());

test("concurrent submissions of one message (different Worker instances) send once", async () => {
  const ns = createFakeRateLimiterNamespace();
  const transport = slowTransport();
  const id = "dup-concurrent-0000001";
  const results = await Promise.all(
    [1, 2, 3, 4].map((i) =>
      handleRequest(req(id, `198.51.100.${i}`), env(ns), deps(transport))
    )
  );
  assert.equal(transport.sent.length, 1, "exactly one email");
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409]);
});

test("a retry after success from a new IP is recognised as a duplicate", async () => {
  const ns = createFakeRateLimiterNamespace();
  const transport = slowTransport(0);
  const id = "dup-retry-000000000001";
  assert.equal(
    (await handleRequest(req(id, "192.0.2.1"), env(ns), deps(transport))).status,
    200
  );
  __resetForTests(); // a different isolate has no local memory of it
  const again = await handleRequest(req(id, "192.0.2.99"), env(ns), deps(transport));
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).duplicate, true);
  assert.equal(transport.sent.length, 1);
});

test("a failed send releases the id so Try Again works", async () => {
  const ns = createFakeRateLimiterNamespace();
  const id = "dup-failed-00000000001";
  const failing = slowTransport(0, false);
  assert.equal((await handleRequest(req(id), env(ns), deps(failing))).status, 502);
  const working = slowTransport(0);
  assert.equal((await handleRequest(req(id), env(ns), deps(working))).status, 200);
  assert.equal(working.sent.length, 1);
});

test("ledger outage fails closed: 503 and no email", async () => {
  const ns = createFakeRateLimiterNamespace();
  ns.setFail(true);
  const transport = slowTransport(0);
  const orig = console.error;
  console.error = () => {};
  try {
    // The limiter is injected (healthy); only the ledger's Durable Object is down.
    const res = await handleRequest(
      req("dup-outage-00000000001"),
      env(ns),
      deps(transport)
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: "temporarily_unavailable" });
  } finally {
    console.error = orig;
  }
  assert.equal(transport.sent.length, 0);
});

test("ledger bookkeeping failing AFTER a send still reports the truth (delivered)", async () => {
  const ns = createFakeRateLimiterNamespace();
  const transport: EmailTransport = {
    kind: "live",
    async send() {
      ns.setFail(true); // the DO goes down mid-request
      return { ok: true, id: "x" };
    }
  };
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await handleRequest(
      req("dup-late-fail-00000001"),
      env(ns),
      deps(transport)
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).delivered, true);
  } finally {
    console.error = orig;
  }
});

test("claim state machine: sent is permanent, failed is retryable", async () => {
  const s = new FakeStorage();
  assert.equal(await claimMessageCheck(s, 0), "new");
  assert.equal(await claimMessageCheck(s, 1000), "inflight");
  await finishMessageCheck(s, "failed", 2000);
  assert.equal(await claimMessageCheck(s, 3000), "new", "definite failure can retry");
  await finishMessageCheck(s, true, 4000);
  assert.equal(await claimMessageCheck(s, 10 * INFLIGHT_TTL_MS), "sent");
  assert.ok(s.alarm, "alarm set to forget the id later");
});

test("an attempt that never reported back becomes uncertain, never resent", async () => {
  const s = new FakeStorage();
  assert.equal(await claimMessageCheck(s, 0), "new");
  // e.g. the invocation was cancelled after Gmail may already have accepted it
  assert.equal(await claimMessageCheck(s, INFLIGHT_TTL_MS + 1), "uncertain");
  assert.equal(
    await claimMessageCheck(s, 5 * INFLIGHT_TTL_MS),
    "uncertain",
    "stays locked"
  );
});

test("uncertain outcome locks the id permanently", async () => {
  const s = new FakeStorage();
  await claimMessageCheck(s, 0);
  await finishMessageCheck(s, "uncertain", 10);
  assert.equal(await claimMessageCheck(s, 20), "uncertain");
});
