import type { MusicData, MusicTrack } from "~/types";

/*
 * Spider-Verse soundtrack.
 *
 * Audio: every track uses Apple's official ~30-second iTunes preview, looked up
 * at runtime by its iTunes ID (see `src/player/sources.ts`). No copyrighted audio
 * is bundled with the site. Full songs are linked on Apple Music.
 *
 * To add a song you own the rights to, use `source: { type: "local", url: "music/file.mp3" }`.
 */

const art = (path: string) =>
  `https://is1-ssl.mzstatic.com/image/thumb/${path}/600x600bb.jpg`;

const INTO_ART = art(
  "Music125/v4/4b/30/2c/4b302cb6-7a14-5464-4e97-0577e9d0be49/18UMGIM82277.rgb.jpg"
);
const ACROSS_ART = art(
  "Music116/v4/c9/ca/6b/c9ca6b51-87a9-4a13-d37f-24535687023d/23UMGIM63882.rgb.jpg"
);
const INTO_ALBUM = "Spider-Man: Into the Spider-Verse (Soundtrack)";
const ACROSS_ALBUM = "Spider-Man: Across the Spider-Verse (Soundtrack)";

const tracks: MusicTrack[] = [
  {
    id: "sunflower",
    title: "Sunflower",
    artist: "Post Malone & Swae Lee",
    album: INTO_ALBUM,
    artwork: INTO_ART,
    durationMs: 158040,
    source: { type: "itunes-preview", itunesId: 1445949267 },
    appleMusicUrl: "https://music.apple.com/us/album/1445949265?i=1445949267"
  },
  {
    id: "whats-up-danger",
    title: "What's Up Danger",
    artist: "Blackway & Black Caviar",
    album: INTO_ALBUM,
    artwork: INTO_ART,
    durationMs: 222316,
    source: { type: "itunes-preview", itunesId: 1445949266 },
    appleMusicUrl: "https://music.apple.com/us/album/1445949265?i=1445949266"
  },
  {
    id: "am-i-dreaming",
    title: "Am I Dreaming",
    artist: "Metro Boomin, A$AP Rocky & Roisee",
    album: ACROSS_ALBUM,
    artwork: ACROSS_ART,
    durationMs: 256027,
    source: { type: "itunes-preview", itunesId: 1690685353 },
    appleMusicUrl: "https://music.apple.com/us/album/1690685331?i=1690685353"
  },
  {
    id: "calling",
    title: "Calling (feat. A Boogie wit da Hoodie)",
    artist: "Metro Boomin, Swae Lee & NAV",
    album: ACROSS_ALBUM,
    artwork: ACROSS_ART,
    durationMs: 219453,
    source: { type: "itunes-preview", itunesId: 1690685617 },
    appleMusicUrl: "https://music.apple.com/us/album/1690685331?i=1690685617"
  },
  {
    id: "annihilate",
    title: "Annihilate",
    artist: "Metro Boomin, Swae Lee, Lil Wayne & Offset",
    album: ACROSS_ALBUM,
    artwork: ACROSS_ART,
    durationMs: 231747,
    source: { type: "itunes-preview", itunesId: 1690685343 },
    appleMusicUrl: "https://music.apple.com/us/album/1690685331?i=1690685343"
  },
  {
    id: "self-love",
    title: "Self Love",
    artist: "Metro Boomin & Coi Leray",
    album: ACROSS_ALBUM,
    artwork: ACROSS_ART,
    durationMs: 189467,
    source: { type: "itunes-preview", itunesId: 1690685844 },
    appleMusicUrl: "https://music.apple.com/us/album/1690685331?i=1690685844"
  },
  {
    id: "hummingbird",
    title: "Hummingbird",
    artist: "Metro Boomin & James Blake",
    album: ACROSS_ALBUM,
    artwork: ACROSS_ART,
    durationMs: 319493,
    source: { type: "itunes-preview", itunesId: 1690685611 },
    appleMusicUrl: "https://music.apple.com/us/album/1690685331?i=1690685611"
  }
];

const music: MusicData = {
  tracks,
  defaultPlaylistId: "spider-verse",
  playlists: [
    {
      id: "spider-verse",
      title: "Spider-Verse",
      description: "Ashish's Spider-Man soundtrack picks across both Spider-Verse films.",
      featured: true,
      trackIds: [
        "sunflower",
        "whats-up-danger",
        "am-i-dreaming",
        "calling",
        "annihilate",
        "self-love",
        "hummingbird"
      ]
    },
    {
      id: "into-the-spider-verse",
      title: "Into the Spider-Verse",
      description: "From the 2018 soundtrack.",
      artwork: INTO_ART,
      trackIds: ["sunflower", "whats-up-danger"]
    },
    {
      id: "across-the-spider-verse",
      title: "Across the Spider-Verse",
      description: "From the 2023 soundtrack by Metro Boomin.",
      artwork: ACROSS_ART,
      trackIds: ["am-i-dreaming", "calling", "annihilate", "self-love", "hummingbird"]
    }
  ]
};

export default music;
