import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createSmtpTransport, encodeDataSection, type SmtpSocket } from "../src/smtp.ts";
import { buildContactEmail } from "../src/email.ts";
import {
  __resetForTests,
  handleRequest,
  missingLiveConfig,
  type Env
} from "../src/handler.ts";
import { createFakeRateLimiterNamespace } from "./fakeDurableObject.ts";

const USER = "ashish.portfolio@gmail.com";
const APP_PASSWORD = "abcd efgh ijkl mnop"; // fake, in Google's display format

interface ServerOptions {
  greeting?: "ok" | "hang";
  authPlain?: boolean;
  rcptCode?: number;
  afterData?: "ok" | "drop" | "hang" | "reject";
}

/** A scripted SMTP server speaking Gmail's reply formats over an in-memory socket. */
function fakeGmail(opts: ServerOptions = {}) {
  const commands: string[] = [];
  let data = "";
  let connections = 0;
  let inData = false;
  let authUser = "";
  let authPass = "";

  const connect = (host: string, port: number): SmtpSocket => {
    connections++;
    assert.equal(host, "smtp.gmail.com");
    assert.equal(port, 465);
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
    const enc = new TextEncoder();
    const reply = (s: string) => ctrl.enqueue(enc.encode(s));
    let buf = "";
    const onLine = (line: string) => {
      if (inData) {
        data += `${line}\r\n`;
        if (line !== ".") return;
        inData = false;
        if (opts.afterData === "drop") return ctrl.close();
        if (opts.afterData === "hang") return;
        if (opts.afterData === "reject") return reply("452 4.2.2 Mailbox full\r\n");
        return reply(
          "250 2.0.0 OK  1764151234 d2e1a72fcca58-7a1b2c3d4e5f6sm123456b3a.12 - gsmtp\r\n"
        );
      }
      commands.push(line);
      const verb = line.split(" ")[0].toUpperCase();
      if (verb === "EHLO")
        return reply(
          "250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250-8BITMIME\r\n" +
            (opts.authPlain === false
              ? ""
              : "250-AUTH LOGIN PLAIN XOAUTH2 PLAIN-CLIENTTOKEN\r\n") +
            "250-ENHANCEDSTATUSCODES\r\n250 SMTPUTF8\r\n"
        );
      if (verb === "AUTH") {
        const parts = Buffer.from(line.split(" ")[2], "base64")
          .toString("utf8")
          .split("\0");
        authUser = parts[1];
        authPass = parts[2];
        return authPass === APP_PASSWORD.replace(/\s/g, "") && authUser === USER
          ? reply("235 2.7.0 Accepted\r\n")
          : reply(
              "535-5.7.8 Username and Password not accepted. For more information, go to\r\n535 5.7.8  https://support.google.com/mail/?p=BadCredentials - gsmtp\r\n"
            );
      }
      if (verb === "MAIL") return reply("250 2.1.0 OK - gsmtp\r\n");
      if (verb === "RCPT")
        return reply(
          opts.rcptCode && opts.rcptCode !== 250
            ? `${opts.rcptCode} 5.1.1 rejected - gsmtp\r\n`
            : "250 2.1.5 OK - gsmtp\r\n"
        );
      if (verb === "DATA") {
        inData = true;
        return reply("354 Go ahead - gsmtp\r\n");
      }
      if (verb === "QUIT") return reply("221 2.0.0 closing connection - gsmtp\r\n");
      reply("502 5.5.1 Unrecognized command\r\n");
    };
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        buf += new TextDecoder().decode(chunk);
        let i;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          onLine(line);
        }
      }
    });
    if (opts.greeting !== "hang")
      reply("220 smtp.gmail.com ESMTP d2e1a72fcca58-7a1b2c3d - gsmtp\r\n");
    return { readable, writable, close: async () => {} };
  };
  return {
    connect,
    commands,
    data: () => data,
    connections: () => connections,
    auth: () => ({ user: authUser, pass: authPass })
  };
}

const cfg = (over = {}) => ({
  host: "smtp.gmail.com",
  port: 465,
  username: USER,
  appPassword: APP_PASSWORD,
  stepTimeoutMs: 200,
  dataTimeoutMs: 200,
  ...over
});

const email = (over = {}) => ({
  ...buildContactEmail(
    {
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Hi Ashish!\n.hidden line\nBye"
    },
    { to: "ashish.inbox@gmail.com", from: `Ashish's Portfolio <${USER}>` },
    { receivedAt: new Date(0), messageId: "smtp-test-0000000001" }
  ),
  ...over
});

