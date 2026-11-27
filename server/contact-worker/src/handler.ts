import { MESSAGE_ID_RE, validateContact } from "../../../src/shared/contactValidation.ts";
import { handleChat, isChatLive, missingChatConfig, type ChatDeps } from "./chat.ts";
import {
  buildContactEmail,
  createMockTransport,
  createResendTransport,
  type EmailTransport,
  type SendOutcome
} from "./email.ts";
import { createGmailTransport } from "./gmail.ts";
import {
  RATE_LIMIT,
  bindingRateLimiter,
  durableObjectLedger,
  durableObjectRateLimiter,
  memoryLedger,
  memoryRateLimiter,
  verifyTurnstile,
  type ClaimState,
  type MessageLedger,
  type RateLimitBinding,
  type RateLimiter,
  type RateLimiterNamespace
} from "./guards.ts";
import { corsHeaders, json, parseAllowedOrigins } from "./http.ts";
import { parseMailbox } from "./mime.ts";
import { createSmtpTransport, type SmtpConnect } from "./smtp.ts";

export interface Env {
  /** "live" sends real email; anything else (default) is mock/preview. */
  CONTACT_MODE?: string;
  /** Comma-separated exact origins, e.g. "https://<project>.vercel.app,http://localhost:5173" */
  ALLOWED_ORIGINS?: string;
  /** Secret: where messages are delivered. */
  CONTACT_TO_EMAIL?: string;
  /** Sender for "resend"/"gmail". Resend: an address on your verified domain. */
  CONTACT_FROM_EMAIL?: string;
  /** "smtp" (Gmail SMTP + App Password), "gmail" (Gmail API OAuth) or "resend" (default). */
  EMAIL_PROVIDER?: string;
  /** EMAIL_PROVIDER = "smtp": host and port (implicit TLS, so 465). */
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  /** Secret: the Gmail address that authenticates AND is always the sender. */
  SMTP_USERNAME?: string;
  /** Secret: Google App Password (never the normal account password). */
  SMTP_APP_PASSWORD?: string;
  /** Display name for the SMTP sender, e.g. "Ashish's Portfolio". */
  CONTACT_FROM_NAME?: string;
  /** Secret: Resend API key (EMAIL_PROVIDER = "resend"). */
  RESEND_API_KEY?: string;
  /** Secrets for EMAIL_PROVIDER = "gmail" (OAuth 2.0, gmail.send scope only). */
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  /** Secret: Cloudflare Turnstile secret key (contact and chat). */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Durable Object namespace for the global per-IP contact limiter and the
   * duplicate-send ledger (wrangler.toml). Required in live mode.
   */
  CONTACT_RATE_LIMITER_DO?: RateLimiterNamespace;
  /**
   * Optional Workers Rate Limiting binding. Counts are per Cloudflare location
   * and approximate, so it is only used when the Durable Object isn't bound.
   */
  CONTACT_RATE_LIMITER?: RateLimitBinding;

  // ---- Ashish AI (POST /chat) ----
  /** "live" calls Gemini; anything else returns a labelled preview reply. */
  CHAT_MODE?: string;
  /** Secret: Gemini API key (ideally from a project without billing). */
  GEMINI_API_KEY?: string;
  /** Model id, e.g. "gemini-3.5-flash-lite". */
  GEMINI_MODEL?: string;
  /** Secret: >= 32 random chars, signs chat sessions and replies. */
  CHAT_SESSION_SECRET?: string;
  /** Global replies per rolling 24 h (default 300). */
  CHAT_DAILY_LIMIT?: string;
  /** Separate Durable Object namespace for chat limits. Required for live chat. */
  CHAT_RATE_LIMITER_DO?: RateLimiterNamespace;
}

export interface Deps {
  transport?: EmailTransport;
  rateLimiter?: RateLimiter;
  ledger?: MessageLedger;
  verifyBot?: (token: string, ip: string | null) => Promise<boolean>;
  now?: () => number;
  chat?: ChatDeps;
  /** TCP socket factory (cloudflare:sockets in the Worker); required for SMTP. */
  smtpConnect?: SmtpConnect;
}

export const MAX_BODY_BYTES = 16 * 1024;
/** Real people take a few seconds to type; scripts post instantly. */
export const MIN_FILL_MS = 2500;

// Per-isolate limiter for mock mode / local dev only (NOT global; see guards.ts).
const fallbackLimiter = memoryRateLimiter(RATE_LIMIT.max, RATE_LIMIT.windowMs);
// Per-isolate duplicate guard for mock mode / local dev only.
const fallbackLedger = memoryLedger();

