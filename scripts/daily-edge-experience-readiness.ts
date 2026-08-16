/**
 * Read-only cross-sport presentation contract audit for the private Daily Edge
 * release candidate. It invokes the normal member response route and never
 * runs a writer, refresh job, or model calculation.
 */
import { GET as getDailyEdge } from "../app/api/lab/daily-edge/route";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  MarketEdgeDto,
} from "../app/lab/lib/labTypes";
import {
  AVAILABLE_DAILY_EDGE_SPORTS,
  DAILY_EDGE_SPORTS,
} from "../app/lab/lib/dailyEdgeSports";
import type { Sport } from "../lib/types/domain/Sport";

type MarketKey = "moneyline" | "total" | "first_inning";
const MARKET_KEYS: MarketKey[] = ["moneyline", "total", "first_inning"];

type SportResult = {
  sport: Sport;
  label: string;
  slateDate: string | null;
  games: number;
  markets: number;
  status:
    | "verified_current_slate"
    | "verified_representative_contract"
    | "awaiting_representative_slate"
    | "failed";
  violations: string[];
};

const REPRESENTATIVE_SLATE_DATE: Partial<Record<Sport, string>> = {
  nba: "2026-06-10",
  nhl: "2026-06-09",
  soccer: "2026-06-13",
};

function validPct(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
}

function auditMarket(
  game: DailyEdgeGameDto,
  key: MarketKey,
  market: MarketEdgeDto,
): string[] {
  const prefix = `${game.id}/${key}`;
  const violations: string[] = [];

  if (!market || !market.verdict?.key || !market.verdict?.label) {
    violations.push(`${prefix}: missing canonical market/verdict shape`);
    return violations;
  }
  if (!Array.isArray(market.keyStats)) {
    violations.push(`${prefix}: keyStats is not an array`);
  }
  if (!Array.isArray(market.publicSplits)) {
    violations.push(`${prefix}: publicSplits is not an array`);
  } else {
    for (const split of market.publicSplits) {
      if (!split.label || !validPct(split.moneyPct) || !validPct(split.betsPct)) {
        violations.push(`${prefix}: invalid public split row`);
      }
    }
  }

  // A held market is intentionally non-actionable even when the underlying
  // model still has a side. Do not report its withheld display price/line as a
  // launch defect; the visible hold is the safety behavior being validated.
  const neutralPick = market.held || market.pick === null || market.pick === "Toss-Up";
  if (!neutralPick && market.priceAmerican === null) {
    violations.push(`${prefix}: selected side is missing its current price`);
  }
  if (key === "total" && !neutralPick && market.line === null) {
    violations.push(`${prefix}: selected total is missing its betting line`);
  }
  if (
    game.sport === "wnba" &&
    !neutralPick &&
    (market.oddsTrail?.length ?? 0) < 2
  ) {
    violations.push(`${prefix}: selected WNBA market is missing a continuous same-book price trail`);
  }
  if (
    game.sport === "mlb" &&
    key === "first_inning" &&
    !neutralPick &&
    market.fiMarketBoard
  ) {
    const board = market.fiMarketBoard;
    if (board.nrfiAmerican === null || board.yrfiAmerican === null) {
      violations.push(`${prefix}: two-sided FI board is missing a current NRFI/YRFI price`);
    }
    if (board.nrfiOpenAmerican === null || board.yrfiOpenAmerican === null) {
      violations.push(`${prefix}: two-sided FI board is missing an earliest stored NRFI/YRFI price`);
    }
  }

  const numberChanged =
    market.lastMoveLinePrev != null &&
    market.lastMoveLineNext != null &&
    market.lastMoveLinePrev !== market.lastMoveLineNext;
  if (
    numberChanged &&
    (market.lastMovePrevAmerican != null || market.lastMoveNextAmerican != null)
  ) {
    violations.push(
      `${prefix}: incomparable prices exposed across ${market.lastMoveLinePrev} → ${market.lastMoveLineNext}`,
    );
  }

  const decision = market.recommendationDecision;
  if (decision?.sharpBookSplits) {
    const sharpSection = decision.sharpBookSplits;
    if (
      sharpSection.label !== "Sharp Book Splits" &&
      sharpSection.label !== "Sharp Book Signal"
    ) {
      violations.push(`${prefix}: sharp section has a non-sharp label`);
    }
    if (sharpSection.label === "Sharp Book Splits" && sharpSection.rows.length === 0) {
      violations.push(`${prefix}: sharp split section exists without rows`);
    }
    if (
      sharpSection.label === "Sharp Book Signal" &&
      (sharpSection.rows.length > 0 || !sharpSection.signal?.trim())
    ) {
      violations.push(`${prefix}: sharp signal section has an invalid signal-only shape`);
    }
  }
  if (
    decision?.consensusSplits &&
    decision.consensusSplits.label !== "Consensus Splits"
  ) {
    violations.push(`${prefix}: consensus section has the wrong label`);
  }

  return violations;
}

