/**
 * keyStatsFormatter — turns `game_predictions.sport_specific.auto_factors`
 * into 2-3 beginner-friendly stat rows per market for the v13.1 Daily Edge
 * KeyStats panel.
 *
 * Per Daniel's 4.1.10 adjustment #5: format for beginners; do not show
 * raw multipliers like 1.08. Factors are translated to "% vs league
 * average" phrasing.
 *
 * Rules:
 *   - Each market has a fixed 3-row template
 *   - Rows with no underlying data are OMITTED
 *   - If fewer than 2 rows remain after omissions, return [] (UI hides
 *     the panel entirely for that market)
 *   - Output passes through bannedTermsLinter on each label
 */

import { assertNoBannedTerms } from "./bannedTermsLinter";

export type KeyStatRow = {
  label: string;
  awayValue: string | null;
  homeValue: string | null;
  source: "feature_snapshot" | "computed";
};

export type AutoFactors = Record<string, unknown>;
export type KeyStatsMarket = "moneyline" | "total" | "first_inning";

// ───────────────────────────────────────────────────────────────────
// Value helpers
// ───────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

/** Format a 0-tier raw stat with N decimals, e.g. ERA = 3.42. */
function fmtRaw(v: number | null, decimals: number, suffix = ""): string | null {
  if (v === null) return null;
  return `${v.toFixed(decimals)}${suffix}`;
}

/**
 * Translate a "factor" multiplier into beginner-friendly relative phrasing.
 * Convention (matches auto-model semantics):
 *   factor > 1.00 → MORE runs / WORSE for run prevention
 *   factor < 1.00 → FEWER runs / BETTER for run prevention
 *
 * Caller passes `direction` so the phrasing matches what beginners expect:
 *   direction="more_runs":   1.08 → "+8% runs"        (used for park, hitter context)
 *   direction="worse_pitching": 1.08 → "8% worse than league avg"  (used for bullpen / starter)
 */
function fmtFactor(
  v: number | null,
  direction: "more_runs" | "worse_pitching" | "lineup_strength"
): string | null {
  if (v === null) return null;
  // Defensive sanity clamp: real MLB factors live in [0.5, 2.0]. Anything
  // outside that range almost certainly indicates a data shape issue (e.g.,
  // a stored raw percentage like 102 instead of the multiplier 1.02). Return
  // null so the row falls back to "no data shown" rather than producing
  // misleading copy like "+10100% runs".
  if (!Number.isFinite(v) || v < 0.5 || v > 2.0) return null;
  const pct = Math.round((v - 1) * 100);
  if (direction === "more_runs") {
    if (pct === 0) return "neutral";
    return pct > 0 ? `+${pct}% runs` : `${pct}% runs`;
  }
  if (direction === "worse_pitching") {
    if (pct === 0) return "league average";
    return pct > 0 ? `${pct}% worse than league avg` : `${Math.abs(pct)}% better than league avg`;
  }
  // lineup_strength: higher factor = stronger lineup
  if (pct === 0) return "league average";
  return pct > 0 ? `${pct}% stronger than league avg` : `${Math.abs(pct)}% weaker than league avg`;
}

/** Format a small additive run-delta from weather_total_adjust (typically -1 to +1). */
function fmtWeatherDelta(v: number | null): string | null {
  if (v === null) return null;
  if (Math.abs(v) < 0.05) return "neutral";
  const rounded = (Math.round(v * 10) / 10).toFixed(1);
  return v > 0 ? `+${rounded} runs` : `${rounded} runs`;
}

// ───────────────────────────────────────────────────────────────────
// Per-market builders
// ───────────────────────────────────────────────────────────────────

