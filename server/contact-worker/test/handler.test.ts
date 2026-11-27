import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { __resetForTests, handleRequest, type Env } from "../src/handler.ts";
import {
  buildContactEmail,
  createMockTransport,
  createResendTransport
} from "../src/email.ts";
import { memoryRateLimiter } from "../src/guards.ts";
import { createFakeRateLimiterNamespace } from "./fakeDurableObject.ts";

const ORIGIN = "https://portfolio.example";
const liveEnv: Env = {
  CONTACT_MODE: "live",
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
  CONTACT_TO_EMAIL: "owner@example.com",
  CONTACT_FROM_EMAIL: "Portfolio <contact@example.com>",
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "ts_test",
  CONTACT_RATE_LIMITER_DO: createFakeRateLimiterNamespace()
};

let n = 0;
const payload = (extra: Record<string, unknown> = {}) => ({
  name: "Jane Doe",
  email: "jane@example.com",
  message: "Hi Ashish, I'd love to chat about a role.",
  website: "",
  elapsedMs: 8000,
  turnstileToken: "tok",
  messageId: `msg-${String(++n).padStart(16, "0")}`,
  ...extra
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://worker.example/contact", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

const deps = (over: Record<string, unknown> = {}) => ({
  transport: createMockTransport(),
  rateLimiter: memoryRateLimiter(100, 60_000),
  verifyBot: async () => true,
  ...over
});

beforeEach(() => __resetForTests());

test("delivers a valid message with Reply-To set to the visitor", async () => {
  const d = deps({
    transport: {
      ...createMockTransport(),
      kind: "live" as const,
      sent: [] as any[],
      async send(e: any) {
        (this as any).sent.push(e);
        return { ok: true as const };
      }
    }
  });
  const res = await handleRequest(post(payload()), liveEnv, d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: true, mode: "live" });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const sent = (d.transport as any).sent[0];
  assert.equal(sent.to, "owner@example.com");
  assert.equal(sent.from, "Portfolio <contact@example.com>");
  assert.equal(sent.replyTo, "jane@example.com");
  assert.match(sent.idempotencyKey, /^contact-msg-/);
});

test("never reports success when the provider fails", async () => {
  const transport = {
    kind: "live" as const,
    send: async () => ({ ok: false as const, error: "provider_error" })
  };
  const res = await handleRequest(post(payload()), liveEnv, deps({ transport }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { ok: false, error: "delivery_failed" });
});

test("mock mode validates but reports delivered:false", async () => {
  const transport = createMockTransport();
  const res = await handleRequest(
    post(payload()),
    { ALLOWED_ORIGINS: ORIGIN },
    deps({ transport })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: false, mode: "mock" });
  assert.equal(transport.sent.length, 1);
});

test("live mode refuses to run with missing configuration", async () => {
  const res = await handleRequest(
    post(payload()),
    { ...liveEnv, RESEND_API_KEY: "" },
    deps()
  );
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.ok(!body.includes("re_test"));
});

test("rejects disallowed origins and methods", async () => {
  assert.equal(
    (
      await handleRequest(
        post(payload(), { Origin: "https://evil.example" }),
        liveEnv,
        deps()
      )
    ).status,
    403
  );
  const get = new Request("https://worker.example/contact", {
    headers: { Origin: ORIGIN }
  });
  assert.equal((await handleRequest(get, liveEnv, deps())).status, 405);
  const pre = new Request("https://worker.example/contact", {
    method: "OPTIONS",
    headers: { Origin: ORIGIN }
  });
  const preRes = await handleRequest(pre, liveEnv, deps());
  assert.equal(preRes.status, 204);
  assert.equal(preRes.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

test("rejects wrong content type, bad JSON and oversize bodies", async () => {
  assert.equal(
    (
      await handleRequest(
        post(payload(), { "Content-Type": "text/plain" }),
        liveEnv,
        deps()
      )
    ).status,
    415
  );
  assert.equal((await handleRequest(post("{not json"), liveEnv, deps())).status, 400);
  assert.equal(
    (await handleRequest(post(payload({ message: "x".repeat(20_000) })), liveEnv, deps()))
      .status,
    413
  );
});

test("returns field errors for invalid input", async () => {
  const res = await handleRequest(post(payload({ email: "nope" })), liveEnv, deps());
  assert.equal(res.status, 422);
  const body = (await res.json()) as any;
  assert.equal(body.error, "invalid");
  assert.ok(body.fields.email);
});

test("bot protection: honeypot, fill time and Turnstile", async () => {
  const transport = createMockTransport();
  assert.equal(
    (
      await handleRequest(
        post(payload({ website: "spam.biz" })),
        liveEnv,
        deps({ transport })
      )
    ).status,
    400
  );
  assert.equal(
    (await handleRequest(post(payload({ elapsedMs: 300 })), liveEnv, deps({ transport })))
      .status,
    400
  );
  const res = await handleRequest(
    post(payload()),
    liveEnv,
    deps({ transport, verifyBot: async () => false })
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, "bot_check_failed");
  assert.equal(transport.sent.length, 0);
});

test("rate limits per IP", async () => {
  const rateLimiter = memoryRateLimiter(2, 60_000);
  const d = deps({ rateLimiter });
  assert.equal((await handleRequest(post(payload()), liveEnv, d)).status, 200);
  assert.equal((await handleRequest(post(payload()), liveEnv, d)).status, 200);
  const third = await handleRequest(post(payload()), liveEnv, d);
  assert.equal(third.status, 429);
  assert.ok(third.headers.get("Retry-After"));
  // A different IP is unaffected.
  assert.equal(
    (
      await handleRequest(
        post(payload(), { "CF-Connecting-IP": "198.51.100.1" }),
        liveEnv,
        d
      )
    ).status,
    200
  );
});

test("the same messageId is only sent once", async () => {
  const transport = createMockTransport();
  const body = payload();
  const d = deps({ transport });
  const first = await handleRequest(post(body), liveEnv, d);
  const second = await handleRequest(post(body), liveEnv, d);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(((await second.json()) as any).duplicate, true);
  assert.equal(transport.sent.length, 1);
});

test("a failed send can be retried with the same messageId", async () => {
  let fail = true;
  const sent: unknown[] = [];
  const transport = {
    kind: "live" as const,
    async send(e: unknown) {
      if (fail) return { ok: false as const, error: "network_error" };
      sent.push(e);
      return { ok: true as const };
    }
  };
  const body = payload();
  assert.equal(
    (await handleRequest(post(body), liveEnv, deps({ transport }))).status,
    502
  );
  fail = false;
  assert.equal(
    (await handleRequest(post(body), liveEnv, deps({ transport }))).status,
    200
  );
  assert.equal(sent.length, 1);
});

test("email body escapes visitor HTML", () => {
  const email = buildContactEmail(
    {
      name: "<b>Jane</b>",
      email: "jane@example.com",
      message: "<script>alert(1)</script>"
    },
    { to: "o@example.com", from: "f@example.com" },
    { receivedAt: new Date(0) }
  );
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.ok(email.text.includes("<script>alert(1)</script>")); // plain text is not HTML
});

test("Resend transport sends the right request and surfaces failures", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const okFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init! });
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
  };
  const t = createResendTransport("re_key", okFetch);
  const email = buildContactEmail(
    { name: "Jane", email: "jane@example.com", message: "Hello there friend" },
    { to: "o@example.com", from: "Portfolio <f@example.com>" },
    { receivedAt: new Date(0), messageId: "abc" }
  );
  assert.deepEqual(await t.send(email), { ok: true, id: "em_1" });
  const { url, init } = calls[0];
  assert.equal(url, "https://api.resend.com/emails");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_key");
  assert.equal(headers["Idempotency-Key"], "contact-abc");
  const sentBody = JSON.parse(init.body as string);
  assert.deepEqual(sentBody.to, ["o@example.com"]);
  assert.equal(sentBody.reply_to, "jane@example.com");

  const origError = console.error;
  console.error = () => {};
  try {
    const failing = createResendTransport(
      "re_key",
      async () => new Response("bad", { status: 422 })
    );
    assert.deepEqual(await failing.send(email), {
      ok: false,
      status: 422,
      error: "provider_error"
    });
    const throwing = createResendTransport("re_key", async () => {
      throw new Error("offline");
    });
    assert.deepEqual(await throwing.send(email), { ok: false, error: "network_error" });
  } finally {
    console.error = origError;
  }
});

