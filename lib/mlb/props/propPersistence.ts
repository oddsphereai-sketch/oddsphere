import { createClient } from "@supabase/supabase-js";
import type { MlbPropBacktestResult } from "./backtest";
import { isPaperTradingMarketAllowed } from "./paperTrading";

export type PersistMlbPropScoreResult = {
  applied: true;
  scoringRunId: number | null;
  featureSnapshots: number;
  propPredictions: number;
  propEdges: number;
  recommendedBets: number;
  dataQualityEvents: number;
  totalWrites: number;
};

function getSupabaseForProps() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Persisting MLB props requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function persistMlbPropScore(args: {
  scored: MlbPropBacktestResult;
  asOfTimestamp: string;
  source: "mock" | "real";
  date: string;
  dryRun: boolean;
  paperTrading?: boolean;
}): Promise<PersistMlbPropScoreResult> {
  if (args.source === "real" && args.paperTrading !== true) {
    throw new Error("Real MLB props persistence is hidden paper-only. Live/recommended real persistence is blocked.");
  }
  if (args.source === "real") {
    const unsupported = args.scored.recommendations.filter((row) => !isPaperTradingMarketAllowed(row.marketKey));
    if (unsupported.length > 0) {
      throw new Error(`Real MLB props paper persistence blocked unsupported markets: ${[...new Set(unsupported.map((row) => row.marketKey))].join(", ")}`);
    }
  }
  const supabase = getSupabaseForProps();
  const recommendationStatus = args.source === "real" && args.paperTrading ? "paper" : "recommended";
  const { data: run, error: runError } = await supabase
    .from("prop_scoring_runs")
    .insert({
      sport: "mlb",
      slate_date: args.date,
      provider_mode: args.source,
      odds_provider: args.source === "mock" ? "mock" : process.env.ODDSPHERE_PROPS_MARKET_PROVIDER ?? "sharpapi",
      stats_provider: args.source === "mock" ? "mock" : process.env.ODDSPHERE_PROPS_STATS_PROVIDER ?? "balldontlie",
      context_provider: args.source === "mock" ? "mock" : process.env.ODDSPHERE_PROPS_CONTEXT_PROVIDER ?? "playbook",
      mlb_provider: args.source === "mock" ? "mock" : process.env.ODDSPHERE_MLB_PROVIDER ?? "real",
      status: "started",
      dry_run: args.dryRun,
      persisted: true,
      publish_enabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
      display_enabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
      games_seen: new Set(args.scored.recommendations.map((row) => row.gameId)).size,
      markets_seen: new Set(args.scored.recommendations.map((row) => row.marketKey)).size,
      odds_snapshots_seen: args.scored.recommendations.length * 2,
      metadata_json: {
        paperTrading: args.paperTrading === true,
        source: args.source,
        modelVersion: args.scored.name,
        allowedMarkets: args.source === "real" ? ["pitcher_strikeouts", "pitcher_outs"] : undefined,
      },
    })
    .select("id")
    .single();
  if (runError) throw runError;

  let featureSnapshots = 0;
  let propPredictions = 0;
  let propEdges = 0;
  let recommendedBets = 0;
  let dataQualityEvents = 0;

  for (const row of args.scored.recommendations) {
    const dataAvailability = {
      persisted_from_scoring_result: true,
      provider_mode: args.source,
      paper_trading: args.paperTrading === true,
      recommendation_status: row.recommendation.status,
      reason_codes: row.recommendation.reasonCodes,
    };
    const { data: feature, error: featureError } = await supabase
      .from("feature_snapshots")
      .insert({
        game_id: null,
        player_id: null,
        market_key: row.marketKey,
        line: row.recommendation.line,
        as_of_timestamp: args.asOfTimestamp,
        feature_version: "mlb_props_v2_persisted_score",
        features_json: {
          external_game_id: row.gameId,
          external_player_id: row.playerId,
          source: args.source,
          model_version: args.scored.name,
          selected_side: row.recommendation.side,
          sportsbook: row.recommendation.sportsbook,
          american_odds: row.recommendation.americanOdds,
        },
        data_availability_json: dataAvailability,
        leakage_guard_hash: `${row.gameId}:${row.playerId}:${row.marketKey}:${args.asOfTimestamp}`,
      })
      .select("id")
      .single();
    if (featureError) throw featureError;
    featureSnapshots++;

    const { data: prediction, error: predictionError } = await supabase
      .from("prop_predictions")
      .insert({
        model_version_id: null,
        game_id: null,
        player_id: null,
        market_key: row.marketKey,
        line: row.recommendation.line,
        side: row.recommendation.side,
        model_probability: row.recommendation.modelProbability,
        fair_decimal_odds: row.recommendation.fairDecimalOdds,
        fair_american_odds: row.recommendation.fairAmericanOdds,
        feature_snapshot_id: feature.id,
        prediction_timestamp: args.asOfTimestamp,
        explanation_json: {
          external_game_id: row.gameId,
          external_player_id: row.playerId,
          source: args.source,
          market_key: row.marketKey,
          selected_side: row.recommendation.side,
          sportsbook: row.recommendation.sportsbook,
          american_odds: row.recommendation.americanOdds,
          result: row.result,
          clv: row.clv,
          paper_trading: args.paperTrading === true,
        },
      })
      .select("id")
      .single();
    if (predictionError) throw predictionError;
    propPredictions++;

    const { data: edge, error: edgeError } = await supabase
      .from("prop_edges")
      .insert({
        prediction_id: prediction.id,
        odds_snapshot_id: null,
        sportsbook_id: null,
        no_vig_market_probability: row.recommendation.noVigMarketProbability,
        model_probability: row.recommendation.modelProbability,
        edge: row.recommendation.edge,
        expected_value: row.recommendation.expectedValue,
        stale_line_flag: row.recommendation.reasonCodes.includes("STALE_ODDS"),
        data_quality_flag: row.recommendation.reasonCodes.includes("LOW_DATA_CONFIDENCE"),
      })
      .select("id")
      .single();
    if (edgeError) throw edgeError;
    propEdges++;

    if (row.recommendation.status === "recommended") {
      const { error: recError } = await supabase.from("recommended_bets").insert({
        edge_id: edge.id,
        recommendation_status: recommendationStatus,
        confidence_tier: row.recommendation.confidenceTier,
        recommended_units: row.recommendation.recommendedUnits,
        recommended_bankroll_fraction: row.recommendation.recommendedBankrollFraction,
        reason_codes_json: row.recommendation.reasonCodes,
        published_at: args.source === "mock" ? null : null,
        clv_status: row.clv === null ? "pending" : "comparable",
        clv_value: row.clv,
        metadata_json: {
          public: false,
          paperTrading: args.paperTrading === true,
          originalStatus: row.recommendation.status,
          providerMode: args.source,
          oddsProvider: args.source === "real" ? "sharpapi" : "mock",
          modelVersion: args.scored.name,
          externalGameId: row.gameId,
          externalPlayerId: row.playerId,
          marketKey: row.marketKey,
          side: row.recommendation.side,
          line: row.recommendation.line,
          sportsbook: row.recommendation.sportsbook,
          americanOdds: row.recommendation.americanOdds,
          fairAmericanOdds: row.recommendation.fairAmericanOdds,
        },
      });
      if (recError) throw recError;
      recommendedBets++;
    }

    if (row.recommendation.reasonCodes.some((code) => ["LOW_DATA_CONFIDENCE", "STALE_ODDS", "MAPPING_RISK", "NO_PLAY"].includes(code))) {
      const { error: dqError } = await supabase.from("data_quality_events").insert({
        severity: row.recommendation.status === "recommended" ? "info" : "medium",
        component: "mlb_props_paper_trading",
        event_type: "prop_recommendation_reason_codes",
        message: `MLB props paper scoring reason codes for ${row.marketKey}`,
        context_json: {
          providerMode: args.source,
          paperTrading: args.paperTrading === true,
          externalGameId: row.gameId,
          externalPlayerId: row.playerId,
          marketKey: row.marketKey,
          reasonCodes: row.recommendation.reasonCodes,
        },
      });
      if (dqError) throw dqError;
      dataQualityEvents++;
    }
  }

  await supabase
    .from("prop_scoring_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "completed",
      feature_snapshots_written: featureSnapshots,
      predictions_written: propPredictions,
      edges_written: propEdges,
      recommendations_written: recommendedBets,
      data_quality_events_written: dataQualityEvents,
    })
    .eq("id", run.id);

  return {
    applied: true,
    scoringRunId: run.id,
    featureSnapshots,
    propPredictions,
    propEdges,
    recommendedBets,
    dataQualityEvents,
    totalWrites: 1 + featureSnapshots + propPredictions + propEdges + recommendedBets + dataQualityEvents + 1,
  };
}
