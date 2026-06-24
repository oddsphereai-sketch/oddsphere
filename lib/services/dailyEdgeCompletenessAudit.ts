/**
 * Phase 6B.30C — Daily Edge Data Completeness Audit (v0).
 *
 * Pure analyzer that takes structured slate inputs and returns a
 * report of completeness red flags. No DB, no env, no network — fully
 * testable via fixture inputs. The companion operator CLI
 * (scripts/operator/audit-daily-edge-completeness.ts) wraps this with
 * real DB queries.
 *
 * Purpose: surface accessible information we are NOT using before the
 * product silently comes up short. The SEA@BAL 2026-06-08 incident
 * was the trigger — Daily Edge had 7 cards while MLB had 8 scheduled
 * games because the orchestrator silently pre-excluded a game whose
 * starter was missing (G2 per-game exclusion). This audit catches
 * that class of bug: a game on the official slate that we either
 * have no prediction for, or a prediction we've broadly fallen back
 * on, or available data that we're not actually consuming.
 *
 * Five categories from the user's spec:
 *   A. Starters       — present/mapped/stats per side
 *   B. Stats          — V2.2 feature counts per game
 *   C. Lines / market — books per market
 *   D. Source/mapping gaps — distinguish "source unavailable" from
 *                            "available but not mapped/used"
 *   E. Guardrail      — red-flag summary the operator can act on
 *
 * The audit does NOT mutate state. It does NOT block writes. It is
 * read-only diagnostic output. Future phase wires it into the
 * orchestrator as a soft-fail signal.
 */

// ─────────────────────────────────────────────────────────────────
// Input shape (pure — caller hydrates from DB)
// ─────────────────────────────────────────────────────────────────

/** Audit-input for a single starter side (home or away). */
export type AuditStarterInput = {
  /** pitcher_id from games.{home,away}_pitcher_id — null when missing. */
  pitcher_id: number | null;
  /** Is this pitcher_id mapped to a players row? Required to be true
   * even if pitcher_id is set, otherwise the model can't use the row. */
  mapped: boolean;
  /**
   * Does this pitcher have a usable player_season_stats row for the season?
   * False can mean either a backfillable gap or a real no-MLB-sample starter.
   * The audit treats mapped/no-stats as no-sample context, not a missing starter.
   */
  season_stats_present: boolean;
  /** Last update timestamp for the starter mapping (ISO 8601), null if
   * the pitcher_id was never set. */
  last_updated_iso: string | null;
};

/** Audit-input for the per-market lines coverage. */
export type AuditLinesInput = {
  ml_books_count: number;
  ou_books_count: number;
  fi_books_count: number;
};

/** V2.2 audit feature counts pulled from sport_specific.v2_2_audit. */
export type AuditFeatureCounts = {
  preferred: number;
  fallback_real: number;
  proxy: number;
  neutral_fallback: number;
  missing: number;
  present: number;
};

/** Audit-input for a single game. */
export type AuditGameInput = {
  game_external_id: number;
  game_id: number;
  matchup: string;
  home: AuditStarterInput;
  away: AuditStarterInput;
  lines: AuditLinesInput;
  /** Does game_predictions have a row for this game? */
  has_prediction: boolean;
  /** From prediction sport_specific — null when has_prediction === false. */
  prediction_tier: "high" | "medium" | "low" | "fallback" | null;
  prediction_provisional: boolean | null;
  prediction_held: boolean;
  prediction_hold_picks: ReadonlyArray<"ml" | "ou" | "nrfi">;
  feature_counts: AuditFeatureCounts | null;
};

/** Slate-level audit input. */
export type DailyEdgeCompletenessInput = {
  sport: "mlb";
  slate_date: string;
  games: ReadonlyArray<AuditGameInput>;
  /**
   * Threshold for "broad neutral fallback usage" red flag. When a
   * single game's `feature_counts.neutral_fallback` exceeds this, the
   * audit flags it. Default: 3 (any more than 3 broad neutral fallbacks
   * means the model is leaning hard on league-average defaults).
   */
  neutral_fallback_threshold?: number;
};

// ─────────────────────────────────────────────────────────────────
// Output shape
// ─────────────────────────────────────────────────────────────────

/** Per-side starter status with policy-relevant classification. */
export type AuditStarterStatus =
  | "present_mapped_with_stats"
  | "present_mapped_no_mlb_sample"
  | "present_unmapped" // pitcher_id set but no players row → ingestion gap
  | "missing_source_unavailable"; // pitcher_id is null

/** Per-market lines status. */
export type AuditLinesStatus =
  | "complete" // all three markets have books
  | "partial" // 1-2 markets have books
  | "missing_all"; // 0 markets have books