const quiet = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "));
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = orig;
  }
};

const decodeBase64Parts = (mime: string) =>
  [...mime.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) =>
    Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8")
  );

beforeEach(() => __resetForTests());

test("delivers over implicit TLS with AUTH PLAIN, fixed sender and visitor Reply-To", async () => {
  const srv = fakeGmail();
  const out = await createSmtpTransport(cfg(), srv.connect).send(email());
  assert.equal(out.ok, true);
  assert.deepEqual(
    srv.commands.map((c) =>
      c
        .split(" ")
        .slice(0, c.startsWith("AUTH") ? 2 : 3)
        .join(" ")
    ),
    [
      "EHLO portfolio-contact.workers.dev",
      "AUTH PLAIN",
      `MAIL FROM:<${USER}>`,
      "RCPT TO:<ashish.inbox@gmail.com>",
      "DATA",
      "QUIT"
    ]
  );
  assert.deepEqual(
    srv.auth(),
    { user: USER, pass: "abcdefghijklmnop" },
    "app password spaces stripped"
  );
  const data = srv.data();
  assert.match(
    data,
    new RegExp(`^From: "Ashish's Portfolio" <${USER.replace(".", "\\.")}>\\r$`, "m")
  );
  assert.match(data, /^To: ashish\.inbox@gmail\.com\r$/m);
  assert.match(data, /^Reply-To: jane@example\.com\r$/m);
  assert.ok(data.endsWith("\r\n.\r\n"));
  assert.ok(decodeBase64Parts(data)[0].includes(".hidden line"), "body intact");
});

test("dot-stuffing protects lines that start with a period", () => {
  assert.equal(encodeDataSection("a\r\n.b\r\n..c"), "a\r\n..b\r\n...c\r\n.\r\n");
  assert.equal(
    encodeDataSection(".\r\n"),
    "..\r\n.\r\n",
    "a lone dot can't end DATA early"
  );
});

test("wrong App Password: auth_error, not delivered, password never logged", async () => {
  const srv = fakeGmail();
  const { value, logged } = await quiet(() =>
    createSmtpTransport(cfg({ appPassword: "wrong pass word" }), srv.connect).send(
      email()
    )
  );
  assert.deepEqual(value, { ok: false, error: "auth_error" });
  assert.ok(!srv.commands.some((c) => c.startsWith("MAIL")), "stopped before MAIL FROM");
  for (const l of logged) assert.ok(!/wrongpassword|wrong pass word|abcd/.test(l), l);
  assert.ok(logged.some((l) => l.includes("AUTH rejected: 535")));
});

test("recipient rejected: failed (not uncertain), nothing sent", async () => {
  const srv = fakeGmail({ rcptCode: 550 });
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(email())
  );
  assert.equal(value.ok, false);
  assert.equal((value as any).uncertain, undefined);
  assert.equal(srv.data(), "");
});

test("server that never greets: timeout, failed, not uncertain", async () => {
  const srv = fakeGmail({ greeting: "hang" });
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(email())
  );
  assert.deepEqual(value, { ok: false, error: "timeout" });
});

test("connection lost AFTER the message was sent: uncertain (never 'failed')", async () => {
  for (const afterData of ["drop", "hang"] as const) {
    const srv = fakeGmail({ afterData });
    const { value } = await quiet(() =>
      createSmtpTransport(cfg(), srv.connect).send(email())
    );
    assert.deepEqual(
      value,
      { ok: false, error: "delivery_uncertain", uncertain: true },
      afterData
    );
  }
});

test("explicit rejection after DATA (4xx/5xx) is a definite failure", async () => {
  const srv = fakeGmail({ afterData: "reject" });
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(email())
  );
  assert.deepEqual(value, { ok: false, error: "provider_error", status: 452 });
});

test("refuses to send as anyone but the authenticated account", async () => {
  const srv = fakeGmail();
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(
      email({ from: "Ashish <someone-else@gmail.com>" })
    )
  );
  assert.deepEqual(value, { ok: false, error: "invalid_message" });
  assert.equal(srv.connections(), 0);
});

test("header injection is rejected before connecting", async () => {
  const srv = fakeGmail();
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(
      email({ subject: "Hi\r\nBcc: x@example.com" })
    )
  );
  assert.deepEqual(value, { ok: false, error: "invalid_message" });
  assert.equal(srv.connections(), 0);
});

test("no AUTH PLAIN offered: the password is never sent", async () => {
  const srv = fakeGmail({ authPlain: false });
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), srv.connect).send(email())
  );
  assert.equal(value.ok, false);
  assert.ok(!srv.commands.some((c) => c.startsWith("AUTH")));
});

