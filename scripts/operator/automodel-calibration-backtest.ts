/**
 * R-19 Phase 6A.1 — read-only model calibration backtest harness.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-calibration-backtest.ts \
 *     [--start YYYY-MM-DD]   (default: today minus 14 days)
 *     [--end YYYY-MM-DD]     (default: today)
 *     [--sport mlb]          (V1: MLB only)
 *     [--source auto_v1_mlb_rules]   (filter prediction_source; default: auto-only)
 *     [--json]               (machine-readable output)
 *     [--verbose]            (per-game detail)
 *
 * READ-ONLY. Never invokes the model. Never writes to DB. Never modifies
 * production state. Rejects --write. Safe to run at any time.
 *
 * PURPOSE:
 *   Builds the foundation for evidence-based model calibration decisions.
 *   Pulls historical game_predictions + final scores + market reference
 *   over a date range and computes the metrics the Phase 6B research
 *   direction calls for: probability calibration, Brier score, accuracy,
 *   score MAE/RMSE, grade × outcome hit rate, and market-vs-model spread.
 *
 *   Graceful when data is sparse: reports "insufficient data" and
 *   explains exactly what's missing rather than failing or producing
 *   misleading numbers. This is intentional — the harness should be
 *   useful BEFORE final-score data flows, so the operator can see the
 *   distribution / market-spread analysis even when accuracy/Brier
 *   can't yet be computed. The moment post-game-results cron flows
 *   scores into games.{home_score, away_score}, this harness starts
 *   producing real calibration numbers without any change.
 *
 * METRICS:
 *   • Coverage report (n predictions × n with finalized scores)
 *   • Per-team score distribution (mean, sd, percentiles, buckets)
 *   • Predicted total distribution (mean, sd, percentiles)
 *   • Grade distribution (per market)
 *   • Confidence distribution (per market)
 *   • Verdict derivation (Best Angle / Lean / Watchlist counts)
 *   • Confidence calibration bins (predicted X% vs actual hit %)
 *   • Brier score (per market, when outcomes exist)
 *   • ML / O-U accuracy (when outcomes exist)
 *   • Score MAE / RMSE for home / away / total (when scores exist)
 *   • Predicted-total vs market line spread (always when listed_line exists)
 *   • Best Angle hit rate (when outcomes exist)
 *   • Recommendations / data gaps summary
 *
 * SAFETY:
 *   • SELECT-only queries
 *   • No model invocation
 *   • No env mutation
 *   • Rejects --write
 *   • No DB writes anywhere
 */

