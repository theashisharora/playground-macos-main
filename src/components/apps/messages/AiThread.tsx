import React from "react";
import { format } from "date-fns";
import { useTurnstile } from "~/hooks";
import {
  CHAT_LIMITS,
  SUGGESTED_QUESTIONS,
  chatLength,
  normalizeChatText,
  type ChatTurn
} from "~/shared/chatProtocol";
import { TURNSTILE_SITE_KEY } from "~/services/contact";
import { chatConfigured, sendChatMessage } from "~/services/chat";
import type { ThreadPreview } from "./ContactThread";

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: Date;
  /** Server signature (live replies only); lets the reply be sent back as context. */
  sig?: string;
  /** Visitor messages: delivery state of the question. */
  status?: "pending" | "ok" | "failed";
  error?: string;
  /** Assistant messages that did NOT come from the model. */
  preview?: boolean;
}

export const AI_NAME = "Ashish AI";
export const AI_INTRO =
  "Hi! I'm Ashish AI, an AI assistant (not Ashish himself). I can answer questions about Ashish's experience, projects, skills and education, using only his public portfolio. What would you like to know?";

let seq = 0;
const nextId = () => `ai-${Date.now().toString(36)}-${++seq}`;

/** The gradient "AI" avatar, distinct from Ashish's photo. */
export const AiAvatar = ({ big = false }: { big?: boolean }) => (
  <span
    className={`msg-ai-avatar ${big ? "size-10 text-lg" : "size-7 text-sm"}`}
    aria-hidden="true"
  >
    <span className="i-ri:sparkling-2-fill" />
  </span>
);

interface Props {
  onPreview: (p: ThreadPreview) => void;
  onContact: () => void;
}