function moneylineRows(af: AutoFactors): KeyStatRow[] {
  const rows: KeyStatRow[] = [];

  // Row 1 — Starter ERA (raw)
  const aSe = num(af.away_starter_era);
  const hSe = num(af.home_starter_era);
  if (aSe !== null || hSe !== null) {
    rows.push({
      label: "Starter ERA",
      awayValue: fmtRaw(aSe, 2),
      homeValue: fmtRaw(hSe, 2),
      source: "feature_snapshot",
    });
  }

  // Row 2 — Lineup weighted OPS (raw)
  const aOps = num(af.away_lineup_weighted_ops);
  const hOps = num(af.home_lineup_weighted_ops);
  if (aOps !== null || hOps !== null) {
    rows.push({
      label: "Lineup OPS (weighted)",
      awayValue: fmtRaw(aOps, 3),
      homeValue: fmtRaw(hOps, 3),
      source: "feature_snapshot",
    });
  }

  // Row 3 — Bullpen factor (beginner-friendly)
  const aBp = num(af.away_bullpen_factor);
  const hBp = num(af.home_bullpen_factor);
  if (aBp !== null || hBp !== null) {
    rows.push({
      label: "Bullpen quality",
      awayValue: fmtFactor(aBp, "worse_pitching"),
      homeValue: fmtFactor(hBp, "worse_pitching"),
      source: "computed",
    });
  }

  return rows;
}

function totalRows(af: AutoFactors): KeyStatRow[] {
  const rows: KeyStatRow[] = [];

  // Row 1 — Park factor (single value, not split home/away)
  const park = num(af.park_factor_runs);
  if (park !== null) {
    rows.push({
      label: "Park factor",
      awayValue: null,
      homeValue: fmtFactor(park, "more_runs"),
      source: "computed",
    });
  }

  // Row 2 — Weather adjust (single value)
  const weather = num(af.weather_total_adjust);
  if (weather !== null) {
    rows.push({
      label: "Weather adjust",
      awayValue: null,
      homeValue: fmtWeatherDelta(weather),
      source: "computed",
    });
  }

  // Row 3 — Lineup vs starter context (combined factor; one value per side)
  const aLs = num(af.away_lineup_ops_factor_adjusted);
  const hLs = num(af.home_lineup_ops_factor_adjusted);
  if (aLs !== null || hLs !== null) {
    rows.push({
      label: "Lineup vs starter",
      awayValue: fmtFactor(aLs, "lineup_strength"),
      homeValue: fmtFactor(hLs, "lineup_strength"),
      source: "computed",
    });
  }

  return rows;
}

function firstInningRows(af: AutoFactors): KeyStatRow[] {
  const rows: KeyStatRow[] = [];

  // Row 1 — Projected first-inning runs (raw)
  const nrfiRuns = num(af.nrfi_expected_runs);
  if (nrfiRuns !== null) {
    rows.push({
      label: "Projected 1st-inning runs",
      awayValue: null,
      homeValue: fmtRaw(nrfiRuns, 2),
      source: "feature_snapshot",
    });
  }

  // Row 2 — Top-of-order data flag (boolean)
  const topOrder = bool(af.nrfi_used_top_of_order_data);
  if (topOrder !== null) {
    rows.push({
      label: "Top-of-order data",
      awayValue: null,
      homeValue: topOrder ? "Available" : "Unavailable",
      source: "feature_snapshot",
    });
  }

  // Row 3 — Starter ERA (same as moneyline row 1; useful for FI context)
  const aSe = num(af.away_starter_era);
  const hSe = num(af.home_starter_era);
  if (aSe !== null || hSe !== null) {
    rows.push({
      label: "Starter ERA",
      awayValue: fmtRaw(aSe, 2),
      homeValue: fmtRaw(hSe, 2),
      source: "feature_snapshot",
    });
  }

  return rows;
}

// ───────────────────────────────────────────────────────────────────
// Main entry
// ───────────────────────────────────────────────────────────────────

export function formatKeyStats(
  autoFactors: AutoFactors | null | undefined,
  market: KeyStatsMarket
): KeyStatRow[] {
  if (autoFactors === null || autoFactors === undefined) return [];

  let rows: KeyStatRow[];
  if (market === "moneyline") rows = moneylineRows(autoFactors);
  else if (market === "total") rows = totalRows(autoFactors);
  else rows = firstInningRows(autoFactors);

  // Drop rows where BOTH away and home values are null (no data at all)
  rows = rows.filter((r) => r.awayValue !== null || r.homeValue !== null);

  // UI rule: hide the KeyStats panel if fewer than 2 rows survive
  if (rows.length < 2) return [];

  // Defense in depth: lint each label (factual stat labels, but a future
  // edit could accidentally introduce a banned term)
  for (const r of rows) assertNoBannedTerms(r.label, "keyStat.label");

  return rows;
}
