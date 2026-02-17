/**
 * Meta Aggregator
 * ──────────────────────────────────────────────────────────────────
 * Fetches rich metadata (banner, cover, description, genres, trailer,
 * characters, relations…) in consumet-compatible shape.
 *
 * Strategy:
 *   1. AniList GraphQL  — best data, no API key
 *   2. Jikan (MAL)      — fallback, no API key
 *   3. null             — meta unavailable (caller shows bare ep data)
 *
 * No API keys required.
 */

import axios from "axios";

const anilist = axios.create({
  baseURL: "https://graphql.anilist.co",
  timeout: 8_000,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
});

const jikan = axios.create({
  baseURL: "https://api.jikan.moe/v4",
  timeout: 8_000,
  headers: { Accept: "application/json" },
});

// ── AniList ───────────────────────────────────────────────────────────────────

const ANILIST_QUERY = `
  query ($search: String, $id: Int) {
    Media(search: $search, id: $id, type: ANIME) {
      id
      idMal
      title { romaji english native userPreferred }
      type
      format
      status
      description(asHtml: false)
      startDate { year month day }
      endDate   { year month day }
      season
      seasonYear
      episodes
      duration
      countryOfOrigin
      isAdult
      trailer { id site thumbnail }
      coverImage { extraLarge large medium color }
      bannerImage
      genres
      synonyms
      averageScore
      popularity
      trending
      studios(isMain: true) { nodes { id name siteUrl } }
      nextAiringEpisode { airingAt timeUntilAiring episode }
      relations {
        edges {
          relationType(version: 2)
          node {
            id
            title { romaji english }
            format type status
            coverImage { medium }
          }
        }
      }
      characters(sort: ROLE, perPage: 16) {
        edges {
          role
          node { id name { full } image { medium } }
          voiceActors(language: JAPANESE) {
            id name { full } image { medium }
          }
        }
      }
    }
  }
`;

