// Import directly (not via ~/configs index) to avoid a cycle: configs/apps.tsx renders <Music />.
import music from "~/configs/music";
import { useStore } from "~/stores";
import type { MusicState } from "~/stores/slices/music";
import type { MusicTrack } from "~/types";
import { HtmlAudioBackend } from "./htmlAudioBackend";
import type { PlaybackBackend } from "./types";

/**
 * The single playback controller for the whole site.
 *
 * The Music app, Control Center and the browser's media keys all call this one
 * object, which drives one backend (one audio stream). State flows back through
 * the shared store (`useStore().music`) only from real media events.
 */

export const LIBRARY_ID = "library";
export const RECENT_ID = "recently-played";

const RECENT_KEY = "macos-portfolio:recently-played";
const RECENT_MAX = 20;
/** Within this many seconds, "previous" goes to the previous song instead of restarting. */
const RESTART_THRESHOLD = 3;

const trackById = new Map(music.tracks.map((t) => [t.id, t]));
export const getTrack = (id: string | null | undefined): MusicTrack | undefined =>
  id ? trackById.get(id) : undefined;

const readRecent = (): string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((id) => trackById.has(id)) : [];
  } catch {
    return [];
  }
};

const writeRecent = (ids: string[]) => {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode etc.); recently played just won't persist.
  }
};

const shuffled = <T>(items: T[]): T[] => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const getContextTrackIds = (contextId: string): string[] => {
  if (contextId === LIBRARY_ID) return music.tracks.map((t) => t.id);
  if (contextId === RECENT_ID) return useStore.getState().music.recentlyPlayed;
  return music.playlists.find((p) => p.id === contextId)?.trackIds ?? [];
};

const errorMessage = (e: unknown): string => {
  const err = e as Error;
  if (err?.name === "NotAllowedError")
    return "Your browser blocked playback. Press Play to start the music.";
  if (err?.name === "NotSupportedError")
    return "This audio is unavailable or not supported by your browser.";
  return err?.message || "Something went wrong while playing this song.";
};

class PlayerController {
  private backend: PlaybackBackend | null = null;
  /** Unshuffled order of the current queue context. */
  private baseQueue: string[] = [];
  private initialized = false;
  private countedPlayFor: string | null = null;

  private get state() {
    return useStore.getState().music;
  }

  private set(patch: Partial<MusicState>) {
    useStore.getState().setMusic(patch);
  }

  /** Lazily create the one audio backend (no audio work happens until first use). */
  private getBackend(): PlaybackBackend {
    if (this.backend) return this.backend;

    this.backend = new HtmlAudioBackend({
      onPlaying: () => {
        this.set({ isPlaying: true, isLoading: false, error: null });
        this.addRecentlyPlayed();
        this.updateMediaSessionState();
      },
      onPause: () => {
        this.set({ isPlaying: false });
        this.updateMediaSessionState();
      },
      onLoadingChange: (isLoading) => this.set({ isLoading }),
      onTimeUpdate: (position) => this.set({ position }),
      onDurationChange: (duration) => {
        this.set({ duration });
        this.updateMediaSessionState();
      },
      onEnded: () => this.handleEnded(),
      onError: (error) => this.set({ error, isPlaying: false, isLoading: false })
    });

    this.applyVolume();
    return this.backend;
  }

  /** Called once at startup. Loads the default playlist paused - never autoplays. */
  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.baseQueue = getContextTrackIds(music.defaultPlaylistId);
    this.set({
      queue: this.baseQueue,
      queueIndex: 0,
      queueContextId: music.defaultPlaylistId,
      currentTrackId: this.baseQueue[0] ?? null,
      recentlyPlayed: readRecent()
    });

    // Follow the global Sound volume (Control Center slider) and mute state.
    useStore.subscribe((s, prev) => {
      if (s.volume !== prev.volume || s.music.muted !== prev.music.muted)
        this.applyVolume();
    });

