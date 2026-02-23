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
 *   2. PixelDrain   (proxied via /api/proxy-pixeldrain — bypasses India block)
 *   3. StreamTape   (proxy via Flask /api/streamtape-stream)
 *
 * StreamTape note:
 *   The Flask API returns stream_url as a RELATIVE path, e.g.
 *     /api/streamtape-stream?id=A6LQ2w22BgtX8kV
 *   This service resolves it to an ABSOLUTE URL by prepending BASE.
 *
 * PixelDrain note:
 *   Direct PixelDrain URLs are BLOCKED in India.
 *   This service wraps them in /api/proxy-pixeldrain to bypass the block.
 *
 * Retry logic:
 *   Every uploader request retries up to MAX_RETRIES times on failure.
 *   There is NO fallback to a different server — the same URL is retried.
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

// ── Retry config ──────────────────────────────────────────────────────────────
// How many times to attempt a failing request before throwing.
// Never falls back to a different server — always retries the same URL.
const MAX_RETRIES  = 5;
const RETRY_DELAY_MS = 1500; // ms between retries

/**
 * Retry-aware HTTP GET for uploader endpoints.
 * Retries up to MAX_RETRIES times on any error.
 * @param {string} path    – relative path (e.g. "/api/anime/list")
 * @param {object} params  – axios query params
 * @returns {Promise<any>} – response .data
 */
