import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  __clearGmailTokenCache,
  buildMimeMessage,
  createGmailTransport,
  encodeHeaderWords,
  parseMailbox
} from "../src/gmail.ts";
import { buildContactEmail } from "../src/email.ts";
import {
  __resetForTests,
  handleRequest,
  missingLiveConfig,
  type Env
} from "../src/handler.ts";
import { createFakeRateLimiterNamespace } from "./fakeDurableObject.ts";

const creds = {
  clientId: "cid.apps.googleusercontent.com",
  clientSecret: "csecret",
  refreshToken: "1//refresh"
};

const email = () =>
  buildContactEmail(
    {
      name: "Zoë Ångström",
      email: "zoe@example.com",
      message: "Hello <b>Ashish</b>, café ☕"
    },
    { to: "ashish@gmail.com", from: "Ashish's Portfolio <ashish@gmail.com>" },
    { receivedAt: new Date(0), messageId: "abcdef0123456789" }
  );

const decodeRaw = (raw: string) =>
  Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const bodyParts = (mime: string) =>
  [
    ...mime.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g
    )
  ].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));

const silence = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "));
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = orig;
  }
};

beforeEach(() => {
  __clearGmailTokenCache();
  __resetForTests();
});

test("MIME message: fixed sender, visitor Reply-To, encoded UTF-8 headers and bodies", () => {
  const mime = buildMimeMessage(email(), new Date(0));
  const [head] = mime.split("\r\n\r\n");
  assert.match(head, /^From: "Ashish's Portfolio" <ashish@gmail\.com>$/m);
  assert.match(head, /^To: ashish@gmail\.com$/m);
  assert.match(head, /^Reply-To: zoe@example\.com$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(head, /^Message-ID: <contact-abcdef0123456789@gmail\.com>$/m);
  const [text, html] = bodyParts(mime);
  assert.ok(text.includes("Hello <b>Ashish</b>, café ☕"), "plain text intact");
  assert.ok(html.includes("Hello &lt;b&gt;Ashish&lt;/b&gt;"), "HTML escaped");
  assert.ok(!html.includes("<b>Ashish</b>"));
});

test("header injection is impossible", () => {
  const e = email();
  assert.throws(() =>
    buildMimeMessage({ ...e, subject: "Hi\r\nBcc: victim@example.com" })
  );
  assert.throws(() =>
    buildMimeMessage({ ...e, replyTo: "a@example.com\r\nBcc: x@example.com" })
  );
  assert.throws(() =>
    buildMimeMessage({ ...e, replyTo: "a@example.com, b@example.com" })
  );
  assert.equal(parseMailbox("x <a@b.c>, y <d@e.f>"), null);
});

test("long non-ASCII subjects become short folded encoded-words", () => {
  const out = encodeHeaderWords("Портфолио сообщение от ".repeat(5));
  for (const word of out.split("\r\n ")) assert.ok(word.length <= 75, word);
  const decoded = out
    .split("\r\n ")
    .map((w) => Buffer.from(w.slice(10, -2), "base64"))
    .reduce((a, b) => Buffer.concat([a, b]));
  assert.equal(decoded.toString("utf8"), "Портфолио сообщение от ".repeat(5));
});

function fakeGoogle(opts: { tokenStatus?: number; sendStatuses?: number[] } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sendStatuses = [...(opts.sendStatuses ?? [200])];
  let tokens = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init! });
    if (url.includes("oauth2.googleapis.com")) {
      tokens++;
      if (opts.tokenStatus && opts.tokenStatus !== 200)
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: opts.tokenStatus
        });
      return new Response(
        JSON.stringify({ access_token: `ya29.token${tokens}`, expires_in: 3599 })
      );
    }
    const status = sendStatuses.length > 1 ? sendStatuses.shift()! : sendStatuses[0];
    if (status !== 200)
      return new Response('{"error":{"code":' + status + "}}", { status });
    return new Response(JSON.stringify({ id: "18c0ffee", threadId: "18c0ffee" }));
  };
  return { calls, fetchImpl, tokens: () => tokens };
}

