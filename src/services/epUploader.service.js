/**
 * Beat Anime Hub API
 * ──────────────────────────────────────────────────────────────────
 * @author      Beat Anime
 * @channel     https://t.me/beatanime
 * @support     https://t.me/Beat_Anime_Discussion
 * ──────────────────────────────────────────────────────────────────
 *
 * EP-Uploader Service
 * Talks directly to your Flask web_server.py API.
 * Anime source = ONLY your site. Nothing fetched from anywhere else.
 *
 * Your Flask API (_build_stream_links) returns links shaped like:
 *   { site, page_url, stream_url, download_url, can_stream, can_download, stream_type, priority }
 *
 * Stream server priority we enforce:
 *   1. Archive.org  (direct .ia.mp4 — most reliable)
 *   2. PixelDrain   (direct CDN)
 *   3. StreamTape   (iframe fallback)
 *
 * Download = GoFile only (resolved to direct file via /api/anime/download proxy)
 *
 * ENV: EP_UPLOADER_URL  (defaults to your render.com deployment)
 */

import axios from "axios";

const BASE = (
  process.env.EP_UPLOADER_URL || "https://beat-anime-ep-uploder.onrender.com"
).replace(/\/$/, "");

const http = axios.create({
  baseURL: BASE,
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

// ── Stream priority ───────────────────────────────────────────────────────────
// Matches what your Flask _build_stream_links returns as `site` values.
const STREAM_ORDER = ["Archive.org", "PixelDrain", "StreamTape"];

function buildServers(links = []) {
  /**
   * Takes the links[] array from Flask and returns a clean `servers` array
   * in the correct priority order for the frontend server-switcher.
   * Only includes servers that actually have a stream_url.
   */
  const servers = [];

  for (const siteName of STREAM_ORDER) {
    const link = links.find(
      (l) => l.site === siteName && l.can_stream && l.stream_url
    );
    if (link) {
      servers.push({
        name:       link.site,
        stream_url: link.stream_url,
        stream_type: link.stream_type || "direct",
      });
    }
  }

  return servers;
}

function bestStreamUrl(links = []) {
  /** Best stream URL following the priority order. */
  for (const siteName of STREAM_ORDER) {
    const link = links.find(
      (l) => l.site === siteName && l.can_stream && l.stream_url
    );
    if (link) return link.stream_url;
  }
  return null;
}

function gofileDownloadUrl(links = []) {
  /**
   * Returns the GoFile page URL for the /api/anime/download proxy.
   * GoFile is download-only — the proxy converts it to a direct file stream.
   */
  const gofile = links.find(
    (l) => l.site === "GoFile" && l.can_download && l.download_url
  );
  return gofile?.download_url || null;
}

function normaliseEpisode(row) {
  /**
   * Normalises one episode row from your Flask API into the hub shape.
   * Preserves all raw URLs + adds the clean `servers` array and best URLs.
   */
  const links = row.links || [];

  return {
    episode_no:     Number(row.episode_no) || 0,
    season:         String(row.season      || "1"),
    quality:        row.quality            || "original",
    content_type:   row.content_type       || "TV Series",
    file_size:      row.file_size          || null,
    created_at:     row.created_at         || null,

    // Best stream URL (Archive.org → PixelDrain → StreamTape)
    stream_url:     bestStreamUrl(links),

    // Download = GoFile only (proxy via /api/anime/download)
    download_url:   gofileDownloadUrl(links),

    // All stream servers for the frontend server-switcher
    servers:        buildServers(links),

    // Raw URLs passthrough
    archive_url:    row.archive_url    || null,
    pixeldrain_url: row.pixeldrain_url || null,
    streamtape_url: row.streamtape_url || null,
    gofile_url:     row.gofile_url     || null,

    // Full links array from Flask (kept for passthrough)
    links,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full catalogue of anime on YOUR site only.
 * Calls GET /api/anime/list on your Flask server.
 * @returns {Promise<Array<{anime_name, episode_count, last_updated}>>}
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
 * Check if an anime exists on your site (case-insensitive).
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function animeExistsOnSite(name) {
  const list = await getAnimeList();
  return list.some(
    (a) => a.anime_name.toLowerCase() === name.trim().toLowerCase()
  );
}

/**
 * All episodes for one anime grouped by season.
 * Calls GET /api/anime/<name>/episodes on your Flask server.
 * @returns {Promise<object|null>}
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

    // Flask already groups by season → episodes → qualities
    // We just normalise each quality entry
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
 * Single episode with stream/download links.
 * Calls GET /api/episode on your Flask server.
 * @returns {Promise<object|null>}
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
 * Calls GET /api/qualities on your Flask server.
 * @returns {Promise<Array>}
 */
export async function getEpisodeQualities(animeName, episodeNo, season = "1") {
  try {
    const { data } = await http.get("/api/qualities", {
      params: { anime: animeName, episode: String(episodeNo), season },
    });
    if (!data?.success) return [];

    return (data.qualities || []).map((q) => ({
      quality:      q.quality      || "original",
      content_type: q.content_type || "TV Series",
      file_size:    q.file_size    || null,
      stream_url:   bestStreamUrl(q.links  || []),
      download_url: gofileDownloadUrl(q.links || []),
      servers:      buildServers(q.links || []),
      links:        q.links || [],
    }));
  } catch (e) {
    console.error("[EPUploader] getEpisodeQualities:", e.message);
    return [];
  }
}

/**
 * Ping your Flask server.
 * @returns {Promise<boolean>}
 */
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
