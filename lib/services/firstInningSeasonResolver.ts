/**
 * Phase 4.2.C.1.H-6.3b — pure season-resolver for the FI backfill
 * operator.
 *
 * Replaces the operator's prior "if --season is missing, error" logic
 * with a stage-aware resolver that:
 *
 *   • defaults season from `--slate-date`'s year when the flag is
 *     omitted (the common case in production — slate year and stats
 *     year always align),
 *   • requires explicit `--season` when no slate date is given
 *     (legitimate historical-backfill case),
 *   • rejects a mismatch between `--slate-date`'s year and an explicit
 *     `--season` value (the H-6.3 bug shape: writing 2025-source data
 *     to a 2026 slate by accident), unless the operator explicitly
 *     opts in via `--allow-season-mismatch`.
 *
 * Pure (no I/O). Unit-tested via `scripts/test-fi-backfill-season.ts`.
 *
 * Why this exists: in H-5.6 the operator was run with `--season 2025`
 * against a `2026-MM-DD` slate (test-environment clock skew). The
 * resulting rows landed under season=2025 while `featureSnapshot`
 * queried season=2026, causing every NRFI to hard-hold. H-6.3a fixed
 * the data; this helper closes the gap so the same mistake can't be
 * made silently again. The mismatch error is loud on purpose.
 */

export type SeasonResolutionSource =
  | "explicit_flag"
  | "derived_from_slate_date"
  | "matched_explicit_and_slate"
  | "mismatch_override";

export type SeasonResolution =
  | { kind: "ok"; season: number; source: SeasonResolutionSource }
  | { kind: "error"; message: string };

const MIN_SEASON = 2020;
const MAX_SEASON = 2099;

/**
 * Parse a `--slate-date YYYY-MM-DD` string and extract the calendar
 * year. Returns null on any malformed input (the operator's date
 * format check runs elsewhere; this helper only cares about the year).
 */
function extractYearFromSlateDate(slateDate: string | undefined): number | null {
  if (slateDate === undefined) return null;
  const m = slateDate.match(/^(\d{4})-\d{2}-\d{2}$/);
  if (m === null) return null;
  const y = parseInt(m[1]!, 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * Parse a `--season YYYY` flag. Returns:
 *   • a number when the flag is omitted or valid,
 *   • `"invalid"` when the flag is present but doesn't parse to an
 *     in-range year.
 */
function parseSeasonFlag(
  raw: string | undefined
): number | null | "invalid" {
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return "invalid";
  if (n < MIN_SEASON || n > MAX_SEASON) return "invalid";
  return n;
}

/**
 * Pure season-resolution helper for the FI backfill operator. See the
 * file-level docstring for the rationale.
 *
 * Behavior matrix:
 *   slate-date | --season | --allow-mismatch | result
 *   ───────────┼──────────┼──────────────────┼─────────────────────
 *   absent     | absent   | n/a              | ERROR (no source)
 *   absent     | invalid  | n/a              | ERROR (invalid flag)
 *   absent     | valid    | n/a              | ok / explicit_flag
 *   present    | absent   | n/a              | ok / derived_from_slate_date
 *   present    | invalid  | n/a              | ERROR (invalid flag)
 *   present    | valid (= slate year) | n/a   | ok / matched_explicit_and_slate
 *   present    | valid (≠ slate year) | false | ERROR (mismatch)
 *   present    | valid (≠ slate year) | true  | ok / mismatch_override (--season wins)
 *
 * On the mismatch-with-override path the explicit `--season` value
 * wins (caller's intent is explicit and acknowledged); the source
 * tag carries `mismatch_override` so the operator's banner can flag
 * it for downstream auditors.
 */
export function resolveOperatorSeason(opts: {
  slateDate: string | undefined;
  seasonFlag: string | undefined;
  allowMismatch: boolean;
}): SeasonResolution {
  const slateYear = extractYearFromSlateDate(opts.slateDate);
  const flagSeason = parseSeasonFlag(opts.seasonFlag);

  // Case: explicit --season flag is present but malformed
  if (flagSeason === "invalid") {
    return {
      kind: "error",
      message:
        `Invalid --season "${opts.seasonFlag}". Expected a 4-digit year ` +
        `between ${MIN_SEASON} and ${MAX_SEASON}.`,
    };
  }

  // Case: neither source available
  if (slateYear === null && flagSeason === null) {
    return {
      kind: "error",
      message:
        "Missing season. Provide --season <YYYY> explicitly, OR provide " +
        "--slate-date <YYYY-MM-DD> to default season from the slate's year.",
    };
  }

  // Case: slate-date only → default from slate year
  if (slateYear !== null && flagSeason === null) {
    return {
      kind: "ok",
      season: slateYear,
      source: "derived_from_slate_date",
    };
  }

  // Case: explicit flag only → use the flag
  if (slateYear === null && typeof flagSeason === "number") {
    return {
      kind: "ok",
      season: flagSeason,
      source: "explicit_flag",
    };
  }

  // Case: both present — match or mismatch
  if (slateYear !== null && typeof flagSeason === "number") {
    if (slateYear === flagSeason) {
      return {
        kind: "ok",
        season: flagSeason,
        source: "matched_explicit_and_slate",
      };
    }
    if (opts.allowMismatch) {
      return {
        kind: "ok",
        season: flagSeason,
        source: "mismatch_override",
      };
    }
    return {
      kind: "error",
      message:
        `Season mismatch: --slate-date "${opts.slateDate}" implies season=` +
        `${slateYear}, but --season=${flagSeason} was passed.\n` +
        `  This is the bug shape that caused the H-6.3 wrong-season write\n` +
        `  (slate filed in 2026 but FI rows written under 2025 →\n` +
        `  featureSnapshot.deriveSeason found no row → every NRFI held).\n` +
        `  If you intentionally want to write under year ${flagSeason},\n` +
        `  re-run with --allow-season-mismatch (the override is loud on\n` +
        `  purpose so audit logs surface the intent).`,
    };
  }

  // Defensive — unreachable per the type analysis above.
  return { kind: "error", message: "Unexpected season resolution state" };
}
