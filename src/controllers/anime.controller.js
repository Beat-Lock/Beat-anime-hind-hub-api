/**
 * Anime Controller
 * ──────────────────────────────────────────────────────────────────
 * Business logic for all beat-anime-hub routes.
 *
 * Key rule: ONLY anime present in the ep-uploader catalogue are served.
 * Metadata (banner, cover, genres, etc.) is fetched from AniList/Jikan
 * for those anime and merged into the response.
 */

import axios from "axios";
import * as uploader from "../services/epUploader.service.js";
import * as meta from "../services/metaAggregator.service.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function ok(res, data) {
  return res.json({ success: true, ...data });
}

function notFound(res, message = "Not found") {
  return res.status(404).json({ success: false, message });
}

function err(res, message = "Server error", status = 500) {
  return res.status(status).json({ success: false, message });
}

// ── handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /anime/list
 * Returns all anime on the site, each enriched with basic metadata
 * (cover image, english title, genres) from AniList.
 *
 * Query params:
 *   ?meta=false  — skip metadata enrichment (faster, plain list)
 */
export async function listAnime(req, res) {
  try {
    const withMeta = req.query.meta !== "false";
    const catalogue = await uploader.getAnimeList();

    if (!withMeta) {
      return ok(res, { total: catalogue.length, anime: catalogue });
    }

    // Fetch meta for all titles in parallel (graceful — null on miss)
    const enriched = await Promise.all(
      catalogue.map(async (entry) => {
        const m = await meta.fetchMeta(entry.anime_name);
        return {
          anime_name:     entry.anime_name,
          episode_count:  entry.episode_count,
          last_updated:   entry.last_updated,
          // Lightweight card data — just what a listing page needs
          title:          m?.title         || null,
          image:          m?.image         || null,
          genres:         m?.genres        || [],
          type:           m?.type          || null,
          status:         m?.status        || null,
          averageScore:   m?.averageScore  || null,
          anilistId:      m?.anilistId     || null,
          malId:          m?.malId         || null,
        };
      })
    );

    return ok(res, { total: enriched.length, anime: enriched });
  } catch (e) {
    console.error("[Controller] listAnime:", e.message);
    return err(res, "Failed to fetch anime list");
  }
}

/**
 * GET /anime/info
 * Full info for one anime: rich metadata + complete episode list.
 *
 * Required query param:  ?name=<anime_name>
 * Optional query params: ?season=<n>  ?quality=<q>
 */
export async function getAnimeInfo(req, res) {
  try {
    const { name, season, quality } = req.query;
    if (!name) return err(res, "Query param 'name' is required", 400);

    // Reject if not on the site
    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return notFound(res, `"${name}" is not available on this site`);

    // Fetch episodes + metadata in parallel
    const [episodes, metaData] = await Promise.all([
      uploader.getAnimeEpisodes(name, { season, quality }),
      meta.fetchMeta(name),
    ]);

    return ok(res, {
      anime_name: name,
      // Full AniList / Jikan metadata
      meta: metaData,
      // Episode structure from uploader
      episodes: episodes || { total_seasons: 0, total_episodes: 0, seasons: [] },
    });
  } catch (e) {
    console.error("[Controller] getAnimeInfo:", e.message);
    return err(res, "Failed to fetch anime info");
  }
}

/**
 * GET /anime/episode
 * Stream + download links for a single episode.
 *
 * Required: ?name=<anime_name>  ?episode=<n>
 * Optional: ?season=<n>  ?quality=<q>
 */
export async function getEpisode(req, res) {
  try {
    const { name, episode, season, quality } = req.query;
    if (!name)    return err(res, "Query param 'name' is required",    400);
    if (!episode) return err(res, "Query param 'episode' is required", 400);

    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return notFound(res, `"${name}" is not available on this site`);

    const ep = await uploader.getEpisode(name, episode, { season, quality });
    if (!ep) return notFound(res, `Episode ${episode} not found for "${name}"`);

    return ok(res, { anime_name: name, episode: ep });
  } catch (e) {
    console.error("[Controller] getEpisode:", e.message);
    return err(res, "Failed to fetch episode");
  }
}

/**
 * GET /anime/qualities
 * All available quality variants for one episode.
 *
 * Required: ?name=<anime_name>  ?episode=<n>
 * Optional: ?season=<n>
 */
export async function getEpisodeQualities(req, res) {
  try {
    const { name, episode, season = "1" } = req.query;
    if (!name)    return err(res, "Query param 'name' is required",    400);
    if (!episode) return err(res, "Query param 'episode' is required", 400);

    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return notFound(res, `"${name}" is not available on this site`);

    const qualities = await uploader.getEpisodeQualities(name, episode, season);
    return ok(res, { anime_name: name, episode_no: episode, qualities });
  } catch (e) {
    console.error("[Controller] getEpisodeQualities:", e.message);
    return err(res, "Failed to fetch qualities");
  }
}

/**
 * GET /anime/meta
 * Pure metadata only — no episode data.
 * Useful for pre-fetching info cards.
 *
 * Required: ?name=<anime_name>
 * Optional: ?source=anilist|jikan  (force a specific source)
 */