/** Combined per-game classification used in the slate summary. */
export type AuditGameClassification =
  | "ready" // both starters mapped + stats + lines + prediction tier ≥ low
  | "provisional_fallback" // tier="fallback" + provisional=true → V2.2 real-data fallback
  | "pending_one_starter" // single-side starter missing
  | "pending_both_starters" // both starters missing
  | "pending_lines" // lines completely missing
  | "no_prediction"; // game exists but no row written

export type AuditGameReport = {
  game_external_id: number;
  matchup: string;
  classification: AuditGameClassification;
  starter_home: AuditStarterStatus;
  starter_away: AuditStarterStatus;
  lines: AuditLinesStatus;
  has_prediction: boolean;
  prediction_tier: AuditGameInput["prediction_tier"];
  prediction_provisional: AuditGameInput["prediction_provisional"];
  feature_counts: AuditFeatureCounts | null;
  /** Red flags that fire on this specific game. */
  flags: ReadonlyArray<AuditFlag>;
};

export type AuditFlag =
  /** Single-side missing starter → should produce provisional fallback. */
  | "starter_warning_single_side"
  /** Both starters missing → pending card via 6B.30A. */
  | "starter_warning_both_sides"
  /** Pitcher_id is set but no players row → ingestion gap. */
  | "starter_unmapped_player_row_missing"
  /** Pitcher mapped but no provider season sample yet. */
  | "starter_no_mlb_sample"
  /** Lines exist (≥1 book on any market) but no prediction → orchestrator pre-exclusion bug. */
  | "lines_present_but_no_prediction"
  /** Game has zero books across all markets → pending_lines path. */
  | "lines_missing_all_markets"
  /** Game's neutral_fallback exceeds threshold → broad league-avg fallback. */
  | "broad_neutral_fallback"
  /** Game on official slate but has no game_predictions row at all. */
  | "no_prediction_row";

export type DailyEdgeCompletenessReport = {
  sport: "mlb";
  slate_date: string;
  /** Official games on the slate (== games.length). */
  official_count: number;
  /** Games with a game_predictions row. */
  prediction_count: number;
  /** Games WITHOUT a game_predictions row. */
  no_prediction_count: number;
  /** Games where prediction tier is "fallback" + provisional=true. */
  provisional_fallback_count: number;
  /** Games where any starter side is missing (source-unavailable). */
  starter_warning_count: number;
  /** Subset of starter_warning_count where both sides are missing. */
  starter_both_missing_count: number;
  /** Games where lines exist but no prediction row — the SEA@BAL class of bug. */
  lines_present_but_no_prediction_count: number;
  /** Games whose neutral_fallback feature count exceeds threshold. */
  broad_neutral_fallback_count: number;
  /** Per-game audit rows. */
  per_game: ReadonlyArray<AuditGameReport>;
  /** Slate-level red flags — non-empty means operator action needed. */
  red_flags: ReadonlyArray<AuditSlateFlag>;
  /** Threshold used (echoed back for verification). */
  neutral_fallback_threshold: number;
};

export type AuditSlateFlag =
  /** official_count !== prediction_count + pending_count. */
  | "card_count_mismatch"
  /** Any game has flag "lines_present_but_no_prediction". */
  | "lines_present_but_no_prediction"
  /** Any game has flag "broad_neutral_fallback". */
  | "broad_neutral_fallback_used"
  /** Any game has flag "starter_unmapped_player_row_missing". */
  | "starter_player_mapping_gap";

// ─────────────────────────────────────────────────────────────────
// Per-game classifier
// ─────────────────────────────────────────────────────────────────

export function classifyStarter(s: AuditStarterInput): AuditStarterStatus {
  if (s.pitcher_id === null) return "missing_source_unavailable";
  if (!s.mapped) return "present_unmapped";
  if (!s.season_stats_present) return "present_mapped_no_mlb_sample";
  return "present_mapped_with_stats";
}

export function classifyLines(l: AuditLinesInput): AuditLinesStatus {
  const markets = [l.ml_books_count > 0, l.ou_books_count > 0, l.fi_books_count > 0];
  const presentCount = markets.filter(Boolean).length;
  if (presentCount === 3) return "complete";
  if (presentCount === 0) return "missing_all";
  return "partial";
}

export function classifyGame(g: AuditGameInput): AuditGameClassification {
  const homeStatus = classifyStarter(g.home);
  const awayStatus = classifyStarter(g.away);
  const linesStatus = classifyLines(g.lines);

  // Hierarchy: lines_missing > both_starters > one_starter > no_prediction > provisional > ready
  const homeMissing = homeStatus === "missing_source_unavailable";
  const awayMissing = awayStatus === "missing_source_unavailable";

  if (linesStatus === "missing_all") return "pending_lines";
  if (homeMissing && awayMissing) return "pending_both_starters";
  if (!g.has_prediction) {
    if (homeMissing || awayMissing) return "pending_one_starter";
    return "no_prediction";
  }
  if (g.prediction_tier === "fallback" && g.prediction_provisional === true) {
    return "provisional_fallback";
  }
  if (homeMissing || awayMissing) return "pending_one_starter";
  return "ready";
}

