import type { DailyEdgeResponse, MarketEdgeDto } from "../../app/lab/lib/labTypes";
import type { CurrentSoccerProviderTelemetry } from "../../lib/providers/real_api/CurrentSoccerMarketProvider";
import { buildEplDailyEdgePreview } from "../../lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "../../lib/services/epl/buildEplShadowSlate";
import { readEplStoredPriceHistory } from "../../lib/services/epl/eplLineHistoryStore";
import { readCurrentEplMemberSnapshot } from "../../lib/services/epl/eplMemberSnapshotStore";
import { buildUclDailyEdgePreview } from "../../lib/services/ucl/buildUclDailyEdgePreview";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";
import { readUclStoredPriceHistory } from "../../lib/services/ucl/uclLineHistoryStore";
import { readCurrentUclMemberSnapshot } from "../../lib/services/ucl/uclMemberSnapshotStore";

type MarketKey = "match_result" | "double_chance" | "total" | "btts";
type Row = {
  identity: string;
  matchup: string;
  kickoff: string;
  market: MarketKey;
  side: string | null;
  grade: string;
  actionable: boolean;
  probability: number | null;
  price: number | null;
  locked: boolean;
};

function normalizedSide(market: MarketEdgeDto): string | null {
  const selected = market.pick ?? market.soccerPriceBoard?.rows.find((row) => row.selected)?.side ?? null;
  return selected?.toLowerCase().replaceAll(" ", "_") ?? null;
}

function compactChange(row: { identity: string; before: Row; after: Row }) {
  return {
    identity: row.identity,
    matchup: row.before.matchup,
    market: row.before.market,
    before: {
      side: row.before.side,
      grade: row.before.grade,
      actionable: row.before.actionable,
      probability: row.before.probability,
      price: row.before.price,
    },
    after: {
      side: row.after.side,
      grade: row.after.grade,
      actionable: row.after.actionable,
      probability: row.after.probability,
      price: row.after.price,
    },
  };
}

function rows(response: DailyEdgeResponse): Row[] {
  return response.games.flatMap((game) => ([
    ["match_result", game.markets.moneyline],
    ["double_chance", game.soccerDoubleChanceMarket],
    ["total", game.markets.total],
    ["btts", game.markets.first_inning],
  ] as const).flatMap(([market, value]) => value ? [{
    identity: `${game.external_id}:${market}`,
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    kickoff: game.gameStartAt ?? "",
    market,
    side: normalizedSide(value),
    grade: value.verdict.label,
    actionable: value.verdict.key === "best_angle" || value.verdict.key === "lean",
    probability: value.modelProb,
    price: value.currentPriceAmerican ?? null,
    locked: game.lockState === "locked",
  }] : []));
}

function summarize(response: DailyEdgeResponse) {
  const values = rows(response);
  return {
    games: response.games.length,
    markets: values.length,
    priced: values.filter((row) => row.price !== null).length,
    pricedByMarket: Object.fromEntries((["match_result", "double_chance", "total", "btts"] as const)
      .map((market) => [market, values.filter((row) => row.market === market && row.price !== null).length])),
    actionables: values.filter((row) => row.actionable).length,
    grades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, values.filter((row) => row.grade === grade).length])),
  };
}

function compare(beforeResponse: DailyEdgeResponse, afterResponse: DailyEdgeResponse) {
  const before = new Map(rows(beforeResponse).map((row) => [row.identity, row]));
  const after = new Map(rows(afterResponse).map((row) => [row.identity, row]));
  const paired = [...before.entries()].flatMap(([identity, left]) => {
    const right = after.get(identity);
    return right ? [{ identity, before: left, after: right }] : [];
  });
  const unlocked = paired.filter((row) => !row.before.locked && !row.after.locked);
  const projectionChanges = unlocked.filter((row) =>
    row.before.probability !== null
    && row.after.probability !== null
    && Math.abs(row.before.probability - row.after.probability) > 1e-9);
  return {
    paired: paired.length,
    lockedExcluded: paired.length - unlocked.length,
    sideChanges: unlocked.filter((row) => row.before.side !== row.after.side).map(compactChange),
    promotions: unlocked.filter((row) => !row.before.actionable && row.after.actionable).map(compactChange),
    demotions: unlocked.filter((row) => row.before.actionable && !row.after.actionable).map(compactChange),
    projectionChanges: {
      count: projectionChanges.length,
      maximumAbsoluteDelta: projectionChanges.reduce((maximum, row) => Math.max(
        maximum,
        Math.abs((row.before.probability ?? 0) - (row.after.probability ?? 0)),
      ), 0),
    },
  };
}

async function main(): Promise<void> {
  const eplSlate = await buildEplShadowSlate();
  const eplBefore = await readCurrentEplMemberSnapshot();
  if (!eplBefore) throw new Error("Current EPL member snapshot unavailable.");
  const eplHistory = await readEplStoredPriceHistory(eplSlate.matches.map((match) => match.id));
  let eplTelemetry: CurrentSoccerProviderTelemetry | null = null;
  const eplAfter = await buildEplDailyEdgePreview(eplSlate, {
    storedPriceHistory: eplHistory,
    skipForwardEvidence: true,
    cacheNamespace: "soccer-provider-cutover-epl",
    cacheIdentity: String(Date.now()),
    captureProviderTelemetry: (value) => { eplTelemetry = value; },
  });

  const uclSlate = await buildUclSlate();
  const uclBefore = await readCurrentUclMemberSnapshot();
  if (!uclBefore) throw new Error("Current UCL member snapshot unavailable.");
  const uclHistory = await readUclStoredPriceHistory(uclSlate.matches.map((match) => match.id));
  const uclSameInputBaseline = await buildUclDailyEdgePreview(uclSlate, {
    storedPriceHistory: uclHistory,
    marketProvider: null,
    cacheNamespace: "soccer-provider-cutover-ucl-baseline",
    cacheIdentity: String(Date.now()),
  });
  let uclTelemetry: CurrentSoccerProviderTelemetry | null = null;
  const uclAfter = await buildUclDailyEdgePreview(uclSlate, {
    storedPriceHistory: uclHistory,
    cacheNamespace: "soccer-provider-cutover-ucl-candidate",
    cacheIdentity: String(Date.now()),
    captureProviderTelemetry: (value) => { uclTelemetry = value; },
  });

  console.log(JSON.stringify({
    mode: "read_only_zero_write_provider_cutover",
    epl: {
      releases: { model: eplSlate.modelRelease, calibration: eplSlate.calibrationRelease },
      incumbent: summarize(eplBefore),
      candidate: summarize(eplAfter),
      impact: compare(eplBefore, eplAfter),
      provider: eplTelemetry,
    },
    ucl: {
      releases: { model: uclSlate.modelRelease, calibration: uclSlate.calibrationRelease },
      deployedIncumbent: summarize(uclBefore),
      sameInputBaseline: summarize(uclSameInputBaseline),
      candidate: summarize(uclAfter),
      sameInputImpact: compare(uclSameInputBaseline, uclAfter),
      deployedImpact: compare(uclBefore, uclAfter),
      provider: uclTelemetry,
    },
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
