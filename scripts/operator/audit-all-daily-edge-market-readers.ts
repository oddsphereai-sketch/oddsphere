/**
 * Read-only cross-sport Daily Edge market-reader coherence audit.
 *
 * This audit never calls a paid provider and never writes production state. It
 * reads the already-published member boards, then checks whether projected
 * scores, selected sides, displayed market evidence, prices, and grades form a
 * coherent three-market story.
 */

import { auditDailyEdgeBoards, DAILY_EDGE_DEEP_AUDIT_SPORTS } from "../../lib/services/dailyEdgeDeepAudit";
import {
  resolveDailyEdgeAuditHttpPayload,
  type DailyEdgeAuditHttpPayload,
} from "../../lib/services/dailyEdgeAuditTransport";

type Row = Record<string, any>;
type Issue = {
  severity: "review" | "warning";
  reason: string;
  sport: string;
  matchup: string;
  market: string;
  details: Record<string, unknown>;
};

const baseUrl = process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
  ?? "https://www.oddsphereai.com";
const requestedSport = process.argv.find((value) => value.startsWith("--sport="))?.slice("--sport=".length) ?? null;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function actionable(market: Row): boolean {
  const verdict = String(market?.verdict?.key ?? market?.verdict ?? "").toLowerCase();
  return verdict === "lean" || verdict === "best_angle";
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
}

function selectedTeamSide(game: Row, pick: string): "home" | "away" | null {
  const value = normalized(pick);
  const home = normalized(game.homeTeam);
  const away = normalized(game.awayTeam);
  if (home && value.includes(home)) return "home";
  if (away && value.includes(away)) return "away";
  return null;
}

function selectedTotalSide(pick: string): "over" | "under" | null {
  const value = normalized(pick);
  if (value.startsWith("OVER")) return "over";
  if (value.startsWith("UNDER")) return "under";
  return null;
}

function selectedSplitRow(game: Row, market: Row): Row | null {
  const rows = market?.sportsbookSplits?.rows;
  if (!Array.isArray(rows)) return null;
  const totalSide = selectedTotalSide(market.pick);
  const teamSide = selectedTeamSide(game, market.pick);
  const side = totalSide ?? teamSide;
  return rows.find((row: Row) => row.side === side) ?? null;
}

function opposingSplitRow(market: Row, selected: Row | null): Row | null {
  const rows = market?.sportsbookSplits?.rows;
  if (!selected || !Array.isArray(rows)) return null;
  return rows.find((row: Row) => row !== selected) ?? null;
}