test("runtime without TCP sockets: clear failure, not a crash", async () => {
  const { value } = await quiet(() =>
    createSmtpTransport(cfg(), undefined).send(email())
  );
  assert.deepEqual(value, { ok: false, error: "provider_unavailable" });
});

// ---------- Handler with EMAIL_PROVIDER = "smtp" ----------

const ORIGIN = "https://portfolio.example";
const smtpEnv = (ns = createFakeRateLimiterNamespace()): Env => ({
  CONTACT_MODE: "live",
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "465",
  SMTP_USERNAME: USER,
  SMTP_APP_PASSWORD: APP_PASSWORD,
  CONTACT_TO_EMAIL: "ashish.inbox@gmail.com",
  ALLOWED_ORIGINS: ORIGIN,
  TURNSTILE_SECRET_KEY: "ts",
  CONTACT_RATE_LIMITER_DO: ns
});

const req = (messageId: string) =>
  new Request("https://worker.example/contact", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.77"
    },
    body: JSON.stringify({
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Hello Ashish, testing Gmail SMTP.",
      website: "",
      elapsedMs: 8000,
      turnstileToken: "tok",
      messageId
    })
  });

test("SMTP config: needs host/port/username/app password; only port 465", () => {
  assert.deepEqual(missingLiveConfig(smtpEnv()), []);
  assert.deepEqual(missingLiveConfig({ ...smtpEnv(), SMTP_APP_PASSWORD: "" }), [
    "SMTP_APP_PASSWORD"
  ]);
  assert.deepEqual(missingLiveConfig({ ...smtpEnv(), SMTP_PORT: "587" }), [
    "SMTP_PORT (must be 465)"
  ]);
  assert.deepEqual(missingLiveConfig({ ...smtpEnv(), SMTP_USERNAME: "not-an-email" }), [
    "SMTP_USERNAME (must be an email address)"
  ]);
});

test("live SMTP: Delivered only after 250; sender is the Gmail account", async () => {
  const srv = fakeGmail();
  const res = await handleRequest(req("smtp-live-00000000001"), smtpEnv(), {
    verifyBot: async () => true,
    smtpConnect: srv.connect
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: true, mode: "live" });
  assert.match(
    srv.data(),
    /^From: "Ashish's Portfolio" <ashish\.portfolio@gmail\.com>\r$/m
  );
  assert.match(srv.data(), /^Reply-To: jane@example\.com\r$/m);
});

test("uncertain delivery: no Delivered, and the same message is never resent", async () => {
  const ns = createFakeRateLimiterNamespace();
  const dropping = fakeGmail({ afterData: "drop" });
  const { value: first } = await quiet(() =>
    handleRequest(req("smtp-uncertain-000001"), smtpEnv(ns), {
      verifyBot: async () => true,
      smtpConnect: dropping.connect
    })
  );
  assert.equal(first.status, 502);
  assert.deepEqual(await first.json(), { ok: false, error: "delivery_uncertain" });

  // "Try Again" with the same id, even on a healthy server, must not send again.
  __resetForTests();
  const healthy = fakeGmail();
  const retry = await handleRequest(req("smtp-uncertain-000001"), smtpEnv(ns), {
    verifyBot: async () => true,
    smtpConnect: healthy.connect
  });
  assert.equal(retry.status, 409);
  assert.deepEqual(await retry.json(), { ok: false, error: "delivery_uncertain" });
  assert.equal(healthy.connections(), 0);
});

test("definite SMTP failure releases the id so Try Again can deliver once", async () => {
  const ns = createFakeRateLimiterNamespace();
  const { value: first } = await quiet(() =>
    handleRequest(req("smtp-retry-0000000001"), smtpEnv(ns), {
      verifyBot: async () => true,
      smtpConnect: fakeGmail({ rcptCode: 550 }).connect
    })
  );
  assert.equal(first.status, 502);
  assert.deepEqual(await first.json(), { ok: false, error: "delivery_failed" });
  const ok = fakeGmail();
  const second = await handleRequest(req("smtp-retry-0000000001"), smtpEnv(ns), {
    verifyBot: async () => true,
    smtpConnect: ok.connect
  });
  assert.equal(second.status, 200);
  const third = await handleRequest(req("smtp-retry-0000000001"), smtpEnv(ns), {
    verifyBot: async () => true,
    smtpConnect: ok.connect
  });
  assert.equal(((await third.json()) as any).duplicate, true);
  assert.equal(ok.connections(), 1, "exactly one delivery");
});
