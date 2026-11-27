import assistant from "~/configs/assistant";
import { minMarginY } from "~/utils";

const config = assistant.welcomeNotification;

const readShown = (): boolean => {
  try {
    return sessionStorage.getItem(config.sessionKey) === "1";
  } catch {
    return false;
  }
};

/** Remembers (for this browser session) that the welcome must not show again. */
export const markWelcomeNotificationShown = (): void => {
  try {
    sessionStorage.setItem(config.sessionKey, "1");
  } catch {
    // Storage blocked: the notification may show again on a later login.
  }
};

interface Props {
  /** True while Messages is open; if it opens before the delay, the banner never shows. */
  messagesOpened: boolean;
  /** Opens Messages (or focuses the open window) on the Ash AI conversation. */
  onOpen: () => void;
}

/**
 * macOS-style banner from "Ash AI", shown once per browser session a few
 * seconds after the desktop appears. Purely local: fixed text, no browser
 * notification permission and no Gemini request.
 */
const WelcomeNotification = ({ messagesOpened, onOpen }: Props) => {
  const [phase, setPhase] = useState<"hidden" | "shown" | "leaving">("hidden");
  const [paused, setPaused] = useState(false);

  // Show after the delay, unless already shown this session or Messages opened.
  useEffect(() => {
    if (messagesOpened || readShown()) return;
    const timer = window.setTimeout(() => {
      if (readShown()) return;
      markWelcomeNotificationShown();
      setPhase("shown");
    }, config.delayMs);
    return () => window.clearTimeout(timer);
  }, [messagesOpened]);

  const dismiss = useCallback(() => {
    setPhase((p) => (p === "shown" ? "leaving" : p));
  }, []);

  // Auto-dismiss, paused while the pointer or keyboard focus is on it.
  useEffect(() => {
    if (phase !== "shown" || paused) return;
    const timer = window.setTimeout(dismiss, config.autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [phase, paused, dismiss]);

  // Remove after the exit animation, even if the browser never reports its end
  // (animations can be paused, e.g. in a background tab).
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase("hidden"), 400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      className={`welcome-notice ${phase === "leaving" ? "welcome-notice-leaving" : ""}`}
      style={{ top: minMarginY + 8 }}
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => {
        if (e.animationName === "welcome-notice-out") setPhase("hidden");
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss();
      }}
    >
      <button
        type="button"
        className="welcome-notice-main"
        onClick={() => {
          onOpen();
          dismiss();
        }}
      >
        <span className="welcome-notice-icon">
          <img src={assistant.avatar} alt="" draggable={false} />
          <img
            src="img/icons/messages.svg"
            alt=""
            draggable={false}
            className="welcome-notice-badge"
          />
        </span>
        <span className="welcome-notice-body">
          <span className="welcome-notice-head">
            <span className="welcome-notice-title">{config.title}</span>
            <span className="welcome-notice-time">now</span>
          </span>
          <span className="welcome-notice-text">{config.message}</span>
          <span className="sr-only">Open Messages to chat with {assistant.name}.</span>
        </span>
      </button>
      <button
        type="button"
        className="welcome-notice-close"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        <span className="i-ri:close-line" aria-hidden="true" />
      </button>
    </div>
  );
};

export default WelcomeNotification;