function fmtDate(d) {
  if (!d?.year) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function normaliseAniList(m) {
  return {
    // ── IDs ──────────────────────────────────────────────────────────────────
    anilistId:  m.id       || null,
    malId:      m.idMal    || null,

    // ── Titles ───────────────────────────────────────────────────────────────
    title: {
      romaji:        m.title?.romaji        || null,
      english:       m.title?.english       || null,
      native:        m.title?.native        || null,
      userPreferred: m.title?.userPreferred || null,
    },

    // ── Classification ───────────────────────────────────────────────────────
    type:   m.format || m.type || null,   // TV, MOVIE, OVA, ONA, SPECIAL, MUSIC
    status: m.status           || null,   // FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED, HIATUS

    // ── Content ──────────────────────────────────────────────────────────────
    description: m.description || null,

    // ── Dates & Schedule ─────────────────────────────────────────────────────
    startDate: fmtDate(m.startDate),
    endDate:   fmtDate(m.endDate),
    season:    m.season ? `${m.season} ${m.seasonYear || ""}`.trim() : null,

    // ── Episode Info ─────────────────────────────────────────────────────────
    totalEpisodes:   m.episodes || null,   // total ep count from AniList
    episodeDuration: m.duration || null,   // minutes per episode

    // ── Flags ────────────────────────────────────────────────────────────────
    isAdult:         m.isAdult         || false,
    countryOfOrigin: m.countryOfOrigin || null,

    // ── Scores ───────────────────────────────────────────────────────────────
    averageScore: m.averageScore || null,   // 0–100
    popularity:   m.popularity  || null,
    trending:     m.trending    || null,

    // ── Tags ─────────────────────────────────────────────────────────────────
    genres:   m.genres   || [],
    synonyms: m.synonyms || [],

    // ── Images ───────────────────────────────────────────────────────────────
    image: {
      cover:  m.coverImage?.extraLarge || m.coverImage?.large || null,  // tall poster
      medium: m.coverImage?.medium     || null,                          // thumbnail
      color:  m.coverImage?.color      || null,                          // dominant hex color
      banner: m.bannerImage            || null,                          // wide banner (1900×400)
    },

    // ── Trailer ──────────────────────────────────────────────────────────────
    trailer: m.trailer
      ? {
          id:        m.trailer.id,
          site:      m.trailer.site,
          thumbnail: m.trailer.thumbnail,
          url:
            m.trailer.site === "youtube"
              ? `https://www.youtube.com/watch?v=${m.trailer.id}`
              : null,
        }
      : null,

    // ── Studios ──────────────────────────────────────────────────────────────
    studios: (m.studios?.nodes || []).map((s) => ({
      id:      s.id,
      name:    s.name,
      siteUrl: s.siteUrl || null,
    })),

    // ── Airing ───────────────────────────────────────────────────────────────
    nextAiringEpisode: m.nextAiringEpisode
      ? {
          episode:         m.nextAiringEpisode.episode,
          airingAt:        new Date(m.nextAiringEpisode.airingAt * 1000).toISOString(),
          timeUntilAiring: m.nextAiringEpisode.timeUntilAiring,
        }
      : null,

    // ── Relations (sequels, prequels, spin-offs…) ────────────────────────────
    relations: (m.relations?.edges || []).map((e) => ({
      relationType: e.relationType,
      id:           e.node?.id           || null,
      title:        e.node?.title?.english || e.node?.title?.romaji || null,
      format:       e.node?.format       || null,
      type:         e.node?.type         || null,
      status:       e.node?.status       || null,
      image:        e.node?.coverImage?.medium || null,
    })),

    // ── Characters ───────────────────────────────────────────────────────────
    characters: (m.characters?.edges || []).map((e) => ({
      role:  e.role,
      id:    e.node?.id   || null,
      name:  e.node?.name?.full || null,
      image: e.node?.image?.medium || null,
      voiceActors: (e.voiceActors || []).map((va) => ({
        id:    va.id               || null,
        name:  va.name?.full       || null,
        image: va.image?.medium    || null,
      })),
    })),

    // ── Source tag ───────────────────────────────────────────────────────────
    source: "anilist",
  };
}

export async function fetchAniListMeta(query) {
  try {
    const variables =
      typeof query === "number" ? { id: query } : { search: String(query) };

    const { data } = await anilist.post("", { query: ANILIST_QUERY, variables });
    const media = data?.data?.Media;
    if (!media) return null;
    return normaliseAniList(media);
  } catch (e) {
    console.error("[Meta] AniList error:", e.message);
    return null;
  }
}

// ── Jikan (MAL) fallback ──────────────────────────────────────────────────────

function normaliseJikan(m) {
  return {
    // ── IDs ──────────────────────────────────────────────────────────────────
    anilistId: null,
    malId:     m.mal_id || null,

    // ── Titles ───────────────────────────────────────────────────────────────
    title: {
      romaji:        m.title_japanese || null,
      english:       m.title_english  || m.title || null,
      native:        m.title_japanese || null,
      userPreferred: m.title          || null,
    },

    // ── Classification ───────────────────────────────────────────────────────
    type:   m.type   || null,
    status: m.status || null,

    // ── Content ──────────────────────────────────────────────────────────────
    description: m.synopsis || null,

    // ── Dates & Schedule ─────────────────────────────────────────────────────
    startDate: m.aired?.from ? m.aired.from.split("T")[0] : null,
    endDate:   m.aired?.to   ? m.aired.to.split("T")[0]   : null,
    season:    m.season ? `${m.season} ${m.year || ""}`.trim() : null,

    // ── Episode Info ─────────────────────────────────────────────────────────
    totalEpisodes:   m.episodes || null,
    episodeDuration: typeof m.duration === "string"
      ? parseInt(m.duration, 10) || null
      : m.duration               || null,

    // ── Flags ────────────────────────────────────────────────────────────────
    isAdult:         m.rating?.toLowerCase().includes("rx") || false,
    countryOfOrigin: "JP",

    // ── Scores ───────────────────────────────────────────────────────────────
    averageScore: m.score   ? Math.round(m.score * 10) : null,
    popularity:   m.members || null,
    trending:     null,

    // ── Tags ─────────────────────────────────────────────────────────────────
    genres:   (m.genres        || []).map((g) => g.name),
    synonyms: m.title_synonyms || [],

    // ── Images (Jikan has no banner) ─────────────────────────────────────────
    image: {
      cover:  m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || null,
      medium: m.images?.jpg?.image_url       || null,
      color:  null,
      banner: null,
    },

    // ── Trailer ──────────────────────────────────────────────────────────────
    trailer: m.trailer?.youtube_id
      ? {
          id:        m.trailer.youtube_id,
          site:      "youtube",
          thumbnail: m.trailer.images?.maximum_image_url || null,
          url:       `https://www.youtube.com/watch?v=${m.trailer.youtube_id}`,
        }
      : null,

    // ── Studios ──────────────────────────────────────────────────────────────
    studios: (m.studios || []).map((s) => ({
      id:      s.mal_id || null,
      name:    s.name,
      siteUrl: null,
    })),

    // ── Airing (Jikan doesn't provide this) ──────────────────────────────────
    nextAiringEpisode: null,

    // ── Relations ────────────────────────────────────────────────────────────
    relations: (m.relations || []).flatMap((r) =>
      (r.entry || []).map((e) => ({
        relationType: r.relation,
        id:           e.mal_id || null,
        title:        e.name   || null,
        format:       e.type   || null,
        type:         e.type   || null,
        status:       null,
        image:        null,
      }))
    ),

    // ── Characters (not fetched from Jikan to avoid extra API call) ───────────
    characters: [],

    // ── Source tag ───────────────────────────────────────────────────────────
    source: "jikan",
  };
}

export async function fetchJikanMeta(query) {
  try {
    const { data } = await jikan.get("/anime", { params: { q: query, limit: 1 } });
    const item = data?.data?.[0];
    if (!item) return null;
    return normaliseJikan(item);
  } catch (e) {
    console.error("[Meta] Jikan error:", e.message);
    return null;
  }
}

// ── Combined (AniList → Jikan) ────────────────────────────────────────────────

/**
 * Fetch full metadata for an anime title.
 * Tries AniList first, falls back to Jikan.
 * @param {string} animeName
 * @returns {Promise<object|null>}
 */
export async function fetchMeta(animeName) {
  const result = await fetchAniListMeta(animeName);
  if (result) return result;

  console.warn(`[Meta] AniList miss for "${animeName}" — falling back to Jikan`);
  return fetchJikanMeta(animeName);
}

export default { fetchMeta, fetchAniListMeta, fetchJikanMeta };
