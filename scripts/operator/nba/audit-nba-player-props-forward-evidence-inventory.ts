/** SELECT-only inventory and replay of authentic NBA player-prop forward evidence. */
import { supabase } from "../../../lib/db/supabase";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import {
  buildNbaPlayerPropsMarketEvidence,
} from "../../../lib/services/nba/nbaPlayerPropsMarketEvidence";
import {
  decodeNbaPlayerPropsPrivatePayload,
  type NbaPlayerPropsMarketHistory,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  decodeNbaPlayerPropsPrivateTrackingHistory,
  type NbaPlayerPropsPrivateTrackingRow,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateTracking";
import {
  NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,
  buildNbaPlayerPropsSettlementRevision,
  nbaPlayerPropsSettlementKey,
  type NbaPlayerPropsSettlementHistory,
  type NbaPlayerPropsSettlementRevision,
} from "../../../lib/services/nba/nbaPlayerPropsSettlementStore";

type SnapshotRow = Readonly<{
  snapshot_key: string;
  slate_date: string | null;
  payload: unknown;
  payload_version: string | null;
  generated_at: string | null;
}>;

type Scored = Readonly<{
  market: string;
  finalCorrect: boolean;
  independentCorrect: boolean;
  twoPointReadCorrect: boolean | null;
  twoPointReadChanged: boolean;
  qualifiedEvidence: boolean;
  hasOpening: boolean;
  hasPrior: boolean;
  hasCurrent: boolean;
  hasTargetExcluded: boolean;
}>;

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function suffix(value: string | null | undefined): string {
  return String(value ?? "").match(/(\d+)$/)?.[1] ?? normalize(value ?? "");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameScope(row: NbaPlayerPropsPrivateTrackingRow, observation: NbaPlayerPropPriceObservation): boolean {
  const playerMatches = suffix(observation.canonicalPlayerId ?? observation.providerPlayerId) === suffix(row.playerId)
    || normalize(observation.playerName ?? "") === normalize(row.playerName);
  return suffix(observation.canonicalGameId) === suffix(row.gameId)
    && playerMatches
    && observation.market === row.market;
}

function targetAtLock(
  row: NbaPlayerPropsPrivateTrackingRow,
  observations: readonly NbaPlayerPropPriceObservation[],
): NbaPlayerPropPriceObservation | null {
  const lock = Date.parse(row.lockedAt);
  return observations
    .filter((observation) => sameScope(row, observation))
    .filter((observation) => !observation.isLive
      && observation.line === row.line
      && observation.side === row.side
      && normalize(observation.sportsbook) === normalize(row.sportsbook)
      && Date.parse(observation.observedAt) <= lock)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function latestSettlements(history: NbaPlayerPropsSettlementHistory | null): Map<string, NbaPlayerPropsSettlementRevision> {
  const latest = new Map<string, NbaPlayerPropsSettlementRevision>();
  for (const revision of history?.revisions ?? []) {
    const previous = latest.get(revision.rowKey);
    if (!previous || revision.revision > previous.revision) latest.set(revision.rowKey, revision);
  }
  return latest;
}

function sideCorrect(side: "over" | "under", actual: number, line: number): boolean {
  return side === "over" ? actual > line : actual < line;
}

function summarize(rows: readonly Scored[]) {
  const total = rows.length;
  const twoPoint = rows.filter((row) => row.twoPointReadCorrect !== null);
  return {
    settledRows: total,
    final: { correct: rows.filter((row) => row.finalCorrect).length, hitRate: rate(rows.filter((row) => row.finalCorrect).length, total) },
    independent: { correct: rows.filter((row) => row.independentCorrect).length, hitRate: rate(rows.filter((row) => row.independentCorrect).length, total) },
    marketRead2pp: {
      eligibleRows: twoPoint.length,
      correct: twoPoint.filter((row) => row.twoPointReadCorrect).length,
      hitRate: rate(twoPoint.filter((row) => row.twoPointReadCorrect).length, twoPoint.length),
      changedRows: twoPoint.filter((row) => row.twoPointReadChanged).length,
    },
    evidence: {
      qualified: rows.filter((row) => row.qualifiedEvidence).length,
      opening: rows.filter((row) => row.hasOpening).length,
      prior: rows.filter((row) => row.hasPrior).length,
      current: rows.filter((row) => row.hasCurrent).length,
      targetExcluded: rows.filter((row) => row.hasTargetExcluded).length,
    },
  };
}

function rate(correct: number, total: number): number | null {
  return total > 0 ? correct / total : null;
}

async function main(): Promise<void> {
  const season = Number(value("--season") ?? "2026");
  if (!Number.isInteger(season)) throw new Error("--season must be an integer.");
  const { data, error } = await supabase.from("lab_response_snapshots")
    .select("snapshot_key,slate_date,payload,payload_version,generated_at")
    .eq("sport", "nba")
    .like("snapshot_key", "nba::player-props-%")
    .order("snapshot_key", { ascending: true });
  if (error) throw new Error(`NBA props forward evidence inventory read failed: ${error.message}`);
  const snapshots = (data ?? []) as SnapshotRow[];
  const marketByDate = new Map<string, NbaPlayerPropsMarketHistory>();
  const trackingByDate = new Map<string, ReturnType<typeof decodeNbaPlayerPropsPrivateTrackingHistory>>();
  let settlement: NbaPlayerPropsSettlementHistory | null = null;
  for (const row of snapshots) {
    if (row.snapshot_key.includes("private-market::")) {
      const history = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsMarketHistory>(row.payload, "market_history");
      if (history) marketByDate.set(history.slateDate, history);
    } else if (row.snapshot_key.includes("private-tracking::")) {
      const history = decodeNbaPlayerPropsPrivateTrackingHistory(row.payload);
      if (history) trackingByDate.set(history.slateDate, history);
    } else if (row.snapshot_key === nbaPlayerPropsSettlementKey(season)) {
      const history = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsSettlementHistory>(row.payload, "tracking_history");
      if (history?.release === NBA_PLAYER_PROPS_SETTLEMENT_RELEASE) settlement = history;
    }
  }
  const settlements = latestSettlements(settlement);
  const currentState = await readNbaPlayerPropsCurrentState({ client: supabase, season });
  const boxByGamePlayer = new Map((currentState?.boxes ?? []).map((box) => [
    `${box.gameId}|${box.playerId}`,
    box,
  ]));
  const scored: Scored[] = [];
  const dateInventory = [];
  for (const date of [...new Set([...marketByDate.keys(), ...trackingByDate.keys()])].sort()) {
    const market = marketByDate.get(date);
    const tracking = trackingByDate.get(date);
    let matchedTargets = 0;
    let settledRows = 0;
    for (const row of tracking?.rows ?? []) {
      if (row.side !== "over" && row.side !== "under") continue;
      const storedRevision = settlements.get(row.rowKey);
      const box = boxByGamePlayer.get(`${suffix(row.gameId)}|${suffix(row.playerId)}`) ?? null;
      const revision = storedRevision ?? (box
        ? buildNbaPlayerPropsSettlementRevision({
          row,
          box,
          prior: null,
          observedAt: currentState?.updatedAt ?? new Date().toISOString(),
        }).revision
        : null);
      if (!revision || revision.actual === null || revision.result === "push" || revision.result === "void") continue;
      settledRows += 1;
      const target = market ? targetAtLock(row, market.observations) : null;
      const evidence = target && market
        ? buildNbaPlayerPropsMarketEvidence({ target, observations: market.observations, evaluatedAt: row.lockedAt })
        : null;
      if (target) matchedTargets += 1;
      const independentSide = row.independentProjection > row.line ? "over" : "under";
      const marketProbability = evidence?.targetExcludedOverProbability ?? null;
      const marketSide = marketProbability === null ? null : marketProbability > 0.5 ? "over" : "under";
      const useMarket = marketProbability !== null
        && Math.abs(marketProbability - 0.5) >= 0.02
        && marketSide !== independentSide;
      const twoPointSide = marketProbability === null ? null : useMarket ? marketSide : independentSide;
      scored.push({
        market: row.market,
        finalCorrect: sideCorrect(row.side, revision.actual, row.line),
        independentCorrect: sideCorrect(independentSide, revision.actual, row.line),
        twoPointReadCorrect: twoPointSide === null ? null : sideCorrect(twoPointSide, revision.actual, row.line),
        twoPointReadChanged: useMarket,
        qualifiedEvidence: evidence?.qualifiedForDecisionReplay ?? false,
        hasOpening: evidence?.openingLine !== null && evidence?.openingLine !== undefined,
        hasPrior: evidence?.priorLine !== null && evidence?.priorLine !== undefined,
        hasCurrent: evidence?.currentLine !== undefined,
        hasTargetExcluded: marketProbability !== null,
      });
    }
    dateInventory.push({
      slateDate: date,
      observations: market?.observations.length ?? 0,
      lockedRows: tracking?.rows.length ?? 0,
      settledRows,
      matchedTargets,
    });
  }
  const byMarket = Object.fromEntries([...new Set(scored.map((row) => row.market))].sort()
    .map((market) => [market, summarize(scored.filter((row) => row.market === market))]));
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_forward_evidence_inventory_2026_10_23_r1",
    mode: "select_only",
    season,
    snapshotRows: snapshots.length,
    snapshotKeys: snapshots.map((row) => row.snapshot_key),
    dates: dateInventory,
    overall: summarize(scored),
    byMarket,
    limitations: [
      "The two-point replay uses the stored independent projection, not the new support-weighted rebound candidate.",
      "Only rows with a genuine target quote at or before the immutable lock are eligible for full market-evidence reconstruction.",
      "Opening and prior coverage are measured at the evaluated target sportsbook without fabricating cross-book chronology.",
    ],
  }, null, 2)}\n`);
}

void main();
