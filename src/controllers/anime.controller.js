/**
 * Beat Anime Hub API
 * ──────────────────────────────────────────────────────────────────
 * @author      Beat Anime
 * @channel     https://t.me/beatanime
 * @support     https://t.me/Beat_Anime_Discussion
 * ──────────────────────────────────────────────────────────────────
 *
 * Anime Controller
 * Handles all route logic for the hub API.
 *
 * RULE: Anime are sourced ONLY from your Flask site (ep-uploader).
 *       AniList/Jikan metadata is fetched ONLY for anime that exist there.
 *       No anime from any external source ever appears in responses.
 */

import axios from "axios";
import * as uploader from "../services/epUploader.service.js";
import * as meta from "../services/metaAggregator.service.js";

// ── Response helpers ──────────────────────────────────────────────────────────

const ok  = (res, data)                => res.json({ success: true, ...data });
const bad = (res, msg, status = 400)   => res.status(status).json({ success: false, message: msg });
const missing = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });
const fail  = (res, msg = "Server error") => res.status(500).json({ success: false, message: msg });

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/anime/list
 *
 * All anime that exist on YOUR site, each enriched with AniList metadata
 * (cover image, banner, title, genres, score).
 *
 * Only anime present in your Flask database are returned — no extras.
 *
 * Query params:
 *   ?meta=false   skip metadata enrichment (faster, returns plain catalogue)
 */
export async function listAnime(req, res) {
  try {
    const withMeta = req.query.meta !== "false";

    // ← Source of truth: YOUR site only
    const catalogue = await uploader.getAnimeList();

    if (!withMeta) {
      return ok(res, { total: catalogue.length, anime: catalogue });
    }

    // Enrich each anime with metadata from AniList → Jikan
    // Runs in parallel; if metadata fails for one anime it just returns nulls
    const enriched = await Promise.all(
      catalogue.map(async (entry) => {
        const m = await meta.fetchMeta(entry.anime_name);
        return {
          // From YOUR site
          anime_name:    entry.anime_name,
          episode_count: entry.episode_count,
          last_updated:  entry.last_updated,
          // From AniList / Jikan
          anilistId:     m?.anilistId     || null,
          malId:         m?.malId         || null,
          title:         m?.title         || null,
          type:          m?.type          || null,
          status:        m?.status        || null,
          averageScore:  m?.averageScore  || null,
          genres:        m?.genres        || [],
          image:         m?.image         || null,  // cover + banner + color
        };
      })
    );

    return ok(res, { total: enriched.length, anime: enriched });
  } catch (e) {
    console.error("[Controller] listAnime:", e.message);
    return fail(res, "Failed to fetch anime list");
  }
}

/**
 * GET /api/anime/info
 *
 * Full info for one anime: complete AniList metadata + all episodes.
 * Returns 404 if the anime is not on your site.
 *
 * Required:  ?name=<anime_name>
 * Optional:  ?season=<n>   ?quality=<q>
 */
export async function getAnimeInfo(req, res) {
  try {
    const { name, season, quality } = req.query;
    if (!name) return bad(res, "Query param 'name' is required");

    // ← Must exist on YOUR site
    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return missing(res, `"${name}" is not available on Beat Anime`);

    // Fetch episodes + metadata in parallel
    const [episodes, metaData] = await Promise.all([
      uploader.getAnimeEpisodes(name, { season, quality }),
      meta.fetchMeta(name),
    ]);

    return ok(res, {
      anime_name: name,

      // Full metadata (all 23 fields guaranteed — null if unavailable)
      meta: metaData ? {
        anilistId:         metaData.anilistId,
        malId:             metaData.malId,
        title:             metaData.title,
        type:              metaData.type,
        status:            metaData.status,
        description:       metaData.description,
        startDate:         metaData.startDate,
        endDate:           metaData.endDate,
        season:            metaData.season,
        totalEpisodes:     metaData.totalEpisodes,
        episodeDuration:   metaData.episodeDuration,
        isAdult:           metaData.isAdult,
        genres:            metaData.genres,
        synonyms:          metaData.synonyms,
        averageScore:      metaData.averageScore,
        popularity:        metaData.popularity,
        image:             metaData.image,       // { cover, medium, color, banner }
        trailer:           metaData.trailer,
        studios:           metaData.studios,
        nextAiringEpisode: metaData.nextAiringEpisode,
        relations:         metaData.relations,
        characters:        metaData.characters,
        source:            metaData.source,      // "anilist" or "jikan"
      } : null,

      // Episodes from YOUR site
      // stream_url = best server (Archive.org → PixelDrain → StreamTape)
      // download_url = GoFile (resolved via /api/anime/download proxy)
      // servers[] = all available stream servers in priority order
      episodes: episodes || { total_seasons: 0, total_episodes: 0, seasons: [] },
    });
  } catch (e) {
    console.error("[Controller] getAnimeInfo:", e.message);
    return fail(res, "Failed to fetch anime info");
  }
}