async function auditSport(sport: Sport): Promise<SportResult> {
  const label =
    DAILY_EDGE_SPORTS.find((definition) => definition.key === sport)?.label ??
    sport.toUpperCase();
  const violations: string[] = [];
  try {
    const currentUrl = new URL("http://localhost/api/lab/daily-edge");
    currentUrl.searchParams.set("sport", sport);
    // Launch readiness must validate the authoritative runtime builder, not a
    // previously primed presentation snapshot. Snapshot priming has its own
    // separate read-after-write contract check.
    currentUrl.searchParams.set("snapshotBypass", "true");
    const response = await getDailyEdge(new Request(currentUrl));
    if (!response.ok) {
      return {
        sport,
        label,
        slateDate: null,
        games: 0,
        markets: 0,
        status: "failed",
        violations: [`route returned ${response.status}`],
      };
    }
    let body = (await response.json()) as DailyEdgeResponse;
    let usedRepresentativeSlate = false;
    const representativeDate = REPRESENTATIVE_SLATE_DATE[sport];
    if (body.games.length === 0 && representativeDate) {
      const representativeResponse = await getDailyEdge(
        new Request(
          `http://localhost/api/lab/daily-edge?sport=${sport}&date=${representativeDate}&snapshotBypass=true`,
        ),
      );
      if (representativeResponse.ok) {
        body = (await representativeResponse.json()) as DailyEdgeResponse;
        usedRepresentativeSlate = body.games.length > 0;
      }
    }
    if (body.sport !== sport) {
      violations.push(`response sport ${body.sport} does not match ${sport}`);
    }
    const ids = new Set<string>();
    for (const game of body.games) {
      if (ids.has(game.id)) violations.push(`${game.id}: duplicate game id`);
      ids.add(game.id);
      if (game.sport !== sport) violations.push(`${game.id}: wrong game sport ${game.sport}`);
      if (!game.awayTeam || !game.homeTeam) violations.push(`${game.id}: missing team identity`);
      for (const key of MARKET_KEYS) {
        violations.push(...auditMarket(game, key, game.markets[key]));
      }
    }

    return {
      sport,
      label,
      slateDate: body.date,
      games: body.games.length,
      markets: body.games.length * MARKET_KEYS.length,
      status:
        violations.length > 0
          ? "failed"
          : body.games.length > 0
            ? usedRepresentativeSlate
              ? "verified_representative_contract"
              : "verified_current_slate"
            : "awaiting_representative_slate",
      violations,
    };
  } catch (error) {
    return {
      sport,
      label,
      slateDate: null,
      games: 0,
      markets: 0,
      status: "failed",
      violations: [(error as Error).message],
    };
  }
}

async function main() {
  const results = await Promise.all(AVAILABLE_DAILY_EDGE_SPORTS.map(auditSport));
  console.table(
    results.map(({ label, slateDate, games, markets, status, violations }) => ({
      sport: label,
      slate: slateDate ?? "—",
      games,
      markets,
      status,
      violations: violations.length,
    })),
  );

  for (const result of results) {
    if (result.violations.length === 0) continue;
    console.error(`\n${result.label}`);
    for (const violation of result.violations) console.error(`  - ${violation}`);
  }

  const failed = results.filter((result) => result.status === "failed");
  const awaiting = results.filter(
    (result) => result.status === "awaiting_representative_slate",
  );
  console.log(
    `\n${results.length - failed.length}/${results.length} sport contracts passed; ` +
      `${awaiting.length} lack representative slate data. Visual review remains a separate launch gate.`,
  );
  if (failed.length > 0) process.exit(1);
}

void main();
