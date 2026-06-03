/**
 * Phase 4.2.C.1.M — Provider-ID mapping service.
 *
 * Auto-maps BDL player IDs to MLB Stats person IDs by name + DOB +
 * birth-city tiebreaker. Writes the mapping result to
 * `players.provider_ids` JSONB. Tier 1 + 2 auto-write; Tier 3 + 4 + None
 * queue with `unresolved_bdl` for operator review.
 *
 * The service is DI-friendly: provider dependencies are passed as
 * function references (not concrete classes) so tests can stub them.
 * Supabase client is also injected.
 *
 * No HTTP, no DB writes happen in this module's pure-match path —
 * `attemptMatch()` is testable without any external side effects.
 * `writeMapping()` is the only function that calls Supabase, and only
 * with the operator's explicit confirmation in the calling script.
 *
 * Algorithm version: "name_dob_v1" — tagged in every written record so
 * future algorithm revisions can re-run the matcher on prior data
 * without ambiguity. Bump the version constant when the algorithm
 * changes materially.
 *
 * Match tiers (Phase 4.2.C.1.M plan §3):
 *   Tier 1 HIGH:    full_name normalized exact + DOB exact → auto-write
 *   Tier 2 MEDIUM:  DOB exact + name variant (first-name overlap +
 *                   last-name match) → auto-write with audit flag
 *   Tier 3 LOW:     multiple DOB matches, tiebroken inconclusively →
 *                   queue, NEVER auto-write
 *   Tier 4 LOW:     DOB missing on one side + name + city match →
 *                   queue, NEVER auto-write
 *   None:           no candidate found / DOB mismatch → queue with reason
 *
 * Algorithm details on normalization, DOB century disambiguation, and
 * sanity checks live alongside the implementation below — readers can
 * verify each step against the plan without indirection.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MlbPersonProfile } from "../providers/real_api/_mlbStatsApiClient";

/** Algorithm version tag — included in every written record. */
export const MAPPING_ALGORITHM_VERSION = "name_dob_v1";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * The matcher's view of a BDL candidate. We don't import
 * `StatsPlayerRecord` from BallDontLieProvider directly — the matcher
 * is provider-agnostic, and a future SharpAPI/FanDuel provider mapping
 * could reuse this shape. Keep the surface tight.
 */
export type BdlCandidate = {
  external_id: number;          // BDL player ID
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;            // BDL "MM/DD/YY" — raw, NOT pre-normalized
  age: number | null;            // BDL exposes age, useful for century-disambiguation
  birth_place: string | null;    // "Fullerton, CA" (city + state)
  position_abbr: string | null;
  bats: string | null;
  throws: string | null;
  team_abbreviation: string | null;  // not part of StatsPlayerRecord; matcher derives if available
};

/**
 * Confidence tier for a match attempt. Maps directly to the auto-write
 * gate: only "high" and "medium" auto-write; "low" and "none" queue.
 */
export type MatchTier = "high" | "medium" | "low" | "none";

/** Reason codes for unresolved matches. Stable strings; used in JSONB. */
export type UnresolvedReason =
  | "no_candidates"
  | "multiple_candidates"
  | "dob_mismatch"
  | "dob_missing_one_side"
  | "name_variant_uncertain"
  | "position_mismatch";

/**
 * Output of `attemptMatch()` — what the matcher decided. Always carries
 * enough audit context for the caller to write the JSONB shape.
 */
export type MatchResult =
  | {
      tier: "high" | "medium";
      bdlId: number;
      bdlFullName: string;
      method: "name_dob_v1" | "name_dob_variant_v1";
    }
  | {
      tier: "low" | "none";
      reason: UnresolvedReason;
      candidates: Array<{
        bdl_id: number;
        name: string;
        dob: string | null;
        team: string | null;
      }>;
    };

// ─────────────────────────────────────────────────────────────────────
// Normalization helpers (pure)
// ─────────────────────────────────────────────────────────────────────

/**
 * Lowercase + strip diacritics + strip punctuation + strip common
 * suffixes + collapse whitespace. Used on full names from BOTH sides
 * before comparison. "José Ramírez Jr." → "jose ramirez".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"`]/g, "")
    // Strip trailing suffixes (case after lowercase): " jr", " sr", " ii", " iii", " iv"
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize BDL DOB ("MM/DD/YY") + age to ISO ("YYYY-MM-DD").
 *
 * Century disambiguation: BDL's two-digit year is ambiguous. We resolve
 * it against the player's current age IF age is provided, otherwise
 * assume 19YY for ages > 30 in the current year and 20YY otherwise.
 *
 * Returns null when input is malformed or age is implausible.
 */