import {
  parseCommonCliOptions,
  printBanner,
  rejectWriteFlag,
  emitReport,
  readStringFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

// ─── CLI flag helpers ────────────────────────────────────────────────────

function parseDateRange(argv: readonly string[]): {
  start: string;
  end: string;
  source: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const fourteenAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const start = readStringFlag(argv, "--start") ?? fourteenAgo;
  const end = readStringFlag(argv, "--end") ?? today;
  const source = readStringFlag(argv, "--source") ?? "auto_v1_mlb_rules";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error(`Invalid --start "${start}". Expected YYYY-MM-DD.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error(`Invalid --end "${end}". Expected YYYY-MM-DD.`);
  }
  return { start, end, source };
}

// ─── Shape ───────────────────────────────────────────────────────────────

type Row = {
  prediction_id: number;
  game_id: number;
  external_id: number;
  slate_date: string;
  sport: Sport;
  game_date: string | null;
  status: string | null;
  home_team_code: string | null;
  away_team_code: string | null;
  home_score: number | null;
  away_score: number | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  ml_grade: string | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  ou_grade: string | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  nrfi_grade: string | null;
  listed_line: number | null;
};

type Stats = {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sd: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
};

type BacktestReport = {
  sport: Sport;
  start: string;
  end: string;
  source: string;
  generated_at: string;
  coverage: {
    n_predictions: number;
    n_with_final_scores: number;
    n_with_market_line: number;
    n_with_ml_pick: number;
    n_with_ou_pick: number;
    n_with_nrfi_pick: number;
    finalized_pct: number;
    insufficient_for: string[];
  };
  per_team_scores: Stats | null;
  predicted_total: Stats | null;
  grade_distribution: Record<"ml" | "ou" | "nrfi", Record<string, number>>;
  confidence_distribution: Record<"ml" | "ou" | "nrfi", Stats | null>;
  verdict_distribution: Record<
    "ml" | "ou" | "nrfi",
    {
      best_angle: number;
      lean: number;
      watchlist: number;
      caution: number;
      no_play: number;
    }
  >;
  market_comparison: {
    n: number;
    mean_delta: number | null;
    mean_abs_delta: number | null;
    distribution: Record<string, number>;
  };
  accuracy: Record<
    "ml" | "ou" | "nrfi",
    { n: number; correct: number | null; accuracy: number | null }
  >;
  brier: Record<"ml" | "ou" | "nrfi", number | null>;
  calibration_bins: Record<
    "ml" | "ou" | "nrfi",
    Array<{ label: string; n: number; predicted: number | null; actual: number | null }>
  > | null;
  score_error: {
    home: { n: number; mae: number | null; rmse: number | null };
    away: { n: number; mae: number | null; rmse: number | null };
    total: { n: number; mae: number | null; rmse: number | null };
  };
  best_angle_hit_rate: Record<"ml" | "ou" | "nrfi", { n: number; hits: number | null; rate: number | null }>;
  recommendations: string[];
};

// ─── Math helpers ────────────────────────────────────────────────────────

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sd = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    n,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean,
    median: sorted[Math.floor(n / 2)]!,
    sd,
    p10: sorted[Math.floor(n * 0.1)]!,
    p25: sorted[Math.floor(n * 0.25)]!,
    p75: sorted[Math.floor(n * 0.75)]!,
    p90: sorted[Math.floor(n * 0.9)]!,
  };
}

function mae(diffs: number[]): number | null {
  if (diffs.length === 0) return null;
  return diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length;
}

function rmse(diffs: number[]): number | null {
  if (diffs.length === 0) return null;
  return Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length);
}

// ─── Verdict derivation (mirrors lib/services/verdictDerivation.ts logic) ──

function deriveVerdict(
  grade: string | null,
  confidencePct: number | null
): "best_angle" | "lean" | "watchlist" | "caution" | "no_play" {
  if (grade === null) return "no_play";
  if (grade === "sharp_conflict") return "caution";
  if (confidencePct === null || confidencePct < 53) return "no_play";
  if (grade === "best_signal" || grade === "sharp_confirmed") return "best_angle";
  if (grade === "market_led" || grade === "model_only") return "lean";
  if (grade === "market_watch" || grade === "public_smoke") return "watchlist";
  return "no_play";
}

// ─── DB load ─────────────────────────────────────────────────────────────

async function loadRows(
  sport: Sport,
  start: string,
  end: string,
  source: string
): Promise<Row[]> {
  const { data, error } = await supabase
    .from("game_predictions")
    .select(
      "id, games!inner ( id, external_id, slate_date, sport, game_date, status, " +
        "home_score, away_score, " +
        "home_team:home_team_id ( abbreviation ), " +
        "away_team:away_team_id ( abbreviation ) ), " +
        "predicted_home_score, predicted_away_score, predicted_total, " +
        "predicted_ml_winner, ml_confidence, ml_grade, " +
        "predicted_ou_side, ou_confidence, ou_grade, " +
        "predicted_nrfi, nrfi_confidence, nrfi_grade, " +
        "prediction_source, is_override, sport_specific"
    )
    .eq("games.sport", sport)
    .gte("games.slate_date", start)
    .lte("games.slate_date", end)
    .eq("prediction_source", source)
    .eq("is_override", false);
  if (error) throw new Error(`backtest loadRows: ${error.message}`);

  type Raw = {
    id: number;
    games: {
      id: number;
      external_id: number;
      slate_date: string;
      sport: Sport;
      game_date: string | null;
      status: string | null;
      home_score: number | null;
      away_score: number | null;
      home_team: { abbreviation: string } | null;
      away_team: { abbreviation: string } | null;
    };
    predicted_home_score: number | null;
    predicted_away_score: number | null;
    predicted_total: number | null;
    predicted_ml_winner: string | null;
    ml_confidence: number | null;
    ml_grade: string | null;
    predicted_ou_side: string | null;
    ou_confidence: number | null;
    ou_grade: string | null;
    predicted_nrfi: boolean | null;
    nrfi_confidence: number | null;
    nrfi_grade: string | null;
    sport_specific: Record<string, unknown> | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const ss = r.sport_specific ?? {};
    const af = (ss as Record<string, unknown>).auto_factors as
      | Record<string, unknown>
      | undefined;
    const listed = af?.listed_line;
    return {
      prediction_id: r.id,
      game_id: r.games.id,
      external_id: r.games.external_id,
      slate_date: r.games.slate_date,
      sport: r.games.sport,
      game_date: r.games.game_date,
      status: r.games.status,
      home_team_code: r.games.home_team?.abbreviation ?? null,
      away_team_code: r.games.away_team?.abbreviation ?? null,
      home_score: r.games.home_score,
      away_score: r.games.away_score,
      predicted_home_score: r.predicted_home_score,
      predicted_away_score: r.predicted_away_score,
      predicted_total: r.predicted_total,
      predicted_ml_winner: r.predicted_ml_winner,
      ml_confidence: r.ml_confidence,
      ml_grade: r.ml_grade,
      predicted_ou_side: r.predicted_ou_side,
      ou_confidence: r.ou_confidence,
      ou_grade: r.ou_grade,
      predicted_nrfi: r.predicted_nrfi,
      nrfi_confidence: r.nrfi_confidence,
      nrfi_grade: r.nrfi_grade,
      listed_line: typeof listed === "number" ? listed : null,
    };
  });
}

// ─── Build report ────────────────────────────────────────────────────────

function buildReport(
  sport: Sport,
  start: string,
  end: string,
  source: string,
  rows: Row[]
): BacktestReport {
  const finalized = rows.filter(
    (r) => r.home_score !== null && r.away_score !== null
  );
  const withMarket = rows.filter((r) => r.listed_line !== null);

  const insufficient: string[] = [];
  if (finalized.length === 0) {
    insufficient.push(
      "no games with home_score+away_score populated — accuracy/Brier/score-error/Best-Angle-hit-rate are all unavailable. Activate post-game-results cron to flow final scores into games table."
    );
  } else if (finalized.length < 30) {
    insufficient.push(
      `only ${finalized.length} finalized games — statistical confidence is weak. 100+ recommended for reliable Brier; 500+ for grade-level hit rate.`
    );
  }
  if (withMarket.length === 0) {
    insufficient.push(
      "no games with listed_line in sport_specific.auto_factors — market spread analysis unavailable."
    );
  }

  // Score distribution
  const perTeamScores: number[] = [];
  for (const r of rows) {
    if (r.predicted_home_score !== null) perTeamScores.push(r.predicted_home_score);
    if (r.predicted_away_score !== null) perTeamScores.push(r.predicted_away_score);
  }
  const predictedTotals = rows
    .map((r) => r.predicted_total)
    .filter((v): v is number => v !== null);

  // Grade distribution
  const gradeDist: BacktestReport["grade_distribution"] = {
    ml: {},
    ou: {},
    nrfi: {},
  };
  for (const r of rows) {
    const ml = r.ml_grade ?? "null";
    gradeDist.ml[ml] = (gradeDist.ml[ml] ?? 0) + 1;
    const ou = r.ou_grade ?? "null";
    gradeDist.ou[ou] = (gradeDist.ou[ou] ?? 0) + 1;
    const nrfi = r.nrfi_grade ?? "null";
    gradeDist.nrfi[nrfi] = (gradeDist.nrfi[nrfi] ?? 0) + 1;
  }

  // Confidence distribution
  const confDist: BacktestReport["confidence_distribution"] = {
    ml: stats(rows.map((r) => r.ml_confidence).filter((v): v is number => v !== null)),
    ou: stats(rows.map((r) => r.ou_confidence).filter((v): v is number => v !== null)),
    nrfi: stats(rows.map((r) => r.nrfi_confidence).filter((v): v is number => v !== null)),
  };

  // Verdict distribution
  const verdictDist: BacktestReport["verdict_distribution"] = {
    ml: { best_angle: 0, lean: 0, watchlist: 0, caution: 0, no_play: 0 },
    ou: { best_angle: 0, lean: 0, watchlist: 0, caution: 0, no_play: 0 },
    nrfi: { best_angle: 0, lean: 0, watchlist: 0, caution: 0, no_play: 0 },
  };
  for (const r of rows) {
    verdictDist.ml[deriveVerdict(r.ml_grade, r.ml_confidence)]++;
    verdictDist.ou[deriveVerdict(r.ou_grade, r.ou_confidence)]++;
    verdictDist.nrfi[deriveVerdict(r.nrfi_grade, r.nrfi_confidence)]++;
  }

  // Market comparison
  const marketDeltas = withMarket
    .filter((r) => r.predicted_total !== null)
    .map((r) => r.predicted_total! - r.listed_line!);
  const marketDist: Record<string, number> = {
    "<-1.5": 0,
    "-1.5_to_-0.5": 0,
    "-0.5_to_+0.5": 0,
    "+0.5_to_+1.5": 0,
    ">+1.5": 0,
  };
  for (const d of marketDeltas) {
    if (d < -1.5) marketDist["<-1.5"]!++;
    else if (d < -0.5) marketDist["-1.5_to_-0.5"]!++;
    else if (d <= 0.5) marketDist["-0.5_to_+0.5"]!++;
    else if (d <= 1.5) marketDist["+0.5_to_+1.5"]!++;
    else marketDist[">+1.5"]!++;
  }
  const marketComp: BacktestReport["market_comparison"] = {
    n: marketDeltas.length,
    mean_delta:
      marketDeltas.length > 0
        ? marketDeltas.reduce((a, b) => a + b, 0) / marketDeltas.length
        : null,
    mean_abs_delta: mae(marketDeltas),
    distribution: marketDist,
  };

  // Accuracy (needs finalized scores)
  const accuracy: BacktestReport["accuracy"] = {
    ml: { n: 0, correct: null, accuracy: null },
    ou: { n: 0, correct: null, accuracy: null },
    nrfi: { n: 0, correct: null, accuracy: null },
  };
  if (finalized.length > 0) {
    let mlN = 0, mlC = 0;
    let ouN = 0, ouC = 0;
    let nrfiN = 0, nrfiC = 0;
    for (const r of finalized) {
      const homeWon =
        r.home_score !== null && r.away_score !== null && r.home_score > r.away_score;
      const awayWon =
        r.home_score !== null && r.away_score !== null && r.away_score > r.home_score;
      const actualTotal = (r.home_score ?? 0) + (r.away_score ?? 0);
      if (r.predicted_ml_winner !== null && (homeWon || awayWon)) {
        mlN++;
        const predHome = r.predicted_ml_winner === "home";
        if ((predHome && homeWon) || (!predHome && awayWon)) mlC++;
      }
      if (r.predicted_ou_side !== null && r.listed_line !== null) {
        ouN++;
        const overActual = actualTotal > r.listed_line;
        const underActual = actualTotal < r.listed_line;
        if (
          (r.predicted_ou_side === "over" && overActual) ||
          (r.predicted_ou_side === "under" && underActual)
        )
          ouC++;
      }
      if (r.predicted_nrfi !== null) {
        // NRFI/YRFI needs first_inning_runs; not in games table today.
        // Conservative: skip until first_inning_runs columns exist.
        // Tracked in recommendations.
      }
      nrfiN; // suppress unused
      nrfiC;
    }
    accuracy.ml = { n: mlN, correct: mlC, accuracy: mlN > 0 ? mlC / mlN : null };
    accuracy.ou = { n: ouN, correct: ouC, accuracy: ouN > 0 ? ouC / ouN : null };
    if (nrfiN === 0) {
      insufficient.push(
        "NRFI/YRFI accuracy unavailable — needs first_inning_runs column on games table to compute outcome side."
      );
    }
  }

  // Brier score (needs probability + outcome)
  // For ML: probability = ml_confidence / 100 for picked side, outcome 1/0
  const brier: BacktestReport["brier"] = { ml: null, ou: null, nrfi: null };
  if (finalized.length > 0) {
    const mlPairs: Array<[number, number]> = [];
    const ouPairs: Array<[number, number]> = [];
    for (const r of finalized) {
      const homeWon = (r.home_score ?? 0) > (r.away_score ?? 0);
      const awayWon = (r.away_score ?? 0) > (r.home_score ?? 0);
      const actualTotal = (r.home_score ?? 0) + (r.away_score ?? 0);
      if (r.ml_confidence !== null && r.predicted_ml_winner !== null && (homeWon || awayWon)) {
        const p = r.ml_confidence / 100;
        const o =
          (r.predicted_ml_winner === "home" && homeWon) ||
          (r.predicted_ml_winner === "away" && awayWon)
            ? 1
            : 0;
        mlPairs.push([p, o]);
      }
      if (
        r.ou_confidence !== null &&
        r.predicted_ou_side !== null &&
        r.listed_line !== null
      ) {
        const p = r.ou_confidence / 100;
        const overActual = actualTotal > r.listed_line;
        const underActual = actualTotal < r.listed_line;
        const o =
          (r.predicted_ou_side === "over" && overActual) ||
          (r.predicted_ou_side === "under" && underActual)
            ? 1
            : 0;
        if (overActual || underActual) ouPairs.push([p, o]);
      }
    }
    if (mlPairs.length > 0) {
      brier.ml =
        mlPairs.reduce((a, [p, o]) => a + (p - o) ** 2, 0) / mlPairs.length;
    }
    if (ouPairs.length > 0) {
      brier.ou =
        ouPairs.reduce((a, [p, o]) => a + (p - o) ** 2, 0) / ouPairs.length;
    }
  }

  // Calibration bins (per market) — only with finalized data
  let calibrationBins: BacktestReport["calibration_bins"] = null;
  if (finalized.length >= 20) {
    const bins = [
      { lo: 50, hi: 53, label: "50-53%" },
      { lo: 53, hi: 56, label: "53-56%" },
      { lo: 56, hi: 60, label: "56-60%" },
      { lo: 60, hi: 65, label: "60-65%" },
      { lo: 65, hi: 100, label: "65%+" },
    ];
    calibrationBins = { ml: [], ou: [], nrfi: [] };
    for (const market of ["ml", "ou", "nrfi"] as const) {
      for (const b of bins) {
        const matches: Array<{ p: number; o: number }> = [];
        for (const r of finalized) {
          const conf =
            market === "ml" ? r.ml_confidence :
            market === "ou" ? r.ou_confidence :
            r.nrfi_confidence;
          if (conf === null || conf < b.lo || conf >= b.hi) continue;
          const homeWon = (r.home_score ?? 0) > (r.away_score ?? 0);
          const awayWon = (r.away_score ?? 0) > (r.home_score ?? 0);
          const actualTotal = (r.home_score ?? 0) + (r.away_score ?? 0);
          if (market === "ml" && r.predicted_ml_winner !== null && (homeWon || awayWon)) {
            matches.push({
              p: conf / 100,
              o:
                (r.predicted_ml_winner === "home" && homeWon) ||
                (r.predicted_ml_winner === "away" && awayWon)
                  ? 1
                  : 0,
            });
          } else if (
            market === "ou" &&
            r.predicted_ou_side !== null &&
            r.listed_line !== null
          ) {
            const overActual = actualTotal > r.listed_line;
            const underActual = actualTotal < r.listed_line;
            if (overActual || underActual) {
              matches.push({
                p: conf / 100,
                o:
                  (r.predicted_ou_side === "over" && overActual) ||
                  (r.predicted_ou_side === "under" && underActual)
                    ? 1
                    : 0,
              });
            }
          }
        }
        calibrationBins[market].push({
          label: b.label,
          n: matches.length,
          predicted:
            matches.length > 0
              ? matches.reduce((a, m) => a + m.p, 0) / matches.length
              : null,
          actual:
            matches.length > 0
              ? matches.reduce((a, m) => a + m.o, 0) / matches.length
              : null,
        });
      }
    }
  }

  // Score error
  const homeDiffs: number[] = [];
  const awayDiffs: number[] = [];
  const totalDiffs: number[] = [];
  for (const r of finalized) {
    if (
      r.predicted_home_score !== null &&
      r.home_score !== null
    ) {
      homeDiffs.push(r.predicted_home_score - r.home_score);
    }
    if (
      r.predicted_away_score !== null &&
      r.away_score !== null
    ) {
      awayDiffs.push(r.predicted_away_score - r.away_score);
    }
    if (
      r.predicted_total !== null &&
      r.home_score !== null &&
      r.away_score !== null
    ) {
      totalDiffs.push(r.predicted_total - (r.home_score + r.away_score));
    }
  }

  // Best Angle hit rate
  const bestAngleHits: BacktestReport["best_angle_hit_rate"] = {
    ml: { n: 0, hits: null, rate: null },
    ou: { n: 0, hits: null, rate: null },
    nrfi: { n: 0, hits: null, rate: null },
  };
  if (finalized.length > 0) {
    for (const market of ["ml", "ou"] as const) {
      let n = 0;
      let hits = 0;
      for (const r of finalized) {
        const grade =
          market === "ml" ? r.ml_grade : r.ou_grade;
        const conf =
          market === "ml" ? r.ml_confidence : r.ou_confidence;
        if (deriveVerdict(grade, conf) !== "best_angle") continue;
        n++;
        const homeWon = (r.home_score ?? 0) > (r.away_score ?? 0);
        const awayWon = (r.away_score ?? 0) > (r.home_score ?? 0);
        const actualTotal = (r.home_score ?? 0) + (r.away_score ?? 0);
        if (market === "ml" && r.predicted_ml_winner !== null && (homeWon || awayWon)) {
          if (
            (r.predicted_ml_winner === "home" && homeWon) ||
            (r.predicted_ml_winner === "away" && awayWon)
          )
            hits++;
        } else if (
          market === "ou" &&
          r.predicted_ou_side !== null &&
          r.listed_line !== null
        ) {
          const overActual = actualTotal > r.listed_line;
          const underActual = actualTotal < r.listed_line;
          if (
            (r.predicted_ou_side === "over" && overActual) ||
            (r.predicted_ou_side === "under" && underActual)
          )
            hits++;
        }
      }
      bestAngleHits[market] = {
        n,
        hits: n > 0 ? hits : null,
        rate: n > 0 ? hits / n : null,
      };
    }
  }

  // Recommendations
  const recommendations: string[] = [];
  if (finalized.length === 0) {
    recommendations.push(
      "CRITICAL: no finalized game scores in this date range. " +
        "Calibration cannot be measured. Action: activate post-game-results cron " +
        "via vercel.json to flow MLB final scores into games.{home_score, away_score}."
    );
  }
  if (perTeamScores.length > 0) {
    const s = stats(perTeamScores);
    if (s !== null && s.sd < 0.85) {
      recommendations.push(
        `Per-team score std_dev=${s.sd.toFixed(2)} indicates compression. ` +
          `Healthy MLB games span 0-15 runs/team — model is producing too narrow a distribution. ` +
          `This is the score-compression issue identified in Phase 6A Gate 1.`
      );
    }
  }
  if (
    verdictDist.ml.best_angle === 0 &&
    verdictDist.ou.best_angle === 0 &&
    verdictDist.nrfi.best_angle === 0
  ) {
    recommendations.push(
      `Zero Best Angles surfaced across ${rows.length} predictions × 3 markets. ` +
        `Either thresholds are too strict (best_signal needs ≥2 strong-tier signals = EV ≥ 3%) ` +
        `or signal-tier data isn't reaching the grade pipeline. Investigate gradeDerivationService aligned-signal logic.`
    );
  }
  if (marketDeltas.length > 0 && marketComp.mean_abs_delta !== null) {
    if (marketComp.mean_abs_delta < 0.5) {
      recommendations.push(
        `Predicted total is too close to market line (mean_abs_delta=${marketComp.mean_abs_delta.toFixed(2)} runs). ` +
          `Model isn't producing independent edge.`
      );
    } else if (marketComp.mean_abs_delta > 2.5) {
      recommendations.push(
        `Predicted total is very far from market line (mean_abs_delta=${marketComp.mean_abs_delta.toFixed(2)} runs). ` +
          `Could indicate calibration is off; investigate.`
      );
    }
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "No specific calibration recommendations. Re-run with --start broader date range as more games finalize."
    );
  }

  return {
    sport,
    start,
    end,
    source,
    generated_at: new Date().toISOString(),
    coverage: {
      n_predictions: rows.length,
      n_with_final_scores: finalized.length,
      n_with_market_line: withMarket.length,
      n_with_ml_pick: rows.filter((r) => r.predicted_ml_winner !== null).length,
      n_with_ou_pick: rows.filter((r) => r.predicted_ou_side !== null).length,
      n_with_nrfi_pick: rows.filter((r) => r.predicted_nrfi !== null).length,
      finalized_pct: rows.length === 0 ? 0 : (finalized.length / rows.length) * 100,
      insufficient_for: insufficient,
    },
    per_team_scores: stats(perTeamScores),
    predicted_total: stats(predictedTotals),
    grade_distribution: gradeDist,
    confidence_distribution: confDist,
    verdict_distribution: verdictDist,
    market_comparison: marketComp,
    accuracy,
    brier,
    calibration_bins: calibrationBins,
    score_error: {
      home: { n: homeDiffs.length, mae: mae(homeDiffs), rmse: rmse(homeDiffs) },
      away: { n: awayDiffs.length, mae: mae(awayDiffs), rmse: rmse(awayDiffs) },
      total: {
        n: totalDiffs.length,
        mae: mae(totalDiffs),
        rmse: rmse(totalDiffs),
      },
    },
    best_angle_hit_rate: bestAngleHits,
    recommendations,
  };
}

