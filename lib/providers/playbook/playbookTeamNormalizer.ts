/**
 * Sport-aware Playbook team normalizer / matcher.
 *
 * Ticket: o-non-mlb-team-normalizer.
 *
 * PROBLEM
 *   Playbook returns full club names ("Golden State Valkyries"). Our slate
 *   carries canonical abbreviations. The shadow audit matched WNBA only 2/3
 *   because the probe slugged BOTH sides by name instead of resolving the
 *   Playbook name to OUR canonical abbreviation. This module fixes that:
 *   resolve any provider name form -> canonical abbrev, then match on abbrev.
 *
 * DESIGN
 *   A per-sport registry of { abbr, name, city, mascot, aliases }. Resolution
 *   tries, in order: exact full-name -> alias -> abbreviation -> unique
 *   mascot -> unique city -> unique mascot-token contained in the string. It
 *   NEVER guesses across an ambiguous key (returns null instead), so a wrong
 *   match can't silently feed a public-splits row.
 *
 *   WNBA is fully populated from the canonical WNBA team map (single source of
 *   truth). NBA/NHL/NFL/NCAAF are scaffolded with empty registries + a generic
 *   mascot-slug fallback so they work best-effort today and can be promoted to
 *   exact registries later WITHOUT changing call sites.
 *
 * SCOPE / SAFETY
 *   Pure functions. No DB, no network, no production wiring. This is a mapping
 *   helper only — it does not ingest splits, touch grading, or affect lines.
 *   MLB intentionally NOT handled here; MLB keeps its dedicated
 *   normalizeMlbTeamName (lib/providers/real_api/_teamNameNormalizer.ts).
 */

import { WNBA_TEAMS_BY_BDL_ID } from "../../services/wnba/wnbaTeams";

export type NormalizerSport = "wnba" | "nba" | "nhl" | "nfl" | "ncaaf";

export interface TeamEntry {
  /** Canonical abbreviation — must equal OUR slate's teams.abbreviation. */
  abbr: string;
  /** Member-facing full club name. */
  name: string;
  /** Location/city tokens (lowercased, no mascot). */
  city: string;
  /** Mascot / nickname (lowercased, last word of name). */
  mascot: string;
  /** Extra provider name/abbrev forms to accept (lowercased, cleaned). */
  aliases?: string[];
}

export interface TeamResolution {
  abbr: string;
  source: "fullName" | "alias" | "abbr" | "mascot" | "city" | "token";
}

