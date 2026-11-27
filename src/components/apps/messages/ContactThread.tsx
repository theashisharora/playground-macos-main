import React from "react";
import { format } from "date-fns";
import { user } from "~/configs";
import { useTurnstile } from "~/hooks";
import {
  CONTACT_LIMITS,
  charLength,
  validateContact,
  type ContactErrors,
  type ContactField
} from "~/shared/contactValidation";
import {
  TURNSTILE_SITE_KEY,
  contactConfigured,
  newMessageId,
  sendContactMessage,
  type ContactPayload
} from "~/services/contact";

type DeliveryStatus = "sending" | "sent" | "preview" | "failed" | "uncertain";

interface OutgoingBubble {
  id: string;
  text: string;
  time: Date;
  status: DeliveryStatus;
  error?: string;
  payload: ContactPayload;
}

export interface ThreadPreview {
  text: string;
  time: Date;
}

export const CONTACT_WELCOME =
  "Hi, I'm Ashish 👋 Thanks for stopping by my portfolio! If you have a question, an opportunity, or just want to say hello, send me a message here. It goes straight to my email inbox, so leave an address where I can reply.";

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  sending: "Sending…",
  sent: "Delivered",
  preview: "Preview only · not sent",
  failed: "Not Delivered",
  // Neither "Delivered" nor "Not Delivered": the provider may have accepted it.
  uncertain: "Delivery unconfirmed"
};

const FIELD_ORDER: ContactField[] = ["name", "email", "message"];

interface Props {
  /** Reports the latest message for the sidebar. */
  onPreview: (p: ThreadPreview) => void;
  /** Increments when "Contact Ashish" is used, to focus the form. */
  focusSignal: number;
}

