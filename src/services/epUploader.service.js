/**
 * EP-Uploader Service
 * ──────────────────────────────────────────────────────────────────
 * Source of truth — ONLY anime that exist here are served by the hub.
 *
 * ENV: EP_UPLOADER_URL  (defaults to your render.com deployment)
 */

import axios from "axios";

const BASE = (
  process.env.EP_UPLOADER_URL || "https://beat-anime-ep-uploder.onrender.com"
).replace(/\/$/, "");

const http = axios.create({
  baseURL: BASE,
  timeout: 12_000,
  headers: { Accept: "application/json" },
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Stream server priority:
 *   1. Archive.org  — most reliable, no account needed
 *   2. PixelDrain   — fast CDN
 *   3. StreamTape   — fallback
 *
 * We match by checking the stream_url domain so order is deterministic
 * regardless of how the Flask API sends the links array.
 */
const STREAM_PRIORITY = ["archive.org", "pixeldrain.com", "streamtape.com"];

function pickByPriority(links = [], urlKey = "stream_url", flagKey = "can_stream") {
  const viable = links.filter((l) => l[flagKey] && l[urlKey]);
  if (!viable.length) return null;

  for (const domain of STREAM_PRIORITY) {
    const match = viable.find((l) => l[urlKey]?.includes(domain));
    if (match) return match[urlKey];
  }
  // Fallback: first viable link if none matched the priority list
  return viable[0][urlKey];
}

/**
 * GoFile direct download — convert the GoFile page URL to a direct file link.
 *
 * GoFile page:    https://gofile.io/d/<contentId>
 * Direct download is served via the GoFile CDN but requires their API.
 * Since we can't call the API server-side without a session token, we
 * expose a /download proxy endpoint in the controller instead, so the
 * frontend can request it from our server which will resolve it.
 *
 * For now we return the raw gofile URL; the controller /download endpoint
 * handles the actual direct-stream resolution.
 */
function gofileDirectUrl(raw) {
  if (!raw) return null;
  return raw; // passed through — resolved by /api/anime/download proxy
}

function normaliseEpisode(row) {
  const links = row.links || [];

  // Build the 3-server list explicitly so the frontend can build a server selector
  const servers = [
    {
      name:       "Archive.org",
      priority:   1,
      stream_url: links.find((l) => l.can_stream  && l.stream_url?.includes("archive.org"))?.stream_url  || row.archive_url    || null,
    },
    {
      name:       "PixelDrain",
      priority:   2,
      stream_url: links.find((l) => l.can_stream  && l.stream_url?.includes("pixeldrain.com"))?.stream_url || row.pixeldrain_url || null,
    },
    {
      name:       "StreamTape",
      priority:   3,
      stream_url: links.find((l) => l.can_stream  && l.stream_url?.includes("streamtape.com"))?.stream_url || row.streamtape_url || null,
    },
  ].filter((s) => s.stream_url !== null); // only include servers that have a URL

  return {
    episode_no:     Number(row.episode_no) || 0,
    season:         String(row.season      || "1"),
    quality:        row.quality            || "original",
    content_type:   row.content_type       || "TV Series",
    file_size:      row.file_size          || null,
    created_at:     row.created_at         || null,

    // Best stream URL following priority order
    stream_url:     pickByPriority(links, "stream_url", "can_stream"),

    // Download — GoFile only (direct download, resolved by /api/anime/download)
    download_url:   gofileDirectUrl(row.gofile_url || links.find((l) => l.download_url?.includes("gofile.io"))?.download_url || null),

    // All three stream servers for the frontend server-switcher
    servers,

    // Raw individual URLs (kept for passthrough / debugging)
    archive_url:    row.archive_url    || null,
    pixeldrain_url: row.pixeldrain_url || null,
    streamtape_url: row.streamtape_url || null,
    gofile_url:     row.gofile_url     || null,
  };
}

// ── public ────────────────────────────────────────────────────────────────────

/**
 * Full catalogue of anime available on the site.
 * @returns {Promise<Array<{anime_name:string,episode_count:number,last_updated:string}>>}
 */
export async function getAnimeList() {
  try {
    const { data } = await http.get("/api/anime/list");
    return data?.success ? (data.anime_list || []) : [];
  } catch (e) {
    console.error("[EPUploader] getAnimeList:", e.message);
    return [];
  }
}

/**
 * Check if a given anime name exists on the site (case-insensitive).
 */
export async function animeExistsOnSite(name) {
  const list = await getAnimeList();
  return list.some((a) => a.anime_name.toLowerCase() === name.trim().toLowerCase());
}

/**
 * All episodes for one anime, grouped by season.
 * Returns null if the anime is not found.
 */
export async function getAnimeEpisodes(animeName, { season, quality } = {}) {
  try {
    const params = {};
    if (season)  params.season  = season;
    if (quality) params.quality = quality;

    const { data } = await http.get(
      `/api/anime/${encodeURIComponent(animeName)}/episodes`,
      { params }
    );
    if (!data?.success) return null;

    const seasons = (data.seasons || []).map((s) => ({
      season:   s.season,
      episodes: (s.episodes || []).map((ep) => ({
        episode_no: ep.episode_no,
        qualities:  (ep.qualities || []).map(normaliseEpisode),
      })),
    }));

    return {
      total_seasons:  data.total_seasons  || seasons.length,
      total_episodes: data.total_episodes || 0,
      seasons,
    };
  } catch (e) {
    console.error("[EPUploader] getAnimeEpisodes:", e.message);
    return null;
  }
}

/**
 * Single episode — best available quality by default.
 */
export async function getEpisode(animeName, episodeNo, { season, quality } = {}) {
  try {
    const params = { anime: animeName, episode: String(episodeNo) };
    if (season)  params.season  = season;
    if (quality) params.quality = quality;

    const { data } = await http.get("/api/episode", { params });
    return data?.success ? normaliseEpisode(data) : null;
  } catch (e) {
    console.error("[EPUploader] getEpisode:", e.message);
    return null;
  }
}

/**
 * All quality variants for one episode.
 */
export async function getEpisodeQualities(animeName, episodeNo, season = "1") {
  try {
    const { data } = await http.get("/api/qualities", {
      params: { anime: animeName, episode: String(episodeNo), season },
    });
    if (!data?.success) return [];

    return (data.qualities || []).map((q) => normaliseEpisode(q));
  } catch (e) {
    console.error("[EPUploader] getEpisodeQualities:", e.message);
    return [];
  }
}

/** Ping the uploader service. */
export async function ping() {
  try {
    const { data } = await http.get("/api/health", { timeout: 5_000 });
    return data?.status === "healthy";
  } catch {
    return false;
  }
}

export default {
  getAnimeList,
  animeExistsOnSite,
  getAnimeEpisodes,
  getEpisode,
  getEpisodeQualities,
  ping,
};
