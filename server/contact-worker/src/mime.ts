// RFC 5322 / MIME message building, shared by the SMTP and Gmail API transports.
import type { OutgoingEmail } from "./email.ts";
import { bytesToBase64, toBase64Url } from "./signing.ts";

const enc = new TextEncoder();

/** Rejects CR/LF so a value can never start a new header or SMTP command. */
export function headerValue(v: string): string {
  if (/[\r\n]/.test(v)) throw new Error("Header value contains a line break");
  return v;
}

/** RFC 2047 encoded-words (UTF-8, base64), each <= 75 chars, folded. */
export function encodeHeaderWords(text: string): string {
  headerValue(text);
  if (/^[\x20-\x7E]*$/.test(text) && !/=\?/.test(text)) return text;
  const words: string[] = [];
  let chunk: number[] = [];
  for (const ch of text) {
    const bytes = Array.from(enc.encode(ch));
    if (chunk.length + bytes.length > 45) {
      words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
  return words.join("\r\n ");
}

const ADDRESS_RE = /^[^\s<>@",;]+@[^\s<>@",;]+$/;

/** Parses `Name <addr>` or `addr`. Returns null for anything unusual. */
export function parseMailbox(v: string): { name: string; address: string } | null {
  const m = /^\s*(?:"?([^"<>]*?)"?\s*)?<([^<>]+)>\s*$/.exec(v);
  const name = m ? (m[1] ?? "").trim() : "";
  const address = (m ? m[2] : v).trim();
  if (!ADDRESS_RE.test(address)) return null;
  return { name, address };
}

function formatMailbox({ name, address }: { name: string; address: string }) {
  const clean = name.replace(/["\\]/g, "").trim();
  if (!clean) return address;
  // Plain ASCII goes in a quoted string; anything else as encoded-words.
  const display =
    /^[\x20-\x7E]*$/.test(clean) && !/=\?/.test(clean)
      ? `"${headerValue(clean)}"`
      : encodeHeaderWords(clean);
  return `${display} <${address}>`;
}

const base64Lines = (s: string) =>
  (bytesToBase64(enc.encode(s)).match(/.{1,76}/g) ?? []).join("\r\n");

/** Builds a raw RFC 5322 message (CRLF line endings). Throws on unsafe header input. */
export function buildMimeMessage(email: OutgoingEmail, date = new Date()): string {
  const from = parseMailbox(email.from);
  const to = parseMailbox(email.to);
  const replyTo = parseMailbox(email.replyTo);
  if (!from || !to || !replyTo) throw new Error("Invalid address in email headers");

  const boundary = `b_${toBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const domain = from.address.split("@")[1];
  const idPart = (
    email.idempotencyKey ?? toBase64Url(crypto.getRandomValues(new Uint8Array(12)))
  ).replace(/[^A-Za-z0-9._-]/g, "");

  const headers = [
    `From: ${formatMailbox(from)}`,
    `To: ${formatMailbox(to)}`,
    `Reply-To: ${formatMailbox(replyTo)}`,
    `Subject: ${encodeHeaderWords(email.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${idPart}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.html),
    `--${boundary}--`,
    ""
  ].join("\r\n");
}
