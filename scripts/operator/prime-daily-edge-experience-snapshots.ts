/**
 * Pre-cutover Daily Edge member-snapshot primer.
 *
 * Default mode is read-only: rebuild each available sport through the
 * authoritative Daily Edge route, validate the response contract, and print
 * the result. `--apply` is the only mode that republishes the already-existing
 * member-fast snapshots through the shared snapshot writer.
 */
import { GET as getDailyEdge } from "../../app/api/lab/daily-edge/route";
import type { DailyEdgeResponse } from "../../app/lab/lib/labTypes";
import { auditDailyEdgeResponseCoherence } from "../../app/lab/lib/dailyEdgeResponseCoherence";
import { AVAILABLE_DAILY_EDGE_SPORTS } from "../../app/lab/lib/dailyEdgeSports";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { refreshDailyEdgeResponseSnapshot } from "../../lib/services/labResponseSnapshotWriter";
import { fetchEspnWnbaSlateAvailability } from "../../lib/services/wnba/espnWnbaAvailability";
import type { Sport } from "../../lib/types/domain/Sport";

const MARKET_KEYS = ["moneyline", "total", "first_inning"] as const;
const apply = process.argv.includes("--apply");

type Candidate = {
  sport: Sport;
  date: string;
  games: number;
  violations: string[];
};

function validateResponse(sport: Sport, date: string, body: DailyEdgeResponse): string[] {
  const violations: string[] = [];
  if (body.sport !== sport) violations.push(`response sport is ${body.sport}`);
  if (body.date !== date) violations.push(`response slate is ${body.date}`);

  const gameIds = new Set<string>();
  for (const game of body.games) {
    if (gameIds.has(game.id)) violations.push(`${game.id}: duplicate game id`);
    gameIds.add(game.id);
    if (!game.awayTeam || !game.homeTeam) violations.push(`${game.id}: missing team identity`);
    if (
      sport === "wnba" &&
      (
        !game.awayTeamLogo?.includes("/teamlogos/wnba/") ||
        !game.homeTeamLogo?.includes("/teamlogos/wnba/")
      )
    ) {
      violations.push(`${game.id}: WNBA team identity is not backed by WNBA logo assets`);
    }

    for (const key of MARKET_KEYS) {
      const market = game.markets[key];
      const prefix = `${game.id}/${key}`;
      if (!market?.verdict?.key || !Array.isArray(market.keyStats) || !Array.isArray(market.publicSplits)) {
        violations.push(`${prefix}: incomplete member DTO`);
        continue;
      }
      const selected = market.pick !== null && market.pick !== "Toss-Up";
      if (selected && market.priceAmerican === null) violations.push(`${prefix}: selected side has no current price`);
      if (selected && key === "total" && market.line === null) violations.push(`${prefix}: selected total has no line`);
      if (
        sport === "wnba" &&
        selected &&
        (market.oddsTrail?.length ?? 0) < 2
      ) {
        violations.push(`${prefix}: selected WNBA market lacks a continuous same-book price trail`);
      }
      if (sport === "wnba" && selected && (market.oddsTrail?.length ?? 0) >= 2) {
        const trail = market.oddsTrail ?? [];
        const sportsbook = trail[0]?.sportsbook ?? null;
        if (
          sportsbook === null ||
          trail.some((stop) => stop.sportsbook !== sportsbook)
        ) {
          violations.push(`${prefix}: WNBA movement trail mixes sportsbooks or lacks book identity`);
        }
        if (
          key !== "moneyline" &&
          (trail[0]?.line === null || trail.at(-1)?.line === null)
        ) {
          violations.push(`${prefix}: WNBA total/spread trail lacks its first or current point line`);
        }
      }
      if (sport === "wnba" && market.recommendationDecision?.sharpBookSplits) {
        violations.push(`${prefix}: WNBA must not render unsupported sharp-book splits`);
      }

      if (sport === "mlb" && key === "first_inning" && market.fiMarketBoard) {
        const board = market.fiMarketBoard;
        if (board.nrfiAmerican === null || board.yrfiAmerican === null) {
          violations.push(`${prefix}: two-sided FI board lacks a current price`);
        }
        if (board.nrfiOpenAmerican === null || board.yrfiOpenAmerican === null) {
          violations.push(`${prefix}: two-sided FI board lacks an earliest stored opener`);
        }
      }
    }
  }
  violations.push(...auditDailyEdgeResponseCoherence(body).map((issue) =>
    `${issue.gameId}/${issue.market}: ${issue.code}`
  ));
  return violations;
}

async function buildCandidate(sport: Sport): Promise<Candidate> {
  const date = currentSlateDate(sport);
  const url = new URL("https://oddsphere.internal/api/lab/daily-edge");
  url.searchParams.set("sport", sport);
  url.searchParams.set("date", date);
  url.searchParams.set("snapshotBypass", "true");
  const response = await getDailyEdge(new Request(url));
  if (!response.ok) {
    return { sport, date, games: 0, violations: [`route returned HTTP ${response.status}`] };
  }
  const body = (await response.json()) as DailyEdgeResponse;
  const violations = validateResponse(sport, date, body);
  if (sport === "wnba") {
    const scheduled = await fetchEspnWnbaSlateAvailability(date);
    if (scheduled === null) {
      violations.push("authoritative WNBA slate availability could not be verified");
    } else if (scheduled.length !== body.games.length) {
      violations.push(
        `member DTO contains ${body.games.length} games but the authoritative WNBA slate contains ${scheduled.length}`,
      );
    }
  }
  return { sport, date, games: body.games.length, violations };
}

async function main(): Promise<void> {
  const candidates: Candidate[] = [];
  for (const sport of AVAILABLE_DAILY_EDGE_SPORTS) candidates.push(await buildCandidate(sport));

  console.table(candidates.map((candidate) => ({
    sport: candidate.sport,
    date: candidate.date,
    games: candidate.games,
    violations: candidate.violations.length,
  })));
  for (const candidate of candidates) {
    for (const violation of candidate.violations) console.error(`${candidate.sport}: ${violation}`);
  }
  if (candidates.some((candidate) => candidate.violations.length > 0)) {
    throw new Error("Daily Edge snapshot candidate validation failed; no snapshots were written.");
  }
  if (!apply) {
    console.log("Dry run passed. No snapshots were written. Re-run with --apply only at approved cutover.");
    return;
  }

  const failed: string[] = [];
  for (const candidate of candidates) {
    const result = await refreshDailyEdgeResponseSnapshot({
      sport: candidate.sport,
      date: candidate.date,
      source: "daily_edge_experience_cutover",
    });
    if (!result.ok) failed.push(`${candidate.sport}: ${result.error ?? "snapshot write failed"}`);
    else console.log(`${candidate.sport}: primed ${result.games ?? 0} games (${result.snapshotKey})`);
  }
  if (failed.length > 0) throw new Error(`Snapshot cutover failed: ${failed.join(" | ")}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