/** "Ashish AI": Gemini-powered assistant limited to approved portfolio facts. */
const AiThread = ({ onPreview, onContact }: Props) => {
  const dark = useStore((state) => state.dark) as boolean;
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [hasSession, setHasSession] = useState(false);

  const inFlight = useRef(false);
  const session = useRef<string | undefined>(undefined);
  const messagesRef = useRef<AiMessage[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openedTime = useMemo(() => new Date(), []);

  const turnstile = useTurnstile(TURNSTILE_SITE_KEY, dark);
  const needsVerification = turnstile.enabled && !hasSession;

  useEffect(() => {
    messagesRef.current = messages;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const last = messages[messages.length - 1];
    onPreview(
      last
        ? {
            text: last.role === "user" ? `You: ${last.text}` : last.text,
            time: last.time
          }
        : { text: AI_INTRO, time: openedTime }
    );
  }, [messages, pending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // A hidden conversation measures 0: keep the natural one-row height then.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const patch = (id: string, p: Partial<AiMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)));

  /** Earlier answered turns, newest last. Only signed (real) replies are sent back. */
  const historyBefore = (id: string): ChatTurn[] => {
    const list = messagesRef.current;
    const idx = list.findIndex((m) => m.id === id);
    const turns: ChatTurn[] = [];
    for (const m of list.slice(0, idx < 0 ? list.length : idx)) {
      if (m.role === "user" && m.status === "ok")
        turns.push({ role: "user", text: m.text });
      else if (m.role === "assistant" && m.sig)
        turns.push({ role: "assistant", text: m.text, sig: m.sig });
    }
    return turns.slice(-CHAT_LIMITS.historyMax);
  };

  const ask = async (question: AiMessage) => {
    if (inFlight.current) return;
    const useToken = !session.current;
    if (turnstile.enabled && useToken && !turnstile.token) {
      setHasSession(false);
      setNotice("Please complete the verification below, then try again.");
      patch(question.id, { status: "failed", error: "Verification needed." });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setNotice("");
    patch(question.id, { status: "pending", error: undefined });

    const result = await sendChatMessage({
      message: question.text,
      history: historyBefore(question.id),
      session: session.current,
      turnstileToken: useToken ? turnstile.token || undefined : undefined
    });
    if (useToken && turnstile.enabled) turnstile.reset();

    if ("session" in result && result.session) {
      session.current = result.session;
      setHasSession(true);
    }

    if (result.status === "error") {
      if (result.code === "session_required" || result.code === "bot_check_failed") {
        session.current = undefined;
        setHasSession(false);
      }
      patch(question.id, { status: "failed", error: result.message });
    } else {
      const reply: AiMessage = {
        id: nextId(),
        role: "assistant",
        text: result.reply,
        time: new Date(),
        sig: result.status === "ok" && result.mode === "live" ? result.sig : undefined,
        preview: result.status === "preview" || result.mode === "mock"
      };
      setMessages((list) =>
        list
          .map((m) => (m.id === question.id ? { ...m, status: "ok" as const } : m))
          .concat(reply)
      );
    }
    inFlight.current = false;
    setPending(false);
  };

  const submit = (text: string) => {
    if (inFlight.current) return;
    const clean = normalizeChatText(text);
    if (!clean) return;
    if (chatLength(clean) > CHAT_LIMITS.messageMax) {
      setNotice(`Questions can be up to ${CHAT_LIMITS.messageMax} characters.`);
      return;
    }
    if (needsVerification && !turnstile.token) {
      setDraft(text);
      setNotice("Please complete the verification below, then send your question.");
      return;
    }
    const q: AiMessage = {
      id: nextId(),
      role: "user",
      text: clean,
      time: new Date(),
      status: "pending"
    };
    messagesRef.current = [...messagesRef.current, q];
    setMessages(messagesRef.current);
    setDraft("");
    ask(q);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  const len = chatLength(draft);
  const asked = messages.some((m) => m.role === "user");

  return (
    <>
      <header className="msg-header">
        <AiAvatar />
        <div className="leading-tight min-w-0">
          <div className="hstack gap-1.5 text-sm font-semibold text-c-800">
            <span className="truncate">{AI_NAME}</span>
            <span className="msg-ai-pill">AI</span>
          </div>
          <div className="text-[11px] text-c-500 truncate">
            AI assistant · not Ashish himself
          </div>
        </div>
        {!chatConfigured && (
          <span
            className="msg-preview-badge"
            title="No AI backend is connected in this build"
          >
            Preview mode
          </span>
        )}
        <button
          type="button"
          className={`msg-contact-btn ${chatConfigured ? "ml-auto" : ""}`}
          onClick={onContact}
          title="Message the real Ashish"
          aria-label="Contact Ashish (message the real Ashish)"
        >
          <span className="i-ri:user-smile-line" aria-hidden="true" />
          <span className="msg-contact-label">Contact Ashish</span>
        </button>
      </header>

      <div
        ref={transcriptRef}
        className="msg-transcript"
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${AI_NAME}, an AI assistant`}
        aria-busy={pending}
      >
        <div className="msg-timestamp">
          <span className="font-semibold">Today</span> {format(openedTime, "h:mm a")}
        </div>

        <AiBubble text={AI_INTRO} />

        {messages.map((m) =>
          m.role === "assistant" ? (
            <AiBubble key={m.id} text={m.text} preview={m.preview} />
          ) : (
            <div key={m.id} className="msg-row-out">
              <div
                className={`msg-bubble msg-bubble-out ${
                  m.status === "failed" ? "msg-bubble-failed" : ""
                }`}
              >
                {m.text}
              </div>
              {m.status === "failed" && (
                <div className="msg-status msg-status-failed" role="alert">
                  <span className="i-ph:warning-circle-fill text-sm" aria-hidden="true" />
                  <span>Not answered</span>
                  {m.error && <span className="msg-status-detail">{m.error}</span>}
                  <button
                    type="button"
                    className="msg-retry"
                    onClick={() => ask(m)}
                    disabled={pending}
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )
        )}

        {pending && (
          <div className="msg-row-in" role="status">
            <AiAvatar />
            <div className="msg-bubble msg-bubble-in msg-bubble-ai msg-thinking">
              <span className="sr-only">{AI_NAME} is answering…</span>
              <span className="msg-dot" aria-hidden="true" />
              <span className="msg-dot" aria-hidden="true" />
              <span className="msg-dot" aria-hidden="true" />
            </div>
          </div>
        )}

        {!asked && !pending && (
          <div className="msg-suggestions" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="msg-chip"
                onClick={() => submit(q)}
              >
                {q}
              </button>
            ))}
            <button
              type="button"
              className="msg-chip msg-chip-contact"
              onClick={onContact}
            >
              <span className="i-ri:user-smile-line" aria-hidden="true" /> Contact Ashish
            </button>
          </div>
        )}
      </div>

      <form
        className="msg-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        noValidate
      >
        {turnstile.enabled && (
          <div
            ref={turnstile.containerRef}
            className="msg-turnstile"
            hidden={!needsVerification}
          />
        )}

        <div className="msg-compose-row">
          <label htmlFor="ai-text" className="sr-only">
            Ask {AI_NAME} a question
          </label>
          <textarea
            id="ai-text"
            ref={inputRef}
            className="msg-textarea"
            rows={1}
            placeholder="Ask about Ashish's work…"
            maxLength={CHAT_LIMITS.messageMax}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNotice("");
            }}
            onKeyDown={onKeyDown}
            aria-describedby="ai-hint"
          />
          <button
            type="submit"
            className="msg-send"
            disabled={pending || !draft.trim()}
            aria-label={pending ? "Waiting for answer" : "Send question"}
            title="Send (Enter)"
          >
            {pending ? (
              <span className="i-svg-spinners:180-ring text-base" aria-hidden="true" />
            ) : (
              <span className="i-ph:arrow-up-bold text-sm" aria-hidden="true" />
            )}
          </button>
        </div>

        {(notice || (needsVerification && turnstile.failed)) && (
          <p className="msg-field-error" role="alert">
            {notice ||
              "The verification widget couldn't load. Please refresh and try again."}
          </p>
        )}

        <div className="msg-footer">
          <p id="ai-hint">
            {AI_NAME} is an AI, not Ashish. It answers only from his public portfolio and
            can make mistakes. Chats aren't saved or emailed; please don't share personal
            details.
          </p>
          <span className="shrink-0 tabular-nums">
            {len}/{CHAT_LIMITS.messageMax}
          </span>
        </div>
      </form>
    </>
  );
};

/** An assistant bubble, always captioned so it can't be mistaken for Ashish. */
const AiBubble = ({ text, preview }: { text: string; preview?: boolean }) => (
  <div className="msg-ai-group">
    <div className="msg-ai-caption">
      <span className="i-ri:sparkling-2-fill" aria-hidden="true" />
      {preview
        ? `${AI_NAME} · preview reply, not AI-generated`
        : `${AI_NAME} · AI assistant`}
    </div>
    <div className="msg-row-in">
      <AiAvatar />
      <div className="msg-bubble msg-bubble-in msg-bubble-ai">{text}</div>
    </div>
  </div>
);

export default AiThread;