/**
 * GET /api/anime/episode
 *
 * Stream + download links for a single episode.
 *
 * Response includes:
 *   stream_url    — best server URL (Archive.org → PixelDrain → StreamTape)
 *   download_url  — GoFile page URL (pass to /api/anime/download for direct file)
 *   servers[]     — all available servers for a server-switcher UI
 *
 * Required:  ?name=<anime_name>   ?episode=<n>
 * Optional:  ?season=<n>          ?quality=<q>
 */
export async function getEpisode(req, res) {
  try {
    const { name, episode, season, quality } = req.query;
    if (!name)    return bad(res, "Query param 'name' is required");
    if (!episode) return bad(res, "Query param 'episode' is required");

    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return missing(res, `"${name}" is not available on Beat Anime`);

    const ep = await uploader.getEpisode(name, episode, { season, quality });
    if (!ep) return missing(res, `Episode ${episode} not found for "${name}"`);

    return ok(res, { anime_name: name, episode: ep });
  } catch (e) {
    console.error("[Controller] getEpisode:", e.message);
    return fail(res, "Failed to fetch episode");
  }
}

/**
 * GET /api/anime/qualities
 *
 * All quality variants (480p / 720p / 1080p / original) for one episode,
 * each with its own servers[] and stream_url.
 *
 * Required:  ?name=<anime_name>   ?episode=<n>
 * Optional:  ?season=<n>
 */
export async function getEpisodeQualities(req, res) {
  try {
    const { name, episode, season = "1" } = req.query;
    if (!name)    return bad(res, "Query param 'name' is required");
    if (!episode) return bad(res, "Query param 'episode' is required");

    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return missing(res, `"${name}" is not available on Beat Anime`);

    const qualities = await uploader.getEpisodeQualities(name, episode, season);
    return ok(res, { anime_name: name, episode_no: episode, qualities });
  } catch (e) {
    console.error("[Controller] getEpisodeQualities:", e.message);
    return fail(res, "Failed to fetch qualities");
  }
}

/**
 * GET /api/anime/meta
 *
 * Pure metadata only — all 23 fields, no episode data.
 * Only works for anime that exist on your site.
 *
 * Required:  ?name=<anime_name>
 * Optional:  ?source=anilist|jikan   force a specific source
 */
export async function getAnimeMeta(req, res) {
  try {
    const { name, source } = req.query;
    if (!name) return bad(res, "Query param 'name' is required");

    // ← Only serve metadata for anime on YOUR site
    const exists = await uploader.animeExistsOnSite(name);
    if (!exists) return missing(res, `"${name}" is not available on Beat Anime`);

    let metaData;
    if (source === "anilist")     metaData = await meta.fetchAniListMeta(name);
    else if (source === "jikan")  metaData = await meta.fetchJikanMeta(name);
    else                          metaData = await meta.fetchMeta(name);

    if (!metaData) return missing(res, `No metadata found for "${name}"`);

    return ok(res, {
      meta: {
        anilistId:         metaData.anilistId,
        malId:             metaData.malId,
        title:             metaData.title,
        type:              metaData.type,
        status:            metaData.status,
        description:       metaData.description,
        startDate:         metaData.startDate,
        endDate:           metaData.endDate,
        season:            metaData.season,
        totalEpisodes:     metaData.totalEpisodes,
        episodeDuration:   metaData.episodeDuration,
        isAdult:           metaData.isAdult,
        genres:            metaData.genres,
        synonyms:          metaData.synonyms,
        averageScore:      metaData.averageScore,
        popularity:        metaData.popularity,
        image:             metaData.image,
        trailer:           metaData.trailer,
        studios:           metaData.studios,
        nextAiringEpisode: metaData.nextAiringEpisode,
        relations:         metaData.relations,
        characters:        metaData.characters,
        source:            metaData.source,
      }
    });
  } catch (e) {
    console.error("[Controller] getAnimeMeta:", e.message);
    return fail(res, "Failed to fetch metadata");
  }
}

