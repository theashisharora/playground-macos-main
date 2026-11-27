import type { ContactInput } from "../../../src/shared/contactValidation.ts";

export interface OutgoingEmail {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  /** Same key => provider sends at most once (protects against retries). */
  idempotencyKey?: string;
}

export type SendOutcome =
  | { ok: true; id?: string }
  | {
      ok: false;
      status?: number;
      error: string;
      /**
       * The message may or may not have been accepted (e.g. the connection
       * dropped after the full message was sent). Never retried automatically.
       */
      uncertain?: boolean;
    };

export interface EmailTransport {
  /** "live" really delivers mail; "mock" only records it. */
  readonly kind: "live" | "mock";
  send(email: OutgoingEmail): Promise<SendOutcome>;
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface EmailConfig {
  to: string;
  from: string;
}

/** Builds the notification email. All visitor text is escaped for HTML. */
export function buildContactEmail(
  input: ContactInput,
  cfg: EmailConfig,
  meta: { receivedAt: Date; messageId?: string }
): OutgoingEmail {
  const when = meta.receivedAt.toISOString();
  const text = [
    `New message from your portfolio's Messages app.`,
    ``,
    `Name:  ${input.name}`,
    `Email: ${input.email}`,
    `Received: ${when}`,
    ``,
    `----`,
    input.message,
    `----`,
    ``,
    `Reply to this email to respond to ${input.name} directly.`
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;line-height:1.5">
<p style="margin:0 0 12px">New message from your portfolio's <strong>Messages</strong> app.</p>
<table style="border-collapse:collapse;margin-bottom:12px;font-size:14px">
<tr><td style="padding:2px 12px 2px 0;color:#666">Name</td><td>${escapeHtml(input.name)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(input.email)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Received</td><td>${when}</td></tr>
</table>
<div style="white-space:pre-wrap;padding:12px 14px;border-radius:12px;background:#f2f2f7;font-size:15px">${escapeHtml(input.message)}</div>
<p style="margin-top:12px;font-size:12px;color:#666">Reply to this email to respond to ${escapeHtml(input.name)} directly.</p>
</body></html>`;

  return {
    to: cfg.to,
    from: cfg.from,
    replyTo: input.email,
    subject: `Portfolio message from ${input.name}`,
    text,
    html,
    idempotencyKey: meta.messageId ? `contact-${meta.messageId}` : undefined
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Resend REST transport (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendTransport(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000
): EmailTransport {
  return {
    kind: "live",
    async send(email) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      };
      if (email.idempotencyKey) headers["Idempotency-Key"] = email.idempotencyKey;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            reply_to: email.replyTo,
            subject: email.subject,
            text: email.text,
            html: email.html
          }),
          signal: controller.signal
        });
        if (!res.ok) {
          // Log provider detail server-side only; never echo it to visitors.
          const detail = await res.text().catch(() => "");
          console.error(`Resend error ${res.status}: ${detail.slice(0, 500)}`);
          return { ok: false, status: res.status, error: "provider_error" };
        }
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id: data.id };
      } catch (err) {
        console.error("Resend request failed", err);
        return { ok: false, error: "network_error" };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** Records emails instead of sending them. For local preview and tests. */
export function createMockTransport(
  outcome: SendOutcome = { ok: true, id: "mock" }
): EmailTransport & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    kind: "mock",
    sent,
    async send(email) {
      sent.push(email);
      return outcome;
    }
  };
}
