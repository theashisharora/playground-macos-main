import type { MusicTrack } from "~/types";

/**
 * Callbacks a playback backend fires from *real* media events. The controller
 * turns these into shared store state, so every UI reflects what the audio is
 * actually doing rather than what was requested.
 */
export interface PlaybackEvents {
  /** Audio actually started/resumed producing sound. */
  onPlaying: () => void;
  /** Audio paused (by request, by the browser, or at the end of a track). */
  onPause: () => void;
  onLoadingChange: (loading: boolean) => void;
  onTimeUpdate: (seconds: number) => void;
  onDurationChange: (seconds: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}

/**
 * A playback engine. `HtmlAudioBackend` plays preview/local URLs through one
 * shared <audio> element. A future `MusicKitBackend` (MusicKit on the Web) can
 * implement the same interface, letting the controller, Music app and Control
 * Center stay unchanged.
 */
export interface PlaybackBackend {
  /** Human-readable label, e.g. "30-second previews". */
  readonly label: string;
  /** Id of the track whose audio is currently loaded, if any. */
  readonly loadedTrackId: string | null;
  /** Prepare a track for playback. Does not start playing. */
  load: (track: MusicTrack) => Promise<void>;
  /** Start playback. Rejects if the browser refuses (e.g. autoplay policy). */
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  /** 0-1 */
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  /** Drop the loaded audio (used when the queue moves without playing). */
  unload: () => void;
}
