// Import directly (not via ~/configs index) to avoid a cycle: configs/apps.tsx renders <Music />.
import music from "~/configs/music";
import {
  LIBRARY_ID,
  RECENT_ID,
  getContextTrackIds,
  getTrack,
  player
} from "~/player/controller";
import { formatTime } from "~/player/format";
import { isPreview } from "~/player/sources";
import type { MusicTrack } from "~/types";

/*
 * Music app. Every control here goes through the shared `player` controller,
 * and everything shown comes from the shared store - the same state the
 * Control Center uses - so the two always agree.
 */

interface ViewInfo {
  id: string;
  kind: string;
  title: string;
  description?: string;
  artwork?: string;
}

const getView = (id: string): ViewInfo => {
  if (id === LIBRARY_ID)
    return {
      id,
      kind: "Library",
      title: "Songs",
      description: "Every song in Ashish's library."
    };
  if (id === RECENT_ID)
    return {
      id,
      kind: "Library",
      title: "Recently Played",
      description: "Songs you've played on this device."
    };
  const p = music.playlists.find((pl) => pl.id === id);
  return {
    id,
    kind: p?.featured ? "Featured Playlist" : "Playlist",
    title: p?.title ?? "Playlist",
    description: p?.description,
    artwork: p?.artwork
  };
};

const useMusic = () => useStore((s) => s.music);

/* ------------------------------- controls ------------------------------- */

