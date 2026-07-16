import { validateAdminAuth } from "@/lib/auth/admin";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({
      ok: false,
      error: "Supabase env vars are required for admin paper review.",
    }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const [{ data: runs }, { data: recs, error: recError }] = await Promise.all([
    supabase
      .from("prop_scoring_runs")
      .select("id,sport,slate_date,provider_mode,odds_provider,mlb_provider,started_at,completed_at,status,dry_run,persisted,publish_enabled,display_enabled,games_seen,markets_seen,odds_snapshots_seen,feature_snapshots_written,predictions_written,edges_written,recommendations_written,data_quality_events_written,error_message,metadata_json,created_at")
      .eq("sport", "mlb")
      .eq("slate_date", date)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("recommended_bets")
      .select("id,edge_id,recommendation_status,confidence_tier,recommended_units,recommended_bankroll_fraction,reason_codes_json,result_status,result_units,clv_status,clv_value,metadata_json,created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .eq("recommendation_status", "paper")
      .order("created_at", { ascending: false })
      .limit(250),
  ]);
  if (recError) {
    return Response.json({ ok: false, error: recError.message }, { status: 500 });
  }

  const edgeIds = [...new Set((recs ?? []).map((row) => row.edge_id).filter(Boolean))];
  const { data: edges } = edgeIds.length
    ? await supabase
        .from("prop_edges")
        .select("id,prediction_id,no_vig_market_probability,model_probability,edge,expected_value,stale_line_flag,data_quality_flag,created_at")
        .in("id", edgeIds)
    : { data: [] };
  const predictionIds = [...new Set((edges ?? []).map((row) => row.prediction_id).filter(Boolean))];
  const { data: predictions } = predictionIds.length
    ? await supabase
        .from("prop_predictions")
        .select("id,game_id,player_id,market_key,line,side,model_probability,fair_american_odds,prediction_timestamp,explanation_json")
        .in("id", predictionIds)
    : { data: [] };

  const edgeById = new Map((edges ?? []).map((row) => [row.id, row]));
  const predById = new Map((predictions ?? []).map((row) => [row.id, row]));

  return Response.json({
    ok: true,
    date,
    publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    paperTradingEnabled: process.env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED === "true",
    scoringRuns: runs ?? [],
    recommendations: (recs ?? []).map((rec) => {
      const edge = edgeById.get(rec.edge_id);
      const prediction = edge ? predById.get(edge.prediction_id) : null;
      const metadata = asRecord(rec.metadata_json);
      const explanation = asRecord(prediction?.explanation_json);
      return {
        id: rec.id,
        recommendationStatus: rec.recommendation_status,
        player: stringValue(metadata.externalPlayerId) ?? stringValue(explanation.external_player_id),
        game: stringValue(metadata.externalGameId) ?? stringValue(explanation.external_game_id),
        team: null,
        opponent: null,
        market: prediction?.market_key ?? stringValue(metadata.marketKey),
        normalizedMarket: prediction?.market_key ?? stringValue(metadata.marketKey),
        side: prediction?.side ?? stringValue(metadata.side),
        line: prediction?.line ?? numberValue(metadata.line),
        sportsbook: stringValue(metadata.sportsbook),
        odds: numberValue(metadata.americanOdds),
        modelProbability: edge?.model_probability ?? prediction?.model_probability ?? null,
        noVigMarketProbability: edge?.no_vig_market_probability ?? null,
        edge: edge?.edge ?? null,
        expectedValue: edge?.expected_value ?? null,
        fairOdds: prediction?.fair_american_odds ?? numberValue(metadata.fairAmericanOdds),
        recommendedUnits: rec.recommended_units,
        reasonCodes: rec.reason_codes_json ?? [],
        staleLineFlag: edge?.stale_line_flag ?? null,
        dataQualityFlag: edge?.data_quality_flag ?? null,
        dataAvailabilityFlags: {
          staleLine: edge?.stale_line_flag ?? null,
          dataQuality: edge?.data_quality_flag ?? null,
        },
        oddsTimestamp: null,
        featureSnapshotTimestamp: prediction?.prediction_timestamp ?? null,
        settlementStatus: rec.result_status ?? null,
        clvStatus: rec.clv_status ?? null,
        clvValue: rec.clv_value ?? null,
        createdAt: rec.created_at,
      };
    }),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