export async function getAnimeMeta(req, res) {
  try {
    const { name, source } = req.query;
    if (!name) return err(res, "Query param 'name' is required", 400);

    // Must exist on the site
    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return notFound(res, `"${name}" is not available on this site`);

    let metaData;
    if (source === "anilist") {
      metaData = await meta.fetchAniListMeta(name);
    } else if (source === "jikan") {
      metaData = await meta.fetchJikanMeta(name);
    } else {
      metaData = await meta.fetchMeta(name);
    }

    if (!metaData) return notFound(res, `No metadata found for "${name}"`);
    return ok(res, { meta: metaData });
  } catch (e) {
    console.error("[Controller] getAnimeMeta:", e.message);
    return err(res, "Failed to fetch metadata");
  }
}

/**
 * GET /anime/search
 * Search anime by name — returns only titles available on the site,
 * with basic metadata for each match.
 *
 * Required: ?q=<query>
 */
export async function searchAnime(req, res) {
  try {
    const { q } = req.query;
    if (!q) return err(res, "Query param 'q' is required", 400);

    const catalogue = await uploader.getAnimeList();
    const query = q.trim().toLowerCase();

    // Simple fuzzy filter — titles that include the search string
    const matches = catalogue.filter((a) =>
      a.anime_name.toLowerCase().includes(query)
    );

    if (!matches.length) {
      return ok(res, { total: 0, results: [] });
    }

    // Enrich matches with metadata
    const results = await Promise.all(
      matches.map(async (entry) => {
        const m = await meta.fetchMeta(entry.anime_name);
        return {
          anime_name:    entry.anime_name,
          episode_count: entry.episode_count,
          title:         m?.title       || null,
          image:         m?.image       || null,
          genres:        m?.genres      || [],
          type:          m?.type        || null,
          status:        m?.status      || null,
          averageScore:  m?.averageScore || null,
          anilistId:     m?.anilistId   || null,
          malId:         m?.malId       || null,
        };
      })
    );

    return ok(res, { total: results.length, results });
  } catch (e) {
    console.error("[Controller] searchAnime:", e.message);
    return err(res, "Search failed");
  }
}

/**
 * GET /health
 * Reports hub status + uploader connectivity.
 */
export async function healthCheck(req, res) {
  try {
    const uploaderUp = await uploader.ping();
    return res.json({
      success:  true,
      hub:      "beat-anime-hub-api",
      uploader: uploaderUp ? "online" : "offline",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return err(res, "Health check failed");
  }
}

/**
 * GET /anime/download
 * ──────────────────────────────────────────────────────────────────
 * Proxies a GoFile direct download so the user's browser gets the
 * actual file instead of being redirected to GoFile's web page.
 *
 * How GoFile works:
 *   - GoFile page URL:  https://gofile.io/d/<contentId>
 *   - To get a direct download link we must call the GoFile API:
 *       GET https://api.gofile.io/getContent?contentId=<id>&token=<guest_token>
 *     which returns a direct download URL.
 *   - We fetch that URL server-side and pipe the file bytes back to
 *     the client so the browser triggers a real "Save File" download.
 *
 * Required query param: ?url=<gofile_page_url>
 *
 * Example:
 *   /api/anime/download?url=https://gofile.io/d/AbCdEf
 */
export async function gofileDownload(req, res) {
  const { url: gofileUrl } = req.query;
  if (!gofileUrl) return err(res, "Query param 'url' is required", 400);

  try {
    // Extract content ID from the GoFile page URL
    const contentId = gofileUrl.split("/d/")[1]?.split("?")[0]?.trim();
    if (!contentId) return err(res, "Invalid GoFile URL", 400);

    // Step 1: Get a guest token from GoFile
    const tokenRes = await axios.get("https://api.gofile.io/accounts", { timeout: 8_000 });
    const token = tokenRes.data?.data?.token;
    if (!token) return err(res, "Could not obtain GoFile token", 502);

    // Step 2: Fetch content metadata to get the real download URL
    const metaRes = await axios.get(
      `https://api.gofile.io/contents/${contentId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8_000,
      }
    );

    const files = metaRes.data?.data?.children;
    if (!files) return err(res, "No files found in GoFile content", 404);

    // Pick the first file entry
    const fileEntry = Object.values(files).find((f) => f.type === "file");
    if (!fileEntry) return err(res, "No downloadable file found", 404);

    const directUrl  = fileEntry.link;
    const fileName   = fileEntry.name   || "download";
    const mimeType   = fileEntry.mimetype || "application/octet-stream";

    // Step 3: Stream the file directly to the client
    const fileStream = await axios.get(directUrl, {
      responseType: "stream",
      headers: {
        Cookie:  `accountToken=${token}`,
        Referer: "https://gofile.io",
      },
      timeout: 30_000,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", mimeType);
    if (fileStream.headers["content-length"]) {
      res.setHeader("Content-Length", fileStream.headers["content-length"]);
    }

    fileStream.data.pipe(res);
  } catch (e) {
    console.error("[Controller] gofileDownload:", e.message);
    return err(res, "Download failed — could not resolve GoFile link");
  }
}

export default {
  listAnime,
  getAnimeInfo,
  getEpisode,
  getEpisodeQualities,
  getAnimeMeta,
  searchAnime,
  healthCheck,
  gofileDownload,
};