const IconButton = ({
  label,
  icon,
  onClick,
  active,
  disabled,
  big
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  big?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={`music-btn flex-center rounded-md ${big ? "size-9 text-3xl" : "size-7 text-lg"} ${
      active ? "text-rose-500" : "text-c-700"
    }`}
  >
    <span className={icon} />
  </button>
);

const Transport = () => {
  const m = useMusic();
  const playLabel = m.isPlaying ? "Pause" : "Play";

  return (
    <div className="hstack space-x-1">
      <IconButton
        label={m.shuffle ? "Shuffle on" : "Shuffle off"}
        icon="i-ph:shuffle-bold"
        active={m.shuffle}
        onClick={() => player.toggleShuffle()}
      />
      <IconButton
        label="Previous"
        icon="i-ph:skip-back-fill"
        onClick={() => player.previous()}
      />
      <IconButton
        big
        label={playLabel}
        icon={m.isPlaying ? "i-ph:pause-fill" : "i-ph:play-fill"}
        onClick={() => player.toggle()}
      />
      <IconButton
        label="Next"
        icon="i-ph:skip-forward-fill"
        onClick={() => player.next()}
      />
      <IconButton
        label={`Repeat ${m.repeat === "one" ? "one" : m.repeat === "all" ? "all" : "off"}`}
        icon={m.repeat === "one" ? "i-ph:repeat-once-bold" : "i-ph:repeat-bold"}
        active={m.repeat !== "off"}
        onClick={() => player.cycleRepeat()}
      />
    </div>
  );
};

const Progress = () => {
  const m = useMusic();
  // While dragging, show the scrub position instead of live playback time.
  // A ref holds the latest value so a quick key/pointer release never commits a stale one.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const canSeek = m.duration > 0;
  const value = scrub ?? m.position;

  const update = (v: number) => {
    scrubRef.current = v;
    setScrub(v);
  };

  const commit = () => {
    if (scrubRef.current !== null) player.seek(scrubRef.current);
    scrubRef.current = null;
    setScrub(null);
  };

  return (
    <div className="hstack w-full space-x-2 text-[10px] text-c-500 tabular-nums">
      <span className="w-7 text-right">{formatTime(value)}</span>
      <input
        type="range"
        className="music-range flex-1"
        aria-label="Seek"
        aria-valuetext={`${formatTime(value)} of ${formatTime(m.duration)}`}
        min={0}
        max={canSeek ? m.duration : 1}
        step={0.1}
        value={canSeek ? Math.min(value, m.duration) : 0}
        disabled={!canSeek}
        onChange={(e) => update(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="w-7">{formatTime(m.duration)}</span>
    </div>
  );
};

const Volume = () => {
  const volume = useStore((s) => s.volume);
  const muted = useStore((s) => s.music.muted);
  const icon =
    muted || volume <= 1
      ? "i-ph:speaker-x-fill"
      : volume < 50
        ? "i-ph:speaker-low-fill"
        : "i-ph:speaker-high-fill";

  return (
    <div className="music-volume hstack space-x-1.5">
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        icon={icon}
        onClick={() => player.toggleMute()}
      />
      <input
        type="range"
        className="music-range w-20"
        aria-label="Volume"
        min={1}
        max={100}
        value={muted ? 1 : volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
      />
    </div>
  );
};

/** The "LCD" now-playing display at the top of the window. */
const NowPlaying = () => {
  const m = useMusic();
  const track = getTrack(m.currentTrackId);

  return (
    <div className="music-lcd flex-1 min-w-0 hstack space-x-2.5 rounded-lg px-2 py-1 bg-c-200/70 border border-c-300/60">
      {track ? (
        <img
          src={track.artwork}
          alt={`${track.album} artwork`}
          className="size-10 rounded shadow-sm object-cover shrink-0"
        />
      ) : (
        <div className="size-10 rounded bg-c-300 flex-center shrink-0">
          <span className="i-ph:music-note-simple text-c-500" />
        </div>
      )}
      <div className="flex-1 min-w-0 vstack">
        <div className="hstack w-full justify-center space-x-1.5 text-xs leading-4">
          {m.isLoading && (
            <span
              className="i-svg-spinners:180-ring text-rose-500 shrink-0"
              aria-hidden
            />
          )}
          <span className="font-semibold text-c-black truncate">
            {track?.title ?? "Not Playing"}
          </span>
          {track && isPreview(track) && <span className="music-badge">Preview</span>}
        </div>
        <div className="w-full text-center text-[11px] leading-4 text-c-500 truncate">
          {track
            ? `${track.artist} — ${track.album}`
            : "Choose a song to start listening"}
        </div>
        <Progress />
      </div>
    </div>
  );
};

/* -------------------------------- layout -------------------------------- */

const SidebarItem = ({
  id,
  icon,
  label,
  current,
  onSelect
}: {
  id: string;
  icon: string;
  label: string;
  current: string;
  onSelect: (id: string) => void;
}) => (
  <li>
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-current={current === id ? "page" : undefined}
      className={`music-side-item w-full hstack space-x-2 rounded-md px-2 py-1 text-left text-sm ${
        current === id ? "bg-c-300/70 text-c-black" : "text-c-700"
      }`}
    >
      <span className={`${icon} text-rose-500 shrink-0`} />
      <span className="truncate">{label}</span>
    </button>
  </li>
);

const Sidebar = ({
  view,
  onSelect
}: {
  view: string;
  onSelect: (id: string) => void;
}) => (
  <nav
    aria-label="Music library"
    className="music-sidebar w-48 shrink-0 overflow-y-auto bg-c-100/80 border-r border-c-300/60 px-2 py-3 space-y-4"
  >
    <div>
      <div className="px-2 mb-1 text-[11px] font-semibold text-c-500">Library</div>
      <ul className="space-y-0.5">
        <SidebarItem
          id={LIBRARY_ID}
          icon="i-ph:music-notes-fill"
          label="Songs"
          current={view}
          onSelect={onSelect}
        />
        <SidebarItem
          id={RECENT_ID}
          icon="i-ph:clock-counter-clockwise"
          label="Recently Played"
          current={view}
          onSelect={onSelect}
        />
      </ul>
    </div>
    <div>
      <div className="px-2 mb-1 text-[11px] font-semibold text-c-500">Playlists</div>
      <ul className="space-y-0.5">
        {music.playlists.map((p) => (
          <SidebarItem
            key={p.id}
            id={p.id}
            icon={p.featured ? "i-ph:star-four-fill" : "i-ph:playlist"}
            label={p.title}
            current={view}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  </nav>
);

/** Shown instead of the sidebar when the window is narrow. */
const ViewSelect = ({
  view,
  onSelect
}: {
  view: string;
  onSelect: (id: string) => void;
}) => (
  <label className="music-view-select hstack space-x-2 text-xs text-c-500">
    <span>View</span>
    <select
      value={view}
      onChange={(e) => onSelect(e.target.value)}
      className="flex-1 rounded-md bg-c-200 text-c-black border border-c-300 px-1.5 py-1 text-sm"
    >
      <optgroup label="Library">
        <option value={LIBRARY_ID}>Songs</option>
        <option value={RECENT_ID}>Recently Played</option>
      </optgroup>
      <optgroup label="Playlists">
        {music.playlists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </optgroup>
    </select>
  </label>
);

const ErrorBanner = () => {
  const error = useStore((s) => s.music.error);
  const track = getTrack(useStore((s) => s.music.currentTrackId));
  if (!error) return null;

  return (
    <div
      role="alert"
      className="mx-4 mt-3 hstack space-x-2 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
    >
      <span className="i-ph:warning-circle-fill text-lg shrink-0" />
      <span className="flex-1">{error}</span>
      <button
        type="button"
        className="music-link-btn shrink-0 font-medium"
        onClick={() => void player.play()}
      >
        Try again
      </button>
      {track?.appleMusicUrl && (
        <a
          className="shrink-0 font-medium underline"
          href={track.appleMusicUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Apple Music
        </a>
      )}
    </div>
  );
};

const TrackRow = ({
  track,
  index,
  contextId
}: {
  track: MusicTrack;
  index: number;
  contextId: string;
}) => {
  const current = useStore((s) => s.music.currentTrackId === track.id);
  const isPlaying = useStore((s) => s.music.isPlaying);

  return (
    <li
      className={`music-row group hstack rounded-md pr-2 ${
        current ? "bg-rose-500/10" : "hover:bg-c-200/70"
      }`}
    >
      <button
        type="button"
        onClick={() => player.playTrack(track.id, contextId)}
        aria-label={`Play ${track.title} by ${track.artist}`}
        aria-current={current ? "true" : undefined}
        className="flex-1 min-w-0 hstack space-x-3 px-2 py-1.5 text-left"
      >
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-c-500">
          {current && isPlaying ? (
            <span
              className="i-svg-spinners:bars-scale-middle text-rose-500"
              aria-hidden
            />
          ) : (
            <>
              <span className="group-hover:hidden">{index + 1}</span>
              <span className="i-ph:play-fill hidden group-hover:inline-block text-c-700" />
            </>
          )}
        </span>
        <img
          src={track.artwork}
          alt=""
          loading="lazy"
          className="size-9 rounded shrink-0 object-cover"
        />
        <span className="flex-1 min-w-0">
          <span
            className={`block truncate text-sm ${current ? "text-rose-500 font-semibold" : "text-c-black"}`}
          >
            {track.title}
          </span>
          <span className="block truncate text-xs text-c-500">{track.artist}</span>
        </span>
        <span className="music-col-album w-56 shrink-0 truncate text-xs text-c-500">
          {track.album}
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-c-500">
          {formatTime(track.durationMs / 1000)}
        </span>
      </button>
      {track.appleMusicUrl && (
        <a
          href={track.appleMusicUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${track.title} in Apple Music`}
          title="Listen to the full song on Apple Music"
          className="ml-1 size-7 flex-center rounded-md text-c-500 hover:text-rose-500"
        >
          <span className="i-ph:arrow-square-out" />
        </a>
      )}
    </li>
  );
};

const PlaylistView = ({ view }: { view: string }) => {
  const recentlyPlayed = useStore((s) => s.music.recentlyPlayed);
  const info = getView(view);
  const ids = view === RECENT_ID ? recentlyPlayed : getContextTrackIds(view);
  const tracks = ids.map((id) => getTrack(id)).filter((t): t is MusicTrack => !!t);
  const cover = info.artwork ?? tracks[0]?.artwork;
  const anyPreview = tracks.some(isPreview);

  return (
    <div className="px-4 pb-6">
      <header className="music-header hstack space-x-5 py-4">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="music-cover size-36 rounded-lg shadow-lg object-cover shrink-0"
          />
        ) : (
          <div className="music-cover size-36 rounded-lg bg-gradient-to-br from-rose-400 to-red-600 flex-center shrink-0">
            <span className="i-ph:clock-counter-clockwise text-5xl text-white" />
          </div>
        )}
        <div className="min-w-0 space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">
            {info.kind}
          </div>
          <h2 className="text-2xl font-bold text-c-black leading-tight">{info.title}</h2>
          {info.description && <p className="text-sm text-c-500">{info.description}</p>}
          <p className="text-xs text-c-500">
            {tracks.length} {tracks.length === 1 ? "song" : "songs"}
          </p>
          <div className="hstack space-x-2 pt-1">
            <button
              type="button"
              disabled={!tracks.length}
              onClick={() => player.playContext(view)}
              className="music-pill hstack space-x-1 rounded-md bg-rose-500 px-4 py-1 text-sm font-semibold text-white"
            >
              <span className="i-ph:play-fill" />
              <span>Play</span>
            </button>
            <button
              type="button"
              disabled={!tracks.length}
              onClick={() => player.playContext(view, true)}
              className="music-pill hstack space-x-1 rounded-md bg-c-200 px-4 py-1 text-sm font-semibold text-rose-500"
            >
              <span className="i-ph:shuffle-bold" />
              <span>Shuffle</span>
            </button>
          </div>
        </div>
      </header>

      {anyPreview && (
        <p className="mb-2 text-xs text-c-500">
          Plays 30-second previews provided by Apple. Use the{" "}
          <span className="i-ph:arrow-square-out align-[-2px]" aria-hidden /> button next
          to a song to hear it in full on Apple Music.
        </p>
      )}

      {tracks.length ? (
        <ol aria-label={`${info.title} songs`} className="space-y-0.5">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} contextId={view} />
          ))}
        </ol>
      ) : (
        <p className="py-10 text-center text-sm text-c-500">
          Nothing here yet. Songs you play will show up in Recently Played.
        </p>
      )}
    </div>
  );
};

export default function Music() {
  const [view, setView] = useState<string>(
    () => useStore.getState().music.queueContextId || music.defaultPlaylistId
  );

  return (
    <div className="music-app size-full flex bg-c-50 text-c-black select-none">
      <Sidebar view={view} onSelect={setView} />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="music-toolbar hstack space-x-3 px-3 py-2 border-b border-c-300/60 bg-c-100/80">
          <Transport />
          <NowPlaying />
          <Volume />
        </div>
        <div className="music-compact-bar px-3 pt-2">
          <ViewSelect view={view} onSelect={setView} />
        </div>
        <ErrorBanner />
        <main className="flex-1 overflow-y-auto">
          <PlaylistView view={view} />
        </main>
      </div>
    </div>
  );
}
