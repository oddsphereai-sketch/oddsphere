import { supabase } from "../../lib/db/supabase";
import { MARKET_INTELLIGENCE_V2_RESOLVER_VERSION } from "../../lib/services/marketIntelligenceV2/snapshotSync";
import type { Sport } from "../../lib/types/domain/Sport";
import type { MarketIntelligenceMarketType } from "../../lib/types/domain/MarketIntelligenceV2";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { readStringFlag } from "./_cliCommon";

type Row = Record<string, any>;
type Side = "home" | "away" | "over" | "under";

const MARKETS_BY_SPORT: Record<string, MarketIntelligenceMarketType[]> = {
  mlb: ["moneyline", "total"],
  wnba: ["moneyline", "total", "spread"],
};

const MAX_EVIDENCE_AGE_MINUTES = 180;

function parseSport(raw: string | undefined): Sport {
  const sport = (raw ?? "mlb").toLowerCase();
  if (sport === "mlb" || sport === "wnba") return sport as Sport;
  throw new Error(`Invalid --sport ${raw}; supported: mlb, wnba.`);
}

function timeMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function obsIso(row: Row): string | null {
  return row.provider_timestamp ?? row.source_observed_at ?? row.fetched_at ?? null;
}

function sameLine(a: unknown, b: unknown): boolean {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.001;
}

function americanToImplied(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return null;
  return v > 0 ? 100 / (v + 100) : Math.abs(v) / (Math.abs(v) + 100);
}

function mainLineRank(row: Row): number {
  const p = americanToImplied(row.american_price);
  return p === null ? Number.POSITIVE_INFINITY : Math.abs(p - 0.5);
}

