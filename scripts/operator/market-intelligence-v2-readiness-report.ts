import { supabase } from "../../lib/db/supabase";
import { MARKET_INTELLIGENCE_V2_RESOLVER_VERSION } from "../../lib/services/marketIntelligenceV2/snapshotSync";
import type { Sport } from "../../lib/types/domain/Sport";
import type { MarketIntelligenceMarketType } from "../../lib/types/domain/MarketIntelligenceV2";
import { readStringFlag } from "./_cliCommon";

type Row = Record<string, any>;

const MARKETS_BY_SPORT: Record<string, MarketIntelligenceMarketType[]> = {
  mlb: ["moneyline", "total"],
  wnba: ["moneyline", "total", "spread"],
};

function parseSport(raw: string | undefined): Sport {
  const sport = (raw ?? "mlb").toLowerCase();
  if (sport === "mlb" || sport === "wnba") return sport as Sport;
  throw new Error(`Invalid --sport ${raw}; readiness report currently supports mlb, wnba.`);
}

function latestBy<T>(rows: T[], keyOf: (row: T) => string, timeOf: (row: T) => string | null): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = out.get(key);
    if (!prev || Date.parse(timeOf(row) ?? "") > Date.parse(timeOf(prev) ?? "")) out.set(key, row);
  }
  return out;
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

