import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { findEplGamesEnteringLock, seedEplSlate, writeEplPredictionRecords, type ClubSoccerPipelineConfig } from "@/lib/services/epl/eplProductionPipeline";
import type { UclSlate } from "./buildUclSlate";
import { UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND } from "./uclCompetitionContext";
import { UCL_MODEL_RELEASE } from "./uclModel";
import { supabase } from "@/lib/db/supabase";

export const UCL_LOCK_MINUTES = 60;

export function uclPipelineConfig(slate: UclSlate): ClubSoccerPipelineConfig {
  return {
    competition: UCL_COMPETITION,
    externalIdOffset: UCL_EXTERNAL_ID_OFFSET,
    externalIdUpperBound: UCL_EXTERNAL_ID_UPPER_BOUND,
    slugPrefix: "ucl",
    providerIdKey: "balldontlie_ucl",
    predictionSource: "ucl_club_model",
    lockMinutes: UCL_LOCK_MINUTES,
    contextForGame: (providerId) => slate.competitionContexts[providerId] ?? null,
    preservePriorPricedTupleOnMissingLock: true,
    returnPreservedLockedRecordIds: true,
  };
}

export function seedUclSlate(input: { slate: UclSlate; apply: boolean; client?: typeof supabase }) {
  return seedEplSlate({ ...input, config: uclPipelineConfig(input.slate) });
}

export function writeUclPredictionRecords(input: { slate: UclSlate; response: DailyEdgeResponse; apply: boolean; now?: Date; client?: typeof supabase }) {
  return writeEplPredictionRecords({ ...input, config: uclPipelineConfig(input.slate) });
}

export function findUclGamesEnteringLock(now = new Date()) {
  return findEplGamesEnteringLock(now, {
    modelRelease: UCL_MODEL_RELEASE,
    lockMinutes: UCL_LOCK_MINUTES,
    externalIdOffset: UCL_EXTERNAL_ID_OFFSET,
    externalIdUpperBound: UCL_EXTERNAL_ID_UPPER_BOUND,
  });
}

export function uclRefreshProviderIdsDueForLock(
  response: DailyEdgeResponse,
  now = new Date(),
): number[] {
  const nowMs = now.getTime();
  return [...new Set(response.games
    .filter((game) => {
      const explicitLockMs = Date.parse(game.scheduledLockAt ?? "");
      const kickoffMs = Date.parse(game.gameStartAt ?? "");
      const scheduledLockMs = Number.isFinite(explicitLockMs)
        ? explicitLockMs
        : Number.isFinite(kickoffMs) ? kickoffMs - UCL_LOCK_MINUTES * 60_000 : Number.NaN;
      return Number.isFinite(scheduledLockMs) && nowMs >= scheduledLockMs;
    })
    .map((game) => Number(game.external_id))
    .filter(Number.isFinite))];
}

const UCL_LOCK_MARKETS = ["match_result", "double_chance", "total", "btts"] as const;
const UCL_IMMUTABLE_TUPLE_FIELDS = [
  "pick", "side", "line_value", "odds_american", "model_probability", "market_probability",
  "edge", "expected_value", "play_grade", "best_angle", "no_bet", "held", "hold_reason",
] as const;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

type UclLockedRecord = Pick<PredictionRecordRow,
  "external_id" | "market" | "model_version" | "calibration_version" | "locked_at" | "snapshot_json"
  | "pick" | "side" | "line_value" | "odds_american" | "model_probability" | "market_probability"
  | "edge" | "expected_value" | "play_grade" | "best_angle" | "no_bet" | "held" | "hold_reason"
> & { id: number };

function matchesImmutableTuple(actual: UclLockedRecord, expected: PredictionRecordRow): boolean {
  return UCL_IMMUTABLE_TUPLE_FIELDS.every((field) => actual[field] === expected[field])
    && canonicalJson(actual.snapshot_json) === canonicalJson(expected.snapshot_json);
}

function numberEqual(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) < 1e-9;
}

function memberMarketAtCapture(row: UclLockedRecord): MarketEdgeDto | null {
  const snapshot = row.snapshot_json as Record<string, unknown> | null;
  const market = snapshot?.member_market_at_capture;
  if (!market || typeof market !== "object") return null;
  return market as MarketEdgeDto;
}

function memberMarketMatchesRecord(market: MarketEdgeDto, row: UclLockedRecord): boolean {
  const selectedSide = market.soccerPriceBoard?.rows.find((candidate) => candidate.selected)?.side ?? null;
  const verdict = market.verdict?.key ?? "no_play";
  const actionable = verdict === "best_angle" || verdict === "lean";
  const expectedLine = row.market === "total" ? market.line : null;
  const expectedHoldReason = market.held ? "missing_coherent_current_price" : null;
  return row.pick === row.side
    && (selectedSide === row.side || (selectedSide === null && row.side === null))
    && numberEqual(market.currentPriceAmerican, row.odds_american)
    && numberEqual(market.priceAmerican, row.odds_american)
    && numberEqual(market.modelProb, row.model_probability)
    && numberEqual(market.marketFairProb, row.market_probability)
    && numberEqual(market.modelMarketGapPct, row.edge)
    && numberEqual(market.pinnacleEvPct, row.expected_value == null ? null : row.expected_value * 100)
    && numberEqual(expectedLine, row.line_value)
    && market.verdict.label === row.play_grade
    && row.best_angle === (verdict === "best_angle")
    && row.no_bet === !actionable
    && market.held === row.held
    && row.hold_reason === expectedHoldReason;
}

