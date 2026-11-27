// Cloudflare Turnstile (bot check) for the Messages app. Loaded only when a
// public site key is configured; otherwise this hook is inert.

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

// Read via a cast instead of augmenting `Window`, which clashes with this
// project's global typings.
const ts = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

const loadScript = () => {
  if (ts()) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
};

export function useTurnstile(siteKey: string, dark: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const enabled = siteKey !== "";

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        const api = ts();
        if (cancelled || !containerRef.current || !api) return;
        widgetId.current = api.render(containerRef.current, {
          sitekey: siteKey,
          theme: dark ? "dark" : "light",
          size: "flexible",
          callback: (t: string) => {
            setToken(t);
            setFailed(false);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setFailed(true);
          }
        });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (widgetId.current) ts()?.remove(widgetId.current);
      widgetId.current = null;
      setToken("");
    };
  }, [enabled, siteKey, dark]);

  /** Tokens are single-use: call after every submission attempt. */
  const reset = useCallback(() => {
    setToken("");
    if (widgetId.current) ts()?.reset(widgetId.current);
  }, []);

  return { enabled, containerRef, token, failed, reset };
}
