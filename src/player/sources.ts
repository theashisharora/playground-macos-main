import type { MusicTrack } from "~/types";

/**
 * Resolves a track's configured source into a playable URL.
 *
 * iTunes previews are looked up at play time from Apple's public iTunes Lookup
 * API, so preview URLs stay fresh and no audio is stored in this repository.
 */

const LOOKUP_URL = "https://itunes.apple.com/lookup";
const LOOKUP_TIMEOUT_MS = 10000;

const previewCache = new Map<number, Promise<string>>();

const lookupPreview = async (itunesId: number): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch(`${LOOKUP_URL}?id=${itunesId}&entity=song`, {
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Preview lookup failed (HTTP ${res.status}).`);

    const data = await res.json();
    const result = data?.results?.find(
      (r: { trackId?: number; previewUrl?: string }) => r.trackId === itunesId
    );
    if (!result?.previewUrl) throw new Error("No preview is available for this song.");

    return result.previewUrl as string;
  } catch (e) {
    if ((e as Error).name === "AbortError")
      throw new Error("Preview lookup timed out. Check your connection and try again.");
    if (e instanceof TypeError)
      throw new Error("Couldn't reach Apple's preview service. Check your connection.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const resolveTrackUrl = (track: MusicTrack): Promise<string> => {
  const { source } = track;

  if (source.type === "local") return Promise.resolve(source.url);

  const cached = previewCache.get(source.itunesId);
  if (cached) return cached;

  const pending = lookupPreview(source.itunesId).catch((e) => {
    // Don't cache failures, so the next attempt retries.
    previewCache.delete(source.itunesId);
    throw e;
  });
  previewCache.set(source.itunesId, pending);
  return pending;
};

/** True when the track plays a short preview rather than the full song. */
export const isPreview = (track: MusicTrack) => track.source.type === "itunes-preview";