test("empty ALLOWED_ORIGINS fails closed: every browser origin refused, live not ready", async () => {
  const env: Env = {
    ...liveEnv,
    ALLOWED_ORIGINS: "",
    CHAT_MODE: "live",
    GEMINI_API_KEY: "g",
    CHAT_SESSION_SECRET: "x".repeat(40),
    CHAT_RATE_LIMITER_DO: createFakeRateLimiterNamespace()
  };
  for (const origin of [ORIGIN, "https://portfolio.vercel.app", "null", ""]) {
    for (const path of ["/contact", "/chat"]) {
      const res = await handleRequest(
        new Request(`https://worker.example${path}`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify(payload())
        }),
        env,
        deps()
      );
      assert.equal(res.status, 403, `${path} from ${origin || "(none)"}`);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    }
  }
  const health = (await (
    await handleRequest(new Request("https://worker.example/health"), env)
  ).json()) as any;
  assert.equal(health.ready, false);
  assert.equal(health.chat.ready, false);
});

test("origins are matched exactly (no prefix/suffix tricks)", async () => {
  const env: Env = { ...liveEnv, ALLOWED_ORIGINS: "https://portfolio-abc.vercel.app" };
  for (const origin of [
    "https://portfolio-abc.vercel.app.evil.example",
    "https://evil-portfolio-abc.vercel.app",
    "http://portfolio-abc.vercel.app",
    "https://portfolio-abc-git-feature-me.vercel.app"
  ]) {
    const res = await handleRequest(post(payload(), { Origin: origin }), env, deps());
    assert.equal(res.status, 403, origin);
  }
  const ok = await handleRequest(
    post(payload(), { Origin: "https://portfolio-abc.vercel.app" }),
    env,
    deps()
  );
  assert.equal(ok.status, 200);
});

test("domain transition: both production origins allowed, each echoed exactly", async () => {
  const env: Env = {
    ...liveEnv,
    ALLOWED_ORIGINS:
      "https://ashisharora.vercel.app,https://portfolio-macos-psi.vercel.app"
  };
  for (const origin of [
    "https://ashisharora.vercel.app",
    "https://portfolio-macos-psi.vercel.app"
  ]) {
    const res = await handleRequest(post(payload(), { Origin: origin }), env, deps());
    assert.equal(res.status, 200, origin);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  }
  for (const origin of [
    "https://ashisharora-git-main-someone.vercel.app",
    "https://www.ashisharora.site",
    "https://ashisharora.vercel.app.evil.example"
  ]) {
    const res = await handleRequest(post(payload(), { Origin: origin }), env, deps());
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null, origin);
  }
});

test("health endpoint reveals readiness, not secrets", async () => {
  const res = await handleRequest(
    new Request("https://worker.example/health"),
    liveEnv,
    deps()
  );
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), {
    ok: true,
    mode: "live",
    ready: true,
    provider: "resend",
    chat: { mode: "mock", ready: true }
  });
  assert.ok(!text.includes("re_test") && !text.includes("owner@example.com"));
});
