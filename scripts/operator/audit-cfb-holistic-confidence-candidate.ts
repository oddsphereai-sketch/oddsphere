/* eslint-disable @typescript-eslint/no-explicit-any -- operator audit parses release-stamped JSON snapshots with versioned dynamic shapes */
import { createClient } from "@supabase/supabase-js";
import {
  CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
  evaluateCfbHolisticConfidence,
  type CfbHolisticSelectedSide,
} from "../../lib/services/football/cfbHolisticConfidenceCandidate";

type Json = Record<string, any>;
const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7) ?? "2026-09-03";
const includeRows = process.argv.includes("--include-rows");

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials unavailable.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const start = `${date}T04:00:00Z`;
  const end = `${nextDate(date)}T04:00:00Z`;
  const { data, error } = await client
    .from("cfb_forward_evidence_snapshots")
    .select("id,provider_game_id,away_team,home_team,stage,captured_at,game_start_at,payload")
    .gte("game_start_at", start)
    .lt("game_start_at", end)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(error.message);

  const latestComplete = new Map<string, Json>();
  for (const row of data ?? []) {
    const decisions = row.payload?.decisions?.evaluatedBets;
    if (!Array.isArray(decisions) || decisions.length === 0) continue;
    latestComplete.set(String(row.provider_game_id), row);
  }

  const gameIds = [...latestComplete.keys()];
  const { data: gameRows, error: gameError } = gameIds.length === 0
    ? { data: [] as Json[], error: null }
    : await client.from("games").select("external_id,status,home_score,away_score").eq("sport", "cfb").in("external_id", gameIds);
  if (gameError) throw new Error(gameError.message);
  const resultsByGame = new Map((gameRows ?? []).map((row: Json) => [String(row.external_id), row]));

  const rows = [...latestComplete.values()].flatMap((row) => {
    const payload = row.payload as Json;
    return (payload.decisions.evaluatedBets as Json[]).map((decision) => {
      const selectedSide = canonicalSide(decision, row.home_team);
      const sharpGap = sharpGapPp(payload, decision, selectedSide);
      const publicGap = publicGapPp(payload, decision, selectedSide);
      const movement = movementInputs(payload, decision, selectedSide);
      const candidate = evaluateCfbHolisticConfidence({
        market: decision.market,
        selectedSide,
        modelProbability: decision.modelProbability,
        exactPriceExpectedValue: decision.expectedValue,
        evaluatedPrice: decision.evaluatedQuote.price,
        evaluatedLine: decision.evaluatedQuote.line,
        sharpMoneyMinusTicketsPp: sharpGap,
        publicMoneyMinusTicketsPp: publicGap,
        selectedSideLineDelta: movement.lineDelta,
        selectedSideImpliedProbabilityDeltaPp: movement.impliedProbabilityDeltaPp,
      });
      const result = settleDecision(decision, selectedSide, resultsByGame.get(String(row.provider_game_id)) ?? null);
      return {
        providerGameId: row.provider_game_id,
        matchup: `${row.away_team}@${row.home_team}`,
        stage: row.stage,
        capturedAt: row.captured_at,
        market: decision.market,
        side: decision.side,
        line: decision.evaluatedQuote.line,
        price: decision.evaluatedQuote.price,
        probability: decision.modelProbability,
        edgePp: decision.edgePercentagePoints,
        ev: decision.expectedValue,
        incumbentGrade: decision.grade,
        candidateGrade: candidate.confidenceGrade,
        executionStatus: candidate.executionStatus,
        result,
        confidenceScore: candidate.confidenceScore,
        evidenceAdjustment: candidate.evidenceConfidenceAdjustment,
        evidence: {
          sharpGapPp: sharpGap,
          publicGapPp: publicGap,
          lineDelta: movement.lineDelta,
          priceDeltaPp: movement.impliedProbabilityDeltaPp,
          contributions: candidate.evidenceContributions,
        },
      };
    });
  });

  const gradeCounts = (key: "incumbentGrade" | "candidateGrade") => Object.fromEntries(
    ["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, rows.filter((row) => row[key] === grade).length]),
  );
  const transitions = rows.filter((row) => row.incumbentGrade !== row.candidateGrade);
  const promotionCount = transitions.filter((row) => rank(row.candidateGrade) > rank(row.incumbentGrade)).length;
  const demotionCount = transitions.length - promotionCount;
  const output = {
    generatedAt: new Date().toISOString(),
    candidateRelease: CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
    date,
    games: latestComplete.size,
    evaluatedMarkets: rows.length,
    incumbentGrades: gradeCounts("incumbentGrade"),
    candidateGrades: gradeCounts("candidateGrade"),
    transitions: { total: transitions.length, promotions: promotionCount, demotions: demotionCount },
    execution: {
      bet: rows.filter((row) => row.executionStatus === "bet").length,
      shop: rows.filter((row) => row.executionStatus === "shop").length,
      unavailable: 0,
      confidenceActionable: rows.filter((row) => actionable(row.candidateGrade)).length,
      executableActionable: rows.filter((row) => actionable(row.candidateGrade) && row.executionStatus === "bet").length,
      confidenceOnlyShop: rows.filter((row) => actionable(row.candidateGrade) && row.executionStatus === "shop").length,
    },
    transitionsByMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, {
      promotions: transitions.filter((row) => row.market === market && rank(row.candidateGrade) > rank(row.incumbentGrade)).length,
      demotions: transitions.filter((row) => row.market === market && rank(row.candidateGrade) < rank(row.incumbentGrade)).length,
    }])),
    settledResults: {
      incumbentByGrade: outcomeByGrade(rows, "incumbentGrade"),
      candidateByGrade: outcomeByGrade(rows, "candidateGrade"),
      candidateExecutableActionables: outcomeRecord(rows.filter((row) => actionable(row.candidateGrade) && row.executionStatus === "bet")),
      candidateConfidenceOnlyShops: outcomeRecord(rows.filter((row) => actionable(row.candidateGrade) && row.executionStatus === "shop")),
    },
    sideChanges: 0,
    largeSpreads: rows.filter((row) => row.market === "spread" && Math.abs(row.line ?? 0) > 24),
    umass: rows.filter((row) => row.matchup === "MASS@RUTG"),
    ...(includeRows ? { rows } : { changedRows: transitions }),
  };
  console.log(JSON.stringify(output, null, 2));
}

