import { createClient } from "@supabase/supabase-js";
import {
  applyMlbTeamResidualRunCorrection,
} from "../../lib/automodel/mlbAutoModelV2_2";
import {
  buildMlbCoherentMarketPriceMap,
  type MlbMarketPriceRow,
} from "../../lib/automodel/mlbCoherentMarketPriceMap";
import { computeMarketBaseline } from "../../lib/automodel/marketPrior";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";
import { blendPosterior } from "../../lib/automodel/mlbV22PosteriorBlend";
import { homeWinProbabilityPoisson, overProbabilityPoisson } from "../../lib/automodel/runDistribution";
import type { SharpSnapshot } from "../../lib/automodel/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");
const supabase = createClient(url, key, { auth: { persistSession: false } });

const from = argument("from") ?? "2026-08-25";
const through = argument("through") ?? "2026-08-31";
const selectionThrough = argument("selection-through") ?? "2026-08-28";
const priorMode = argument("prior") ?? "production";
if (!new Set(["production", "sharp", "retail"]).has(priorMode)) {
  throw new Error("--prior must be production, sharp, or retail");
}

type GameRow = {
  id: number;
  external_id: string | number;
  slate_date: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
};

type RecordRow = {
  id: number;
  game_id: number;
  market: "moneyline" | "total";
  side: string | null;
  line_value: number | null;
  locked_at: string | null;
  model_probability: number | null;
  snapshot_json: Record<string, unknown> | null;
};

type ObservationRow = {
  canonical_event_id: string;
  sportsbook: string | null;
  market_type: "moneyline" | "total";
  selection_key: string | null;
  american_price: number | null;
  line: number | null;
  provider_timestamp: string | null;
  fetched_at: string;
};