test("Gmail transport: refresh-token exchange, then messages.send with raw MIME", async () => {
  const g = fakeGoogle();
  const t = createGmailTransport(creds, g.fetchImpl);
  assert.deepEqual(await t.send(email()), { ok: true, id: "18c0ffee" });

  const tokenCall = g.calls[0];
  assert.equal(tokenCall.url, "https://oauth2.googleapis.com/token");
  const form = new URLSearchParams(tokenCall.init.body as string);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "1//refresh");

  const sendCall = g.calls[1];
  assert.equal(
    sendCall.url,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
  );
  assert.equal(
    (sendCall.init.headers as Record<string, string>).Authorization,
    "Bearer ya29.token1"
  );
  const raw = JSON.parse(sendCall.init.body as string).raw as string;
  assert.match(raw, /^[A-Za-z0-9_-]+$/, "base64url");
  assert.match(decodeRaw(raw), /^Reply-To: zoe@example\.com$/m);

  await t.send(email());
  assert.equal(g.tokens(), 1, "access token cached between sends");
});

test("Gmail transport: a 401 refreshes once and retries", async () => {
  const g = fakeGoogle({ sendStatuses: [401, 200] });
  const t = createGmailTransport(creds, g.fetchImpl);
  assert.deepEqual(await t.send(email()), { ok: true, id: "18c0ffee" });
  assert.equal(g.tokens(), 2);
});

test("Gmail transport: revoked refresh token or send error is NOT delivered, and secrets aren't logged", async () => {
  const { value: revoked, logged } = await silence(() =>
    createGmailTransport(creds, fakeGoogle({ tokenStatus: 400 }).fetchImpl).send(email())
  );
  assert.deepEqual(revoked, { ok: false, error: "auth_error" });
  assert.ok(logged.some((l) => l.includes("invalid_grant")));
  for (const l of logged)
    assert.ok(
      !l.includes("csecret") && !l.includes("1//refresh") && !l.includes("ya29"),
      l
    );

  __clearGmailTokenCache();
  const { value: failed } = await silence(() =>
    createGmailTransport(creds, fakeGoogle({ sendStatuses: [500] }).fetchImpl).send(
      email()
    )
  );
  assert.deepEqual(failed, { ok: false, status: 500, error: "provider_error" });

  __clearGmailTokenCache();
  const { value: offline } = await silence(() =>
    createGmailTransport(creds, async () => {
      throw new Error("offline");
    }).send(email())
  );
  assert.deepEqual(offline, { ok: false, error: "network_error" });
});

// ---------- Handler wiring with EMAIL_PROVIDER = "gmail" ----------

const ORIGIN = "https://portfolio.example";
const gmailEnv = (): Env => ({
  CONTACT_MODE: "live",
  EMAIL_PROVIDER: "gmail",
  ALLOWED_ORIGINS: ORIGIN,
  CONTACT_TO_EMAIL: "ashish@gmail.com",
  CONTACT_FROM_EMAIL: "Ashish's Portfolio <ashish@gmail.com>",
  GMAIL_CLIENT_ID: creds.clientId,
  GMAIL_CLIENT_SECRET: creds.clientSecret,
  GMAIL_REFRESH_TOKEN: creds.refreshToken,
  TURNSTILE_SECRET_KEY: "ts",
  CONTACT_RATE_LIMITER_DO: createFakeRateLimiterNamespace()
});

let n = 0;
const contactReq = (
  messageId = `gm-${String(++n).padStart(16, "0")}`,
  ip = "203.0.113.90"
) =>
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
      message: "Hi Ashish, testing the Gmail provider.",
      website: "",
      elapsedMs: 8000,
      turnstileToken: "tok",
      messageId
    })
  });

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

test("Gmail provider config: needs the three OAuth secrets, not a Resend key", () => {
  assert.deepEqual(missingLiveConfig(gmailEnv()), []);
  assert.deepEqual(missingLiveConfig({ ...gmailEnv(), GMAIL_REFRESH_TOKEN: "" }), [
    "GMAIL_REFRESH_TOKEN"
  ]);
  assert.deepEqual(
    missingLiveConfig({ ...gmailEnv(), EMAIL_PROVIDER: "carrier-pigeon" }),
    ["EMAIL_PROVIDER"]
  );
});

test("live Gmail delivery: delivered only after Gmail accepts; failures are Not Delivered", async () => {
  const g = fakeGoogle();
  globalThis.fetch = g.fetchImpl as typeof fetch;
  const ok = await handleRequest(contactReq(), gmailEnv(), {
    verifyBot: async () => true
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, delivered: true, mode: "live" });

  __clearGmailTokenCache();
  globalThis.fetch = fakeGoogle({ sendStatuses: [503] }).fetchImpl as typeof fetch;
  const { value: bad } = await silence(() =>
    handleRequest(contactReq(), gmailEnv(), { verifyBot: async () => true })
  );
  assert.equal(bad.status, 502);
  assert.deepEqual(await bad.json(), { ok: false, error: "delivery_failed" });
});