function gameFlags(g: AuditGameInput, neutralFallbackThreshold: number): AuditFlag[] {
  const flags: AuditFlag[] = [];
  const homeStatus = classifyStarter(g.home);
  const awayStatus = classifyStarter(g.away);
  const linesStatus = classifyLines(g.lines);
  const homeMissing = homeStatus === "missing_source_unavailable";
  const awayMissing = awayStatus === "missing_source_unavailable";

  if (homeMissing && awayMissing) flags.push("starter_warning_both_sides");
  else if (homeMissing || awayMissing) flags.push("starter_warning_single_side");

  if (homeStatus === "present_unmapped" || awayStatus === "present_unmapped") {
    flags.push("starter_unmapped_player_row_missing");
  }
  if (homeStatus === "present_mapped_no_mlb_sample" || awayStatus === "present_mapped_no_mlb_sample") {
    flags.push("starter_no_mlb_sample");
  }

  if (linesStatus === "missing_all") flags.push("lines_missing_all_markets");

  // The SEA@BAL pattern: lines exist (≥1 book on ML) but no prediction
  // row. This is the orchestrator-pre-exclusion bug class.
  if (!g.has_prediction && (g.lines.ml_books_count > 0 || g.lines.ou_books_count > 0)) {
    flags.push("lines_present_but_no_prediction");
  }

  if (!g.has_prediction) flags.push("no_prediction_row");

  if (g.feature_counts !== null && g.feature_counts.neutral_fallback > neutralFallbackThreshold) {
    flags.push("broad_neutral_fallback");
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────
// Slate-level analyzer
// ─────────────────────────────────────────────────────────────────

export function auditDailyEdgeCompleteness(
  input: DailyEdgeCompletenessInput,
): DailyEdgeCompletenessReport {
  const threshold = input.neutral_fallback_threshold ?? 3;
  const perGame: AuditGameReport[] = [];

  let predictionCount = 0;
  let noPredictionCount = 0;
  let provisionalFallbackCount = 0;
  let starterWarningCount = 0;
  let starterBothMissingCount = 0;
  let linesPresentNoPredCount = 0;
  let broadFallbackCount = 0;
  const slateFlags = new Set<AuditSlateFlag>();

  for (const g of input.games) {
    const classification = classifyGame(g);
    const flags = gameFlags(g, threshold);

    if (g.has_prediction) predictionCount++;
    else noPredictionCount++;
    if (classification === "provisional_fallback") provisionalFallbackCount++;
    if (flags.includes("starter_warning_single_side") || flags.includes("starter_warning_both_sides")) {
      starterWarningCount++;
    }
    if (flags.includes("starter_warning_both_sides")) starterBothMissingCount++;
    if (flags.includes("lines_present_but_no_prediction")) {
      linesPresentNoPredCount++;
      slateFlags.add("lines_present_but_no_prediction");
    }
    if (flags.includes("broad_neutral_fallback")) {
      broadFallbackCount++;
      slateFlags.add("broad_neutral_fallback_used");
    }
    if (flags.includes("starter_unmapped_player_row_missing")) {
      slateFlags.add("starter_player_mapping_gap");
    }
    perGame.push({
      game_external_id: g.game_external_id,
      matchup: g.matchup,
      classification,
      starter_home: classifyStarter(g.home),
      starter_away: classifyStarter(g.away),
      lines: classifyLines(g.lines),
      has_prediction: g.has_prediction,
      prediction_tier: g.prediction_tier,
      prediction_provisional: g.prediction_provisional,
      feature_counts: g.feature_counts,
      flags,
    });
  }

  // card_count_mismatch fires when the official count exceeds the sum
  // of [prediction rows] + [games that should render as pending]. Under
  // 6B.30A, every official game renders a card — so unless there's a
  // route-level bug, official_count should always equal prediction_count
  // + no_prediction_count. The audit fires this flag if the math
  // doesn't add up, which means the daily-edge route is dropping cards.
  if (input.games.length !== predictionCount + noPredictionCount) {
    slateFlags.add("card_count_mismatch");
  }

  return {
    sport: input.sport,
    slate_date: input.slate_date,
    official_count: input.games.length,
    prediction_count: predictionCount,
    no_prediction_count: noPredictionCount,
    provisional_fallback_count: provisionalFallbackCount,
    starter_warning_count: starterWarningCount,
    starter_both_missing_count: starterBothMissingCount,
    lines_present_but_no_prediction_count: linesPresentNoPredCount,
    broad_neutral_fallback_count: broadFallbackCount,
    per_game: perGame,
    red_flags: [...slateFlags],
    neutral_fallback_threshold: threshold,
  };
}
