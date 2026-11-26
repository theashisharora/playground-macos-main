/**
 * Where a track's audio comes from.
 *
 * - `itunes-preview`: Apple's official ~30-second preview, resolved at runtime
 *   through the public iTunes Lookup API. Nothing is bundled with the site.
 * - `local`: an audio file you host yourself. Only use this for audio you own or
 *   are licensed to distribute publicly.
 */
export type MusicTrackSource =
  | { type: "itunes-preview"; itunesId: number }
  | { type: "local"; url: string };

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Album artwork URL (square). */
  artwork: string;
  /** Length of the full song in ms (previews are shorter; see `source`). */
  durationMs: number;
  source: MusicTrackSource;
  /** Link to the song on Apple Music, for full-length listening. */
  appleMusicUrl?: string;
}

export interface MusicPlaylist {
  id: string;
  title: string;
  description?: string;
  /** Optional cover; falls back to the first track's artwork. */
  artwork?: string;
  trackIds: string[];
  featured?: boolean;
}

export interface MusicData {
  tracks: MusicTrack[];
  playlists: MusicPlaylist[];
  /** Playlist loaded (paused) when the site starts. */
  defaultPlaylistId: string;
}
