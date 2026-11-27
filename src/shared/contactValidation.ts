/**
 * Contact-form rules shared by the Messages app (browser) and the contact
 * Worker (server). The server always re-validates; the browser copy only
 * gives visitors instant feedback.
 *
 * Keep this file dependency-free: the Worker imports it directly and the
 * Node test runner loads it with type stripping.
 */

export const CONTACT_LIMITS = {
  nameMin: 2,
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 2000
} as const;

export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

export type ContactField = keyof ContactInput;
export type ContactErrors = Partial<Record<ContactField, string>>;

export type ValidationResult =
  | { ok: true; value: ContactInput }
  | { ok: false; errors: ContactErrors };

// C0 controls except \t and \n, plus DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Bidi overrides / zero-width chars that can disguise content in an inbox.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

// Deliberately conservative: no quoted local parts, no IP-literal domains,
// no whitespace, angle brackets or commas (which could smuggle extra recipients).
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Length in user-perceived code points (so emoji count as one). */
export const charLength = (s: string) => Array.from(s).length;

const clean = (s: string) => s.normalize("NFC").replace(INVISIBLE_CHARS, "");

export const normalizeName = (raw: string) =>
  clean(raw)
    .replace(/[\r\n\t]+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/\s{2,}/g, " ")
    .trim();

export const normalizeEmail = (raw: string) =>
  clean(raw).replace(CONTROL_CHARS, "").trim();

export const normalizeMessage = (raw: string) =>
  clean(raw)
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

export function validateContact(raw: unknown): ValidationResult {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: ContactErrors = {};

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // Cap before normalising so a huge payload can't make us do heavy work.
  const name = normalizeName(str(input.name).slice(0, CONTACT_LIMITS.nameMax * 4));
  const email = normalizeEmail(str(input.email).slice(0, CONTACT_LIMITS.emailMax * 2));
  const message = normalizeMessage(
    str(input.message).slice(0, CONTACT_LIMITS.messageMax * 4)
  );

  const nameLen = charLength(name);
  if (nameLen < CONTACT_LIMITS.nameMin) errors.name = "Please enter your full name.";
  else if (nameLen > CONTACT_LIMITS.nameMax)
    errors.name = `Name must be ${CONTACT_LIMITS.nameMax} characters or fewer.`;

  if (!email) errors.email = "Please enter your email address.";
  else if (email.length > CONTACT_LIMITS.emailMax || !EMAIL_RE.test(email))
    errors.email = "Please enter a valid email address.";

  const msgLen = charLength(message);
  if (msgLen < CONTACT_LIMITS.messageMin)
    errors.message = `Message must be at least ${CONTACT_LIMITS.messageMin} characters.`;
  else if (msgLen > CONTACT_LIMITS.messageMax)
    errors.message = `Message must be ${CONTACT_LIMITS.messageMax} characters or fewer.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, email, message } };
}

/** Client-generated id used to de-duplicate retries of the same message. */
export const MESSAGE_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