async function main(): Promise<void> {
  const gamesResult = await supabase
    .from("games")
    .select("id,external_id,slate_date,home_team_id,away_team_id,home_score,away_score")
    .eq("sport", "mlb")
    .gte("slate_date", from)
    .lte("slate_date", through)
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  if (gamesResult.error) throw gamesResult.error;
  const games = (gamesResult.data ?? []) as GameRow[];
  const gameIds = games.map((game) => game.id);
  const externalIds = games.map((game) => String(game.external_id));

  const teamIds = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]))];
  const teamsResult = await supabase.from("teams").select("id,abbreviation").in("id", teamIds);
  if (teamsResult.error) throw teamsResult.error;
  const teamById = new Map((teamsResult.data ?? []).map((team) => [team.id as number, String(team.abbreviation)]));

  const recordsResult = await supabase
    .from("prediction_records")
    .select("id,game_id,market,side,line_value,locked_at,model_probability,snapshot_json")
    .in("game_id", gameIds)
    .in("market", ["moneyline", "total"])
    .not("locked_at", "is", null)
    .order("locked_at", { ascending: false });
  if (recordsResult.error) throw recordsResult.error;
  const latestByIdentity = new Map<string, RecordRow>();
  for (const row of (recordsResult.data ?? []) as RecordRow[]) {
    const identity = `${row.game_id}:${row.market}`;
    if (!latestByIdentity.has(identity)) latestByIdentity.set(identity, row);
  }

  const observations: ObservationRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabase
      .from("market_price_observations_v2")
      .select("canonical_event_id,sportsbook,market_type,selection_key,american_price,line,provider_timestamp,fetched_at")
      .in("canonical_event_id", externalIds)
      .in("market_type", ["moneyline", "total"])
      .order("fetched_at", { ascending: true })
      .range(offset, offset + 999);
    if (page.error) throw page.error;
    observations.push(...((page.data ?? []) as ObservationRow[]));
    if ((page.data ?? []).length < 1000) break;
  }
  const observationsByEvent = new Map<string, ObservationRow[]>();
  for (const row of observations) {
    const list = observationsByEvent.get(String(row.canonical_event_id)) ?? [];
    list.push(row);
    observationsByEvent.set(String(row.canonical_event_id), list);
  }

  const auditRows = games.flatMap((game) => {
    const v22Record = latestByIdentity.get(`${game.id}:total`)
      ?? latestByIdentity.get(`${game.id}:moneyline`)
      ?? null;
    if (!v22Record?.locked_at) return [];
    const v22 = readObject(v22Record.snapshot_json?.v2_2_audit);
    if (!v22) return [];
    const independentHome = finite(v22.independent_home_runs);
    const independentAway = finite(v22.independent_away_runs);
    const oldHome = finite(v22.posterior_home_runs);
    const oldAway = finite(v22.posterior_away_runs);
    const listedTotal = finite(v22.market_total) ?? v22Record.line_value;
    const storedMlSelectedProbability = finite(v22.ml_model_prob);
    const storedTotalSelectedProbability = finite(v22.ou_model_prob);
    const missingCount = finite(v22.feature_missing_count);
    const tier = readTier(v22.data_quality_tier);
    if (
      independentHome === null || independentAway === null
      || oldHome === null || oldAway === null || listedTotal === null
      || missingCount === null || tier === null
      || storedMlSelectedProbability === null || storedTotalSelectedProbability === null
    ) return [];

    const priceRows = (observationsByEvent.get(String(game.external_id)) ?? [])
      .filter((row) => Date.parse(row.provider_timestamp ?? row.fetched_at) <= Date.parse(v22Record.locked_at!))
      .map(toPriceRow)
      .filter((row): row is MlbMarketPriceRow => row !== null);
    const priceMap = applyPriorMode(buildMlbCoherentMarketPriceMap({
      rows: priceRows,
      listedTotal,
      asOf: v22Record.locked_at,
    }), priorMode);
    const market = computeMarketBaseline({
      listed_total: listedTotal,
      home_ml_odds_american: null,
      away_ml_odds_american: null,
      over_odds_american: finite(v22.over_odds_american),
      under_odds_american: finite(v22.under_odds_american),
      has_pinnacle_total: false,
      coherent_price_map: priceMap,
    }, storedSharp(v22));
    if (!market.coherentMoneylinePriceMapApplied && !market.coherentTotalPriceMapApplied) return [];

    const posterior = blendPosterior({
      market: market.dataQuality === "ok" ? market : null,
      independent: {
        home_expected_runs: independentHome,
        away_expected_runs: independentAway,
        total_expected_runs: independentHome + independentAway,
        home_run_diff: independentHome - independentAway,
        data_quality_tier: tier,
        feature_audit: { missing_count: missingCount },
      } as Parameters<typeof blendPosterior>[0]["independent"],
    });
    const corrected = applyMlbTeamResidualRunCorrection({
      homeTeam: teamById.get(game.home_team_id),
      awayTeam: teamById.get(game.away_team_id),
      homeRuns: posterior.home_expected_runs,
      awayRuns: posterior.away_expected_runs,
    });
    const newHome = corrected.homeRuns;
    const newAway = corrected.awayRuns;
    const actualHome = game.home_score!;
    const actualAway = game.away_score!;
    const oldHomeWinRaw = homeWinProbabilityPoisson(oldHome, oldAway);
    const oldHomeWin = oldHomeWinRaw >= 0.5
      ? storedMlSelectedProbability
      : 1 - storedMlSelectedProbability;
    const newHomeWinRaw = homeWinProbabilityPoisson(newHome, newAway);
    const newHomeWin = regularizedOutcomeProbability({
      rawProbability: newHomeWinRaw,
      marketProbability: market.homeNoVigProb,
      k: 0.1,
      maxDistancePp: 6,
    });
    const oldOverRaw = overProbabilityPoisson(oldHome, oldAway, listedTotal);
    const oldOver = oldOverRaw >= 0.5
      ? storedTotalSelectedProbability
      : 1 - storedTotalSelectedProbability;
    const newOverRaw = overProbabilityPoisson(newHome, newAway, listedTotal);
    const newOver = regularizedOutcomeProbability({
      rawProbability: newOverRaw,
      marketProbability: market.overNoVigProb,
      k: 0.4,
      maxDistancePp: 8,
    });
    const actualHomeWin = actualHome > actualAway ? 1 : 0;
    const actualOver = actualHome + actualAway > listedTotal ? 1 : actualHome + actualAway < listedTotal ? 0 : null;
    return [{
      slateDate: game.slate_date,
      partition: game.slate_date <= selectionThrough ? "selection" : "holdout",
      externalId: String(game.external_id),
      moneylineApplied: market.coherentMoneylinePriceMapApplied === true,
      totalApplied: market.coherentTotalPriceMapApplied === true,
      oldHome,
      oldAway,
      newHome,
      newAway,
      actualHome,
      actualAway,
      oldHomeWin,
      newHomeWin,
      actualHomeWin,
      oldOver,
      newOver,
      actualOver,
      moneylineSideChanged: (oldHomeWin >= 0.5) !== (newHomeWin >= 0.5),
      totalSideChanged: (oldOver >= 0.5) !== (newOver >= 0.5),
    }];
  });

  console.log(JSON.stringify({
    readOnly: true,
    releaseSeparated: true,
    range: { from, through, selectionThrough, priorMode },
    games: games.length,
    observations: observations.length,
    qualifyingRows: auditRows.length,
    selection: metrics(auditRows.filter((row) => row.partition === "selection")),
    holdout: metrics(auditRows.filter((row) => row.partition === "holdout")),
    overall: metrics(auditRows),
    sideChanges: auditRows.filter((row) => row.moneylineSideChanged || row.totalSideChanged),
  }, null, 2));
}

