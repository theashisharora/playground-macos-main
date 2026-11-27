import type { KeyboardEvent } from "react";
import { format } from "date-fns";
import { user } from "~/configs";
import AiThread, { AI_INTRO, AI_NAME, AiAvatar } from "./messages/AiThread";
import ContactThread, {
  CONTACT_WELCOME,
  type ThreadPreview
} from "./messages/ContactThread";

type ConvoId = "ai" | "ashish";

/**
 * Messages: two conversations in one window.
 *  - Ashish AI (default): AI assistant answering from approved portfolio facts.
 *  - Ashish Arora: direct messages to the real Ashish, delivered by email.
 * Both threads stay mounted (only one is visible), so drafts, history and
 * verification state survive switching.
 */
const Messages = () => {
  const [active, setActive] = useState<ConvoId>("ai");
  const [focusContact, setFocusContact] = useState(0);
  const openedAt = useMemo(() => new Date(), []);
  const [previews, setPreviews] = useState<Record<ConvoId, ThreadPreview>>({
    ai: { text: AI_INTRO, time: openedAt },
    ashish: { text: CONTACT_WELCOME, time: openedAt }
  });
  const tabRefs = {
    ai: useRef<HTMLButtonElement>(null),
    ashish: useRef<HTMLButtonElement>(null)
  };

  const setPreview = useCallback(
    (id: ConvoId) => (p: ThreadPreview) =>
      setPreviews((prev) =>
        prev[id].text === p.text && prev[id].time === p.time ? prev : { ...prev, [id]: p }
      ),
    []
  );
  const onAiPreview = useMemo(() => setPreview("ai"), [setPreview]);
  const onContactPreview = useMemo(() => setPreview("ashish"), [setPreview]);

  const contactAshish = useCallback(() => {
    setActive("ashish");
    setFocusContact((n) => n + 1);
  }, []);

  const convos: {
    id: ConvoId;
    name: string;
    subtitle: string;
    avatar: JSX.Element;
  }[] = [
    {
      id: "ai",
      name: AI_NAME,
      subtitle: "AI assistant",
      avatar: <AiAvatar big />
    },
    {
      id: "ashish",
      name: user.name,
      subtitle: "Direct message",
      avatar: <img src={user.avatar} alt="" className="msg-avatar size-10" />
    }
  ];

  // Arrow keys move between conversations (WAI-ARIA tabs pattern).
  const onTabKey = (e: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const next: ConvoId = active === "ai" ? "ashish" : "ai";
    setActive(next);
    tabRefs[next].current?.focus();
  };

  return (
    <div className="messages-app">
      <div className="msg-layout">
        <aside className="msg-sidebar">
          <div className="msg-sidebar-title">Messages</div>
          <div
            role="tablist"
            aria-label="Conversations"
            aria-orientation="vertical"
            className="msg-convo-list"
            onKeyDown={onTabKey}
          >
            {convos.map((c) => {
              const selected = active === c.id;
              const p = previews[c.id];
              return (
                <button
                  key={c.id}
                  ref={tabRefs[c.id]}
                  id={`msg-tab-${c.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`msg-panel-${c.id}`}
                  tabIndex={selected ? 0 : -1}
                  className={`msg-convo ${selected ? "msg-convo-active" : ""}`}
                  onClick={() => setActive(c.id)}
                >
                  {c.avatar}
                  <span className="msg-convo-body">
                    <span className="hstack justify-between gap-2">
                      <span className="hstack gap-1.5 min-w-0">
                        <span className="font-semibold text-sm truncate">{c.name}</span>
                        {c.id === "ai" && <span className="msg-ai-pill">AI</span>}
                      </span>
                      <span className="msg-convo-time">{format(p.time, "h:mm a")}</span>
                    </span>
                    <span className="msg-convo-sub">{c.subtitle}</span>
                    <span className="msg-convo-preview">{p.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          id="msg-panel-ai"
          role="tabpanel"
          aria-labelledby="msg-tab-ai"
          className="msg-main"
          hidden={active !== "ai"}
        >
          <AiThread onPreview={onAiPreview} onContact={contactAshish} />
        </section>
        <section
          id="msg-panel-ashish"
          role="tabpanel"
          aria-labelledby="msg-tab-ashish"
          className="msg-main"
          hidden={active !== "ashish"}
        >
          <ContactThread onPreview={onContactPreview} focusSignal={focusContact} />
        </section>
      </div>
    </div>
  );
};

export default Messages;
