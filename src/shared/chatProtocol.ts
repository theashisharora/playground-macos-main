/**
 * "Ash AI" chat rules shared by the Messages app (browser) and the Worker
 * (server). The server always re-checks everything; the browser copy only
 * gives instant feedback.
 *
 * Keep this file dependency-free: the Worker imports it directly and the Node
 * test runner loads it with type stripping.
 */

export const CHAT_LIMITS = {
  /** Longest visitor question, in characters. */
  messageMax: 500,
  /** Longest assistant reply the server returns (and accepts back as history). */
  replyMax: 1500,
  /** Earlier turns sent back for context (user + assistant, oldest dropped first). */
  historyMax: 8,
  /** Upper bound on a signature or session token string. */
  tokenMax: 512
} as const;

export type ChatRole = "user" | "assistant";

/** One earlier turn. Assistant turns carry the server's signature over their text. */
export interface ChatTurn {
  role: ChatRole;
  text: string;
  sig?: string;
}

export interface ChatRequest {
  message: string;
  history: ChatTurn[];
  /** Short-lived signed session from an earlier reply. */
  session?: string;
  /** Cloudflare Turnstile token, needed when there is no valid session. */
  turnstileToken?: string;
}

export const SUGGESTED_QUESTIONS = [
  "What does Ashish do at Naryant?",
  "What are his main technical skills?",
  "Tell me about Vote4Ash",
  "What is he studying?"
] as const;

// C0 controls except \t and \n, plus DEL and C1 controls.
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]",
  "g"
);
// Bidi overrides / zero-width characters that can hide text.
const INVISIBLE_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]",
  "g"
);

/** Length in user-perceived code points (so emoji count as one). */
export const chatLength = (s: string) => Array.from(s).length;

export const normalizeChatText = (raw: string) =>
  raw
    .slice(0, CHAT_LIMITS.replyMax * 4) // cap before doing any work
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