function applyPriorMode(
  snapshot: ReturnType<typeof buildMlbCoherentMarketPriceMap>,
  mode: string,
): ReturnType<typeof buildMlbCoherentMarketPriceMap> {
  if (mode === "production") return snapshot;
  const resolve = (side: typeof snapshot.moneyline_home) => {
    if (side.sharp_no_vig_probability === null || side.retail_no_vig_probability === null) return side;
    const selected = mode === "sharp"
      ? side.sharp_no_vig_probability
      : side.retail_no_vig_probability;
    return {
      ...side,
      sharp_no_vig_probability: selected,
      retail_no_vig_probability: selected,
    };
  };
  return {
    ...snapshot,
    moneyline_home: resolve(snapshot.moneyline_home),
    total_over: resolve(snapshot.total_over),
  };
}

function metrics(rows: AuditRow[]) {
  const totals = rows.filter((row) => row.actualOver !== null);
  return {
    rows: rows.length,
    mlBrierBefore: mean(rows.map((row) => brier(row.oldHomeWin, row.actualHomeWin))),
    mlBrierAfter: mean(rows.map((row) => brier(row.newHomeWin, row.actualHomeWin))),
    totalBrierBefore: mean(totals.map((row) => brier(row.oldOver, row.actualOver!))),
    totalBrierAfter: mean(totals.map((row) => brier(row.newOver, row.actualOver!))),
    teamScoreMaeBefore: mean(rows.flatMap((row) => [Math.abs(row.oldHome - row.actualHome), Math.abs(row.oldAway - row.actualAway)])),
    teamScoreMaeAfter: mean(rows.flatMap((row) => [Math.abs(row.newHome - row.actualHome), Math.abs(row.newAway - row.actualAway)])),
    totalMaeBefore: mean(rows.map((row) => Math.abs(row.oldHome + row.oldAway - row.actualHome - row.actualAway))),
    totalMaeAfter: mean(rows.map((row) => Math.abs(row.newHome + row.newAway - row.actualHome - row.actualAway))),
    mlDirectionChanges: rows.filter((row) => row.moneylineSideChanged).length,
    totalDirectionChanges: rows.filter((row) => row.totalSideChanged).length,
  };
}

type AuditRow = {
  slateDate: string;
  partition: string;
  externalId: string;
  moneylineApplied: boolean;
  totalApplied: boolean;
  oldHome: number;
  oldAway: number;
  newHome: number;
  newAway: number;
  actualHome: number;
  actualAway: number;
  oldHomeWin: number;
  newHomeWin: number;
  actualHomeWin: number;
  oldOver: number;
  newOver: number;
  actualOver: number | null;
  moneylineSideChanged: boolean;
  totalSideChanged: boolean;
};

function toPriceRow(row: ObservationRow): MlbMarketPriceRow | null {
  const suffix = row.selection_key?.split(":").at(-1) ?? null;
  if (!["home", "away", "over", "under"].includes(suffix ?? "")) return null;
  if (!row.sportsbook) return null;
  return {
    market_type: row.market_type,
    sportsbook: row.sportsbook,
    side: suffix,
    line_value: row.line,
    odds_american: row.american_price,
    fetched_at: row.provider_timestamp ?? row.fetched_at,
  };
}

function storedSharp(v22: Record<string, unknown>): SharpSnapshot {
  const home = finite(v22.market_home_win_prob);
  return {
    pinnacle_ml_fair_prob_home: home,
    pinnacle_ml_fair_prob_away: home === null ? null : 1 - home,
    pinnacle_total_ev_pct: null,
    pinnacle_ml_ev_pct: null,
    public_betting_pct_home: null,
    public_money_pct_home: null,
    public_betting_pct_over: null,
    public_money_pct_over: null,
    ml_plus_ev_side: null,
    total_plus_ev_side: null,
  };
}

function regularizedOutcomeProbability(args: {
  rawProbability: number;
  marketProbability: number | null;
  k: number;
  maxDistancePp: number;
}): number {
  const selectedRaw = args.rawProbability >= 0.5 ? args.rawProbability : 1 - args.rawProbability;
  const selectedMarket = args.marketProbability === null
    ? null
    : args.rawProbability >= 0.5 ? args.marketProbability : 1 - args.marketProbability;
  const regularized = regularizeProbability({
    rawProb: selectedRaw,
    marketProb: selectedMarket,
    k: args.k,
    maxDistancePp: args.maxDistancePp,
  }).regularizedProb ?? selectedRaw;
  return args.rawProbability >= 0.5 ? regularized : 1 - regularized;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTier(value: unknown): "high" | "medium" | "low" | "fallback" | null {
  return value === "high" || value === "medium" || value === "low" || value === "fallback" ? value : null;
}

function brier(probability: number, outcome: number): number {
  return (probability - outcome) ** 2;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
