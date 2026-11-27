import { connect } from "cloudflare:sockets";
import { handleRequest, type Env } from "./handler.ts";
import type { SmtpConnect } from "./smtp.ts";

// Durable Object classes must be exported from the Worker's main module.
export { ChatRateLimiter, ContactRateLimiter } from "./rateLimiterDO.ts";

/** Implicit TLS (port 465): the socket is encrypted from the first byte. */
const smtpConnect: SmtpConnect = (hostname, port) =>
  connect({ hostname, port }, { secureTransport: "on", allowHalfOpen: false });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env, { smtpConnect });
    } catch (err) {
      console.error("Unhandled contact worker error", err);
      return new Response(JSON.stringify({ ok: false, error: "server_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
  }
};