export function normalizeBdlDob(
  dob: string | null,
  age: number | null,
  today: Date = new Date()
): string | null {
  if (dob === null) return null;
  // BallDontLieProvider now converts BDL's raw MM/DD/YY to ISO at ingest,
  // so real-flow `BdlCandidate.dob` is ISO. Accept ISO as a passthrough.
  const iso = dob.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = dob.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m === null) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const yy = Number(m[3]);
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    !Number.isFinite(yy)
  ) {
    return null;
  }
  // Disambiguate century. If age is given, prefer the century that
  // yields an age within ±2 of the reported value (BDL reports the
  // player's current age, which may round at year boundaries).
  const currentYear = today.getUTCFullYear();
  let year = 2000 + yy;
  if (age !== null) {
    const age2000 = currentYear - year;
    const age1900 = currentYear - (1900 + yy);
    if (Math.abs(age1900 - age) < Math.abs(age2000 - age)) {
      year = 1900 + yy;
    }
  } else {
    // No age — heuristic: assume 20YY only if it yields a non-future
    // birth date, else 19YY.
    if (year > currentYear) year = 1900 + yy;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Normalize MLB Stats DOB ("YYYY-MM-DD") to canonical ISO. Mostly a
 * passthrough since MLB Stats already returns ISO, but defensive against
 * trailing whitespace or unexpected formats.
 */
export function normalizeMlbStatsDob(dob: string | null): string | null {
  if (dob === null) return null;
  const m = dob.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Extract birth city from BDL's combined "City, State" string. Returns
 * lowercased city only for comparison.
 */
export function normalizeBdlBirthCity(
  birthPlace: string | null
): string | null {
  if (birthPlace === null) return null;
  const first = birthPlace.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "" ? null : first;
}

/**
 * Normalize MLB Stats birth city (already a separate field).
 */
export function normalizeMlbStatsBirthCity(
  birthCity: string | null
): string | null {
  if (birthCity === null) return null;
  const t = birthCity.trim().toLowerCase();
  return t === "" ? null : t;
}

/**
 * Position sanity check: do the two players' positions categorize the
 * same way? BDL uses "SP"/"RP"/"1B"/etc.; MLB Stats uses "P"/"1B"/etc.
 * We treat any pitcher BDL category as compatible with MLB "P", and
 * insist on exact match for everything else.
 *
 * Returns true when the categories overlap or either side is missing.
 * Missing position → assume compatible (don't reject solely on missing
 * data).
 */
export function positionCompatible(
  bdlAbbr: string | null,
  mlbAbbr: string | null
): boolean {
  if (bdlAbbr === null || mlbAbbr === null) return true;
  const isPitcher = (a: string): boolean =>
    a === "P" || a === "SP" || a === "RP" || a === "CP";
  if (isPitcher(bdlAbbr) && isPitcher(mlbAbbr)) return true;
  if (isPitcher(bdlAbbr) !== isPitcher(mlbAbbr)) return false;
  return bdlAbbr.toUpperCase() === mlbAbbr.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────
// Match logic (pure)
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine if two normalized names match exactly, accounting for the
 * MLB Stats use of `useName`/`useLastName` (display) vs first/last
 * (formal). For Tier 1, names must match exactly after normalization.
 */
function namesMatchExact(
  bdl: BdlCandidate,
  mlb: MlbPersonProfile
): boolean {
  const bdlN = normalizeName(bdl.full_name);
  const mlbN = normalizeName(mlb.fullName);
  if (bdlN === mlbN) return true;
  // Try MLB's useName + useLastName (display form) — common case:
  // formal "Julio Daniel Martinez" vs display "J.D. Martinez".
  if (mlb.useName !== null && mlb.useLastName !== null) {
    const useN = normalizeName(`${mlb.useName} ${mlb.useLastName}`);
    if (useN === bdlN) return true;
  }
  return false;
}

/**
 * Determine if two names are a variant match (Tier 2): last name
 * matches exactly + first name has token overlap. Catches "J.D.
 * Martinez" ↔ "Julio Daniel Martinez" patterns.
 */
function namesMatchVariant(
  bdl: BdlCandidate,
  mlb: MlbPersonProfile
): boolean {
  const bdlLast = bdl.last_name === null ? "" : normalizeName(bdl.last_name);
  const mlbLast = mlb.lastName === null ? "" : normalizeName(mlb.lastName);
  if (bdlLast === "" || mlbLast === "" || bdlLast !== mlbLast) return false;

  const bdlFirstRaw = bdl.first_name ?? "";
  const mlbFirst =
    mlb.firstName === null ? "" : normalizeName(mlb.firstName);
  if (bdlFirstRaw === "" || mlbFirst === "") return false;

  // Detect initials pattern BEFORE punctuation strip. "J.D." or "T.J."
  // is a sequence of 2+ single letters separated by periods. After
  // `normalizeName` punctuation strip these collapse to "jd"/"tj" and
  // we lose the per-letter structure; preserve it here for the initial
  // overlap check.
  const initialsMatch = bdlFirstRaw.match(
    /^\s*([A-Za-z])(?:\.\s*([A-Za-z]))+\.?\s*$/
  );
  if (initialsMatch !== null) {
    const initials = bdlFirstRaw
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .split("");
    const mlbTokens = mlbFirst.split(/\s+/).filter(Boolean);
    if (
      initials.length > 0 &&
      initials.length <= mlbTokens.length &&
      initials.every((c, i) => mlbTokens[i]?.startsWith(c))
    ) {
      return true;
    }
  }

  // Post-normalization comparisons for non-initials variants
  const bdlFirst = normalizeName(bdlFirstRaw);
  if (bdlFirst === mlbFirst) return true;
  if (bdlFirst.startsWith(mlbFirst) || mlbFirst.startsWith(bdlFirst)) return true;
  // Whole-token initial overlap (when BDL stores "J D" with space)
  const bdlTokens = bdlFirst.split(/\s+/).filter(Boolean);
  const mlbTokens = mlbFirst.split(/\s+/).filter(Boolean);
  if (
    bdlTokens.length > 0 &&
    bdlTokens.length <= mlbTokens.length &&
    bdlTokens.every((bt, i) => mlbTokens[i]?.startsWith(bt))
  ) {
    return true;
  }
  return false;
}

/**
 * Pure attempt-match function. Given an MLB Stats profile (what we
 * have on the canonical side) and a list of BDL candidates from a
 * /players?search=<lastname> call, produce a single MatchResult.
 *
 * Deterministic: same inputs → same output. No HTTP, no DB, no side
 * effects. Suitable for unit tests with hand-crafted fixtures.
 *
 * @param mlb         The MLB Stats profile (canonical side)
 * @param candidates  BDL candidates from a name-search call
 * @param today       Reference date for DOB century disambiguation
 *                    (default = new Date(); passed explicitly in tests)
 */
export function attemptMatch(
  mlb: MlbPersonProfile,
  candidates: BdlCandidate[],
  today: Date = new Date()
): MatchResult {
  if (candidates.length === 0) {
    return { tier: "none", reason: "no_candidates", candidates: [] };
  }
  // Step 1: filter to DOB-matching candidates (if MLB has DOB)
  const mlbDob = normalizeMlbStatsDob(mlb.birthDate);
  const dobMatched: BdlCandidate[] = [];
  for (const c of candidates) {
    const bdlDob = normalizeBdlDob(c.dob, c.age, today);
    if (mlbDob === null || bdlDob === null) {
      // Defer decision — handle in name-only/city tier below
      continue;
    }
    if (bdlDob === mlbDob) dobMatched.push(c);
  }

  // Step 2: If we have exactly one DOB-matching candidate, classify it
  if (dobMatched.length === 1) {
    const c = dobMatched[0]!;
    // Position sanity check — reject if positions clearly differ (e.g.,
    // pitcher vs hitter). For pitcher/pitcher or position/position
    // matches, proceed.
    if (!positionCompatible(c.position_abbr, mlb.primaryPositionAbbr)) {
      return {
        tier: "none",
        reason: "position_mismatch",
        candidates: [bdlCandidateSummary(c)],
      };
    }
    if (namesMatchExact(c, mlb)) {
      return {
        tier: "high",
        bdlId: c.external_id,
        bdlFullName: c.full_name,
        method: "name_dob_v1",
      };
    }
    if (namesMatchVariant(c, mlb)) {
      return {
        tier: "medium",
        bdlId: c.external_id,
        bdlFullName: c.full_name,
        method: "name_dob_variant_v1",
      };
    }
    // Same DOB, completely different name → suspicious; queue for review
    return {
      tier: "low",
      reason: "name_variant_uncertain",
      candidates: [bdlCandidateSummary(c)],
    };
  }

  // Step 3: Multiple DOB matches — queue with all candidates
  if (dobMatched.length >= 2) {
    return {
      tier: "low",
      reason: "multiple_candidates",
      candidates: dobMatched.slice(0, 5).map(bdlCandidateSummary),
    };
  }

  // Step 4: No DOB matches. Try Tier 4 path (DOB missing on one side +
  // name + city match).
  if (mlbDob === null) {
    const cityNorm = normalizeMlbStatsBirthCity(mlb.birthCity);
    const cityMatched = candidates.filter((c) => {
      const cBdlDob = normalizeBdlDob(c.dob, c.age, today);
      if (cBdlDob !== null) return false; // had a DOB but it didn't match — skip
      const cityB = normalizeBdlBirthCity(c.birth_place);
      return (
        cityNorm !== null &&
        cityB !== null &&
        cityNorm === cityB &&
        namesMatchExact(c, mlb)
      );
    });
    if (cityMatched.length === 1) {
      return {
        tier: "low",  // Tier 4 — auto-write disabled per plan
        reason: "dob_missing_one_side",
        candidates: [bdlCandidateSummary(cityMatched[0]!)],
      };
    }
  }

  // Step 5: Nothing matched. Return "none" with reason.
  return {
    tier: "none",
    reason: mlbDob === null ? "dob_missing_one_side" : "dob_mismatch",
    candidates: candidates.slice(0, 5).map(bdlCandidateSummary),
  };
}

function bdlCandidateSummary(c: BdlCandidate): {
  bdl_id: number;
  name: string;
  dob: string | null;
  team: string | null;
} {
  return {
    bdl_id: c.external_id,
    name: c.full_name,
    dob: c.dob,
    team: c.team_abbreviation,
  };
}

// ─────────────────────────────────────────────────────────────────────
// JSONB shape builders (pure)
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the `provider_ids.mlb_stats` block. Always present once a player
 * is matched against MLB Stats.
 */
export function buildMlbStatsBlock(
  mlbId: number,
  now: Date = new Date()
): { id: number; last_seen_at: string } {
  return { id: mlbId, last_seen_at: now.toISOString() };
}

/**
 * Build the `provider_ids.bdl` block for an auto-write (Tier 1/2).
 */
export function buildBdlBlock(
  match: Extract<MatchResult, { tier: "high" | "medium" }>,
  now: Date = new Date()
): {
  id: number;
  mapped_via: string;
  confidence: "high" | "medium";
  mapped_at: string;
} {
  return {
    id: match.bdlId,
    mapped_via: match.method,
    confidence: match.tier,
    mapped_at: now.toISOString(),
  };
}

/**
 * Build the `provider_ids.unresolved_bdl` block for queue entries
 * (Tier 3/4/none).
 */
export function buildUnresolvedBdlBlock(
  match: Extract<MatchResult, { tier: "low" | "none" }>,
  now: Date = new Date()
): {
  reason: UnresolvedReason;
  last_attempt_at: string;
  candidates: Array<{
    bdl_id: number;
    name: string;
    dob: string | null;
    team: string | null;
  }>;
} {
  return {
    reason: match.reason,
    last_attempt_at: now.toISOString(),
    candidates: match.candidates,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Service surface — DI-friendly + write-gated
// ─────────────────────────────────────────────────────────────────────

/**
 * Dependencies needed to map one player end-to-end. Tests provide
 * stubs; production passes real providers.
 */
export type ProviderMappingDeps = {
  /** Search BDL by name; typically `BallDontLieProvider.searchPlayersByName`. */
  searchBdlByName: (query: string) => Promise<BdlCandidate[]>;
  /**
   * Optionally fetch a fresh MLB Stats profile by id. Used when the
   * caller has only an mlb_person_id and wants the matcher to drive
   * the search-step too. Tests can stub this with a fixture.
   */
  getMlbPersonById?: (id: number) => Promise<MlbPersonProfile | null>;
};

/**
 * High-level mapping orchestrator for ONE player.
 *
 * Caller workflow: provide an MLB Stats profile (canonical side), let
 * the service search BDL by last name and produce a MatchResult plus
 * the JSONB delta that would be written.
 *
 * NEVER writes to the DB itself — the caller decides whether to apply
 * based on the explicit operator gate (see `backfill-provider-mappings`).
 */
export async function attemptMatchForPlayer(
  mlb: MlbPersonProfile,
  deps: ProviderMappingDeps,
  today: Date = new Date()
): Promise<{
  match: MatchResult;
  proposedProviderIds: Record<string, unknown>;
}> {
  // Prefer last-name as the search term — BDL's /players?search=<X>
  // returns all players whose name contains X. Last name is most
  // distinctive.
  const lastName = mlb.lastName ?? mlb.useLastName ?? "";
  const fallback = lastName === "" ? mlb.fullName : lastName;
  let candidates = await deps.searchBdlByName(fallback);
  // Accent-fold retry: BDL's `?search=` does not match accent variants.
  // If MLB's lastName has accents (e.g. "Acuña", "López") and the first
  // search comes back empty, retry with the folded form.
  if (candidates.length === 0) {
    const folded = fallback
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
    if (folded !== fallback) {
      candidates = await deps.searchBdlByName(folded);
    }
  }
  const match = attemptMatch(mlb, candidates, today);

  const mlbStatsBlock = buildMlbStatsBlock(mlb.id, today);
  const proposedProviderIds: Record<string, unknown> = {
    mlb_stats: mlbStatsBlock,
  };
  if (match.tier === "high" || match.tier === "medium") {
    proposedProviderIds.bdl = buildBdlBlock(match, today);
  } else if (match.tier === "low" || match.tier === "none") {
    proposedProviderIds.unresolved_bdl = buildUnresolvedBdlBlock(match, today);
  }
  return { match, proposedProviderIds };
}

/**
 * Write the proposed provider_ids JSONB to a `players` row by db id.
 * Two-key gated by the operator script: never called unless --apply
 * and PROVIDER_MAPPING_DB_WRITES_ENABLED=true.
 *
 * Merges with existing provider_ids: preserves keys we didn't compute
 * (so a manual mlb_stats override stays put) and only overrides the
 * keys present in `proposedProviderIds`.
 */
export async function writeMapping(
  client: SupabaseClient,
  playerId: number,
  proposedProviderIds: Record<string, unknown>
): Promise<void> {
  // Read-then-merge to preserve operator overrides. The read is cheap
  // (one row by primary key). If the row is gone, throw — we don't
  // create players here.
  const { data, error: readErr } = await client
    .from("players")
    .select("provider_ids")
    .eq("id", playerId)
    .maybeSingle();
  if (readErr) {
    throw new Error(
      `providerMappingService.writeMapping read failed (id=${playerId}): ${readErr.message}`
    );
  }
  if (data === null) {
    throw new Error(
      `providerMappingService.writeMapping: player id=${playerId} not found`
    );
  }
  const existing =
    (data.provider_ids as Record<string, unknown> | null) ?? {};
  const merged = { ...existing, ...proposedProviderIds };
  // If we wrote a real `bdl` block, drop any prior `unresolved_bdl`
  // (and vice versa — a fresh unresolved_bdl supersedes whatever was
  // there).
  if ("bdl" in proposedProviderIds && "unresolved_bdl" in merged) {
    delete merged.unresolved_bdl;
  }
  if ("unresolved_bdl" in proposedProviderIds && "bdl" in merged) {
    // Defensive — should not happen because attemptMatch never emits
    // both blocks; but if a future op manually wrote `bdl` and the
    // matcher subsequently queues an unresolved, keep the manual bdl.
    delete merged.unresolved_bdl;
  }
  const { error: updErr } = await client
    .from("players")
    .update({ provider_ids: merged })
    .eq("id", playerId);
  if (updErr) {
    throw new Error(
      `providerMappingService.writeMapping update failed (id=${playerId}): ${updErr.message}`
    );
  }
}