function memberProjectionAtCapture(row: UclLockedRecord): DailyEdgeResponse["games"][number]["soccerProjection"] | null {
  const snapshot = row.snapshot_json as Record<string, unknown> | null;
  const projection = snapshot?.member_projection_at_capture;
  return projection && typeof projection === "object"
    ? projection as DailyEdgeResponse["games"][number]["soccerProjection"]
    : null;
}

/** Proves the immutable DB record is complete before a whole game can be
 * exposed as locked in the member snapshot. Any missing market fails closed. */
export async function verifyUclAllMarketLocks(input: {
  providerIds: number[];
  modelRelease: string;
  calibrationRelease: string;
  expectedRows: PredictionRecordRow[];
  writerLockedRecordIds: number[];
  response: DailyEdgeResponse;
}, client: typeof supabase = supabase) {
  const providerIds = input.providerIds;
  if (!providerIds.length) return { completeProviderIds: [] as number[], incompleteProviderIds: [] as number[], lockedResponse: input.response };
  const externalIds = providerIds.map((id) => UCL_EXTERNAL_ID_OFFSET + id);
  const { data, error } = await client.from("prediction_records")
    .select("id,external_id,market,model_version,calibration_version,locked_at,snapshot_json,pick,side,line_value,odds_american,model_probability,market_probability,edge,expected_value,play_grade,best_angle,no_bet,held,hold_reason")
    .in("external_id", externalIds)
    .not("locked_at", "is", null);
  if (error) throw new Error(`verify UCL all-market locks: ${error.message}`);
  const expectedByKey = new Map(input.expectedRows.map((row) => [`${row.external_id}:${row.market}`, row]));
  const writerLockedIds = new Set(input.writerLockedRecordIds);
  const rowsByProvider = new Map<number, Map<string, UclLockedRecord>>();
  for (const row of (data ?? []) as UclLockedRecord[]) {
    const providerId = row.external_id - UCL_EXTERNAL_ID_OFFSET;
    const snapshot = row.snapshot_json as Record<string, unknown> | null;
    const exactAuthority = row.model_version === input.modelRelease
      && row.calibration_version === input.calibrationRelease
      && snapshot?.competition === UCL_COMPETITION;
    const expected = expectedByKey.get(`${row.external_id}:${row.market}`);
    const exactIdentity = writerLockedIds.has(row.id) || (expected !== undefined && matchesImmutableTuple(row, expected));
    const capturedMarket = memberMarketAtCapture(row);
    if (!row.locked_at || !exactAuthority || !exactIdentity || !capturedMarket || !memberMarketMatchesRecord(capturedMarket, row)) continue;
    const map = rowsByProvider.get(providerId) ?? new Map<string, UclLockedRecord>();
    map.set(row.market, row);
    rowsByProvider.set(providerId, map);
  }
  const completeProviderIds = providerIds.filter((id) => {
    const rows = rowsByProvider.get(id);
    if (!rows || !UCL_LOCK_MARKETS.every((market) => rows.has(market))) return false;
    const projections = UCL_LOCK_MARKETS.map((market) => memberProjectionAtCapture(rows.get(market)!));
    return projections.every((projection) => projection !== null)
      && projections.every((projection) => canonicalJson(projection) === canonicalJson(projections[0]));
  });
  const complete = new Set(completeProviderIds);
  const lockedResponse: DailyEdgeResponse = {
    ...input.response,
    games: input.response.games.map((game) => {
      const providerId = Number(game.external_id);
      if (!complete.has(providerId)) return game;
      const rows = rowsByProvider.get(providerId)!;
      const captured = (market: typeof UCL_LOCK_MARKETS[number]) => memberMarketAtCapture(rows.get(market)!)!;
      const anchor = rows.get("match_result")!;
      const anchorSnapshot = anchor.snapshot_json as Record<string, unknown>;
      const lockedAt = [...rows.values()].map((row) => row.locked_at!).sort().at(-1)!;
      return {
        ...game,
        lockState: "locked",
        lockedAt,
        soccerProjection: memberProjectionAtCapture(anchor)!,
        soccerModelProvenance: (anchorSnapshot.model_provenance as typeof game.soccerModelProvenance) ?? game.soccerModelProvenance,
        soccerCompetitionContext: (anchorSnapshot.competition_context as typeof game.soccerCompetitionContext) ?? game.soccerCompetitionContext,
        markets: {
          ...game.markets,
          moneyline: captured("match_result"),
          total: captured("total"),
          first_inning: captured("btts"),
        },
        soccerDoubleChanceMarket: captured("double_chance"),
      };
    }),
  };
  return { completeProviderIds, incompleteProviderIds: providerIds.filter((id) => !complete.has(id)), lockedResponse };
}

/** The general refresh shares the same T-60 writer and therefore must prove
 * every due immutable cohort before it can publish a replacement snapshot. */
export async function verifyUclRefreshAllMarketLocks(input: {
  response: DailyEdgeResponse;
  now: Date;
  modelRelease: string;
  calibrationRelease: string;
  expectedRows: PredictionRecordRow[];
  writerLockedRecordIds: number[];
}, client: typeof supabase = supabase) {
  const dueProviderIds = uclRefreshProviderIdsDueForLock(input.response, input.now);
  const verification = await verifyUclAllMarketLocks({
    providerIds: dueProviderIds,
    modelRelease: input.modelRelease,
    calibrationRelease: input.calibrationRelease,
    expectedRows: input.expectedRows,
    writerLockedRecordIds: input.writerLockedRecordIds,
    response: input.response,
  }, client);
  return { dueProviderIds, ...verification };
}