    this.setupMediaSession();
    this.updateMediaSessionMetadata();
  }

  private applyVolume() {
    if (!this.backend) return;
    const { volume, music: m } = useStore.getState();
    this.backend.setVolume(volume / 100);
    this.backend.setMuted(m.muted);
  }

  /* ----------------------------- playback ----------------------------- */

  /** Load (if needed) and play the current track. Errors land in `music.error`. */
  async play() {
    const track = getTrack(this.state.currentTrackId);
    if (!track) return;

    const backend = this.getBackend();
    this.set({ error: null });

    try {
      if (backend.loadedTrackId !== track.id) {
        this.countedPlayFor = null;
        this.set({ position: 0, duration: 0 });
        await backend.load(track);
      }
      await backend.play();
    } catch (e) {
      // A newer action (pause, another track) superseded this one.
      if ((e as Error)?.name === "AbortError") return;
      this.set({ error: errorMessage(e), isPlaying: false, isLoading: false });
    }
  }

  pause() {
    this.backend?.pause();
  }

  toggle() {
    if (this.state.isPlaying || (this.state.isLoading && this.backend?.loadedTrackId))
      this.pause();
    else void this.play();
  }

  /** Play a specific track within a playlist/library context. */
  playTrack(trackId: string, contextId = this.state.queueContextId) {
    const ids = getContextTrackIds(contextId);
    this.baseQueue = ids.length ? ids : [trackId];

    const queue = this.state.shuffle
      ? [trackId, ...shuffled(this.baseQueue.filter((id) => id !== trackId))]
      : this.baseQueue;

    this.goTo(queue, Math.max(0, queue.indexOf(trackId)), true, contextId);
  }

  /** Play a whole playlist from the start (optionally shuffled). */
  playContext(contextId: string, shuffle = false) {
    const ids = getContextTrackIds(contextId);
    if (!ids.length) return;
    this.baseQueue = ids;
    const queue = shuffle ? shuffled(ids) : ids;
    this.set({ shuffle });
    this.goTo(queue, 0, true, contextId);
  }

  /** Next song. Keeps playing if music was playing (or a song just finished). */
  next(continuePlaying = this.state.isPlaying || this.state.isLoading) {
    const { queue, queueIndex, repeat } = this.state;
    if (!queue.length) return;
    if (queueIndex < queue.length - 1) this.goTo(queue, queueIndex + 1, continuePlaying);
    else if (repeat === "all") this.goTo(queue, 0, continuePlaying);
    else this.goTo(queue, 0, false); // end of the queue: back to the start, paused
  }

  previous() {
    const { queue, queueIndex, repeat, position } = this.state;
    if (!queue.length) return;
    if (position > RESTART_THRESHOLD || (queueIndex === 0 && repeat !== "all")) {
      this.seek(0);
      return;
    }
    const index = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    this.goTo(queue, index, this.state.isPlaying || this.state.isLoading);
  }

  seek(seconds: number) {
    if (!this.backend?.loadedTrackId) return;
    this.backend.seek(seconds);
    this.set({ position: seconds });
    this.updateMediaSessionState();
  }

  /** 1-100, shared with the Control Center "Sound" slider. */
  setVolume(volume: number) {
    const v = Math.round(Math.min(100, Math.max(1, volume)));
    useStore.getState().setVolume(v);
    if (this.state.muted) this.set({ muted: false });
  }

  toggleMute() {
    this.set({ muted: !this.state.muted });
  }

  toggleShuffle() {
    const { shuffle, currentTrackId } = this.state;
    if (!currentTrackId) return;
    const queue = shuffle
      ? this.baseQueue
      : [
          currentTrackId,
          ...shuffled(this.baseQueue.filter((id) => id !== currentTrackId))
        ];
    this.set({
      shuffle: !shuffle,
      queue,
      queueIndex: Math.max(0, queue.indexOf(currentTrackId))
    });
  }

  cycleRepeat() {
    const order = { off: "all", all: "one", one: "off" } as const;
    this.set({ repeat: order[this.state.repeat] });
  }

  /** Stop playback, e.g. when the user logs out. Keeps the current track selected. */
  stop() {
    this.backend?.pause();
  }

  private goTo(queue: string[], index: number, autoplay: boolean, contextId?: string) {
    const trackId = queue[index];
    if (!trackId) return;

    const changed = trackId !== this.state.currentTrackId;
    this.set({
      queue,
      queueIndex: index,
      currentTrackId: trackId,
      ...(contextId ? { queueContextId: contextId } : {}),
      ...(changed ? { position: 0, duration: 0 } : {}),
      error: null
    });
    this.updateMediaSessionMetadata();

    if (autoplay) {
      if (!changed) this.seek(0);
      void this.play();
    } else if (changed) {
      this.backend?.unload();
    } else {
      this.backend?.pause();
      this.seek(0);
    }
  }

  private handleEnded() {
    if (this.state.repeat === "one") {
      this.seek(0);
      void this.play();
    } else {
      this.next(true);
    }
  }

  private addRecentlyPlayed() {
    const id = this.state.currentTrackId;
    // Count each load of a track once, not every resume after a pause.
    if (!id || this.countedPlayFor === id) return;
    this.countedPlayFor = id;
    const recentlyPlayed = [
      id,
      ...this.state.recentlyPlayed.filter((t) => t !== id)
    ].slice(0, RECENT_MAX);
    this.set({ recentlyPlayed });
    writeRecent(recentlyPlayed);
  }

  /* --------------------------- media session --------------------------- */

  private setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void this.play()],
      ["pause", () => this.pause()],
      ["previoustrack", () => this.previous()],
      ["nexttrack", () => this.next()],
      ["seekto", (d) => d.seekTime !== undefined && this.seek(d.seekTime)]
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
  }

  private updateMediaSessionMetadata() {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const track = getTrack(this.state.currentTrackId);
    if (!track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [{ src: track.artwork, sizes: "600x600", type: "image/jpeg" }]
    });
  }

  private updateMediaSessionState() {
    if (!("mediaSession" in navigator)) return;
    const { isPlaying, duration, position } = this.state;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    if (duration > 0 && "setPositionState" in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(position, duration),
          playbackRate: 1
        });
      } catch {
        // Ignore invalid intermediate states.
      }
    }
  }
}

export const player = new PlayerController();
