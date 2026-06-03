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

/**
 * Sample-size gate mirroring FIRST_INNING_SAMPLE_GATE in
 * lib/automodel/mlbAutoModelV1.ts. Per-starter FI ERA / WHIP rows are
 * only shown at full confidence when starts ≥ this threshold. Kept in
 * sync with the model gate so the UI never represents a value the
 * model itself would have gated.
 */
const FI_UI_SAMPLE_GATE = 3;

/**
 * Format a per-starter raw stat with a small "(N starts)" sample-size
 * footnote, OR a "(thin sample · N starts)" badge when the starter is
 * below the gate, OR null when no value at all. Used by the FI ERA and
 * FI WHIP rows so users always see how much data backs each number.
 */
function fmtFiStarterValue(
  rawValue: number | null,
  starts: number | null,
  decimals: number
): string | null {
  if (rawValue === null) return null;
  const startsStr = starts !== null && starts > 0
    ? ` (${starts} ${starts === 1 ? "start" : "starts"})`
    : "";
  // Below-gate: show value with explicit "thin sample" flag so users
  // don't over-weight a tiny-sample number.
  if (starts !== null && starts > 0 && starts < FI_UI_SAMPLE_GATE) {
    return `${rawValue.toFixed(decimals)} (thin sample · ${starts} ${starts === 1 ? "start" : "starts"})`;
  }
  return `${rawValue.toFixed(decimals)}${startsStr}`;
}

function firstInningRows(af: AutoFactors): KeyStatRow[] {
  const rows: KeyStatRow[] = [];

  // Row 1 — Projected first-inning runs (model output, unchanged)
  const nrfiRuns = num(af.nrfi_expected_runs);
  if (nrfiRuns !== null) {
    rows.push({
      label: "Projected 1st-inning runs",
      awayValue: null,
      homeValue: fmtRaw(nrfiRuns, 2),
      source: "feature_snapshot",
    });
  }

  // Row 2 — Starter 1st-inning ERA per starter, with sample-size
  // footnote. Sourced from auto_factors.{home,away}_first_inning_era
  // (added 2026-06-02). Only shown when at least one starter has FI
  // data; falls back gracefully when both are missing (Row 5 below
  // catches that case with full-season ERA).
  const aFiEra = num(af.away_first_inning_era);
  const hFiEra = num(af.home_first_inning_era);
  const aFiStarts = num(af.away_first_inning_starts);
  const hFiStarts = num(af.home_first_inning_starts);
  if (aFiEra !== null || hFiEra !== null) {
    rows.push({
      label: "Starter 1st-inning ERA",
      awayValue: fmtFiStarterValue(aFiEra, aFiStarts, 2),
      homeValue: fmtFiStarterValue(hFiEra, hFiStarts, 2),
      source: "feature_snapshot",
    });
  }

  // Row 3 — Starter 1st-inning WHIP per starter, with sample-size
  // footnote. Model-consumed since Phase 4.1.12 (FI WHIP modifier).
  const aFiWhip = num(af.away_first_inning_whip);
  const hFiWhip = num(af.home_first_inning_whip);
  if (aFiWhip !== null || hFiWhip !== null) {
    rows.push({
      label: "Starter 1st-inning WHIP",
      awayValue: fmtFiStarterValue(aFiWhip, aFiStarts, 2),
      homeValue: fmtFiStarterValue(hFiWhip, hFiStarts, 2),
      source: "feature_snapshot",
    });
  }

  // Row 4 — Top-of-order OPS (actual values, not just a boolean flag).
  // Sourced from auto_factors.{home,away}_top_order_ops (added
  // 2026-06-02). The model uses handedness-aware top-3 OPS vs the
  // OPPOSING starter, so a small "vs RHP" / "vs LHP" hint clarifies
  // what each side's value represents when we know the opposing
  // starter's throws.
  const aTopOps = num(af.away_top_order_ops);
  const hTopOps = num(af.home_top_order_ops);
  if (aTopOps !== null || hTopOps !== null) {
    const homeThrows = af.home_starter_throws;
    const awayThrows = af.away_starter_throws;
    // The HOME lineup faces the AWAY starter; if we know the away
    // starter's throws, we can add "vs LHP" / "vs RHP" as context on
    // the home row (and vice versa).
    const homeContext =
      awayThrows === "L" ? " vs LHP" : awayThrows === "R" ? " vs RHP" : "";
    const awayContext =
      homeThrows === "L" ? " vs LHP" : homeThrows === "R" ? " vs RHP" : "";
    rows.push({
      label: "Top-of-order OPS",
      awayValue: aTopOps !== null ? `${aTopOps.toFixed(3)}${awayContext}` : null,
      homeValue: hTopOps !== null ? `${hTopOps.toFixed(3)}${homeContext}` : null,
      source: "feature_snapshot",
    });
  }

  // Row 5 — Full-season Starter ERA, ONLY as fallback when neither
  // starter has FI ERA data ingested. When real FI data is available
  // for either side, the FI ERA row above is the more honest signal
  // and the full-season row would just be noise. Sample-gate concerns
  // around showing thin FI data still produce the row above with a
  // "(thin sample)" footnote, so this fallback fires strictly on the
  // "no FI data at all" path.
  if (aFiEra === null && hFiEra === null) {
    const aSe = num(af.away_starter_era);
    const hSe = num(af.home_starter_era);
    if (aSe !== null || hSe !== null) {
      rows.push({
        label: "Starter ERA (season)",
        awayValue: fmtRaw(aSe, 2),
        homeValue: fmtRaw(hSe, 2),
        source: "feature_snapshot",
      });
    }
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