// ─── Text formatter ──────────────────────────────────────────────────────

function fmtNum(v: number | null, digits = 2): string {
  if (v === null) return "—";
  return v.toFixed(digits);
}

function fmtPct(v: number | null, digits = 1): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function formatText(r: BacktestReport): void {
  console.log(
    `\n━━━ Automodel Calibration Backtest · ${r.sport} · ${r.start} → ${r.end} ━━━\n`
  );
  console.log(`  Source filter: ${r.source}`);
  console.log(`  Generated:     ${r.generated_at}`);

  console.log(`\n  Coverage:`);
  console.log(`    predictions:        ${r.coverage.n_predictions}`);
  console.log(
    `    with final scores:  ${r.coverage.n_with_final_scores}  (${r.coverage.finalized_pct.toFixed(1)}%)`
  );
  console.log(`    with market line:   ${r.coverage.n_with_market_line}`);
  console.log(`    with ML pick:       ${r.coverage.n_with_ml_pick}`);
  console.log(`    with O/U pick:      ${r.coverage.n_with_ou_pick}`);
  console.log(`    with NRFI pick:     ${r.coverage.n_with_nrfi_pick}`);
  if (r.coverage.insufficient_for.length > 0) {
    console.log(`    DATA GAPS:`);
    for (const g of r.coverage.insufficient_for) console.log(`      • ${g}`);
  }

  if (r.per_team_scores !== null) {
    console.log(
      `\n  Per-team predicted score distribution (${r.per_team_scores.n} values):`
    );
    const s = r.per_team_scores;
    console.log(
      `    min=${fmtNum(s.min)}  p10=${fmtNum(s.p10)}  p25=${fmtNum(s.p25)}  median=${fmtNum(s.median)}  mean=${fmtNum(s.mean)}  p75=${fmtNum(s.p75)}  p90=${fmtNum(s.p90)}  max=${fmtNum(s.max)}  sd=${fmtNum(s.sd)}`
    );
  }
  if (r.predicted_total !== null) {
    const s = r.predicted_total;
    console.log(
      `\n  Predicted total distribution (${s.n} games): min=${fmtNum(s.min)} median=${fmtNum(s.median)} mean=${fmtNum(s.mean)} max=${fmtNum(s.max)} sd=${fmtNum(s.sd)}`
    );
  }

  console.log(`\n  Grade distribution:`);
  for (const market of ["ml", "ou", "nrfi"] as const) {
    const d = r.grade_distribution[market];
    const total = Object.values(d).reduce((a, b) => a + b, 0);
    console.log(`    ${market}:`);
    for (const k of Object.keys(d).sort()) {
      const c = d[k]!;
      const pct = total > 0 ? Math.round((c / total) * 100) : 0;
      console.log(`      ${k.padEnd(18)} ${String(c).padStart(4)} (${pct}%)`);
    }
  }

  console.log(`\n  Verdict distribution (derived from grade × confidence):`);
  for (const market of ["ml", "ou", "nrfi"] as const) {
    const v = r.verdict_distribution[market];
    const total = Object.values(v).reduce((a, b) => a + b, 0);
    console.log(
      `    ${market}: best=${v.best_angle}(${total > 0 ? Math.round(v.best_angle / total * 100) : 0}%)  lean=${v.lean}(${total > 0 ? Math.round(v.lean / total * 100) : 0}%)  watchlist=${v.watchlist}(${total > 0 ? Math.round(v.watchlist / total * 100) : 0}%)  caution=${v.caution}(${total > 0 ? Math.round(v.caution / total * 100) : 0}%)  no_play=${v.no_play}(${total > 0 ? Math.round(v.no_play / total * 100) : 0}%)`
    );
  }

  if (r.market_comparison.n > 0) {
    console.log(`\n  Predicted total vs market line (n=${r.market_comparison.n}):`);
    console.log(
      `    mean_delta=${fmtNum(r.market_comparison.mean_delta)} (bias: positive=over)`
    );
    console.log(`    mean_abs_delta=${fmtNum(r.market_comparison.mean_abs_delta)}`);
    console.log(`    distribution buckets:`);
    for (const [k, c] of Object.entries(r.market_comparison.distribution)) {
      console.log(`      ${k.padEnd(15)} ${String(c).padStart(4)}`);
    }
  }

  if (r.coverage.n_with_final_scores > 0) {
    console.log(`\n  Accuracy (where finalized + outcome derivable):`);
    for (const market of ["ml", "ou", "nrfi"] as const) {
      const a = r.accuracy[market];
      console.log(
        `    ${market}: n=${a.n} correct=${a.correct ?? "—"} accuracy=${fmtPct(a.accuracy)}`
      );
    }
    console.log(`\n  Brier score (lower=better; 0=perfect, 0.25=random):`);
    for (const market of ["ml", "ou", "nrfi"] as const) {
      console.log(`    ${market}: ${fmtNum(r.brier[market], 4)}`);
    }
    if (r.calibration_bins !== null) {
      console.log(`\n  Confidence calibration bins (predicted X% should match actual hit %):`);
      for (const market of ["ml", "ou", "nrfi"] as const) {
        console.log(`    ${market}:`);
        for (const b of r.calibration_bins[market]) {
          console.log(
            `      ${b.label.padEnd(8)} n=${String(b.n).padStart(3)}  predicted=${fmtPct(b.predicted)}  actual=${fmtPct(b.actual)}`
          );
        }
      }
    }
    console.log(`\n  Score error (predicted - actual):`);
    console.log(
      `    home:  n=${r.score_error.home.n}  MAE=${fmtNum(r.score_error.home.mae)}  RMSE=${fmtNum(r.score_error.home.rmse)}`
    );
    console.log(
      `    away:  n=${r.score_error.away.n}  MAE=${fmtNum(r.score_error.away.mae)}  RMSE=${fmtNum(r.score_error.away.rmse)}`
    );
    console.log(
      `    total: n=${r.score_error.total.n}  MAE=${fmtNum(r.score_error.total.mae)}  RMSE=${fmtNum(r.score_error.total.rmse)}`
    );
    console.log(`\n  Best Angle hit rate (when surfaced):`);
    for (const market of ["ml", "ou", "nrfi"] as const) {
      const b = r.best_angle_hit_rate[market];
      console.log(
        `    ${market}: n=${b.n} hits=${b.hits ?? "—"} rate=${fmtPct(b.rate)}`
      );
    }
  } else {
    console.log(`\n  Accuracy / Brier / score-error / Best-Angle-hit-rate:`);
    console.log(`    SKIPPED — no finalized game scores in range.`);
  }

  console.log(`\n  Recommendations:`);
  for (const r2 of r.recommendations) console.log(`    • ${r2}`);

  console.log(
    `\n  READ-ONLY. No DB writes. No model invocation. No env reads.\n`
  );
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  const { start, end, source } = parseDateRange(process.argv);
  printBanner("automodel-calibration-backtest", opts, { start, end, source });

  const rows = await loadRows(opts.sport, start, end, source);
  const report = buildReport(opts.sport, start, end, source, rows);
  emitReport(report, opts, () => formatText(report));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
);
