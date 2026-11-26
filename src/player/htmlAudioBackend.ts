import type { MusicTrack } from "~/types";
import { resolveTrackUrl } from "./sources";
import type { PlaybackBackend, PlaybackEvents } from "./types";

const mediaErrorMessage = (error: MediaError | null): string => {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback was interrupted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "A network error stopped playback.";
    case MediaError.MEDIA_ERR_DECODE:
      return "This audio couldn't be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This audio is unavailable or not supported by your browser.";
    default:
      return "Something went wrong while playing this song.";
  }
};

/**
 * Plays audio through ONE shared <audio> element for the whole site, so the
 * Music app, Control Center and media keys can never start a second stream.
 */
export class HtmlAudioBackend implements PlaybackBackend {
  readonly label = "Apple previews";
  loadedTrackId: string | null = null;

  private audio: HTMLAudioElement;
  private loadToken = 0;

  constructor(private events: PlaybackEvents) {
    const audio = new Audio();
    audio.preload = "auto";
    this.audio = audio;

    audio.addEventListener("playing", () => {
      events.onLoadingChange(false);
      events.onPlaying();
    });
    audio.addEventListener("pause", () => events.onPause());
    audio.addEventListener("waiting", () => events.onLoadingChange(true));
    audio.addEventListener("canplay", () => events.onLoadingChange(false));
    audio.addEventListener("timeupdate", () => events.onTimeUpdate(audio.currentTime));
    audio.addEventListener("seeked", () => events.onTimeUpdate(audio.currentTime));
    const onDuration = () => {
      if (Number.isFinite(audio.duration)) events.onDurationChange(audio.duration);
    };
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", () => events.onEnded());
    audio.addEventListener("error", () => {
      // Ignore errors from an empty/cleared src.
      if (!audio.getAttribute("src")) return;
      events.onLoadingChange(false);
      events.onError(mediaErrorMessage(audio.error));
    });
  }

  async load(track: MusicTrack) {
    const token = ++this.loadToken;
    this.audio.pause();
    this.loadedTrackId = null;
    this.events.onLoadingChange(true);

    let url: string;
    try {
      url = await resolveTrackUrl(track);
    } catch (e) {
      if (token === this.loadToken) this.events.onLoadingChange(false);
      throw e;
    }

    // A newer load() started while we were resolving; let it win.
    if (token !== this.loadToken) throw new DOMException("Superseded", "AbortError");

    this.audio.src = url;
    this.audio.load();
    this.loadedTrackId = track.id;
  }

  play() {
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds: number) {
    if (!this.loadedTrackId) return;
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : seconds;
    this.audio.currentTime = Math.min(Math.max(0, seconds), max);
  }

  setVolume(volume: number) {
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted;
  }

  unload() {
    this.loadToken++;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.loadedTrackId = null;
    this.events.onLoadingChange(false);
  }
}
