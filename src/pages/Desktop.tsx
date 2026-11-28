import React from "react";
import { apps, wallpapers } from "~/configs";
import { minMarginY } from "~/utils";
import { player } from "~/player/controller";
import type { MacActions } from "~/types";
import { SHOW_AI_EVENT } from "~/configs/assistant";
import WelcomeNotification, {
  markWelcomeNotificationShown
} from "~/components/WelcomeNotification";

interface DesktopState {
  showApps: {
    [key: string]: boolean;
  };
  appsZ: {
    [key: string]: number;
  };
  maxApps: {
    [key: string]: boolean;
  };
  minApps: {
    [key: string]: boolean;
  };
  maxZ: number;
  showLaunchpad: boolean;
  currentTitle: string;
  hideDockAndTopbar: boolean;
  spotlight: boolean;
}

export default function Desktop(props: MacActions) {
  const [state, setState] = useState({
    showApps: {},
    appsZ: {},
    maxApps: {},
    minApps: {},
    maxZ: 2,
    showLaunchpad: false,
    currentTitle: "Finder",
    hideDockAndTopbar: false,
    spotlight: false
  } as DesktopState);

  const [spotlightBtnRef, setSpotlightBtnRef] =
    useState<React.RefObject<HTMLDivElement> | null>(null);

  const { dark, brightness } = useStore((state) => ({
    dark: state.dark,
    brightness: state.brightness
  }));

  const getAppsData = (): void => {
    let showApps = {},
      appsZ = {},
      maxApps = {},
      minApps = {};

    apps.forEach((app) => {
      showApps = {
        ...showApps,
        [app.id]: !!app.show
      };
      appsZ = {
        ...appsZ,
        [app.id]: 2
      };
      maxApps = {
        ...maxApps,
        [app.id]: false
      };
      minApps = {
        ...minApps,
        [app.id]: false
      };
    });

    setState((prev) => ({ ...prev, showApps, appsZ, maxApps, minApps }));
  };

  useEffect(() => {
    getAppsData();
    // Set up the shared music player (loads the default playlist paused; never autoplays).
    player.init();
    // Logging out / sleeping / shutting down leaves the desktop: stop the music.
    return () => player.stop();
  }, []);

  // Once Messages has been opened this session, the welcome banner is never needed.
  const messagesOpened = !!state.showApps.messages;
  useEffect(() => {
    if (messagesOpened) markWelcomeNotificationShown();
  }, [messagesOpened]);

  const toggleLaunchpad = (target: boolean): void => {
    const r = document.querySelector(`#launchpad`) as HTMLElement;
    if (target) {
      r.style.transform = "scale(1)";
      r.style.transition = "ease-in 0.2s";
    } else {
      r.style.transform = "scale(1.1)";
      r.style.transition = "ease-out 0.2s";
    }

    setState((prev) => ({ ...prev, showLaunchpad: target }));
  };

  const toggleSpotlight = (): void => {
    setState((prev) => ({ ...prev, spotlight: !prev.spotlight }));
  };

  const setWindowPosition = (id: string): void => {
    const r = document.querySelector(`#window-${id}`) as HTMLElement;
    const rect = r.getBoundingClientRect();
    r.style.setProperty(
      "--window-transform-x",
      // "+ window.innerWidth" because of the boundary for windows
      (window.innerWidth + rect.x).toFixed(1).toString() + "px"
    );
    r.style.setProperty(
      "--window-transform-y",
      // "- minMarginY" because of the boundary for windows
      (rect.y - minMarginY).toFixed(1).toString() + "px"
    );
  };

  const setAppMax = (id: string, target?: boolean): void => {
    setState((prev) => {
      const maximized = target ?? !prev.maxApps[id];
      return {
        ...prev,
        maxApps: { ...prev.maxApps, [id]: maximized },
        hideDockAndTopbar: maximized
      };
    });
  };

  const setAppMin = (id: string, target?: boolean): void => {
    setState((prev) => ({
      ...prev,
      minApps: { ...prev.minApps, [id]: target ?? !prev.minApps[id] }
    }));
  };

  const minimizeApp = (id: string): void => {
    setWindowPosition(id);

    // get the corrosponding dock icon's position
    let r = document.querySelector(`#dock-${id}`) as HTMLElement;
    const dockAppRect = r.getBoundingClientRect();

    r = document.querySelector(`#window-${id}`) as HTMLElement;
    // const appRect = r.getBoundingClientRect();
    const posY = window.innerHeight - r.offsetHeight / 2 - minMarginY;
    // "+ window.innerWidth" because of the boundary for windows
    const posX = window.innerWidth + dockAppRect.x - r.offsetWidth / 2 + 25;

    // translate the window to that position
    r.style.transform = `translate(${posX}px, ${posY}px) scale(0.2)`;
    r.style.transition = "ease-out 0.3s";

    // add it to the minimized app list
    setAppMin(id, true);
  };

  const closeApp = (id: string): void => {
    setState((prev) => ({
      ...prev,
      showApps: { ...prev.showApps, [id]: false },
      maxApps: { ...prev.maxApps, [id]: false },
      minApps: { ...prev.minApps, [id]: false },
      hideDockAndTopbar: false
    }));
  };

  const openApp = (id: string): void => {
    const currentApp = apps.find((app) => app.id === id);
    if (currentApp === undefined) {
      throw new TypeError(`App ${id} is undefined.`);
    }

    // Every entry point (Launchpad, Dock, Spotlight, window focus) dismisses
    // Launchpad. Keep the existing scale transition and window restore motion.
    const lp = document.getElementById("launchpad");
    if (lp) {
      lp.style.transform = "scale(1.1)";
      lp.style.transition = "ease-out 0.2s";
    }

    // if the app has already been shown but minimized
    if (state.minApps[id]) {
      // move to window's last position
      const r = document.querySelector(`#window-${id}`) as HTMLElement;
      r.style.transform = `translate(${r.style.getPropertyValue(
        "--window-transform-x"
      )}, ${r.style.getPropertyValue("--window-transform-y")}) scale(1)`;
      r.style.transition = "ease-in 0.3s";
    }

    // One immutable update uses the latest state, including any other updates
    // batched during this click. Existing app IDs keep their mounted window.
    setState((prev) => ({
      ...prev,
      showApps: { ...prev.showApps, [id]: true },
      appsZ: { ...prev.appsZ, [id]: prev.maxZ + 1 },
      minApps: { ...prev.minApps, [id]: false },
      maxZ: prev.maxZ + 1,
      currentTitle: currentApp.title,
      showLaunchpad: false
    }));
  };

  const renderAppWindows = () => {
    return apps.map((app) => {
      if (app.desktop && state.showApps[app.id]) {
        const props = {
          id: app.id,
          title: app.title,
          width: app.width,
          height: app.height,
          minWidth: app.minWidth,
          minHeight: app.minHeight,
          aspectRatio: app.aspectRatio,
          x: app.x,
          y: app.y,
          z: state.appsZ[app.id],
          max: state.maxApps[app.id],
          min: state.minApps[app.id],
          close: closeApp,
          setMax: setAppMax,
          setMin: minimizeApp,
          focus: openApp
        };

        return (
          <AppWindow key={`desktop-app-${app.id}`} {...props}>
            {app.content}
          </AppWindow>
        );
      } else {
        return <div key={`desktop-app-${app.id}`} />;
      }
    });
  };

  return (
    <div
      // Clip oversized drag bounds without allowing focus to scroll the desktop
      // when a Launchpad button becomes hidden during application activation.
      className="size-full overflow-clip bg-center bg-cover"
      style={{
        backgroundImage: `url(${dark ? wallpapers.night : wallpapers.day})`,
        filter: `brightness( ${(brightness as number) * 0.7 + 50}% )`
      }}
    >
      {/* Top Menu Bar */}
      <TopBar
        title={state.currentTitle}
        setLogin={props.setLogin}
        shutMac={props.shutMac}
        sleepMac={props.sleepMac}
        restartMac={props.restartMac}
        toggleSpotlight={toggleSpotlight}
        hide={state.hideDockAndTopbar}
        setSpotlightBtnRef={setSpotlightBtnRef}
      />

      {/* Desktop Apps */}
      <div className="window-bound z-10 absolute" style={{ top: minMarginY }}>
        {renderAppWindows()}
      </div>

      {/* One-time "Ash AI" welcome banner (top right, below the menu bar) */}
      <WelcomeNotification
        messagesOpened={messagesOpened}
        onOpen={() => {
          openApp("messages");
          window.dispatchEvent(new Event(SHOW_AI_EVENT));
        }}
      />

      {/* Spotlight */}
      {state.spotlight && (
        <Spotlight
          openApp={openApp}
          toggleLaunchpad={toggleLaunchpad}
          toggleSpotlight={toggleSpotlight}
          btnRef={spotlightBtnRef as React.RefObject<HTMLDivElement>}
        />
      )}

      {/* Launchpad */}
      <Launchpad
        show={state.showLaunchpad}
        toggleLaunchpad={toggleLaunchpad}
        openApp={openApp}
      />

      {/* Dock */}
      <Dock
        open={openApp}
        showApps={state.showApps}
        showLaunchpad={state.showLaunchpad}
        toggleLaunchpad={toggleLaunchpad}
        hide={state.hideDockAndTopbar}
      />
    </div>
  );
}
