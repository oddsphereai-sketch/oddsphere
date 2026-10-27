/** Read-only same-model NBA board impact for replacing sharp-book rows with Owls. */

import { runNbaAutoModelV2 } from "../../../lib/automodel/nba/nbaAutoModelV2";
import { buildNbaMarketConsensus } from "../../../lib/automodel/nba/nbaMarketConsensus";
import {
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import type { NbaGameSnapshot } from "../../../lib/automodel/nba/types";
import { supabase } from "../../../lib/db/supabase";
import { loadCompleteCurrentGameLines } from "../../../lib/services/currentGameLineReader";
import { buildNbaDailyEdgeGameDto } from "../../../lib/services/nba/buildNbaDailyEdgeDto";
import { selectNbaCurrentLineBoard } from "../../../lib/services/nba/nbaCurrentLineBoard";
import { buildNbaFeatureSnapshotsWithProvenance } from "../../../lib/services/nba/featureSnapshot";
import type { NbaLineRow } from "../../../lib/services/nba/nbaMarketIntelligence";
import { isNbaAuthoritativeSportsbook } from "../../../lib/services/nba/nbaMarketSourceEligibility";
import {
  applyNbaProfessionalCandidate,
  buildNbaProfessionalCandidate,
} from "../../../lib/services/nba/nbaProfessionalCandidate";
import { refreshNbaLines } from "../../../lib/services/nba/refreshNbaLinesService";

const slateDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const owlsApiKey = process.env.OWLS_INSIGHT_API_KEY;
if (!owlsApiKey) throw new Error("OWLS_INSIGHT_API_KEY is required");

function actionable(grade: string): boolean {
  return grade === "best_angle" || grade === "lean";
}

function lineRow(row: {
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
}): NbaLineRow | null {
  if (row.side === null || !isNbaAuthoritativeSportsbook(row.sportsbook)) return null;
  return {
    market_type: row.market_type,
    sportsbook: row.sportsbook,
    side: row.side,
    line_value: row.line_value,
    odds_american: row.odds_american,
    fetched_at: row.fetched_at,
  };
}

async function main(): Promise<void> {
  const built = await buildNbaFeatureSnapshotsWithProvenance(slateDate);
  const refresh = await refreshNbaLines({ slateDate, owlsApiKey, dryRun: true });
  const externalIds = built.snapshots.map((snapshot) => snapshot.game_external_id);
  const { data: games, error } = await supabase.from("games")
    .select("id,external_id")
    .eq("sport", "nba")
    .in("external_id", externalIds);
  if (error) throw new Error(error.message);
  const externalByDbId = new Map((games ?? []).map((game) => [Number(game.id), Number(game.external_id)]));
  const dbIdByExternal = new Map([...externalByDbId].map(([dbId, externalId]) => [externalId, dbId]));
  const currentRows = await loadCompleteCurrentGameLines({
    client: supabase,
    gameIds: [...externalByDbId.keys()],
    marketTypes: ["moneyline", "spread", "total"],
    context: `NBA Owls cutover audit ${slateDate}`,
  });
  const incumbentByExternal = new Map<number, NbaLineRow[]>();
  for (const row of currentRows) {
    const externalId = externalByDbId.get(row.game_id);
    const normalized = lineRow(row);
    if (externalId === undefined || normalized === null) continue;
    const values = incumbentByExternal.get(externalId) ?? [];
    values.push(normalized);
    incumbentByExternal.set(externalId, values);
  }
  const now = new Date().toISOString();
  const owlsByExternal = new Map<number, NbaLineRow[]>();
  for (const row of refresh.canonicalLines) {
    const externalId = externalByDbId.get(row.gameId);
    if (externalId === undefined) continue;
    const values = owlsByExternal.get(externalId) ?? [];
    values.push({
      market_type: row.marketType,
      sportsbook: row.sportsbook,
      side: row.side,
      line_value: row.lineValue,
      odds_american: row.oddsAmerican,
      fetched_at: now,
    });
    owlsByExternal.set(externalId, values);
  }
  const candidateByExternal = new Map<number, NbaLineRow[]>();
  for (const externalId of externalIds) {
    const retained = (incumbentByExternal.get(externalId) ?? []).filter((row) => (
      row.sportsbook !== "circa" && row.sportsbook !== "pinnacle"
    ));
    candidateByExternal.set(externalId, selectNbaCurrentLineBoard([
      ...retained,
      ...(owlsByExternal.get(externalId) ?? []),
    ]));
    incumbentByExternal.set(externalId, selectNbaCurrentLineBoard(incumbentByExternal.get(externalId) ?? []));
  }
  const season = Number(slateDate.slice(5, 7)) >= 10 ? Number(slateDate.slice(0, 4)) : Number(slateDate.slice(0, 4)) - 1;
  const features = buildNbaProfessionalRuntimeFeatures({
    upcomingGames: built.snapshots.flatMap((snapshot) => snapshot.game_time_iso === null ? [] : [{
      gameId: snapshot.game_external_id,
      season,
      startTime: snapshot.game_time_iso,
      homeTeam: snapshot.home_team.abbreviation,
      awayTeam: snapshot.away_team.abbreviation,
    }]),
  });
  const provenance = new Map(built.provenance.map((row) => [row.game_external_id, row]));

  const evaluate = (raw: NbaGameSnapshot, lines: NbaLineRow[]) => {
    const consensus = buildNbaMarketConsensus(lines.map((row) => ({
      sportsbook: row.sportsbook,
      market_type: row.market_type as "moneyline" | "spread" | "total",
      side: row.side!,
      line_value: row.line_value,
      odds_american: row.odds_american,
    })));
    const snapshot: NbaGameSnapshot = {
      ...raw,
      market: {
        ml: {
          home_odds_american: lines.find((row) => row.market_type === "moneyline" && row.side === "home")?.odds_american ?? null,
          away_odds_american: lines.find((row) => row.market_type === "moneyline" && row.side === "away")?.odds_american ?? null,
        },
        spread: {
          home_line: consensus.spreadHome,
          home_odds_american: lines.find((row) => row.market_type === "spread" && row.side === "home")?.odds_american ?? null,
          away_odds_american: lines.find((row) => row.market_type === "spread" && row.side === "away")?.odds_american ?? null,
        },
        total: {
          line: consensus.totalLine,
          over_odds_american: lines.find((row) => row.market_type === "total" && row.side === "over")?.odds_american ?? null,
          under_odds_american: lines.find((row) => row.market_type === "total" && row.side === "under")?.odds_american ?? null,
        },
      },
      data_quality: { ...raw.data_quality, market_present: lines.length > 0 },
    };
    const feature = features.get(snapshot.game_external_id);
    const prov = provenance.get(snapshot.game_external_id);
    if (!feature || !prov) throw new Error(`Missing NBA audit input for ${snapshot.game_external_id}`);
    const baseline = runNbaAutoModelV2(snapshot, "t60_locked", {
      bookCount: new Set(lines.map((row) => row.sportsbook)).size,
    });
    const candidate = buildNbaProfessionalCandidate({
      artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
      featureRow: selectNbaProfessionalPortableFeatures(feature),
      lines,
      history: [],
      externalGameId: snapshot.game_external_id,
    });
    const prediction = applyNbaProfessionalCandidate({ baseline, candidate });
    return buildNbaDailyEdgeGameDto({
      snapshot,
      prediction,
      provenance: prov,
      lines,
      splitsRow: null,
      opportunities: [],
    });
  };

  const rows = built.snapshots.flatMap((snapshot) => {
    if (!dbIdByExternal.has(snapshot.game_external_id)) return [];
    const incumbent = evaluate(snapshot, incumbentByExternal.get(snapshot.game_external_id) ?? []);
    const candidate = evaluate(snapshot, candidateByExternal.get(snapshot.game_external_id) ?? []);
    return (["ml", "spread", "total"] as const).map((market) => ({
      gameExternalId: snapshot.game_external_id,
      matchup: incumbent.matchup,
      market,
      beforePick: incumbent.intelligence[market].pick_side,
      afterPick: candidate.intelligence[market].pick_side,
      beforeGrade: incumbent.intelligence[market].grade,
      afterGrade: candidate.intelligence[market].grade,
      beforePrice: incumbent.intelligence[market].current_price.odds_american,
      afterPrice: candidate.intelligence[market].current_price.odds_american,
    }));
  });
  const summary = {
    slateDate,
    games: built.snapshots.length,
    markets: rows.length,
    beforeActionable: rows.filter((row) => actionable(row.beforeGrade)).length,
    afterActionable: rows.filter((row) => actionable(row.afterGrade)).length,
    promotions: rows.filter((row) => !actionable(row.beforeGrade) && actionable(row.afterGrade)).length,
    demotions: rows.filter((row) => actionable(row.beforeGrade) && !actionable(row.afterGrade)).length,
    pickChanges: rows.filter((row) => row.beforePick !== row.afterPick).length,
    priceChanges: rows.filter((row) => row.beforePrice !== row.afterPrice).length,
    providerErrors: refresh.errors,
  };
  console.log(JSON.stringify({ summary, changed: rows.filter((row) => (
    row.beforePick !== row.afterPick || row.beforeGrade !== row.afterGrade || row.beforePrice !== row.afterPrice
  )) }, null, 2));
}

void main();
