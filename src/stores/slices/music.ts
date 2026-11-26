import type { StateCreator } from "zustand";

/**
 * Shared playback state for the Music app, Control Center and Media Session.
 *
 * This slice only *describes* playback. It is written by the player controller
 * (`src/player/controller.ts`) in response to real media events, so the UI never
 * claims to be playing before the audio element actually is. UI components call
 * the controller (`player.play()`, `player.seek()`, ...) rather than setting
 * these fields directly.
 *
 * Volume lives in the system slice (`volume`, 1-100) because the Control Center
 * "Sound" slider already owns it; the player follows it.
 */
export type RepeatMode = "off" | "all" | "one";

export interface MusicState {
  /** Track ids in play order (shuffled when `shuffle` is on). */
  queue: string[];
  queueIndex: number;
  /** Playlist (or library view) the queue came from. */
  queueContextId: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  /** Seconds. */
  position: number;
  /** Seconds of the loaded audio (previews are ~30 s). 0 until known. */
  duration: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
  recentlyPlayed: string[];
}

export interface MusicSlice {
  music: MusicState;
  setMusic: (patch: Partial<MusicState>) => void;
}

export const initialMusicState: MusicState = {
  queue: [],
  queueIndex: 0,
  queueContextId: "",
  currentTrackId: null,
  isPlaying: false,
  isLoading: false,
  position: 0,
  duration: 0,
  muted: false,
  shuffle: false,
  repeat: "off",
  error: null,
  recentlyPlayed: []
};

export const createMusicSlice: StateCreator<MusicSlice> = (set) => ({
  music: initialMusicState,
  setMusic: (patch) => set((state) => ({ music: { ...state.music, ...patch } }))
});
