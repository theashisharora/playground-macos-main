// Minimal SMTP submission client for Gmail (smtp.gmail.com:465, implicit TLS,
// AUTH PLAIN with a Google App Password). Runs on Cloudflare Workers TCP
// sockets (`cloudflare:sockets` connect() with secureTransport: "on"); the
// socket factory is injected so this file also runs under Node tests.
//
// Delivery semantics:
//  - "Delivered" only after the server answers 250 to the end of DATA.
//  - Any failure BEFORE the final "." is sent means nothing was accepted.
//  - A failure AFTER the final "." (timeout / dropped connection while waiting
//    for the reply) is reported as UNCERTAIN and never retried automatically.
import type { EmailTransport, OutgoingEmail, SendOutcome } from "./email.ts";
import { buildMimeMessage, headerValue, parseMailbox } from "./mime.ts";

/** The subset of a Workers `Socket` this client uses. */
export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close(): Promise<void>;
}

/** Opens an implicit-TLS connection. In Workers: connect(..., { secureTransport: "on" }). */
export type SmtpConnect = (host: string, port: number) => SmtpSocket;

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  /** Google App Password (16 letters; spaces are ignored). Never the account password. */
  appPassword: string;
  /** Name used in EHLO. */
  heloName?: string;
  /** Per-step timeout. */
  stepTimeoutMs?: number;
  /** Wait for the final reply after the message body. */
  dataTimeoutMs?: number;
}

export class SmtpError extends Error {
  readonly code: number | null;
  readonly kind: "timeout" | "closed" | "reply" | "protocol";
  constructor(
    message: string,
    code: number | null,
    kind: "timeout" | "closed" | "reply" | "protocol"
  ) {
    super(message);
    this.name = "SmtpError";
    this.code = code;
    this.kind = kind;
  }
}

interface Reply {
  code: number;
  lines: string[];
}

