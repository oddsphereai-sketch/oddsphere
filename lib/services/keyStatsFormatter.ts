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
export type KeyStatsDisplayFallbacks = {
  awayTeamOpsProxy?: number | null;
  homeTeamOpsProxy?: number | null;
  /** Human-readable, game-time forecast captured with this prediction. */
  gameTimeWeather?: string | null;
};

/**
 * Labels that are inherently two-sided (one value per team). The Key Stats
 * UI must render BOTH team rows whenever at least one side has a value, so
 * a missing/unavailable side shows "TEAM —" rather than collapsing to a
 * single dangling unlabeled number (the ATL@NYM 2026-06-12 bug). Shared
 * with DailyEdgeShell's interpretKeyStat so the renderer and formatter
 * agree on what "two-sided" means.
 */
export const TWO_SIDED_KEY_STAT_LABELS: ReadonlySet<string> = new Set([
  "Starter ERA",
  "Lineup OPS (weighted)",
  "Bullpen quality",
  "Lineup vs starter",
  "Starter 1st-inning ERA",
  "Starter 1st-inning WHIP",
  "Top-of-order OPS",
  "Starter ERA (season)",
]);

/**
 * True when a Key Stats row should render as two team-labeled rows.
 * Two-sided labels render two-sided as long as ONE side has a value
 * (missing side → "—"); all other labels are two-sided only when both
 * sides are present.
 */
export function keyStatIsTwoSided(
  label: string,
  awayValue: string | null,
  homeValue: string | null
): boolean {
  if (TWO_SIDED_KEY_STAT_LABELS.has(label)) {
    return awayValue !== null || homeValue !== null;
  }
  return awayValue !== null && homeValue !== null;
}

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

function moneylineRows(af: AutoFactors, fallbacks: KeyStatsDisplayFallbacks): KeyStatRow[] {
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
  const aOpsProxy = num(fallbacks.awayTeamOpsProxy);
  const hOpsProxy = num(fallbacks.homeTeamOpsProxy);
  if (aOps !== null || hOps !== null || aOpsProxy !== null || hOpsProxy !== null) {
    rows.push({
      label: "Lineup OPS (weighted)",
      awayValue: aOps !== null ? fmtRaw(aOps, 3) : aOpsProxy !== null ? `${aOpsProxy.toFixed(3)} team proxy` : null,
      homeValue: hOps !== null ? fmtRaw(hOps, 3) : hOpsProxy !== null ? `${hOpsProxy.toFixed(3)} team proxy` : null,
      source: "feature_snapshot",
    });
  }

  // Row 3 — Bullpen factor (beginner-friendly)
  //
  // When a raw factor is PRESENT but out of the trusted [0.5, 2.0] range
  // (fmtFactor → null, e.g. ATL/NYM's 0.47/0.468 on 2026-06-12), surface
  // an honest "—" for that side instead of letting both-null collapse drop
  // the entire row. This keeps the Bullpen Quality slot structurally
  // consistent across games rather than silently vanishing on anomalous
  // data — without inventing a misleading "% better than league" figure.
  // A genuinely absent side (raw null) stays null and renders as "—" too.
  const aBp = num(af.away_bullpen_factor);
  const hBp = num(af.home_bullpen_factor);
  if (aBp !== null || hBp !== null) {
    rows.push({
      label: "Bullpen quality",
      awayValue: aBp !== null ? (fmtFactor(aBp, "worse_pitching") ?? "—") : null,
      homeValue: hBp !== null ? (fmtFactor(hBp, "worse_pitching") ?? "—") : null,
      source: "computed",
    });
  }

  return rows;
}

