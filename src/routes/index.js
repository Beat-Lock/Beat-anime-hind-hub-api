/**
 * Main Routes — beat-anime-hub-api
 * ──────────────────────────────────────────────────────────────────
 * Single entry point for all hub routes.
 * Import and call registerRoutes(app) in your server.js / index.js.
 *
 * Route map
 * ─────────────────────────────────────────────────────
 *  GET  /api/anime/list              → all anime on the site (+ optional meta)
 *  GET  /api/anime/info              → full info: metadata + episodes
 *  GET  /api/anime/episode           → single episode stream/download links
 *  GET  /api/anime/qualities         → all quality variants for one episode
 *  GET  /api/anime/meta              → metadata only (AniList/Jikan)
 *  GET  /api/anime/search            → search anime available on site
 *  GET  /api/health                  → hub + uploader status
 * ─────────────────────────────────────────────────────
 *
 * Anime are ONLY served if they exist in the ep-uploader catalogue.
 * Metadata comes from AniList (primary) or Jikan/MAL (fallback).
 */

import { Router } from "express";
import {
  listAnime,
  getAnimeInfo,
  getEpisode,
  getEpisodeQualities,
  getAnimeMeta,
  searchAnime,
  healthCheck,
  gofileDownload,
} from "../controllers/anime.controller.js";

const router = Router();

// ── Anime routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/anime/list
 *
 * All anime present on the site.
 * Each entry includes basic metadata (cover, title, genres).
 *
 * Query params:
 *   ?meta=false   → skip metadata enrichment (returns plain catalogue faster)
 *
 * Example:
 *   /api/anime/list
 *   /api/anime/list?meta=false
 */
router.get("/list", listAnime);

/**
 * GET /api/anime/info
 *
 * Full details: complete AniList/Jikan metadata (banner, cover, description,
 * genres, trailer, characters, relations…) + all episodes grouped by season.
 *
 * Required:  ?name=<anime_name>
 * Optional:  ?season=<n>    filter episodes to one season
 *            ?quality=<q>   filter episodes to one quality (e.g. 1080p)
 *
 * Example:
 *   /api/anime/info?name=Naruto
 *   /api/anime/info?name=One+Piece&season=1
 */
router.get("/info", getAnimeInfo);

/**
 * GET /api/anime/episode
 *
 * Stream + download links for a single episode.
 * Returns best available quality by default.
 *
 * Required:  ?name=<anime_name>   ?episode=<n>
 * Optional:  ?season=<n>          ?quality=<q>
 *
 * Example:
 *   /api/anime/episode?name=Naruto&episode=1
 *   /api/anime/episode?name=Naruto&episode=5&season=1&quality=1080p
 */
router.get("/episode", getEpisode);

/**
 * GET /api/anime/qualities
 *
 * All quality variants (480p, 720p, 1080p, etc.) for one episode,
 * each with its own stream/download URL.
 *
 * Required:  ?name=<anime_name>   ?episode=<n>
 * Optional:  ?season=<n>
 *
 * Example:
 *   /api/anime/qualities?name=Naruto&episode=1
 */
router.get("/qualities", getEpisodeQualities);

/**
 * GET /api/anime/meta
 *
 * Pure metadata for one anime — no episode data.
 * Useful for info pages, banners, and pre-rendering.
 *
 * Required:  ?name=<anime_name>
 * Optional:  ?source=anilist|jikan   (force a specific source)
 *
 * Example:
 *   /api/anime/meta?name=Bleach
 *   /api/anime/meta?name=Bleach&source=jikan
 */
router.get("/meta", getAnimeMeta);

/**
 * GET /api/anime/search
 *
 * Search anime by name — only titles available on the site are returned,
 * each enriched with metadata.
 *
 * Required:  ?q=<search_query>
 *
 * Example:
 *   /api/anime/search?q=dragon
 */
router.get("/search", searchAnime);

/**
 * GET /api/anime/download
 *
 * Proxies a GoFile download as a DIRECT file download.
 * The user's browser will get the actual file bytes — not a redirect
 * to GoFile's website.
 *
 * Required:  ?url=<gofile_page_url>
 *
 * Example:
 *   /api/anime/download?url=https://gofile.io/d/AbCdEf
 *
 * Frontend usage:
 *   <a href="/api/anime/download?url=GOFILE_URL" download>Download</a>
 */
router.get("/download", gofileDownload);

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Attach all hub routes to an Express app.
 *
 * Usage in server.js / index.js:
 *
 *   import { registerRoutes } from "./src/routes/index.js";
 *   registerRoutes(app);
 *
 * Or with a custom prefix:
 *
 *   import animeRouter from "./src/routes/index.js";
 *   app.use("/api/v2/anime", animeRouter);
 */
export function registerRoutes(app) {
  // Anime catalogue + info + streaming
  app.use("/api/anime", router);

  // Health check at root level
  app.get("/api/health", healthCheck);

  console.log("[Routes] beat-anime-hub routes registered:");
  console.log("  GET /api/anime/list");
  console.log("  GET /api/anime/info");
  console.log("  GET /api/anime/episode");
  console.log("  GET /api/anime/qualities");
  console.log("  GET /api/anime/meta");
  console.log("  GET /api/anime/search");
  console.log("  GET /api/anime/download");
  console.log("  GET /api/health");
}

export default router;