/** Reads CRLF-terminated SMTP replies (including multi-line "250-..." replies). */
class ReplyReader {
  private buf = "";
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private dec = new TextDecoder();
  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async read(timeoutMs: number): Promise<Reply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SmtpError("Timed out waiting for server", null, "timeout")),
        timeoutMs
      );
    });
    try {
      return await Promise.race([this.next(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async next(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const nl = this.buf.indexOf("\r\n");
      if (nl >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 2);
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m) throw new SmtpError("Malformed reply line", null, "protocol");
        lines.push(m[3]);
        if (m[2] === " ") return { code: Number(m[1]), lines };
        if (lines.length > 100) throw new SmtpError("Reply too long", null, "protocol");
        continue;
      }
      if (this.buf.length > 64 * 1024)
        throw new SmtpError("Reply too large", null, "protocol");
      const { value, done } = await this.reader.read();
      if (done) throw new SmtpError("Connection closed by server", null, "closed");
      this.buf += this.dec.decode(value, { stream: true });
    }
  }

  release() {
    try {
      this.reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

const enc = new TextEncoder();

/** Dot-stuffing (RFC 5321 4.5.2) and the end-of-data marker. */
export function encodeDataSection(message: string): string {
  const body = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return `${body.endsWith("\r\n") ? body : `${body}\r\n`}.\r\n`;
}

const b64 = (s: string) => {
  let bin = "";
  for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** Never log server text verbatim beyond a short, credential-free snippet. */
const snippet = (r: Reply) => `${r.code} ${r.lines.join(" ").slice(0, 120)}`;

export function createSmtpTransport(
  cfg: SmtpConfig,
  connectFn: SmtpConnect | undefined
): EmailTransport {
  const stepTimeout = cfg.stepTimeoutMs ?? 10_000;
  const dataTimeout = cfg.dataTimeoutMs ?? 20_000;
  return {
    kind: "live",
    async send(email: OutgoingEmail): Promise<SendOutcome> {
      if (!connectFn) {
        console.error("SMTP: no socket support in this runtime");
        return { ok: false, error: "provider_unavailable" };
      }
      let raw: string;
      let fromAddr: string;
      let toAddr: string;
      try {
        // The envelope sender is ALWAYS the authenticated account.
        fromAddr = headerValue(cfg.username);
        const to = parseMailbox(email.to);
        const from = parseMailbox(email.from);
        if (!to || !from || from.address.toLowerCase() !== fromAddr.toLowerCase())
          throw new Error("From must be the authenticated SMTP account");
        toAddr = headerValue(to.address);
        raw = buildMimeMessage(email);
      } catch (err) {
        console.error(
          "SMTP: refusing to build email:",
          err instanceof Error ? err.message : ""
        );
        return { ok: false, error: "invalid_message" };
      }

      let socket: SmtpSocket | undefined;
      let reader: ReplyReader | undefined;
      let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
      let dataSent = false;
      const password = cfg.appPassword.replace(/\s+/g, "");

      const expect = async (codes: number[], step: string, ms = stepTimeout) => {
        const r = await reader!.read(ms);
        if (!codes.includes(r.code)) {
          // AUTH replies are logged by code only.
          console.error(
            `SMTP ${step} rejected: ${step === "AUTH" ? r.code : snippet(r)}`
          );
          throw new SmtpError(`${step} rejected`, r.code, "reply");
        }
        return r;
      };
      const write = async (line: string) => {
        await writer!.write(enc.encode(line));
      };

      try {
        socket = connectFn(cfg.host, cfg.port);
        reader = new ReplyReader(socket.readable);
        writer = socket.writable.getWriter();

        await expect([220], "greeting");
        await write(`EHLO ${cfg.heloName ?? "portfolio-contact.workers.dev"}\r\n`);
        const ehlo = await expect([250], "EHLO");
        const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) ?? "";
        if (!/\bPLAIN\b/i.test(auth)) {
          console.error("SMTP: server does not offer AUTH PLAIN");
          throw new SmtpError("AUTH PLAIN unavailable", null, "protocol");
        }
        await write(`AUTH PLAIN ${b64(`\0${cfg.username}\0${password}`)}\r\n`);
        await expect([235], "AUTH");
        await write(`MAIL FROM:<${fromAddr}>\r\n`);
        await expect([250], "MAIL FROM");
        await write(`RCPT TO:<${toAddr}>\r\n`);
        await expect([250, 251], "RCPT TO");
        await write("DATA\r\n");
        await expect([354], "DATA");

        await write(encodeDataSection(raw));
        dataSent = true; // from here on, a lost reply means "unknown", not "failed"
        const final = await expect([250], "message", dataTimeout);

        // Best-effort goodbye; the message is already accepted.
        write("QUIT\r\n").catch(() => {});
        const id =
          final.lines[0]?.match(/\S+\s+-\s+gsmtp$/)?.[0] ?? final.lines[0]?.slice(0, 80);
        return { ok: true, id };
      } catch (err) {
        const e = err instanceof SmtpError ? err : null;
        if (!e)
          // Socket/TLS errors (e.g. "proxy request failed…", certificate
          // errors) never contain credentials; keep a short message for diagnosis.
          console.error(
            "SMTP connection failed:",
            err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown"
          );
        else if (e.kind !== "reply") console.error(`SMTP ${e.kind}: ${e.message}`);
        if (dataSent && e?.kind !== "reply") {
          // The server may have queued the message; report honestly, don't retry.
          return { ok: false, error: "delivery_uncertain", uncertain: true };
        }
        if (e?.kind === "reply" && e.code === 535)
          return { ok: false, error: "auth_error" };
        return {
          ok: false,
          error: e?.kind === "timeout" ? "timeout" : "provider_error",
          ...(e?.code ? { status: e.code } : {})
        };
      } finally {
        reader?.release();
        try {
          writer?.releaseLock();
        } catch {
          /* ignore */
        }
        socket?.close().catch(() => {});
      }
    }
  };
}
