import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LIMITS,
  validateContact
} from "../../../src/shared/contactValidation.ts";

const good = {
  name: "Jane Doe",
  email: "jane@example.com",
  message: "Hello there, nice portfolio!"
};

// Built from char codes so formatters can't turn them into invisible literals.
const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e); // right-to-left override
const ZWSP = String.fromCharCode(0x200b); // zero-width space

test("accepts a valid message and trims fields", () => {
  const r = validateContact({
    name: "  Jane Doe ",
    email: " jane@example.com ",
    message: "  Hello there, nice portfolio!  "
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, good);
});

test("rejects missing and non-string fields", () => {
  const r = validateContact({ name: 42, email: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["email", "message", "name"]);
  assert.equal(validateContact(null).ok, false);
  assert.equal(validateContact("string").ok, false);
});

test("rejects malformed and header-injection emails", () => {
  for (const email of [
    "not-an-email",
    "a@b",
    "jane@example.com\r\nBcc: x@evil.com",
    "jane@example.com, other@evil.com",
    "Jane <jane@example.com>",
    "jane@@example.com",
    `${"a".repeat(250)}@example.com`
  ]) {
    assert.equal(validateContact({ ...good, email }).ok, false, email);
  }
});

test("strips newlines, control and invisible characters from the name", () => {
  const r = validateContact({ ...good, name: `Ja${ZWSP}ne\r\nBcc: evil${NUL}${RLO}` });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.name, "Jane Bcc: evil");
});

test("enforces message length limits in code points", () => {
  assert.equal(validateContact({ ...good, message: "short" }).ok, false);
  assert.equal(
    validateContact({ ...good, message: "x".repeat(CONTACT_LIMITS.messageMax + 1) }).ok,
    false
  );
  assert.equal(
    validateContact({ ...good, message: "😀".repeat(CONTACT_LIMITS.messageMax) }).ok,
    true
  );
});

test("keeps message line breaks but normalises CRLF", () => {
  const r = validateContact({ ...good, message: "Line one\r\nLine two\rLine three" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.message, "Line one\nLine two\nLine three");
});