function totalRows(af: AutoFactors, fallbacks: KeyStatsDisplayFallbacks): KeyStatRow[] {
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

  // Row 2 — actual game-time weather when the prediction snapshot carries it.
  // The run adjustment is model plumbing, not useful weather information for
  // a member. Keep it only as a legacy fallback for older snapshots.
  const weather = num(af.weather_total_adjust);
  if (fallbacks.gameTimeWeather) {
    rows.push({
      label: "Game-time weather",
      awayValue: null,
      homeValue: fallbacks.gameTimeWeather,
      source: "feature_snapshot",
    });
  } else if (weather !== null) {
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

function firstInningRows(af: AutoFactors, fallbacks: KeyStatsDisplayFallbacks): KeyStatRow[] {
  const rows: KeyStatRow[] = [];

  // Row 1 — Projected first-inning runs (model output, unchanged).
  // Phase 6B.1.6j: append "combined" suffix to clarify this is the
  // single combined first-inning expected-runs estimate (NOT a per-
  // team value).
  const nrfiRuns = num(af.nrfi_expected_runs);
  if (nrfiRuns !== null) {
    rows.push({
      label: "Projected 1st-inning runs",
      awayValue: null,
      homeValue: `${fmtRaw(nrfiRuns, 2)} combined`,
      source: "feature_snapshot",
    });
  }

  // Row 2 — Starter 1st-inning ERA per starter, with sample-size
  // footnote. Sourced from auto_factors.{home,away}_first_inning_era
  // (added 2026-06-02). Only shown when at least one starter has FI
  // data; falls back gracefully when both are missing (Row 5 below
  // catches that case with full-season ERA).
  //
  // Phase 6B.1.6j: when only one starter has FI data, the missing
  // side gets an explicit "no FI sample" sentinel instead of null so
  // the UI's two-sided team-labeled renderer fires and shows
  //   CLE  5.25 (12 starts)
  //   TEX  no FI sample
  // instead of a bare "5.25 (12 starts)" with no team attribution.
  const aFiEra = num(af.away_first_inning_era);
  const hFiEra = num(af.home_first_inning_era);
  const aFiStarts = num(af.away_first_inning_starts);
  const hFiStarts = num(af.home_first_inning_starts);
  if (aFiEra !== null || hFiEra !== null) {
    rows.push({
      label: "Starter 1st-inning ERA",
      awayValue: fmtFiStarterValue(aFiEra, aFiStarts, 2) ?? "no FI sample",
      homeValue: fmtFiStarterValue(hFiEra, hFiStarts, 2) ?? "no FI sample",
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
      awayValue: fmtFiStarterValue(aFiWhip, aFiStarts, 2) ?? "no FI sample",
      homeValue: fmtFiStarterValue(hFiWhip, hFiStarts, 2) ?? "no FI sample",
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
  const aTopOpsProxy = num(fallbacks.awayTeamOpsProxy);
  const hTopOpsProxy = num(fallbacks.homeTeamOpsProxy);
  if (aTopOps !== null || hTopOps !== null || aTopOpsProxy !== null || hTopOpsProxy !== null) {
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
      // Phase 6B.1.6j: explicit per-side sentinel so renderer shows
      // both team labels even when one side has no top-order data.
      awayValue: aTopOps !== null ? `${aTopOps.toFixed(3)}${awayContext}` : aTopOpsProxy !== null ? `${aTopOpsProxy.toFixed(3)} team OPS proxy` : "no OPS sample",
      homeValue: hTopOps !== null ? `${hTopOps.toFixed(3)}${homeContext}` : hTopOpsProxy !== null ? `${hTopOpsProxy.toFixed(3)} team OPS proxy` : "no OPS sample",
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
  const aSe = num(af.away_starter_era);
  const hSe = num(af.home_starter_era);
  if (aFiEra === null && hFiEra === null) {
    if (aSe !== null || hSe !== null) {
      rows.push({
        label: "Starter ERA (season)",
        // Phase 6B.1.6j: explicit per-side fallback so missing-side
        // gets a team-labeled "—" row instead of disappearing.
        awayValue: fmtRaw(aSe, 2) ?? "no season ERA",
        homeValue: fmtRaw(hSe, 2) ?? "no season ERA",
        source: "feature_snapshot",
      });
    }
  }

  // Push 3B-7 follow-up (Phase 6B.1.6i): partial-data placeholder.
  //
  // MIL@COL surfaced a UI bug where one starter (Misiorowski) had no
  // season ERA AND no FI ERA, so the row showed "1.65 / —" for the
  // other side and nothing at all for him. Worse, when all starter
  // values were null, the FI panel disappeared entirely under the
  // "fewer than 2 rows" threshold.
  //
  // When pitcher data is partially or fully missing, surface an
  // explicit unavailable marker (per side) instead of going silent.
  // The format honors the row's awayValue/homeValue contract so the
  // existing team-column rendering in DailyEdgeShell renders it
  // correctly with team abbreviations as column headers.
  const aHasAnyPitcherStat = aFiEra !== null || aFiWhip !== null || aSe !== null;
  const hHasAnyPitcherStat = hFiEra !== null || hFiWhip !== null || hSe !== null;
  if (!aHasAnyPitcherStat || !hHasAnyPitcherStat) {
    rows.push({
      label: "Starter data status",
      awayValue: aHasAnyPitcherStat ? "available" : "unavailable",
      homeValue: hHasAnyPitcherStat ? "available" : "unavailable",
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
  market: KeyStatsMarket,
  displayFallbacks: KeyStatsDisplayFallbacks = {},
): KeyStatRow[] {
  if (autoFactors === null || autoFactors === undefined) return [];

  let rows: KeyStatRow[];
  if (market === "moneyline") rows = moneylineRows(autoFactors, displayFallbacks);
  else if (market === "total") rows = totalRows(autoFactors, displayFallbacks);
  else rows = firstInningRows(autoFactors, displayFallbacks);

  // Drop rows where BOTH away and home values are null (no data at all)
  rows = rows.filter((r) => r.awayValue !== null || r.homeValue !== null);

  // UI rule: hide the KeyStats panel if fewer than 2 rows survive —
  // EXCEPT for first_inning, where surfacing even a single row (e.g.,
  // the projected-runs row alongside the new "Starter data status"
  // placeholder) is preferable to hiding the panel entirely on
  // partial-data games like MIL@COL.
  if (rows.length < 2 && market !== "first_inning") return [];
  if (rows.length === 0) return [];

  // Defense in depth: lint each label (factual stat labels, but a future
  // edit could accidentally introduce a banned term)
  for (const r of rows) assertNoBannedTerms(r.label, "keyStat.label");

  return rows;
}