async function fetchWithRetry(path, params = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await http.get(path, { params });
      return data;
    } catch (e) {
      const isLast = attempt === MAX_RETRIES;
      console.warn(
        `[EPUploader] attempt ${attempt}/${MAX_RETRIES} failed for ${path}: ${e.message}`
      );
      if (isLast) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

// ── Stream priority ───────────────────────────────────────────────────────────
// Archive.org: Direct HLS (most reliable)
// PixelDrain:  Proxied through /api/proxy-pixeldrain (bypasses India block)
// StreamTape:  Proxied through Flask /api/streamtape-stream
const STREAM_ORDER = ["Archive.org", "PixelDrain", "StreamTape"];

/**
 * Resolve a possibly-relative stream_url to an absolute URL.
 *
 * The Flask API returns StreamTape stream_url as a relative path, e.g.:
 *   /api/streamtape-stream?id=A6LQ2w22BgtX8kV
 *
 * This must be turned into:
 *   https://beat-anime-ep-uploder.onrender.com/api/streamtape-stream?id=A6LQ2w22BgtX8kV
 *
 * PixelDrain URLs are direct from Flask but BLOCKED in India, so we wrap them:
 *   https://pixeldrain.com/api/file/ABC123
 * Becomes:
 *   /api/proxy-pixeldrain?url=https%3A%2F%2Fpixeldrain.com%2Fapi%2Ffile%2FABC123
 */
function resolveStreamUrl(url) {
  if (!url) return null;
  
  // Handle relative URLs (StreamTape from Flask)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    // relative path → prepend uploader BASE
    return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  
  // ✅ PROXY PixelDrain URLs (blocked in India)
  if (url.includes('pixeldrain.com')) {
    // Wrap in proxy endpoint - relative URL works on any domain
    return `/api/proxy-pixeldrain?url=${encodeURIComponent(url)}`;
  }
  
  // Return direct URL for Archive.org and others
  return url;
}

function buildServers(links = []) {
  /**
   * Takes the links[] array from Flask and returns a clean `servers` array
   * in the correct priority order for the frontend server-switcher.
   * Only includes servers that actually have a stream_url.
   * 
   * StreamTape stream_urls are resolved to absolute URLs.
   * PixelDrain URLs are wrapped in /api/proxy-pixeldrain proxy.
   */
  const servers = [];

  for (const siteName of STREAM_ORDER) {
    const link = links.find(
      (l) => l.site === siteName && l.can_stream && l.stream_url
    );
    if (link) {
      servers.push({
        name:        link.site,
        stream_url:  resolveStreamUrl(link.stream_url),  // ← resolved/proxied
        stream_type: link.stream_type || "direct",
      });
    }
  }

  return servers;
}

function bestStreamUrl(links = []) {
  /**
   * Best stream URL following the priority order.
   * Returns an absolute/proxied URL.
   * 
   * Archive.org → direct
   * PixelDrain → proxied (India bypass)
   * StreamTape → proxied (Flask)
   */
  for (const siteName of STREAM_ORDER) {
    const link = links.find(
      (l) => l.site === siteName && l.can_stream && l.stream_url
    );
    if (link) return resolveStreamUrl(link.stream_url); // ← resolved/proxied
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
   * 
   * PixelDrain URLs in all fields are wrapped with proxy for India bypass.
   */
  const links = row.links || [];

  return {
    episode_no:     Number(row.episode_no) || 0,
    season:         String(row.season      || "1"),
    quality:        row.quality            || "original",
    content_type:   row.content_type       || "TV Series",
    file_size:      row.file_size          || null,
    created_at:     row.created_at         || null,

    // Best stream URL (Archive.org → PixelDrain [proxied] → StreamTape [proxied])
    stream_url:     bestStreamUrl(links),

    // Download = GoFile only (proxy via /api/anime/download)
    download_url:   gofileDownloadUrl(links),

    // All stream servers for the frontend server-switcher
    // PixelDrain URLs are proxied for India bypass
    servers:        buildServers(links),

    // Raw URLs passthrough (PixelDrain URL is proxied if present)
    archive_url:    row.archive_url    || null,
    pixeldrain_url: row.pixeldrain_url ? resolveStreamUrl(row.pixeldrain_url) : null,
    streamtape_url: row.streamtape_url || null,
    gofile_url:     row.gofile_url     || null,

    // Full links array from Flask (stream_urls resolved/proxied)
    links: links.map((l) => ({
      ...l,
      stream_url: resolveStreamUrl(l.stream_url),
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full catalogue of anime on YOUR site only.
 * Calls GET /api/anime/list on your Flask server.
 * Retries up to MAX_RETRIES times on failure.
 * @returns {Promise<Array<{anime_name, episode_count, last_updated}>>}
 */
export async function getAnimeList() {
  try {
    const data = await fetchWithRetry("/api/anime/list");
    return data?.success ? (data.anime_list || []) : [];
  } catch (e) {
    console.error("[EPUploader] getAnimeList failed after all retries:", e.message);
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
 * Retries up to MAX_RETRIES times on failure.
 * @returns {Promise<object|null>}
 */
export async function getAnimeEpisodes(animeName, { season, quality } = {}) {
  try {
    const params = {};
    if (season)  params.season  = season;
    if (quality) params.quality = quality;

    const data = await fetchWithRetry(
      `/api/anime/${encodeURIComponent(animeName)}/episodes`,
      params
    );
    if (!data?.success) return null;

    // Flask already groups by season → episodes → qualities
    // We just normalise each quality entry (PixelDrain URLs get proxied here)
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
    console.error("[EPUploader] getAnimeEpisodes failed after all retries:", e.message);
    return null;
  }
}

/**
 * Single episode with stream/download links.
 * Calls GET /api/episode on your Flask server.
 * Retries up to MAX_RETRIES times on failure.
 * @returns {Promise<object|null>}
 */
export async function getEpisode(animeName, episodeNo, { season, quality } = {}) {
  try {
    const params = { anime: animeName, episode: String(episodeNo) };
    if (season)  params.season  = season;
    if (quality) params.quality = quality;

    const data = await fetchWithRetry("/api/episode", params);
    return data?.success ? normaliseEpisode(data) : null;
  } catch (e) {
    console.error("[EPUploader] getEpisode failed after all retries:", e.message);
    return null;
  }
}

/**
 * All quality variants for one episode.
 * Calls GET /api/qualities on your Flask server.
 * Retries up to MAX_RETRIES times on failure.
 * @returns {Promise<Array>}
 */
export async function getEpisodeQualities(animeName, episodeNo, season = "1") {
  try {
    const data = await fetchWithRetry("/api/qualities", {
      anime: animeName,
      episode: String(episodeNo),
      season,
    });
    if (!data?.success) return [];

    return (data.qualities || []).map((q) => ({
      quality:      q.quality      || "original",
      content_type: q.content_type || "TV Series",
      file_size:    q.file_size    || null,
      stream_url:   bestStreamUrl(q.links  || []),
      download_url: gofileDownloadUrl(q.links || []),
      servers:      buildServers(q.links || []),
      links:        (q.links || []).map((l) => ({
        ...l,
        stream_url: resolveStreamUrl(l.stream_url),
      })),
    }));
  } catch (e) {
    console.error("[EPUploader] getEpisodeQualities failed after all retries:", e.message);
    return [];
  }
}

/**
 * Ping your Flask server.
 * @returns {Promise<boolean>}
 */
export async function ping() {
  try {
    const data = await fetchWithRetry("/api/health");
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