/** Picks the strongest limiter available: Durable Object > platform binding > memory. */
export function selectRateLimiter(env: Env): RateLimiter {
  if (env.CONTACT_RATE_LIMITER_DO)
    return durableObjectRateLimiter(env.CONTACT_RATE_LIMITER_DO);
  if (env.CONTACT_RATE_LIMITER) return bindingRateLimiter(env.CONTACT_RATE_LIMITER);
  return fallbackLimiter;
}

export function selectLedger(env: Env): MessageLedger {
  return env.CONTACT_RATE_LIMITER_DO
    ? durableObjectLedger(env.CONTACT_RATE_LIMITER_DO)
    : fallbackLedger;
}

export const isLive = (env: Env) => env.CONTACT_MODE === "live";
export const emailProvider = (env: Env) =>
  (env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase();

/** Names of settings live mode still needs (never their values). */
export function missingLiveConfig(env: Env): string[] {
  const required: (keyof Env)[] = [
    "ALLOWED_ORIGINS",
    "CONTACT_TO_EMAIL",
    "TURNSTILE_SECRET_KEY",
    "CONTACT_RATE_LIMITER_DO"
  ];
  const provider = emailProvider(env);
  if (provider === "resend") required.push("CONTACT_FROM_EMAIL", "RESEND_API_KEY");
  else if (provider === "gmail")
    required.push(
      "CONTACT_FROM_EMAIL",
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REFRESH_TOKEN"
    );
  else if (provider === "smtp")
    required.push("SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_APP_PASSWORD");
  else return ["EMAIL_PROVIDER"];
  const missing: string[] = required.filter((k) => !env[k]);
  if (provider === "smtp") {
    // Implicit TLS only: port 465. (587/STARTTLS and plain port 25 are refused.)
    if (env.SMTP_PORT && env.SMTP_PORT.trim() !== "465")
      missing.push("SMTP_PORT (must be 465)");
    if (env.SMTP_USERNAME && !parseMailbox(env.SMTP_USERNAME.trim()))
      missing.push("SMTP_USERNAME (must be an email address)");
  }
  return missing;
}

/** The sender for this provider. SMTP always sends as the authenticated account. */
function senderAddress(env: Env): string {
  if (emailProvider(env) === "smtp" && env.SMTP_USERNAME) {
    const name = (env.CONTACT_FROM_NAME ?? "Ashish's Portfolio").replace(
      /[\r\n"<>]/g,
      ""
    );
    return `${name} <${(env.SMTP_USERNAME ?? "").trim()}>`;
  }
  return env.CONTACT_FROM_EMAIL ?? "Portfolio Preview <preview@example.invalid>";
}

function liveTransport(env: Env, deps: Deps): EmailTransport {
  if (emailProvider(env) === "smtp")
    return createSmtpTransport(
      {
        host: (env.SMTP_HOST as string).trim(),
        port: Number(env.SMTP_PORT),
        username: (env.SMTP_USERNAME as string).trim(),
        appPassword: env.SMTP_APP_PASSWORD as string
      },
      deps.smtpConnect
    );
  if (emailProvider(env) === "gmail")
    return createGmailTransport({
      clientId: env.GMAIL_CLIENT_ID as string,
      clientSecret: env.GMAIL_CLIENT_SECRET as string,
      refreshToken: env.GMAIL_REFRESH_TOKEN as string
    });
  return createResendTransport(env.RESEND_API_KEY as string);
}

export async function handleRequest(
  req: Request,
  env: Env,
  deps: Deps = {}
): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin")?.replace(/\/$/, "") ?? "";
  const originOk = parseAllowedOrigins(env.ALLOWED_ORIGINS).includes(origin);
  const cors = originOk ? corsHeaders(origin) : {};

  if (url.pathname === "/health" && req.method === "GET") {
    // Reports modes and readiness only, never secret values.
    return json(200, {
      ok: true,
      mode: isLive(env) ? "live" : "mock",
      ready: isLive(env) ? missingLiveConfig(env).length === 0 : true,
      provider: emailProvider(env),
      chat: {
        mode: isChatLive(env) ? "live" : "mock",
        ready: isChatLive(env) ? missingChatConfig(env).length === 0 : true
      }
    });
  }

  const route =
    url.pathname === "/contact" ? "contact" : url.pathname === "/chat" ? "chat" : null;
  if (!route) return json(404, { ok: false, error: "not_found" });

  if (!originOk) return json(403, { ok: false, error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")
    return json(
      405,
      { ok: false, error: "method_not_allowed" },
      { ...cors, Allow: "POST, OPTIONS" }
    );

  if (
    !(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")
  )
    return json(415, { ok: false, error: "unsupported_media_type" }, cors);

  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES)
    return json(413, { ok: false, error: "too_large" }, cors);

  const live = isLive(env);
  if (route === "contact" && live && missingLiveConfig(env).length > 0) {
    console.error(
      "Contact worker misconfigured; missing:",
      missingLiveConfig(env).join(", ")
    );
    return json(503, { ok: false, error: "not_configured" }, cors);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES)
      return json(413, { ok: false, error: "too_large" }, cors);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch {
    return json(400, { ok: false, error: "invalid_json" }, cors);
  }

  const ip = req.headers.get("CF-Connecting-IP");

  // Ashish AI has its own bot check, limits and Durable Object namespace.
  if (route === "chat") return handleChat(body, ip, env, cors, deps.chat);

  // Honeypot: a hidden field real visitors never see. Fail honestly.
  if (typeof body.website === "string" && body.website.trim() !== "")
    return json(400, { ok: false, error: "rejected" }, cors);

  const elapsed = Number(body.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS)
    return json(400, { ok: false, error: "too_fast" }, cors);

  // Bot check BEFORE the rate limiter, so scripted floods without a valid
  // Turnstile token never reach (or use up the quota of) the Durable Object.
  if (live || deps.verifyBot) {
    const verify =
      deps.verifyBot ??
      ((token: string, remoteIp: string | null) =>
        verifyTurnstile(token, env.TURNSTILE_SECRET_KEY as string, remoteIp));
    const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    if (!(await verify(token, ip)))
      return json(400, { ok: false, error: "bot_check_failed" }, cors);
  }

  const limiter = deps.rateLimiter ?? selectRateLimiter(env);
  let allowed: boolean;
  try {
    allowed = await limiter.allow(`contact:${ip ?? "unknown"}`);
  } catch (err) {
    // Fail closed: without a working limiter, send nothing. Details stay in logs.
    console.error("Rate limiter unavailable; rejecting request", err);
    return json(
      503,
      { ok: false, error: "temporarily_unavailable" },
      { ...cors, "Retry-After": "60" }
    );
  }
  if (!allowed)
    return json(
      429,
      { ok: false, error: "rate_limited" },
      { ...cors, "Retry-After": String(RATE_LIMIT.windowMs / 1000) }
    );

  const result = validateContact(body);
  if (!result.ok)
    return json(422, { ok: false, error: "invalid", fields: result.errors }, cors);

  const messageId =
    typeof body.messageId === "string" && MESSAGE_ID_RE.test(body.messageId)
      ? body.messageId
      : undefined;
  if (!messageId) return json(400, { ok: false, error: "invalid_message_id" }, cors);

  const now = deps.now ?? Date.now;
  const mode = live ? "live" : "mock";

  // Duplicate guard: claim the message id before sending (global in production).
  const ledger = deps.ledger ?? selectLedger(env);
  let claim: ClaimState;
  try {
    claim = await ledger.claim(messageId);
  } catch (err) {
    console.error("Message ledger unavailable; rejecting request", err);
    return json(
      503,
      { ok: false, error: "temporarily_unavailable" },
      { ...cors, "Retry-After": "60" }
    );
  }
  if (claim === "sent")
    return json(200, { ok: true, delivered: live, mode, duplicate: true }, cors);
  if (claim === "inflight")
    return json(
      409,
      { ok: false, error: "in_progress" },
      { ...cors, "Retry-After": "10" }
    );
  // An earlier attempt may already have been delivered: never resend this id.
  if (claim === "uncertain")
    return json(409, { ok: false, error: "delivery_uncertain" }, cors);

  const transport =
    deps.transport ?? (live ? liveTransport(env, deps) : createMockTransport());

  const email = buildContactEmail(
    result.value,
    { to: env.CONTACT_TO_EMAIL ?? "preview@example.invalid", from: senderAddress(env) },
    { receivedAt: new Date(now()), messageId }
  );

  const outcome: SendOutcome = await transport.send(email);
  const ledgerResult = outcome.ok ? "sent" : outcome.uncertain ? "uncertain" : "failed";
  try {
    await ledger.finish(messageId, ledgerResult);
  } catch (err) {
    // The send already happened (or failed); only the bookkeeping is affected.
    console.error("Could not record message outcome", err);
  }
  if (ledgerResult === "uncertain")
    // Not "Delivered" and not "failed": the provider may have accepted it.
    return json(502, { ok: false, error: "delivery_uncertain" }, cors);
  if (!outcome.ok) return json(502, { ok: false, error: "delivery_failed" }, cors);

  // `delivered` is true only when a live provider accepted the email.
  return json(
    200,
    { ok: true, delivered: transport.kind === "live", mode: transport.kind },
    cors
  );
}

/** Test helper: clears per-isolate state between tests. */
export function __resetForTests() {
  fallbackLedger.clear();
}
