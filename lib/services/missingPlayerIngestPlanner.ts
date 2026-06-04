/**
 * Phase 4.2.C.1.H-2 — pure helper for planning a `players` row insert
 * from an MLB Stats `/people/{id}` profile.
 *
 * Used by the dry-run operator `scripts/operator/ingest-missing-pitchers.ts`
 * and exercised independently by unit tests. No I/O; no DB; no network.
 *
 * Output shape mirrors the exact row payload the operator would pass to
 * `supabase.from("players").insert(...)` if/when the H-3 write phase
 * runs. Keeping the planner pure means we can verify field mapping
 * without any DB writes.
 *
 * Convention (Phase 4.2.C.1.H-0):
 *   • `external_id` is ALWAYS `null` — these are MLB-Stats-only rows.
 *     The future Phase H-4 reconciliation operator will set external_id
 *     when BDL eventually adopts the player.
 *   • `provider_ids.mlb_stats.id` carries the MLB Stats person id alongside
 *     a provenance stamp (`source` + `ingested_at`) so audits can trace
 *     where the row came from.
 *   • `mlb_person_id` (top-level column) duplicates the same id so the
 *     existing partial UNIQUE index (`mlb_person_id IS NOT NULL`) blocks
 *     duplicates and the cheap-join paths in `_idMaps.ts` /
 *     `featureSnapshot.ts` keep working.
 */

import type { MlbPersonProfile } from "../providers/real_api/_mlbStatsApiClient";

// ─── Output shape ────────────────────────────────────────────────────

/**
 * Exact row payload for a `players` INSERT. `external_id` is locked to
 * `null` by the Phase H-0 convention. The shape mirrors what the
 * operator would write — keep field names matching the DB columns so a
 * future writer can pass this object directly to Supabase.
 */
export interface PlannedPlayerInsert {
  external_id: null;
  mlb_person_id: number;
  sport: "mlb";
  team_id: number | null;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string | null;
  position_abbr: string | null;
  is_pitcher: boolean;
  active: boolean;
  bats: "L" | "R" | "S" | null;
  throws: "L" | "R" | null;
  dob: string | null;
  height: string | null;
  weight: string | null;
  birth_place: string | null;
  provider_ids: {
    mlb_stats: {
      id: number;
      ingested_at: string;
      source: "mlb_stats_people_endpoint";
    };
  };
}

export type PlannerSkipReason =
  | "missing_mlb_person_id"
  | "missing_full_name"
  | "missing_position_abbr";

export type PlannerResult =
  | { kind: "plan"; insert: PlannedPlayerInsert }
  | { kind: "skip"; reason: PlannerSkipReason };

// ─── Helpers ──────────────────────────────────────────────────────────

function trimOrNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function isPitcherFromProfile(p: MlbPersonProfile): boolean {
  const abbr = (p.primaryPositionAbbr ?? "").trim().toUpperCase();
  if (abbr === "P" || abbr === "SP" || abbr === "RP") return true;
  const type = (p.primaryPositionType ?? "").trim().toLowerCase();
  return type === "pitcher";
}

function joinBirthPlace(
  city: string | null,
  country: string | null
): string | null {
  const parts: string[] = [];
  const c = trimOrNull(city);
  const k = trimOrNull(country);
  if (c !== null) parts.push(c);
  if (k !== null) parts.push(k);
  return parts.length === 0 ? null : parts.join(", ");
}

// ─── Planner ──────────────────────────────────────────────────────────

/**
 * Build a planned-insert payload from an MLB Stats person profile. Pure.
 *
 * Skip reasons (returned as `{ kind: "skip", reason }`):
 *   • `missing_mlb_person_id`  — `profile.id` is not a finite number
 *   • `missing_full_name`      — `profile.fullName` is empty/whitespace
 *   • `missing_position_abbr`  — no `primaryPositionAbbr`; without a
 *      position we can't decide `is_pitcher` reliably
 *
 * Field mapping notes:
 *   • `first_name` / `last_name` prefer `useName` / `useLastName` (the
 *     name the player actually goes by — e.g. "Andrew" vs the legal
 *     "Michael") and fall back to `firstName` / `lastName`, then to
 *     splitting `fullName`.
 *   • `is_pitcher` is `true` when position_abbr is P/SP/RP OR
 *     `primaryPositionType === "Pitcher"` (defensive — covers MLB Stats
 *     edge cases where one field is set and the other isn't).
 *   • `active` defaults to `true` when MLB Stats returns null —
 *     candidates here are today's probable starters, so "active enough
 *     to be scheduled to pitch" is the safer default for the row.
 *   • `weight` is converted from MLB Stats's numeric → string to match
 *     the DB column type (TEXT).
 *   • `birth_place` joins city + country into "City, COUNTRY".
 */
export function planPlayerInsertFromMlbProfile(
  profile: MlbPersonProfile,
  opts: {
    teamId: number | null;
    ingestedAtIso: string;
  }
): PlannerResult {
  if (typeof profile.id !== "number" || !Number.isFinite(profile.id)) {
    return { kind: "skip", reason: "missing_mlb_person_id" };
  }

  const fullName = trimOrNull(profile.fullName);
  if (fullName === null) {
    return { kind: "skip", reason: "missing_full_name" };
  }

  const positionAbbr = trimOrNull(profile.primaryPositionAbbr);
  if (positionAbbr === null) {
    return { kind: "skip", reason: "missing_position_abbr" };
  }

  // first_name: useName → firstName → fullName.split(" ")[0]
  const firstName =
    trimOrNull(profile.useName) ??
    trimOrNull(profile.firstName) ??
    fullName.split(" ")[0]!;

  // last_name: useLastName → lastName → last token of fullName
  const tokens = fullName.split(" ");
  const lastName =
    trimOrNull(profile.useLastName) ??
    trimOrNull(profile.lastName) ??
    tokens[tokens.length - 1]!;

  const weight =
    typeof profile.weight === "number" && Number.isFinite(profile.weight)
      ? String(profile.weight)
      : null;

  return {
    kind: "plan",
    insert: {
      external_id: null,
      mlb_person_id: profile.id,
      sport: "mlb",
      team_id: opts.teamId,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      position: trimOrNull(profile.primaryPositionName),
      position_abbr: positionAbbr,
      is_pitcher: isPitcherFromProfile(profile),
      active: profile.active === false ? false : true,
      bats: profile.batSideCode,
      throws: profile.pitchHandCode,
      dob: trimOrNull(profile.birthDate),
      height: trimOrNull(profile.height),
      weight,
      birth_place: joinBirthPlace(profile.birthCity, profile.birthCountry),
      provider_ids: {
        mlb_stats: {
          id: profile.id,
          ingested_at: opts.ingestedAtIso,
          source: "mlb_stats_people_endpoint",
        },
      },
    },
  };
}

// ─── Limit truncation ────────────────────────────────────────────────

/**
 * Phase 4.2.C.1.H-3a — pure helper for the operator's `--limit N` flag.
 * Returns the first `limit` elements of the input array; passes the
 * input through when `limit` is `undefined`; returns `[]` when `limit`
 * is `0` or negative.
 *
 * The operator MUST sort its candidates deterministically (e.g. by
 * `mlb_person_id` ascending) BEFORE calling this so that re-running
 * with the same `--limit` always picks the same rows.
 */
export function truncatePlannedInserts<T>(
  rows: ReadonlyArray<T>,
  limit: number | undefined
): T[] {
  if (limit === undefined) return [...rows];
  if (limit <= 0) return [];
  return rows.slice(0, limit);
}