/** Normalize free text: lowercase, strip diacritics + punctuation, collapse. */
export function cleanName(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lastToken(cleaned: string): string {
  const parts = cleaned.split(" ");
  return parts[parts.length - 1] ?? "";
}

// ── Registries ─────────────────────────────────────────────────────────────

/** WNBA — derived from the canonical team map, plus common provider aliases. */
function buildWnbaRegistry(): TeamEntry[] {
  // Hand-curated alias sets keyed by canonical abbr. Mascot + city are derived
  // from the name; aliases cover city-only, abbrev, and nickname provider forms.
  const ALIASES: Record<string, string[]> = {
    NY: ["new york", "ny", "nyl", "ny liberty", "new york liberty"],
    CON: ["connecticut", "conn", "con", "ct"],
    IND: ["indiana", "ind"],
    ATL: ["atlanta", "atl"],
    WSH: ["washington", "wsh", "was", "was mystics"],
    CHI: ["chicago", "chi"],
    MIN: ["minnesota", "min"],
    LV: ["las vegas", "vegas", "lv", "lva", "lv aces"],
    SEA: ["seattle", "sea"],
    PHX: ["phoenix", "phx", "pho"],
    DAL: ["dallas", "dal"],
    LA: ["los angeles", "la", "lal", "l a", "la sparks"],
    GS: ["golden state", "gs", "gsv", "golden st", "valkyries"],
    TOR: ["toronto", "tor", "to"],
    POR: ["portland", "por"],
  };
  return Object.values(WNBA_TEAMS_BY_BDL_ID).map((t) => {
    const cleaned = cleanName(t.name);
    const mascot = lastToken(cleaned);
    const city = cleaned.slice(0, cleaned.length - mascot.length).trim();
    return {
      abbr: t.abbr,
      name: t.name,
      city,
      mascot,
      aliases: (ALIASES[t.abbr] ?? []).map(cleanName),
    };
  });
}

const REGISTRIES: Record<NormalizerSport, TeamEntry[]> = {
  wnba: buildWnbaRegistry(),
  // Scaffolded for later exact population (o-* follow-up tickets). Until
  // populated, these sports use the generic mascot-slug fallback below.
  nba: [],
  nhl: [],
  nfl: [],
  ncaaf: [],
};

// ── Per-sport lookup indices (memoized) ─────────────────────────────────────

interface SportIndex {
  entries: TeamEntry[];
  byFullName: Map<string, string>;
  byAlias: Map<string, string>;
  byAbbr: Map<string, string>;
  byMascot: Map<string, string>; // unique mascots only
  byCity: Map<string, string>; // unique cities only
  mascots: Array<{ token: string; abbr: string }>; // unique mascot tokens
}

const INDEX_CACHE = new Map<NormalizerSport, SportIndex>();

function buildIndex(entries: TeamEntry[]): SportIndex {
  const byFullName = new Map<string, string>();
  const byAlias = new Map<string, string>();
  const byAbbr = new Map<string, string>();
  const mascotCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  for (const e of entries) {
    byFullName.set(cleanName(e.name), e.abbr);
    byAbbr.set(cleanName(e.abbr), e.abbr);
    for (const a of e.aliases ?? []) byAlias.set(a, e.abbr);
    mascotCounts.set(e.mascot, (mascotCounts.get(e.mascot) ?? 0) + 1);
    if (e.city) cityCounts.set(e.city, (cityCounts.get(e.city) ?? 0) + 1);
  }
  const byMascot = new Map<string, string>();
  const byCity = new Map<string, string>();
  const mascots: Array<{ token: string; abbr: string }> = [];
  for (const e of entries) {
    if (mascotCounts.get(e.mascot) === 1) {
      byMascot.set(e.mascot, e.abbr);
      mascots.push({ token: e.mascot, abbr: e.abbr });
    }
    if (e.city && cityCounts.get(e.city) === 1) byCity.set(e.city, e.abbr);
  }
  return { entries, byFullName, byAlias, byAbbr, byMascot, byCity, mascots };
}

function indexFor(sport: NormalizerSport): SportIndex {
  let idx = INDEX_CACHE.get(sport);
  if (!idx) {
    idx = buildIndex(REGISTRIES[sport] ?? []);
    INDEX_CACHE.set(sport, idx);
  }
  return idx;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a provider team name to OUR canonical abbreviation for `sport`.
 * Returns null when the sport has no registry, or when the name is unknown /
 * ambiguous. Never guesses across an ambiguous mascot/city.
 */
export function resolveTeam(
  sport: NormalizerSport,
  rawName: unknown
): TeamResolution | null {
  const s = cleanName(rawName);
  if (!s) return null;
  const idx = indexFor(sport);
  if (idx.entries.length === 0) return null; // unpopulated sport

  const full = idx.byFullName.get(s);
  if (full) return { abbr: full, source: "fullName" };
  const alias = idx.byAlias.get(s);
  if (alias) return { abbr: alias, source: "alias" };
  const abbr = idx.byAbbr.get(s);
  if (abbr) return { abbr, source: "abbr" };

  const mascot = idx.byMascot.get(lastToken(s));
  if (mascot) return { abbr: mascot, source: "mascot" };

  // City-only forms ("golden state"): match the cleaned string against a
  // unique city, or the string minus its last token.
  const city = idx.byCity.get(s) ?? idx.byCity.get(s.split(" ").slice(0, -1).join(" "));
  if (city) return { abbr: city, source: "city" };

  // Last resort: a unique mascot token appearing anywhere in the string.
  const tokens = new Set(s.split(" "));
  const hits = idx.mascots.filter((m) => tokens.has(m.token));
  if (hits.length === 1) return { abbr: hits[0]!.abbr, source: "token" };

  return null;
}

/** Convenience: abbreviation only (or null). */
export function normalizeTeamAbbr(
  sport: NormalizerSport,
  rawName: unknown
): string | null {
  return resolveTeam(sport, rawName)?.abbr ?? null;
}

/**
 * Build a stable away@home match key. For a registered sport this is
 * `AWAYABBR@HOMEABBR`. For an unpopulated sport it falls back to the generic
 * mascot slug on each side (so callers can still match name-to-name today).
 * Returns null only when a registered sport fails to resolve a side.
 */
export function buildGameKey(
  sport: NormalizerSport,
  awayName: unknown,
  homeName: unknown
): string | null {
  const registered = (REGISTRIES[sport] ?? []).length > 0;
  if (registered) {
    const a = normalizeTeamAbbr(sport, awayName);
    const h = normalizeTeamAbbr(sport, homeName);
    return a && h ? `${a}@${h}` : null;
  }
  const a = lastToken(cleanName(awayName));
  const h = lastToken(cleanName(homeName));
  return a && h ? `${a}@${h}` : null;
}

/** Sports that currently have an exact registry (resolve to real abbrevs). */
export function hasRegistry(sport: NormalizerSport): boolean {
  return (REGISTRIES[sport] ?? []).length > 0;
}