function representativeMainRows(rows: Row[], market: MarketIntelligenceMarketType): Row[] {
  if (market === "moneyline") return [...rows];
  const byBookTime = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.sportsbook}:${obsIso(row) ?? ""}`;
    const prev = byBookTime.get(key);
    if (!prev || mainLineRank(row) < mainLineRank(prev)) byBookTime.set(key, row);
  }
  return [...byBookTime.values()];
}

function lineMovementDirection(
  market: MarketIntelligenceMarketType,
  side: Side,
  firstLine: number | null,
  lastLine: number | null,
): "support" | "resistance" | "neutral" {
  if (firstLine === null || lastLine === null || Math.abs(lastLine - firstLine) < 0.001) return "neutral";
  if (market === "total") {
    if (side === "over") return lastLine > firstLine ? "support" : "resistance";
    if (side === "under") return lastLine < firstLine ? "support" : "resistance";
  }
  if (market === "spread") return lastLine < firstLine ? "support" : "resistance";
  return "neutral";
}

function priceMovementDirection(first: number | null, last: number | null): "support" | "resistance" | "neutral" {
  const a = americanToImplied(first);
  const b = americanToImplied(last);
  if (a === null || b === null) return "neutral";
  const delta = b - a;
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 ? "support" : "resistance";
}

function movementDirection(market: MarketIntelligenceMarketType, side: Side, first: Row, last: Row): "support" | "resistance" | "neutral" {
  if (market === "moneyline") return priceMovementDirection(first.american_price ?? null, last.american_price ?? null);
  const lineDirection = lineMovementDirection(market, side, first.line ?? null, last.line ?? null);
  return lineDirection === "neutral"
    ? priceMovementDirection(first.american_price ?? null, last.american_price ?? null)
    : lineDirection;
}

function freshest(rows: Row[]): Row | null {
  return [...rows].sort((a, b) => (timeMs(obsIso(b)) ?? 0) - (timeMs(obsIso(a)) ?? 0))[0] ?? null;
}

function latestBy<T>(rows: T[], keyOf: (row: T) => string, timeOf: (row: T) => string | null): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = out.get(key);
    if (!prev || (timeMs(timeOf(row)) ?? 0) > (timeMs(timeOf(prev)) ?? 0)) out.set(key, row);
  }
  return out;
}

function isFresh(row: Row, asOfMs: number): boolean {
  const t = timeMs(obsIso(row));
  return t !== null && asOfMs - t <= MAX_EVIDENCE_AGE_MINUTES * 60_000;
}

function isStarted(start: string | null, nowMs: number): boolean {
  const t = timeMs(start);
  return t !== null && t <= nowMs;
}

function pickGroup(args: {
  noReadCodes: string[];
  hasAnyProviderRows: boolean;
  hasLinesTableRows: boolean;
  exactAvailableFresh: boolean;
  safeDirectionalMovementFresh: boolean;
  safeMainRowsFresh: number;
  rawAltRejectedCount: number;
  rawDirectionalMovement: boolean;
  gameStarted: boolean;
  selectedMissing: boolean;
  eventMatchingIssue: boolean;
}): { group: string; action: string } {
  if (args.gameStarted) return { group: "E. stale because game already started", action: "should remain omitted" };
  if (args.selectedMissing) return { group: "F. selected-line/price not passed correctly", action: "can fix immediately" };
  if (args.eventMatchingIssue) return { group: "G. event/team/market matching issue", action: "can fix immediately" };
  if (!args.hasAnyProviderRows && !args.hasLinesTableRows) return { group: "A. truly missing provider data", action: "needs provider/history accumulation" };
  if (!args.exactAvailableFresh && args.safeDirectionalMovementFresh) return { group: "B. exact-line price unavailable, but safe main-line movement exists", action: "needs resolver adjustment" };
  if (!args.exactAvailableFresh && !args.safeDirectionalMovementFresh) {
    if (args.noReadCodes.some((c) => c.includes("stale_evidence")) && args.safeMainRowsFresh === 0) {
      return { group: "D. stale due to cron timing", action: "needs cron timing adjustment" };
    }
    if (args.rawAltRejectedCount > 0 && args.rawDirectionalMovement && args.safeMainRowsFresh === 0) {
      return { group: "H. alt-line guard rejected everything", action: "should remain omitted" };
    }
    return { group: "C. exact-line price unavailable and safe main-line movement does not exist", action: "should remain omitted" };
  }
  if (args.exactAvailableFresh || args.safeDirectionalMovementFresh) return { group: "I. resolver too strict despite safe evidence", action: "needs resolver adjustment" };
  return { group: "C. exact-line price unavailable and safe main-line movement does not exist", action: "should remain omitted" };
}

async function buildSportReport(sport: Sport, date: string): Promise<Row> {
  const markets = MARKETS_BY_SPORT[sport] ?? [];
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const { data: gamesData, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_date, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("game_date", { ascending: true });
  if (gamesError) throw new Error(`${sport} games: ${gamesError.message}`);
  const games = (gamesData ?? []) as Row[];
  const gameIds = games.map((g) => Number(g.id));
  const eventIds = games.map((g) => String(g.external_id));

  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x) => x !== null))] as number[];
  const { data: teamRows } = teamIds.length > 0
    ? await supabase.from("teams").select("id, abbreviation").in("id", teamIds)
    : { data: [] as Row[] };
  const teamById = new Map(((teamRows ?? []) as Row[]).map((t) => [Number(t.id), String(t.abbreviation)]));
  const gameById = new Map(games.map((g) => [Number(g.id), g]));

  const { data: snapshotRows, error: snapshotError } = await supabase
    .from("market_intelligence_snapshots_v2")
    .select("canonical_event_id, market_type, selection_key, resolver_version, label, validity_status, explanation, evidence_json, generated_at, evidence_as_of, event_start_time, recommendation_locked_at, selected_side, selected_line, selected_price")
    .eq("league", sport)
    .eq("resolver_version", MARKET_INTELLIGENCE_V2_RESOLVER_VERSION)
    .in("canonical_event_id", eventIds)
    .in("market_type", markets);
  if (snapshotError) throw new Error(`${sport} snapshots: ${snapshotError.message}`);
  const latestSnapshot = latestBy(
    (snapshotRows ?? []) as Row[],
    (r) => `${r.canonical_event_id}:${r.market_type}:${r.selection_key}`,
    (r) => r.generated_at ?? null,
  );
  const gameByExternalId = new Map(games.map((g) => [String(g.external_id), g]));

  const candidates = [...latestSnapshot.values()]
    .filter((s) => markets.includes(s.market_type) && typeof s.selection_key === "string")
    .map((s) => {
      const eventId = String(s.canonical_event_id);
      const game = gameByExternalId.get(eventId);
      const sideRaw = String(s.selection_key).split(":").pop();
      const side = (sideRaw === "home" || sideRaw === "away" || sideRaw === "over" || sideRaw === "under")
        ? sideRaw as Side
        : (s.selected_side as Side);
      return {
        snapshot: s,
        gameId: Number(game?.id),
        eventId,
        matchup: `${teamById.get(Number(game?.away_team_id)) ?? "?"}@${teamById.get(Number(game?.home_team_id)) ?? "?"}`,
        market: s.market_type as MarketIntelligenceMarketType,
        side,
        selectionKey: String(s.selection_key),
        selectedLine: s.selected_line ?? null,
        selectedPrice: s.selected_price ?? null,
        lockAsOfTime: s.recommendation_locked_at ?? s.generated_at ?? nowIso,
        eventStartTime: s.event_start_time ?? game?.game_date ?? null,
      };
    });

  const { data: splitRows, error: splitError } = await supabase
    .from("market_split_observations_v2")
    .select("canonical_event_id, market_type, selection_key, provider, source_book, bets_pct, money_pct, market_line, market_price, split_line_basis, books_used, source_observed_at, fetched_at")
    .in("canonical_event_id", eventIds)
    .in("market_type", markets);
  if (splitError) throw new Error(`${sport} split observations: ${splitError.message}`);

  const { data: priceRows, error: priceError } = await supabase
    .from("market_price_observations_v2")
    .select("canonical_event_id, market_type, selection_key, sportsbook, sharp_book, line, american_price, provider_timestamp, fetched_at")
    .in("canonical_event_id", eventIds)
    .in("market_type", markets);
  if (priceError) throw new Error(`${sport} price observations: ${priceError.message}`);

  const { data: lineRows } = gameIds.length > 0
    ? await supabase
      .from("lines")
      .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
      .in("game_id", gameIds)
      .in("market_type", markets)
      .is("player_id", null)
    : { data: [] as Row[] };

  const failures: Row[] = [];
  const groupCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};

  for (const c of candidates) {
    const snapshot = c.snapshot ?? latestSnapshot.get(`${c.eventId}:${c.market}:${c.selectionKey}`) ?? null;
    const isValid = snapshot?.validity_status === "valid_directional" || snapshot?.validity_status === "valid_nondirectional";
    if (isValid) continue;

    const splitForCandidate = ((splitRows ?? []) as Row[]).filter((r) =>
      r.canonical_event_id === c.eventId && r.market_type === c.market && r.selection_key === c.selectionKey
    );
    const playbookRows = splitForCandidate.filter((r) => r.provider === "playbook" && r.source_book === "consensus");
    const latestPlaybook = freshest(playbookRows);

    const rawPrice = ((priceRows ?? []) as Row[]).filter((r) =>
      r.canonical_event_id === c.eventId && r.market_type === c.market && r.selection_key === c.selectionKey
    );
    const startMs = timeMs(c.eventStartTime);
    const cutoffMs = timeMs(c.lockAsOfTime) ?? nowMs;
    const preStartPreCutoff = rawPrice.filter((r) => {
      const t = timeMs(obsIso(r));
      if (t === null) return false;
      if (startMs !== null && t > startMs) return false;
      return t <= cutoffMs;
    });
    const freshRaw = preStartPreCutoff.filter((r) => isFresh(r, cutoffMs));
    const mainRowsAll = representativeMainRows(preStartPreCutoff, c.market).sort((a, b) => (timeMs(obsIso(a)) ?? 0) - (timeMs(obsIso(b)) ?? 0));
    const mainRowsFresh = representativeMainRows(freshRaw, c.market).sort((a, b) => (timeMs(obsIso(a)) ?? 0) - (timeMs(obsIso(b)) ?? 0));
    const rawAltRejectedCount = Math.max(0, preStartPreCutoff.length - mainRowsAll.length);
    const firstMain = mainRowsAll[0] ?? null;
    const currentMain = mainRowsAll[mainRowsAll.length - 1] ?? null;
    const firstFreshMain = mainRowsFresh[0] ?? null;
    const currentFreshMain = mainRowsFresh[mainRowsFresh.length - 1] ?? null;
    const safeDirection = firstFreshMain && currentFreshMain
      ? movementDirection(c.market, c.side, firstFreshMain, currentFreshMain)
      : "neutral";
    const rawSorted = [...preStartPreCutoff].sort((a, b) => (timeMs(obsIso(a)) ?? 0) - (timeMs(obsIso(b)) ?? 0));
    const rawDirection = rawSorted[0] && rawSorted[rawSorted.length - 1]
      ? movementDirection(c.market, c.side, rawSorted[0], rawSorted[rawSorted.length - 1])
      : "neutral";

    const exactFresh = c.market === "moneyline"
      ? freshRaw.some((r) => typeof r.american_price === "number")
      : freshRaw.some((r) => sameLine(r.line, c.selectedLine) && typeof r.american_price === "number");

    const linesTableForCandidate = ((lineRows ?? []) as Row[]).filter((r) =>
      Number(r.game_id) === c.gameId && r.market_type === c.market && r.side === c.side
    );
    const evidence = snapshot?.evidence_json ?? {};
    const trace = evidence?.trace ?? {};
    const noReadCodes: string[] = Array.isArray(trace.explanationReasonCodes)
      ? trace.explanationReasonCodes.map(String)
      : [String(snapshot?.validity_status ?? "no_snapshot")];
    const staleEvidence = noReadCodes.some((cde) => cde.includes("stale_evidence")) ||
      [...playbookRows, ...preStartPreCutoff].some((r) => !isFresh(r, cutoffMs));
    const started = isStarted(c.eventStartTime, nowMs);
    const selectedMissing =
      c.selectedPrice === null ||
      c.selectedPrice === undefined ||
      (c.market !== "moneyline" && (c.selectedLine === null || c.selectedLine === undefined));
    const eventMatchingIssue = rawPrice.length === 0 && linesTableForCandidate.length > 0;
    const currentMainLine = currentMain?.line ?? null;
    const currentMainPrice = currentMain?.american_price ?? null;
    const selectedLineDrifted = c.market === "moneyline"
      ? typeof c.selectedPrice === "number" && typeof currentMainPrice === "number" && c.selectedPrice !== currentMainPrice
      : typeof c.selectedLine === "number" && typeof currentMainLine === "number" && !sameLine(c.selectedLine, currentMainLine);

    const classification = pickGroup({
      noReadCodes,
      hasAnyProviderRows: splitForCandidate.length > 0 || rawPrice.length > 0,
      hasLinesTableRows: linesTableForCandidate.length > 0,
      exactAvailableFresh: exactFresh,
      safeDirectionalMovementFresh: safeDirection === "support" || safeDirection === "resistance",
      safeMainRowsFresh: mainRowsFresh.length,
      rawAltRejectedCount,
      rawDirectionalMovement: rawDirection === "support" || rawDirection === "resistance",
      gameStarted: started,
      selectedMissing,
      eventMatchingIssue,
    });
    groupCounts[classification.group] = (groupCounts[classification.group] ?? 0) + 1;
    actionCounts[classification.action] = (actionCounts[classification.action] ?? 0) + 1;

    failures.push({
      sport,
      matchup: c.matchup,
      marketType: c.market,
      selectedSide: c.side,
      selectedLine: c.selectedLine,
      selectedPrice: c.selectedPrice,
      lockAsOfTime: c.lockAsOfTime,
      eventStartTime: c.eventStartTime,
      playbookConsensusAvailability: {
        any: playbookRows.length > 0,
        fresh: playbookRows.some((r) => isFresh(r, cutoffMs)),
        latestObservedAt: obsIso(latestPlaybook ?? {}),
      },
      playbookPairedLine: latestPlaybook
        ? {
            line: latestPlaybook.market_line ?? null,
            price: latestPlaybook.market_price ?? null,
            lineBasis: latestPlaybook.split_line_basis ?? null,
            booksUsed: latestPlaybook.books_used ?? null,
          }
        : null,
      sharpApiPriceAvailability: {
        any: rawPrice.length > 0,
        preStartPreCutoff: preStartPreCutoff.length,
        fresh: freshRaw.length,
        linesTableRows: linesTableForCandidate.length,
      },
      exactSelectedLinePriceAvailability: exactFresh,
      marketMovementEvidenceAvailability: {
        safeMainRows: mainRowsFresh.length,
        safeDirectionalMovement: safeDirection,
      },
      firstTrackedMainLine: firstMain?.line ?? null,
      currentMainLine,
      firstTrackedMainPrice: firstMain?.american_price ?? null,
      currentMainPrice,
      mainLineMovementIdentified: safeDirection === "support" || safeDirection === "resistance",
      altLineGuardRejectedRows: rawAltRejectedCount,
      altLineGuardRejectedEverything: rawAltRejectedCount > 0 && mainRowsFresh.length === 0,
      evidenceWasStale: staleEvidence,
      gameAlreadyStarted: started,
      selectedLineDriftedAfterRecommendation: selectedLineDrifted,
      finalNoReadReason: noReadCodes.join("+"),
      group: classification.group,
      recommendedAction: classification.action,
    });
  }

  return {
    sport,
    date,
    resolverVersion: MARKET_INTELLIGENCE_V2_RESOLVER_VERSION,
    candidates: candidates.length,
    missingReads: failures.length,
    groupCounts,
    actionCounts,
    failures,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sportRaw = readStringFlag(argv, "--sport");
  const sports = sportRaw ? [parseSport(sportRaw)] : (["mlb", "wnba"] as Sport[]);
  const reports = [];
  for (const sport of sports) {
    const date = readStringFlag(argv, "--date") ?? currentSlateDate(sport);
    reports.push(await buildSportReport(sport, date));
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
