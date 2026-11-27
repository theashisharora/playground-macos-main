/**
 * Browser-side transport for the Messages app.
 *
 * Only PUBLIC values live here: the Worker URL and the Turnstile site key.
 * API keys and the destination inbox are held by the Worker
 * (server/contact-worker) and never reach the browser.
 */
import type { ContactErrors, ContactInput } from "~/shared/contactValidation";

export interface ContactPayload extends ContactInput {
  messageId: string;
  elapsedMs: number;
  website: string; // honeypot, must stay empty
  turnstileToken?: string;
}

export type SendResult =
  | { status: "sent" }
  /** Nothing was emailed: no endpoint configured, or the Worker is in mock mode. */
  | { status: "preview"; reason: "no-endpoint" | "server-mock" }
  | { status: "invalid"; fields: ContactErrors }
  /** The provider may have accepted it; resending could duplicate it. */
  | { status: "uncertain"; message: string }
  | { status: "error"; message: string };

export const CONTACT_ENDPOINT = (import.meta.env.VITE_CONTACT_ENDPOINT ?? "").trim();
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

/** True when submissions can reach a backend at all. */
export const contactConfigured = CONTACT_ENDPOINT !== "";

const ERROR_TEXT: Record<string, string> = {
  rate_limited:
    "You've sent several messages recently. Please wait a few minutes and try again.",
  bot_check_failed: "The spam check didn't pass. Please complete it again and resend.",
  too_fast: "That was quick! Please take a moment and try sending again.",
  not_configured: "Messaging is temporarily unavailable. Please try again later.",
  temporarily_unavailable:
    "Messaging is temporarily unavailable. Your message wasn't sent. Please try again in a minute.",
  delivery_failed: "Your message couldn't be delivered right now. Please try again.",
  in_progress:
    "This message is already being sent. Please wait a few seconds before trying again.",
  too_large: "Your message is too long.",
  origin_not_allowed: "Messaging isn't available from this site address."
};

export const newMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
        .toString(36)
        .slice(2)}`;

interface SendOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  previewDelayMs?: number;
}

export async function sendContactMessage(
  payload: ContactPayload,
  {
    endpoint = CONTACT_ENDPOINT,
    fetchImpl = fetch,
    timeoutMs = 15_000,
    previewDelayMs = 700
  }: SendOptions = {}
): Promise<SendResult> {
  if (!endpoint) {
    // Preview mode: honest, nothing leaves the browser.
    await new Promise((r) => setTimeout(r, previewDelayMs));
    return { status: "preview", reason: "no-endpoint" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${endpoint.replace(/\/$/, "")}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      delivered?: boolean;
      error?: string;
      fields?: ContactErrors;
    };

    if (res.ok && data.ok === true) {
      return data.delivered === true
        ? { status: "sent" }
        : { status: "preview", reason: "server-mock" };
    }
    if (res.status === 422 && data.fields)
      return { status: "invalid", fields: data.fields };
    if (data.error === "delivery_uncertain")
      return {
        status: "uncertain",
        message:
          "We couldn't confirm delivery. It may still reach Ashish, so please don't resend it. If you don't hear back, write a new message later."
      };
    return {
      status: "error",
      message: ERROR_TEXT[data.error ?? ""] ?? "Something went wrong. Please try again."
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      status: "error",
      message: aborted
        ? "The request timed out. Please check your connection and try again."
        : "Couldn't reach the server. Please check your connection and try again."
    };
  } finally {
    clearTimeout(timer);
  }
}
