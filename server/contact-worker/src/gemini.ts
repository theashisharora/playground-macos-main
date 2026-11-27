// Minimal Gemini REST client (generateContent). No SDK dependency.
// https://ai.google.dev/api/generate-content

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

export type GeminiOutcome =
  | { ok: true; text: string; totalTokens?: number }
  | {
      ok: false;
      reason: "rate_limited" | "blocked" | "empty" | "error";
      status?: number;
    };

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

/** Model ids look like "gemini-3.5-flash-lite"; anything else is a config error. */
export const MODEL_RE = /^[a-z0-9][a-z0-9.-]{2,63}$/;

const BLOCK_FINISH = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION"
]);

export async function generateReply(
  {
    apiKey,
    model,
    fetchImpl = fetch,
    timeoutMs = 20_000,
    maxOutputTokens = 1024
  }: GeminiOptions,
  systemInstruction: string,
  contents: GeminiContent[]
): Promise<GeminiOutcome> {
  if (!MODEL_RE.test(model)) {
    console.error("GEMINI_MODEL is not a valid model id");
    return { ok: false, reason: "error" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.2, maxOutputTokens, candidateCount: 1 }
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) {
      // Status and a short snippet go to the Worker log only; the key is in a header, never logged.
      const detail = await res.text().catch(() => "");
      console.error(`Gemini error ${res.status}: ${detail.slice(0, 300)}`);
      return {
        ok: false,
        reason: res.status === 429 ? "rate_limited" : "error",
        status: res.status
      };
    }
    const data = (await res.json().catch(() => null)) as {
      promptFeedback?: { blockReason?: string };
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
      usageMetadata?: { totalTokenCount?: number };
    } | null;
    if (!data) return { ok: false, reason: "error" };
    if (data.promptFeedback?.blockReason) return { ok: false, reason: "blocked" };
    const cand = data.candidates?.[0];
    if (cand?.finishReason && BLOCK_FINISH.has(cand.finishReason))
      return { ok: false, reason: "blocked" };
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text, totalTokens: data.usageMetadata?.totalTokenCount };
  } catch (err) {
    console.error("Gemini request failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
