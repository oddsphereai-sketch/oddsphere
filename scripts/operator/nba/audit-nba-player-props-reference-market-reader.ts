/** SELECT-only replay of sharp/reference, retail, and movement NBA prop evidence. */
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
import type { NbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  decodeNbaPlayerPropsPrivateTrackingHistory,
  type NbaPlayerPropsPrivateTrackingHistory,
  type NbaPlayerPropsPrivateTrackingRow,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateTracking";

type Side = "over" | "under";
type SnapshotRow = Readonly<{ snapshot_key: string; payload: unknown }>;
type Decision = Readonly<{
  slateDate: string;
  market: string;
  line: number;
  actual: number;
  independentSide: Side;
  releasedSide: Side;
  aggregateSide: Side | null;
  referenceSide: Side | null;
  retailSide: Side | null;
  referenceBooks: number;
  retailBooks: number;
  agreement: NbaPlayerPropsMarketEvidence["referenceRetailAgreement"];
  movementSupportsReference: boolean;
  movementOpposesReference: boolean;
}>;
type Rule = Readonly<{ name: string; choose: (row: Decision) => Side }>;

const DATES = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"] as const;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function suffix(value: string | null | undefined): string {
  return String(value ?? "").match(/(\d+)$/)?.[1] ?? normalize(value ?? "");
}

function decisionKey(row: NbaPlayerPropsPrivateTrackingRow): string {
  return [row.decisionRelease, row.gameId, row.playerId, row.market, row.line].join("|");
}

function sameScope(row: NbaPlayerPropsPrivateTrackingRow, observation: NbaPlayerPropPriceObservation): boolean {
  const playerMatches = suffix(observation.canonicalPlayerId ?? observation.providerPlayerId) === suffix(row.playerId)
    || normalize(observation.playerName ?? "") === normalize(row.playerName);
  return suffix(observation.canonicalGameId) === suffix(row.gameId)
    && playerMatches
    && observation.market === row.market;
}

function observationIndex(rows: readonly NbaPlayerPropPriceObservation[]): Map<string, NbaPlayerPropPriceObservation[]> {
  const index = new Map<string, NbaPlayerPropPriceObservation[]>();
  for (const row of rows) {
    const game = suffix(row.canonicalGameId);
    const players = new Set<string>();
    if (row.canonicalPlayerId || row.providerPlayerId) players.add(`id:${suffix(row.canonicalPlayerId ?? row.providerPlayerId)}`);
    if (row.playerName) players.add(`name:${normalize(row.playerName)}`);
    for (const player of players) {
      const key = `${game}|${row.market}|${player}`;
      index.set(key, [...(index.get(key) ?? []), row]);
    }
  }
  return index;
}