function professionalSplitSection(market: Row): boolean {
  const source = String(market?.sportsbookSplits?.sourceBook ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return source === "circa" || source === "pinnacle" || source === "bookmaker";
}

function gameDate(game: Row): string | null {
  const stamp = game.gameStartAt ?? game.gameTime ?? null;
  if (typeof stamp !== "string") return null;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

function auditBoard(sport: string, board: Row): { issues: Issue[]; summary: Row } {
  const issues: Issue[] = [];
  const gradeCounts: Record<string, number> = {};
  const signalCounts: Record<string, number> = {};
  const marketCounts: Record<string, number> = {};
  const dates: Record<string, number> = {};
  let pricedMarkets = 0;
  let publicSplitMarkets = 0;
  let sharpSplitMarkets = 0;
  let actionables = 0;

  for (const game of board.games ?? []) {
    const matchup = `${game.awayTeam}@${game.homeTeam}`;
    const date = gameDate(game) ?? "unknown";
    dates[date] = (dates[date] ?? 0) + 1;
    const projectedAway = game.projected?.away;
    const projectedHome = game.projected?.home;
    const projectedTotal = finite(projectedAway) && finite(projectedHome) ? projectedAway + projectedHome : null;

    for (const [slot, market] of Object.entries(game.markets ?? {}) as Array<[string, Row]>) {
      if (!market) continue;
      const marketName = slot === "first_inning" && sport !== "mlb" ? "spread" : slot;
      marketCounts[marketName] = (marketCounts[marketName] ?? 0) + 1;
      const grade = String(market.verdict?.key ?? market.verdict ?? market.grade ?? "missing").toLowerCase();
      const signal = String(market.marketSignal ?? "missing").toLowerCase();
      gradeCounts[grade] = (gradeCounts[grade] ?? 0) + 1;
      signalCounts[signal] = (signalCounts[signal] ?? 0) + 1;
      if (finite(market.priceAmerican) || finite(market.currentPriceAmerican)) pricedMarkets += 1;
      if (Array.isArray(market.publicSplits) && market.publicSplits.length === 2) publicSplitMarkets += 1;
      if (Array.isArray(market.sportsbookSplits?.rows) && market.sportsbookSplits.rows.length === 2) sharpSplitMarkets += 1;
      if (actionable(market)) actionables += 1;

      if (actionable(market) && !finite(market.priceAmerican) && !finite(market.currentPriceAmerican)) {
        issues.push({ severity: "warning", reason: "actionable_without_price", sport, matchup, market: marketName,
          details: { pick: market.pick, verdict: grade, date } });
      }

      if (marketName === "moneyline" && sport !== "soccer" && sport !== "ucl" && finite(projectedAway) && finite(projectedHome)) {
        const side = selectedTeamSide(game, market.pick);
        const projectedWinner = projectedHome > projectedAway ? "home" : projectedAway > projectedHome ? "away" : null;
        if (side && projectedWinner && side !== projectedWinner) {
          issues.push({ severity: "warning", reason: "moneyline_pick_score_mismatch", sport, matchup, market: marketName,
            details: { pick: market.pick, projected: game.projected, marketSignal: market.marketSignal, verdict: grade, date } });
        }
      }

      if (marketName === "total" && projectedTotal !== null && finite(market.line)) {
        const side = selectedTotalSide(market.pick);
        const delta = projectedTotal - market.line;
        if ((side === "over" && delta < -0.35) || (side === "under" && delta > 0.35)) {
          const probabilitySupportsPick = finite(market.modelProb) && market.modelProb >= 0.5;
          issues.push({ severity: probabilitySupportsPick ? "review" : Math.abs(delta) >= 1 ? "warning" : "review",
            reason: probabilitySupportsPick ? "mean_probability_direction_divergence" : "total_pick_score_direction_mismatch",
            sport, matchup, market: marketName,
            details: { pick: market.pick, line: market.line, projectedTotal, delta, modelProb: market.modelProb,
              marketSignal: market.marketSignal, verdict: grade, date } });
        }
      }

      if (marketName === "spread" && sport !== "soccer" && sport !== "ucl" && finite(projectedAway) && finite(projectedHome) && finite(market.line)) {
        const side = selectedTeamSide(game, market.pick);
        const selectedMargin = side === "home"
          ? projectedHome - projectedAway + market.line
          : side === "away"
            ? projectedAway - projectedHome + market.line
            : null;
        if (selectedMargin !== null && selectedMargin < -0.35) {
          issues.push({ severity: selectedMargin <= -1 ? "warning" : "review", reason: "spread_pick_score_direction_mismatch",
            sport, matchup, market: marketName,
            details: { pick: market.pick, line: market.line, projected: game.projected, selectedMargin,
              modelProb: market.modelProb, marketSignal: market.marketSignal, verdict: grade, date } });
        }
      }

      const selectedSharp = selectedSplitRow(game, market);
      const opposingSharp = opposingSplitRow(market, selectedSharp);
      if (professionalSplitSection(market) && selectedSharp && opposingSharp && finite(selectedSharp.moneyPct) && finite(opposingSharp.moneyPct)) {
        const opposition = opposingSharp.moneyPct - selectedSharp.moneyPct;
        const resolvedStatus = String(market.recommendationDecision?.resolvedMarketRead?.status ?? "").toLowerCase();
        const oppositionExplained = ["mixed", "resistance", "consensus_resistance"].includes(resolvedStatus) ||
          ["market_resistance", "resistance"].includes(signal);
        if (opposition >= 25 && !oppositionExplained && ["market_neutral", "market_confirmed", "confirmation", "support", "missing"].includes(signal)) {
          issues.push({ severity: "review", reason: "strong_sharp_opposition_not_explained", sport, matchup, market: marketName,
            details: { pick: market.pick, selectedSharpMoney: selectedSharp.moneyPct, opposingSharpMoney: opposingSharp.moneyPct,
              sourceBook: market.sportsbookSplits?.sourceBook ?? null, marketSignal: market.marketSignal,
              resolvedMarketRead: resolvedStatus || null,
              oddsTrailStops: Array.isArray(market.oddsTrail) ? market.oddsTrail.length : 0,
              projected: game.projected, verdict: grade, date } });
        }
      }
    }
  }

  return { issues, summary: {
    games: board.games?.length ?? 0,
    dates,
    marketCounts,
    gradeCounts,
    signalCounts,
    pricedMarkets,
    publicSplitMarkets,
    sharpSplitMarkets,
    actionables,
  } };
}

async function main(): Promise<void> {
  const token = process.env.DAILY_EDGE_AUDIT_TOKEN || process.env.CRON_SECRET;
  if (!token) throw new Error("DAILY_EDGE_AUDIT_TOKEN or CRON_SECRET is required");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/internal/daily-edge-deep-audit`, {
    headers: { authorization: `Bearer ${token}`, "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as DailyEdgeAuditHttpPayload;
  const resolved = resolveDailyEdgeAuditHttpPayload({ status: response.status, ok: response.ok, payload });
  const sports = requestedSport ? [requestedSport] : DAILY_EDGE_DEEP_AUDIT_SPORTS;
  const summaries: Record<string, Row> = {};
  const issues: Issue[] = [];
  const selectedBoards: Record<string, Row> = {};
  for (const sport of sports) {
    const board = resolved.boards[sport];
    if (!board) continue;
    selectedBoards[sport] = board;
    const result = auditBoard(sport, board);
    summaries[sport] = result.summary;
    issues.push(...result.issues);
  }
  const transport = auditDailyEdgeBoards(selectedBoards);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    readOnly: true,
    providerCalls: 0,
    productionWrites: 0,
    httpStatus: response.status,
    diagnosticResponse: resolved.diagnosticResponse,
    upstreamResult: resolved.upstreamResult,
    transportSummary: transport.summary,
    summaries,
    issueCounts: Object.fromEntries([...new Set(issues.map((issue) => issue.reason))].sort().map((reason) => [
      reason,
      issues.filter((issue) => issue.reason === reason).length,
    ])),
    issues,
  }, null, 2));
  if (resolved.hasCriticals || transport.summary.criticalIssues > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