function sharpGapPp(payload: Json, decision: Json, side: CfbHolisticSelectedSide): number | null {
  const evaluated = Date.parse(decision.evaluatedAt);
  const record = (payload.market?.sharpApiSplits ?? [])
    .filter((row: Json) => row.sportsbook === "circa" && row.sourceSemantics === "sharp_adjacent" && Date.parse(row.capturedAt) <= evaluated)
    .sort((a: Json, b: Json) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  if (!record) return null;
  const line = decision.evaluatedQuote.line;
  if (decision.market === "moneyline" && (side === "home" || side === "away")) return gap(record.moneyline?.[side]);
  if (decision.market === "spread" && (side === "home" || side === "away")) {
    const evidenceLine = side === "home" ? record.spread?.homeLine : record.spread?.awayLine;
    return finite(line) && finite(evidenceLine) && Math.abs(line - evidenceLine) <= 0.5 ? gap(record.spread?.[side]) : null;
  }
  if (decision.market === "total" && (side === "over" || side === "under")) {
    return finite(line) && finite(record.total?.line) && Math.abs(line - record.total.line) <= 0.5 ? gap(record.total?.[side]) : null;
  }
  return null;
}

function publicGapPp(payload: Json, decision: Json, side: CfbHolisticSelectedSide): number | null {
  const split = payload.market?.playbookSplits?.[decision.market];
  if (!split) return null;
  const contextLine = decision.market === "spread"
    ? (side === "home" ? payload.market?.playbookLine?.homeSpread : payload.market?.playbookLine?.awaySpread)
    : decision.market === "total" ? payload.market?.playbookLine?.total : null;
  if (decision.market !== "moneyline" && (!finite(contextLine) || !finite(decision.evaluatedQuote.line) || Math.abs(contextLine - decision.evaluatedQuote.line) > 0.5)) return null;
  if (side === "home") return finiteGap(split.homeMoneyPct, split.homeBetsPct);
  if (side === "away") return finiteGap(split.awayMoneyPct, split.awayBetsPct);
  if (side === "over") return finiteGap(split.overMoneyPct, split.overBetsPct);
  return finiteGap(split.underMoneyPct, split.underBetsPct);
}

function movementInputs(payload: Json, decision: Json, side: CfbHolisticSelectedSide): { lineDelta: number | null; impliedProbabilityDeltaPp: number | null } {
  const opening = payload.market?.operationalOpening?.quote;
  const current = payload.market?.current;
  if (!opening || !current || normalizeBook(opening.sportsbook) !== normalizeBook(current.sportsbook)) return { lineDelta: null, impliedProbabilityDeltaPp: null };
  const first = quote(opening, decision.market, side);
  const latest = quote(current, decision.market, side);
  if (!first || !latest) return { lineDelta: null, impliedProbabilityDeltaPp: null };
  return {
    lineDelta: finite(first.line) && finite(latest.line) ? latest.line - first.line : null,
    impliedProbabilityDeltaPp: 100 * (implied(latest.price) - implied(first.price)),
  };
}

function quote(book: Json, market: string, side: CfbHolisticSelectedSide): { line: number | null; price: number } | null {
  if (market === "moneyline" && (side === "home" || side === "away")) return { line: null, price: side === "home" ? book.moneyline?.homePrice : book.moneyline?.awayPrice };
  if (market === "spread" && (side === "home" || side === "away")) return { line: side === "home" ? book.spread?.homeLine : book.spread?.awayLine, price: side === "home" ? book.spread?.homePrice : book.spread?.awayPrice };
  if (market === "total" && (side === "over" || side === "under")) return { line: book.total?.line, price: side === "over" ? book.total?.overPrice : book.total?.underPrice };
  return null;
}

function canonicalSide(decision: Json, homeTeam: string): CfbHolisticSelectedSide {
  if (decision.market === "total") return /^over\b/i.test(decision.side) ? "over" : "under";
  return String(decision.side).startsWith(homeTeam) ? "home" : "away";
}

function gap(side: Json | undefined): number | null { return side ? finiteGap(side.moneyPct, side.ticketsPct) : null; }
function finiteGap(first: unknown, second: unknown): number | null { return finite(first) && finite(second) ? first - second : null; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function implied(price: number): number { return price > 0 ? 100 / (price + 100) : -price / (-price + 100); }
function normalizeBook(value: unknown): string { return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function rank(grade: string): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function actionable(grade: string): boolean { return grade === "Best Angle" || grade === "Lean"; }
function settleDecision(decision: Json, side: CfbHolisticSelectedSide, game: Json | null): "win" | "loss" | "push" | null {
  if (!game || !finite(game.home_score) || !finite(game.away_score)) return null;
  const home = game.home_score;
  const away = game.away_score;
  let margin: number;
  if (decision.market === "moneyline") margin = side === "home" ? home - away : away - home;
  else if (decision.market === "spread") margin = (side === "home" ? home - away : away - home) + decision.evaluatedQuote.line;
  else margin = side === "over" ? home + away - decision.evaluatedQuote.line : decision.evaluatedQuote.line - home - away;
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}
function outcomeByGrade(rows: Json[], key: "incumbentGrade" | "candidateGrade"): Record<string, ReturnType<typeof outcomeRecord>> {
  return Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, outcomeRecord(rows.filter((row) => row[key] === grade))]));
}
function outcomeRecord(rows: Json[]): { wins: number; losses: number; pushes: number; pending: number; winPct: number | null } {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const pushes = rows.filter((row) => row.result === "push").length;
  const pending = rows.filter((row) => row.result === null).length;
  return { wins, losses, pushes, pending, winPct: wins + losses > 0 ? 100 * wins / (wins + losses) : null };
}
function nextDate(value: string): string { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
