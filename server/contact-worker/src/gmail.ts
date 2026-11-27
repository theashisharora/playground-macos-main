// Gmail API transport (OAuth 2.0 refresh token -> access token -> messages.send).
// Lets a personal Gmail account send the contact notification without a
// verified custom domain. Scope needed: https://www.googleapis.com/auth/gmail.send
//
// Client id, client secret and refresh token are Worker secrets. Access tokens
// live only in this isolate's memory and are never logged or returned.
import type { EmailTransport } from "./email.ts";
import { buildMimeMessage } from "./mime.ts";
import { toBase64Url } from "./signing.ts";

export { buildMimeMessage, encodeHeaderWords, parseMailbox } from "./mime.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** Test helper. */
export function __clearGmailTokenCache() {
  cachedToken = null;
}

const enc = new TextEncoder();

// ---------- OAuth + send ----------

async function accessToken(
  creds: GmailCredentials,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  forceRefresh: boolean
): Promise<string | null> {
  const key = creds.clientId;
  if (!forceRefresh && cachedToken?.key === key && cachedToken.expiresAt > Date.now())
    return cachedToken.token;
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token"
    }).toString(),
    signal
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    // Only Google's error code (e.g. "invalid_grant") is logged, never a token.
    console.error(`Gmail token refresh failed: ${res.status} ${data.error ?? ""}`.trim());
    cachedToken = null;
    return null;
  }
  const ttl = Math.max(60, Number(data.expires_in) || 3600);
  cachedToken = {
    key,
    token: data.access_token,
    expiresAt: Date.now() + (ttl - 60) * 1000
  };
  return data.access_token;
}

export function createGmailTransport(
  creds: GmailCredentials,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000
): EmailTransport {
  return {
    kind: "live",
    async send(email) {
      let raw: string;
      try {
        raw = toBase64Url(enc.encode(buildMimeMessage(email)));
      } catch (err) {
        console.error("Refusing to build email", err instanceof Error ? err.message : "");
        return { ok: false, error: "invalid_message" };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // Once messages.send is in flight, a lost response can't tell us whether
      // Gmail accepted the message, so that case is "uncertain", not "failed".
      let sending = false;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const token = await accessToken(
            creds,
            fetchImpl,
            controller.signal,
            attempt > 0
          );
          if (!token) return { ok: false, error: "auth_error" };
          sending = true;
          const res = await fetchImpl(SEND_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ raw }),
            signal: controller.signal
          });
          // An expired/revoked access token: refresh once and retry.
          sending = false;
          if (res.status === 401 && attempt === 0) continue;
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error(`Gmail send error ${res.status}: ${detail.slice(0, 300)}`);
            return { ok: false, status: res.status, error: "provider_error" };
          }
          const data = (await res.json().catch(() => ({}))) as { id?: string };
          // Delivered only when Gmail accepted it and returned a message id.
          if (!data.id) return { ok: false, error: "provider_error" };
          return { ok: true, id: data.id };
        }
        return { ok: false, error: "auth_error" };
      } catch (err) {
        console.error(
          "Gmail request failed",
          err instanceof Error ? err.name : "unknown"
        );
        return sending
          ? { ok: false, error: "network_error", uncertain: true }
          : { ok: false, error: "network_error" };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