function inc(obj: Record<string, number>, key: string): void {
  obj[key] = (obj[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sport = parseSport(readStringFlag(argv, "--sport"));
  const date = readStringFlag(argv, "--date") ?? new Date().toISOString().slice(0, 10);
  const markets = MARKETS_BY_SPORT[sport] ?? [];

  const { data: gamesData, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_date, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("game_date", { ascending: true });
  if (gamesError) throw new Error(`games: ${gamesError.message}`);
  const games = (gamesData ?? []) as Row[];
  const gameIds = games.map((g) => Number(g.id));
  const eventIds = games.map((g) => String(g.external_id));

  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x) => x !== null))] as number[];
  const { data: teamRows } = teamIds.length > 0
    ? await supabase.from("teams").select("id, abbreviation").in("id", teamIds)
    : { data: [] as Row[] };
  const teamById = new Map(((teamRows ?? []) as Row[]).map((t) => [Number(t.id), String(t.abbreviation)]));
  const gameById = new Map(games.map((g) => [Number(g.id), g]));

  const { data: recRows, error: recError } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, side, line_value, odds_american, locked_at, play_grade, best_angle")
    .eq("sport", sport)
    .eq("slate_date", date)
    .in("market", markets);
  if (recError) throw new Error(`prediction_records: ${recError.message}`);

  const candidates = ((recRows ?? []) as Row[])
    .filter((r) => markets.includes(r.market) && ["home", "away", "over", "under"].includes(r.side))
    .map((r) => {
      const game = gameById.get(Number(r.game_id));
      const eventId = String(game?.external_id ?? "");
      return {
        recordId: Number(r.id),
        gameId: Number(r.game_id),
        eventId,
        matchup: `${teamById.get(Number(game?.away_team_id)) ?? "?"}@${teamById.get(Number(game?.home_team_id)) ?? "?"}`,
        start: game?.game_date ?? null,
        market: r.market as MarketIntelligenceMarketType,
        side: r.side as string,
        selectionKey: `${eventId}:${r.market}:${r.side}`,
        selectedLine: r.line_value ?? null,
        selectedPrice: r.odds_american ?? null,
        grade: r.play_grade ?? null,
        bestAngle: r.best_angle === true,
      };
    });

  const { data: snapshotRows, error: snapshotError } = await supabase
    .from("market_intelligence_snapshots_v2")
    .select("canonical_event_id, market_type, selection_key, resolver_version, label, score, validity_status, explanation, evidence_json, generated_at, evidence_as_of, selected_line, selected_price")
    .eq("league", sport)
    .eq("resolver_version", MARKET_INTELLIGENCE_V2_RESOLVER_VERSION)
    .in("canonical_event_id", eventIds)
    .in("market_type", markets);
  if (snapshotError) throw new Error(`snapshots: ${snapshotError.message}`);

  const latestSnapshot = latestBy(
    (snapshotRows ?? []) as Row[],
    (r) => `${r.canonical_event_id}:${r.market_type}:${r.selection_key}`,
    (r) => r.generated_at ?? null,
  );

  const marketReports: Record<string, unknown> = {};
  for (const market of markets) {
    const marketCandidates = candidates.filter((c) => c.market === market);
    const labelDistribution: Record<string, number> = {};
    const noReadReasons: Record<string, number> = {};
    const exactLineEvidenceStatus: Record<string, number> = {};
    let exactAvailable = 0;
    let movementAvailable = 0;
    let movementDirectional = 0;
    const examples: unknown[] = [];

    for (const c of marketCandidates) {
      const snapshot = latestSnapshot.get(`${c.eventId}:${market}:${c.selectionKey}`) ?? null;
      const valid = snapshot?.validity_status === "valid_directional" || snapshot?.validity_status === "valid_nondirectional";
      inc(labelDistribution, valid ? String(snapshot?.label ?? "No Market Read") : "No Market Read");
      const evidence = snapshot?.evidence_json ?? {};
      const exact = evidence?.exactLinePriceEvidence ?? {};
      const movement = evidence?.marketMovementEvidence ?? {};
      const trace = evidence?.trace ?? {};
      const exactStatus = String(exact.status ?? "missing_snapshot");
      inc(exactLineEvidenceStatus, exactStatus);
      if (exact.available === true) exactAvailable++;
      if ((movement.trackedBooks ?? 0) > 0) movementAvailable++;
      if (movement.directionRelativeToPick === "support" || movement.directionRelativeToPick === "resistance") movementDirectional++;
      if (!valid) {
        const reason = Array.isArray(trace.explanationReasonCodes)
          ? trace.explanationReasonCodes.join("+")
          : String(snapshot?.validity_status ?? "no_snapshot");
        inc(noReadReasons, reason);
      }
      if (examples.length < 5) {
        examples.push({
          matchup: c.matchup,
          market,
          side: c.side,
          selectedLine: c.selectedLine,
          selectedPrice: c.selectedPrice,
          label: valid ? snapshot?.label : "No Market Read",
          validityStatus: snapshot?.validity_status ?? "no_snapshot",
          exactLineEvidenceStatus: exactStatus,
          movement: {
            firstTrackedLine: movement.firstTrackedLine ?? null,
            currentLine: movement.currentLine ?? null,
            firstTrackedPrice: movement.firstTrackedPrice ?? null,
            currentPrice: movement.currentPrice ?? null,
            directionRelativeToPick: movement.directionRelativeToPick ?? "neutral",
            trackedBooks: movement.trackedBooks ?? 0,
          },
          consensus: evidence?.playbookConsensus
            ? {
                betsPct: evidence.playbookConsensus.betsPct ?? null,
                moneyPct: evidence.playbookConsensus.moneyPct ?? null,
                booksUsed: evidence.playbookConsensus.booksUsed ?? null,
                lineBasis: evidence.playbookConsensus.lineBasis ?? null,
              }
            : null,
          explanation: snapshot?.explanation ?? null,
        });
      }
    }

    const validReads = Object.entries(labelDistribution)
      .filter(([label]) => label !== "No Market Read")
      .reduce((sum, [, count]) => sum + count, 0);
    marketReports[market] = {
      candidates: marketCandidates.length,
      validReads,
      coveragePct: pct(validReads, marketCandidates.length),
      labelDistribution,
      noReadReasons,
      exactLineEvidence: {
        available: exactAvailable,
        availabilityPct: pct(exactAvailable, marketCandidates.length),
        statusCounts: exactLineEvidenceStatus,
      },
      marketMovementEvidence: {
        available: movementAvailable,
        directional: movementDirectional,
        availabilityPct: pct(movementAvailable, marketCandidates.length),
        directionalPct: pct(movementDirectional, marketCandidates.length),
      },
      examples,
      enableRecommendation: validReads / Math.max(1, marketCandidates.length) >= 0.9,
    };
  }

  console.log(JSON.stringify({
    sport,
    date,
    resolverVersion: MARKET_INTELLIGENCE_V2_RESOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    markets: marketReports,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
