/** SELECT-only replay of rebound-family market arbitration from immutable locks. */
import { supabase } from "../../../lib/db/supabase";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import {
  buildNbaPlayerPropsMarketEvidence,
  type NbaPlayerPropsMarketEvidence,
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
  payload: unknown;
}>;

type ReboundFamilyMarket = "rebounds" | "points_rebounds" | "rebounds_assists" | "points_rebounds_assists";
type Side = "over" | "under";
type Decision = Readonly<{
  player: string;
  market: ReboundFamilyMarket;
  line: number;
  actual: number;
  independentSide: Side;
  releasedSide: Side;
  marketSide: Side;
  marketDistance: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  lineMovement: NbaPlayerPropsMarketEvidence["lineMovement"];
  priceMovement: NbaPlayerPropsMarketEvidence["priceMovement"];
  independentCorrect: boolean;
  releasedCorrect: boolean;
}>;

type Rule = Readonly<{
  name: string;
  choose: (row: Decision) => Side;
}>;

const REBOUND_FAMILY = new Set<ReboundFamilyMarket>([
  "rebounds",
  "points_rebounds",
  "rebounds_assists",
  "points_rebounds_assists",
]);

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function suffix(input: string | null | undefined): string {
  return String(input ?? "").match(/(\d+)$/)?.[1] ?? normalize(input ?? "");
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function sideCorrect(side: Side, actual: number, line: number): boolean {
  return side === "over" ? actual > line : actual < line;
}

function directionSupports(row: Decision, side: Side): boolean {
  const wanted = side === "over" ? "toward_over" : "toward_under";
  return row.lineMovement === wanted || row.priceMovement === wanted;
}

function directionOpposes(row: Decision, side: Side): boolean {
  const opposed = side === "over" ? "toward_under" : "toward_over";
  return row.lineMovement === opposed || row.priceMovement === opposed;
}

function marketOverride(row: Decision, args: {
  distance: number;
  books: number;
  referenceBooks: number;
  movement: "none" | "not_opposed" | "supporting";
}): Side {
  if (row.marketSide === row.independentSide
    || row.marketDistance < args.distance
    || row.targetExcludedBooks < args.books
    || row.targetExcludedReferenceBooks < args.referenceBooks) return row.independentSide;
  if (args.movement === "supporting" && !directionSupports(row, row.marketSide)) return row.independentSide;
  if (args.movement === "not_opposed" && directionOpposes(row, row.marketSide)) return row.independentSide;
  return row.marketSide;
}

function summarize(rule: Rule, rows: readonly Decision[]) {
  const selected = rows.map((row) => ({ row, side: rule.choose(row) }));
  const changed = selected.filter(({ row, side }) => side !== row.independentSide);
  return {
    rule: rule.name,
    settledRows: rows.length,
    correct: selected.filter(({ row, side }) => sideCorrect(side, row.actual, row.line)).length,
    hitRate: rows.length > 0
      ? selected.filter(({ row, side }) => sideCorrect(side, row.actual, row.line)).length / rows.length
      : null,
    changedRows: changed.length,
    corrected: changed.filter(({ row, side }) => !row.independentCorrect && sideCorrect(side, row.actual, row.line)).length,
    harmed: changed.filter(({ row, side }) => row.independentCorrect && !sideCorrect(side, row.actual, row.line)).length,
  };
}

async function main(): Promise<void> {
  const season = Number(value("--season") ?? "2026");
  const slateDate = value("--slate-date") ?? "2026-10-22";
  if (!Number.isInteger(season)) throw new Error("--season must be an integer.");
  const { data, error } = await supabase.from("lab_response_snapshots")
    .select("snapshot_key,payload")
    .eq("sport", "nba")
    .in("snapshot_key", [
      `nba::player-props-private-market::${slateDate}`,
      `nba::player-props-private-tracking::${season}::${slateDate}`,
      nbaPlayerPropsSettlementKey(season),
    ]);
  if (error) throw new Error(`NBA rebound market-reader audit failed: ${error.message}`);
  const snapshots = (data ?? []) as SnapshotRow[];
  let market: NbaPlayerPropsMarketHistory | null = null;
  let tracking: ReturnType<typeof decodeNbaPlayerPropsPrivateTrackingHistory> = null;
  let settlement: NbaPlayerPropsSettlementHistory | null = null;
  for (const row of snapshots) {
    if (row.snapshot_key.includes("private-market::")) {
      market = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsMarketHistory>(row.payload, "market_history");
    } else if (row.snapshot_key.includes("private-tracking::")) {
      tracking = decodeNbaPlayerPropsPrivateTrackingHistory(row.payload);
    } else if (row.snapshot_key === nbaPlayerPropsSettlementKey(season)) {
      const decoded = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsSettlementHistory>(row.payload, "tracking_history");
      if (decoded?.release === NBA_PLAYER_PROPS_SETTLEMENT_RELEASE) settlement = decoded;
    }
  }
  if (!market || !tracking) throw new Error("Required immutable market or tracking snapshot is missing.");
  const settlements = latestSettlements(settlement);
  const currentState = await readNbaPlayerPropsCurrentState({ client: supabase, season });
  const boxByGamePlayer = new Map((currentState?.boxes ?? []).map((box) => [`${box.gameId}|${box.playerId}`, box]));
  const decisions: Decision[] = [];
  for (const row of tracking.rows) {
    if ((row.side !== "over" && row.side !== "under") || !REBOUND_FAMILY.has(row.market as ReboundFamilyMarket)) continue;
    const storedRevision = settlements.get(row.rowKey);
    const box = boxByGamePlayer.get(`${suffix(row.gameId)}|${suffix(row.playerId)}`) ?? null;
    const revision = storedRevision ?? (box
      ? buildNbaPlayerPropsSettlementRevision({ row, box, prior: null, observedAt: currentState?.updatedAt ?? new Date().toISOString() }).revision
      : null);
    if (!revision || revision.actual === null || revision.result === "push" || revision.result === "void") continue;
    const target = targetAtLock(row, market.observations);
    if (!target) continue;
    const evidence = buildNbaPlayerPropsMarketEvidence({ target, observations: market.observations, evaluatedAt: row.lockedAt });
    if (evidence.targetExcludedOverProbability === null) continue;
    const independentSide: Side = row.independentProjection > row.line ? "over" : "under";
    const marketSide: Side = evidence.targetExcludedOverProbability > 0.5 ? "over" : "under";
    decisions.push({
      player: row.playerName,
      market: row.market as ReboundFamilyMarket,
      line: row.line,
      actual: revision.actual,
      independentSide,
      releasedSide: row.side,
      marketSide,
      marketDistance: Math.abs(evidence.targetExcludedOverProbability - 0.5),
      targetExcludedBooks: evidence.targetExcludedBooks,
      targetExcludedReferenceBooks: evidence.targetExcludedReferenceBooks,
      lineMovement: evidence.lineMovement,
      priceMovement: evidence.priceMovement,
      independentCorrect: sideCorrect(independentSide, revision.actual, row.line),
      releasedCorrect: sideCorrect(row.side, revision.actual, row.line),
    });
  }
  const rules: Rule[] = [
    { name: "released", choose: (row) => row.releasedSide },
    { name: "independent", choose: (row) => row.independentSide },
  ];
  for (const distance of [0, 0.02, 0.03, 0.04, 0.05]) {
    for (const books of [1, 2, 3]) {
      for (const referenceBooks of [0, 1, 2]) {
        for (const movement of ["none", "not_opposed", "supporting"] as const) {
          rules.push({
            name: `market_${Math.round(distance * 100)}pp_${books}books_${referenceBooks}refs_${movement}`,
            choose: (row) => marketOverride(row, { distance, books, referenceBooks, movement }),
          });
        }
      }
    }
  }
  const byMarket = Object.fromEntries([...REBOUND_FAMILY].map((marketName) => {
    const rows = decisions.filter((row) => row.market === marketName);
    return [marketName, rules.map((rule) => summarize(rule, rows)).sort((left, right) =>
      right.correct - left.correct || left.changedRows - right.changedRows || left.rule.localeCompare(right.rule)).slice(0, 15)];
  }));
  const overall = rules.map((rule) => summarize(rule, decisions)).sort((left, right) =>
    right.correct - left.correct || left.changedRows - right.changedRows || left.rule.localeCompare(right.rule)).slice(0, 25);
  const disagreements = decisions.filter((row) => row.marketSide !== row.independentSide)
    .sort((left, right) => left.market.localeCompare(right.market) || right.marketDistance - left.marketDistance);
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_rebound_market_reader_audit_2026_10_23_r1",
    mode: "select_only",
    season,
    slateDate,
    settledRows: decisions.length,
    overall,
    byMarket,
    disagreements,
  }, null, 2)}\n`);
}

void main();