/** Direct messages to the real Ashish, delivered by email through the Worker. */
const ContactThread = ({ onPreview, focusSignal }: Props) => {
  const dark = useStore((state) => state.dark) as boolean;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<ContactErrors>({});
  const [formError, setFormError] = useState("");
  const [bubbles, setBubbles] = useState<OutgoingBubble[]>([]);
  const [sending, setSending] = useState(false);

  // A ref (not state) so a double Enter/click in the same tick can't send twice.
  const inFlight = useRef(false);
  const openedAt = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fieldRefs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null)
  };

  const turnstile = useTurnstile(TURNSTILE_SITE_KEY, dark);
  const openedTime = useMemo(() => new Date(), []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const last = bubbles[bubbles.length - 1];
    onPreview(
      last
        ? { text: `You: ${last.text}`, time: last.time }
        : { text: CONTACT_WELCOME, time: openedTime }
    );
  }, [bubbles]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const target = name.trim() ? (email.trim() ? "message" : "email") : "name";
    fieldRefs[target].current?.focus();
  }, [focusSignal]);

  // Grow the composer with its content, up to the CSS max-height.
  useEffect(() => {
    const el = fieldRefs.message.current;
    if (!el) return;
    el.style.height = "auto";
    // A hidden conversation measures 0: keep the natural one-row height then.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  const updateBubble = (id: string, patch: Partial<OutgoingBubble>) =>
    setBubbles((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const focusFirstError = (errs: ContactErrors) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) fieldRefs[first].current?.focus();
  };

  const deliver = async (bubble: OutgoingBubble) => {
    if (inFlight.current) return;
    if (turnstile.enabled && !turnstile.token) {
      setFormError("Please complete the verification below before sending.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    setFormError("");
    updateBubble(bubble.id, { status: "sending", error: undefined });

    const payload = { ...bubble.payload, turnstileToken: turnstile.token || undefined };
    const result = await sendContactMessage(payload);
    turnstile.reset();

    switch (result.status) {
      case "sent":
        updateBubble(bubble.id, { status: "sent" });
        break;
      case "preview":
        updateBubble(bubble.id, { status: "preview" });
        break;
      case "invalid":
        // Server disagreed with the browser's validation: put the text back to edit.
        setBubbles((list) => list.filter((b) => b.id !== bubble.id));
        setMessage((m) => m || bubble.text);
        setErrors(result.fields);
        focusFirstError(result.fields);
        break;
      case "error":
        updateBubble(bubble.id, { status: "failed", error: result.message });
        break;
      case "uncertain":
        // No Try Again: resending could deliver the same message twice.
        updateBubble(bubble.id, { status: "uncertain", error: result.message });
        break;
    }
    inFlight.current = false;
    setSending(false);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;

    const result = validateContact({ name, email, message });
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }
    if (turnstile.enabled && !turnstile.token) {
      setFormError("Please complete the verification below before sending.");
      return;
    }
    setErrors({});

    const id = newMessageId();
    const bubble: OutgoingBubble = {
      id,
      text: result.value.message,
      time: new Date(),
      status: "sending",
      payload: {
        ...result.value,
        messageId: id,
        elapsedMs: Date.now() - openedAt.current,
        website
      }
    };
    setBubbles((list) => [...list, bubble]);
    setMessage("");
    deliver(bubble);
  };

  const onMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const clearError = (field: ContactField) =>
    errors[field] && setErrors(({ [field]: _, ...rest }) => rest);

  const msgLen = charLength(message);
  const nearLimit = msgLen > CONTACT_LIMITS.messageMax * 0.85;
  const canSend = !sending && message.trim().length > 0;

  return (
    <>
      <header className="msg-header">
        <img src={user.avatar} alt="" className="msg-avatar size-7" />
        <div className="leading-tight min-w-0">
          <div className="text-sm font-semibold text-c-800 truncate">{user.name}</div>
          <div className="text-[11px] text-c-500 truncate">
            The real Ashish · replies by email
          </div>
        </div>
        {!contactConfigured && (
          <span
            className="msg-preview-badge"
            title="No email backend is connected in this build"
          >
            Preview mode · messages are not sent
          </span>
        )}
      </header>

      <div
        ref={transcriptRef}
        className="msg-transcript"
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${user.name}`}
      >
        <div className="msg-timestamp">
          <span className="font-semibold">Today</span> {format(openedTime, "h:mm a")}
        </div>

        <div className="msg-row-in">
          <img src={user.avatar} alt="" className="msg-avatar size-7 self-end" />
          <div className="msg-bubble msg-bubble-in">{CONTACT_WELCOME}</div>
        </div>

        {bubbles.map((b, i) => (
          <div key={b.id} className="msg-row-out">
            <div
              className={`msg-bubble msg-bubble-out ${
                b.status === "failed" ? "msg-bubble-failed" : ""
              } ${b.status === "sending" ? "opacity-70" : ""}`}
            >
              {b.text}
            </div>
            {(i === bubbles.length - 1 || b.status !== "sent") && (
              <div
                className={`msg-status ${b.status === "failed" ? "msg-status-failed" : ""}`}
                role={
                  b.status === "failed" || b.status === "uncertain" ? "alert" : undefined
                }
              >
                {b.status === "failed" && (
                  <span className="i-ph:warning-circle-fill text-sm" aria-hidden="true" />
                )}
                {b.status === "uncertain" && (
                  <span
                    className="i-ph:question-fill text-sm text-amber-500"
                    aria-hidden="true"
                  />
                )}
                <span>{STATUS_LABEL[b.status]}</span>
                {b.status === "uncertain" && b.error && (
                  <span className="msg-status-detail">{b.error}</span>
                )}
                {b.status === "failed" && (
                  <>
                    {b.error && <span className="msg-status-detail">{b.error}</span>}
                    <button
                      type="button"
                      className="msg-retry"
                      onClick={() => deliver(b)}
                      disabled={sending}
                    >
                      Try Again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="msg-composer" onSubmit={submit} noValidate>
        <div className="msg-fields">
          <div className="msg-field">
            <label htmlFor="msg-name" className="sr-only">
              Full name
            </label>
            <input
              id="msg-name"
              ref={fieldRefs.name}
              className="msg-input"
              placeholder="Full name"
              autoComplete="name"
              maxLength={CONTACT_LIMITS.nameMax}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError("name");
              }}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "msg-name-err" : undefined}
              disabled={sending}
            />
            {errors.name && (
              <p id="msg-name-err" className="msg-field-error">
                {errors.name}
              </p>
            )}
          </div>
          <div className="msg-field">
            <label htmlFor="msg-email" className="sr-only">
              Email address
            </label>
            <input
              id="msg-email"
              ref={fieldRefs.email}
              className="msg-input"
              type="email"
              inputMode="email"
              placeholder="Email address"
              autoComplete="email"
              maxLength={CONTACT_LIMITS.emailMax}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError("email");
              }}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "msg-email-err" : undefined}
              disabled={sending}
            />
            {errors.email && (
              <p id="msg-email-err" className="msg-field-error">
                {errors.email}
              </p>
            )}
          </div>
        </div>

        {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
        <div className="msg-hp" aria-hidden="true">
          <label htmlFor="msg-website">Website</label>
          <input
            id="msg-website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {turnstile.enabled && (
          <div ref={turnstile.containerRef} className="msg-turnstile" />
        )}

        <div className="msg-compose-row">
          <label htmlFor="msg-text" className="sr-only">
            Message
          </label>
          <textarea
            id="msg-text"
            ref={fieldRefs.message}
            className="msg-textarea"
            rows={1}
            placeholder="Message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              clearError("message");
            }}
            onKeyDown={onMessageKeyDown}
            aria-invalid={!!errors.message}
            aria-describedby={`msg-hint${errors.message ? " msg-text-err" : ""}`}
            disabled={sending}
          />
          <button
            type="submit"
            className="msg-send"
            disabled={!canSend}
            aria-label={sending ? "Sending message" : "Send message"}
            title="Send (Enter)"
          >
            {sending ? (
              <span className="i-svg-spinners:180-ring text-base" aria-hidden="true" />
            ) : (
              <span className="i-ph:arrow-up-bold text-sm" aria-hidden="true" />
            )}
          </button>
        </div>

        {errors.message && (
          <p id="msg-text-err" className="msg-field-error">
            {errors.message}
          </p>
        )}
        {(formError || turnstile.failed) && (
          <p className="msg-field-error" role="alert">
            {formError ||
              "The verification widget couldn't load. Please refresh and try again."}
          </p>
        )}

        <div className="msg-footer">
          <p id="msg-hint">
            Your name, email and message are emailed to Ashish only to reply to you. They
            aren't stored on this site.
          </p>
          <span
            className={`shrink-0 tabular-nums ${nearLimit ? "text-red-500" : ""}`}
            aria-live={nearLimit ? "polite" : "off"}
          >
            {msgLen}/{CONTACT_LIMITS.messageMax}
          </span>
        </div>
      </form>
    </>
  );
};

export default ContactThread;