/**
 * GET /api/anime/search
 *
 * Search anime by name — only returns titles that exist on YOUR site.
 * Each match is enriched with cover image + basic metadata.
 *
 * Required:  ?q=<query>
 */
export async function searchAnime(req, res) {
  try {
    const { q } = req.query;
    if (!q) return bad(res, "Query param 'q' is required");

    // ← Search only within YOUR site's catalogue
    const catalogue = await uploader.getAnimeList();
    const query     = q.trim().toLowerCase();
    const matches   = catalogue.filter((a) =>
      a.anime_name.toLowerCase().includes(query)
    );

    if (!matches.length) return ok(res, { total: 0, results: [] });

    const results = await Promise.all(
      matches.map(async (entry) => {
        const m = await meta.fetchMeta(entry.anime_name);
        return {
          anime_name:    entry.anime_name,
          episode_count: entry.episode_count,
          anilistId:     m?.anilistId     || null,
          malId:         m?.malId         || null,
          title:         m?.title         || null,
          type:          m?.type          || null,
          status:        m?.status        || null,
          averageScore:  m?.averageScore  || null,
          genres:        m?.genres        || [],
          image:         m?.image         || null,
        };
      })
    );

    return ok(res, { total: results.length, results });
  } catch (e) {
    console.error("[Controller] searchAnime:", e.message);
    return fail(res, "Search failed");
  }
}

/**
 * GET /api/health
 * Hub status + uploader connectivity check.
 */
export async function healthCheck(req, res) {
  try {
    const uploaderUp = await uploader.ping();
    return res.json({
      success:   true,
      hub:       "beat-anime-hub-api",
      author:    "Beat Anime",
      channel:   "https://t.me/beatanime",
      support:   "https://t.me/Beat_Anime_Discussion",
      uploader:  uploaderUp ? "online" : "offline",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return fail(res, "Health check failed");
  }
}

/**
 * GET /api/anime/download
 * ──────────────────────────────────────────────────────────────────
 * Proxies a GoFile download as a DIRECT file download.
 * Browser gets the actual file bytes — no redirect to GoFile's page.
 *
 * How it works:
 *   1. Extract contentId from the GoFile page URL
 *   2. Get a guest token from GoFile API
 *   3. Fetch file metadata to get the real CDN URL
 *   4. Pipe the file bytes directly to the browser
 *
 * Required:  ?url=<gofile_page_url>
 *
 * Example:
 *   /api/anime/download?url=https://gofile.io/d/AbCdEf
 *
 * Frontend usage:
 *   <a href="/api/anime/download?url=GOFILE_URL" download>Download</a>
 */
export async function gofileDownload(req, res) {
  const { url: gofileUrl } = req.query;
  if (!gofileUrl) return bad(res, "Query param 'url' is required");

  try {
    const contentId = gofileUrl.split("/d/")[1]?.split("?")[0]?.trim();
    if (!contentId) return bad(res, "Invalid GoFile URL");

    // Step 1: Guest token
    const tokenRes = await axios.get("https://api.gofile.io/accounts", { timeout: 8_000 });
    const token    = tokenRes.data?.data?.token;
    if (!token) return res.status(502).json({ success: false, message: "Could not obtain GoFile token" });

    // Step 2: File metadata
    const metaRes = await axios.get(
      `https://api.gofile.io/contents/${contentId}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 8_000 }
    );

    const files = metaRes.data?.data?.children;
    if (!files) return missing(res, "No files found in GoFile content");

    const fileEntry = Object.values(files).find((f) => f.type === "file");
    if (!fileEntry) return missing(res, "No downloadable file found");

    const directUrl = fileEntry.link;
    const fileName  = fileEntry.name     || "download";
    const mimeType  = fileEntry.mimetype || "application/octet-stream";

    // Step 3: Pipe file to client
    const fileStream = await axios.get(directUrl, {
      responseType: "stream",
      headers: { Cookie: `accountToken=${token}`, Referer: "https://gofile.io" },
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
    return fail(res, "Download failed — could not resolve GoFile link");
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