function indexedScope(
  row: NbaPlayerPropsPrivateTrackingRow,
  index: ReadonlyMap<string, NbaPlayerPropPriceObservation[]>,
): NbaPlayerPropPriceObservation[] {
  const prefix = `${suffix(row.gameId)}|${row.market}|`;
  const byId = index.get(`${prefix}id:${suffix(row.playerId)}`) ?? [];
  const byName = index.get(`${prefix}name:${normalize(row.playerName)}`) ?? [];
  return [...new Map([...byId, ...byName].map((observation) => [observation.providerObservationId, observation])).values()];
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

function actualForMarket(market: string, box: NbaPlayerPropsCurrentState["boxes"][number]): number | null {
  const rebounds = box.oreb + box.dreb;
  if (market === "points") return box.points;
  if (market === "rebounds") return rebounds;
  if (market === "assists") return box.ast;
  if (market === "threes") return box.fg3m;
  if (market === "points_rebounds_assists") return box.points + rebounds + box.ast;
  if (market === "points_rebounds") return box.points + rebounds;
  if (market === "points_assists") return box.points + box.ast;
  if (market === "rebounds_assists") return rebounds + box.ast;
  return null;
}

function probabilitySide(value: number | null): Side | null {
  return value === null || value === 0.5 ? null : value > 0.5 ? "over" : "under";
}

function movementState(evidence: NbaPlayerPropsMarketEvidence, side: Side | null) {
  if (!side) return { supports: false, opposes: false };
  const toward = side === "over" ? "toward_over" : "toward_under";
  const away = side === "over" ? "toward_under" : "toward_over";
  return {
    supports: evidence.lineMovement === toward || evidence.priceMovement === toward,
    opposes: evidence.lineMovement === away || evidence.priceMovement === away,
  };
}

function correct(side: Side, row: Decision): boolean {
  return side === "over" ? row.actual > row.line : row.actual < row.line;
}

function summarize(rule: Rule, rows: readonly Decision[]) {
  const decisions = rows.map((row) => ({ row, side: rule.choose(row) }));
  const changed = decisions.filter(({ row, side }) => side !== row.independentSide);
  const correctRows = decisions.filter(({ row, side }) => correct(side, row));
  return {
    rule: rule.name,
    rows: rows.length,
    correct: correctRows.length,
    hitRate: rows.length > 0 ? correctRows.length / rows.length : null,
    changed: changed.length,
    corrections: changed.filter(({ row, side }) => !correct(row.independentSide, row) && correct(side, row)).length,
    harms: changed.filter(({ row, side }) => correct(row.independentSide, row) && !correct(side, row)).length,
    overShare: rows.length > 0 ? decisions.filter(({ side }) => side === "over").length / rows.length : null,
  };
}

function useReference(row: Decision, qualifier: (row: Decision) => boolean): Side {
  return row.referenceSide && qualifier(row) ? row.referenceSide : row.independentSide;
}

async function main(): Promise<void> {
  const snapshots: SnapshotRow[] = [];
  const { data: stateData, error: stateError } = await supabase.from("lab_response_snapshots")
    .select("snapshot_key,payload")
    .eq("snapshot_key", "nba::player-props-private-current-state::2026")
    .maybeSingle();
  if (stateError) throw new Error(`NBA prop current-state audit read failed: ${stateError.message}`);
  if (stateData) snapshots.push(stateData as SnapshotRow);
  for (const date of DATES) {
    const { data: dateData, error: dateError } = await supabase.from("lab_response_snapshots")
      .select("snapshot_key,payload")
      .in("snapshot_key", [
        `nba::player-props-private-market::${date}`,
        `nba::player-props-private-tracking::2026::${date}`,
      ]);
    if (dateError) throw new Error(`NBA prop ${date} audit read failed: ${dateError.message}`);
    snapshots.push(...((dateData ?? []) as SnapshotRow[]));
    process.stderr.write(`loaded ${date}\n`);
  }
  const markets = new Map<string, NbaPlayerPropsMarketHistory>();
  const tracking = new Map<string, NbaPlayerPropsPrivateTrackingHistory>();
  let state: NbaPlayerPropsCurrentState | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.snapshot_key.includes("private-market::")) {
      const decoded = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsMarketHistory>(snapshot.payload, "market_history");
      if (decoded) markets.set(decoded.slateDate, decoded);
    } else if (snapshot.snapshot_key.includes("private-tracking::")) {
      const decoded = decodeNbaPlayerPropsPrivateTrackingHistory(snapshot.payload);
      if (decoded) tracking.set(decoded.slateDate, decoded);
    } else if (snapshot.snapshot_key.includes("private-current-state::")) {
      state = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsCurrentState>(snapshot.payload, "current_state");
    }
  }
  if (!state) throw new Error("NBA prop current-state evidence is missing.");
  const boxes = new Map(state.boxes.map((box) => [`${box.gameId}|${box.playerId}`, box]));
  const decisions: Decision[] = [];
  for (const date of DATES) {
    const market = markets.get(date);
    const tracked = tracking.get(date);
    if (!market || !tracked) continue;
    const marketIndex = observationIndex(market.observations);
    const canonical = tracked.rows.filter((row) => row.canonicalMainLine && (row.side === "over" || row.side === "under"));
    const scopes = new Map<string, NbaPlayerPropsPrivateTrackingRow[]>();
    for (const row of canonical) scopes.set(decisionKey(row), [...(scopes.get(decisionKey(row)) ?? []), row]);
    for (const rows of scopes.values()) {
      const row = rows[0]!;
      if (new Set(rows.map((value) => value.side)).size !== 1) continue;
      const box = boxes.get(`${suffix(row.gameId)}|${suffix(row.playerId)}`);
      if (!box || box.minutes <= 0) continue;
      const actual = actualForMarket(row.market, box);
      if (actual === null || actual === row.line) continue;
      const scopedObservations = indexedScope(row, marketIndex);
      const target = targetAtLock(row, scopedObservations);
      if (!target) continue;
      const evidence = buildNbaPlayerPropsMarketEvidence({
        target,
        observations: scopedObservations,
        evaluatedAt: row.lockedAt,
      });
      const referenceSide = probabilitySide(evidence.targetExcludedReferenceOverProbability);
      const movement = movementState(evidence, referenceSide);
      decisions.push({
        slateDate: date,
        market: row.market,
        line: row.line,
        actual,
        independentSide: row.independentProjection > row.line ? "over" : "under",
        releasedSide: row.side as Side,
        aggregateSide: probabilitySide(evidence.targetExcludedOverProbability),
        referenceSide,
        retailSide: probabilitySide(evidence.targetExcludedRetailOverProbability),
        referenceBooks: evidence.targetExcludedReferenceBooks,
        retailBooks: evidence.targetExcludedRetailBooks,
        agreement: evidence.referenceRetailAgreement,
        movementSupportsReference: movement.supports,
        movementOpposesReference: movement.opposes,
      });
    }
  }
  const rules: Rule[] = [
    { name: "released", choose: (row) => row.releasedSide },
    { name: "independent", choose: (row) => row.independentSide },
    { name: "aggregate_any", choose: (row) => row.aggregateSide ?? row.independentSide },
    { name: "reference_any", choose: (row) => useReference(row, (value) => value.referenceBooks >= 1) },
    { name: "reference_two_books", choose: (row) => useReference(row, (value) => value.referenceBooks >= 2) },
    { name: "reference_retail_agree", choose: (row) => useReference(row, (value) => value.referenceBooks >= 1 && value.retailBooks >= 1 && value.agreement.startsWith("agree_")) },
    { name: "reference_not_opposed", choose: (row) => useReference(row, (value) => value.referenceBooks >= 1 && !value.movementOpposesReference) },
    { name: "reference_supported", choose: (row) => useReference(row, (value) => value.referenceBooks >= 1 && value.movementSupportsReference) },
    { name: "reference_agree_or_supported", choose: (row) => useReference(row, (value) => value.referenceBooks >= 1 && ((value.retailBooks >= 1 && value.agreement.startsWith("agree_")) || value.movementSupportsReference)) },
    { name: "reference_two_or_confirmed", choose: (row) => useReference(row, (value) => value.referenceBooks >= 2 || (value.referenceBooks >= 1 && ((value.retailBooks >= 1 && value.agreement.startsWith("agree_")) || value.movementSupportsReference))) },
  ];
  const score = (rows: readonly Decision[]) => rules.map((rule) => summarize(rule, rows))
    .sort((left, right) => (right.hitRate ?? 0) - (left.hitRate ?? 0) || left.changed - right.changed);
  const marketNames = [...new Set(decisions.map((row) => row.market))].sort();
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_reference_market_reader_audit_2026_10_28_r1",
    mode: "select_only",
    dates: DATES,
    settledRowsWithExactMarketEvidence: decisions.length,
    evidenceCoverage: {
      reference: decisions.filter((row) => row.referenceBooks > 0).length,
      twoReferenceBooks: decisions.filter((row) => row.referenceBooks > 1).length,
      retail: decisions.filter((row) => row.retailBooks > 0).length,
      referenceRetailAgreement: decisions.filter((row) => row.agreement.startsWith("agree_")).length,
      referenceRetailDisagreement: decisions.filter((row) => row.agreement === "disagree").length,
      referenceMovementSupport: decisions.filter((row) => row.movementSupportsReference).length,
      referenceMovementOpposition: decisions.filter((row) => row.movementOpposesReference).length,
    },
    overall: score(decisions),
    development: score(decisions.filter((row) => row.slateDate <= "2026-10-24")),
    confirmation: score(decisions.filter((row) => row.slateDate >= "2026-10-25")),
    byMarket: Object.fromEntries(marketNames.map((market) => [market, score(decisions.filter((row) => row.market === market))])),
    byMarketDevelopment: Object.fromEntries(marketNames.map((market) => [market, score(decisions.filter((row) => row.market === market && row.slateDate <= "2026-10-24"))])),
    byMarketConfirmation: Object.fromEntries(marketNames.map((market) => [market, score(decisions.filter((row) => row.market === market && row.slateDate >= "2026-10-25"))])),
    bySlateDate: Object.fromEntries(DATES.map((date) => [date, score(decisions.filter((row) => row.slateDate === date))])),
  }, null, 2)}\n`);
}

void main();
