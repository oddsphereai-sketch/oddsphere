/**
 * Soccer prediction-record writer scaffold — WC-3.
 *
 * Pure function: turns the auto-model output for a fixture into
 * PredictionRecordRow[] ready for insertion into the prediction_records
 * table. Honors WC-1 official tracked markets only
 * (match_result / double_chance / total / btts).
 *
 * No DB writes here — actual Supabase integration is a separate step
 * (WC-3b). This scaffold is intentionally pure so it can be exercised
 * by tests + the operator dry-run before any DB hookup.
 *
 * Production-path safety:
 *   • assertOfficialTrackingMarket gate before every emitted row.
 *   • Held markets either emit `held=true, hold_reason=…` rows OR are
 *     skipped per the operator's decision.
 *   • Lambda-implied total goals captured for the snapshot, NEVER used
 *     to overwrite the listed total line.
 */

import type { TrackedMarketV17, TrackedSport, PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { assertOfficialTrackingMarket } from "@/lib/config/officialTrackingMarkets";
import type { NormalizedBdlMatch } from "@/lib/providers/real_api/BallDontLieFifaProvider";
import type { SoccerFixtureModelOutput } from "./soccerAutoModelV1";

export type SoccerWriterOptions = {
  match: NormalizedBdlMatch;
  modelOutput: SoccerFixtureModelOutput;
  /** Whether to emit held rows. If false, held markets are skipped entirely. */
  includeHeldRows?: boolean;
  /**
   * If true, prediction_records.id is intentionally omitted (DB autogen).
   * If callers want to set ids for test scaffolding they can override
   * via post-processing.
   */
};

const SPORT: TrackedSport = "soccer";

function deriveSideForMarket(market: "match_result" | "double_chance" | "total" | "btts", pick: string): string {
  // The `side` column on prediction_records is sport-conventional. For
  // soccer at launch we use the canonical selection literal — no
  // home/away coercion that would erase the draw or BTTS distinction.
  return pick;
}

function deriveModelOdds(_market: "match_result" | "double_chance" | "total" | "btts", grade: SoccerFixtureModelOutput["perMarket"][number]): number | null {
  // Take the first market_implied row implied probability and convert
  // back to American odds for the prediction_records.odds_american
  // column. This is "the line we'd be wagering at" — purely market
  // data, NOT model probability.
  const implied = grade.snapshot.market.implied_probabilities[`${grade.market}|${grade.pick}${grade.market === "total" && grade.line !== null ? `|${grade.line}` : ""}`] ?? null;
  if (implied === null || implied <= 0 || implied >= 1) return null;
  if (implied >= 0.5) return Math.round(-(implied / (1 - implied)) * 100);
  return Math.round(((1 - implied) / implied) * 100);
}

export function buildSoccerPredictionRows(opts: SoccerWriterOptions): PredictionRecordRow[] {
  const rows: PredictionRecordRow[] = [];
  const matchup = `${opts.match.away_team_abbr}@${opts.match.home_team_abbr}`;
  const datetime = opts.match.datetime;
  const slate_date = datetime.split("T")[0]; // YYYY-MM-DD

  for (const m of opts.modelOutput.perMarket) {
    if (m.hold.hold && opts.includeHeldRows === false) continue;

    const market: TrackedMarketV17 = m.market;
    // Tracked-market guard — refuses to write a non-tracked market by mistake.
    assertOfficialTrackingMarket(SPORT, market);

    const row: PredictionRecordRow = {
      game_prediction_id: null,
      game_id: opts.match.provider_match_id, // BDL match id used as game_id for now; WC-3b will reconcile to internal games table
      external_id: opts.match.provider_match_id,
      sport: SPORT,
      slate_date,
      game_date: slate_date,
      matchup,
      market,
      pick: m.pick,
      side: deriveSideForMarket(m.market, m.pick),
      line_value: m.line,
      odds_american: deriveModelOdds(m.market, m),
      odds_decimal: null,
      model_used: "soccer_dixon_coles_v1",
      model_version: "soccer_dixon_coles_v1",
      prediction_source: "auto_model",
      confidence: m.grade.confidence,
      // prediction_records.model_probability and market_probability are
      // stored as 0..1 fractions (NHL convention). The WC-3 model emits
      // percent (0..100), so divide here. Edge stays in percentage
      // points but is clamped to [-99.99, +99.99] to fit the
      // NUMERIC(5,2)-ish column width — soccer pre-calibration can hit
      // |edge_pp| > 45 on a single market (double_chance) which would
      // otherwise overflow.
      model_probability: m.grade.model_p_pct / 100,
      market_probability: (m.snapshot.market.devigged_probabilities[`${m.market}|${m.pick}${m.market === "total" && m.line !== null ? `|${m.line}` : ""}`] ?? null) !== null
        ? (m.snapshot.market.devigged_probabilities[`${m.market}|${m.pick}${m.market === "total" && m.line !== null ? `|${m.line}` : ""}`] as number)
        : null,
      edge: m.grade.edge_pp === null ? null : Math.max(-99.99, Math.min(99.99, m.grade.edge_pp)),
      expected_value: null,
      play_grade: m.grade.grade,
      prediction_type: m.market,
      best_angle: m.grade.best_angle,
      no_bet: m.hold.hold,
      no_bet_reason: m.hold.hold ? m.hold.code : null,
      market_aligned: m.grade.model_market_agreement,
      data_quality_tier: opts.modelOutput.fixtureHoldReason !== null ? "low" : "medium",
      source_quality: null,
      provisional: false,
      held: m.hold.hold,
      hold_reason: m.hold.hold ? m.hold.reason : null,
      launch_day: true,
      manual_outcome_expected: false,
      locked_at: m.snapshot.locked_at,
      published_at: null,
      snapshot_json: m.snapshot as unknown as Record<string, unknown>,
      calibration_version: m.snapshot.calibration_version,
    };

    rows.push(row);
  }

  return rows;
}
