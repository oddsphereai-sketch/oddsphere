import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { supabase } from "@/lib/db/supabase";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { EPL_COMPETITION, EPL_EXTERNAL_ID_OFFSET } from "./eplProductionPipeline";

const EPL_LOCK_MARKETS = ["match_result", "double_chance", "total", "btts"] as const;

type EplLockedRecord = Pick<PredictionRecordRow,
  "external_id" | "market" | "model_version" | "calibration_version" | "locked_at" | "snapshot_json"
  | "pick" | "side" | "line_value" | "odds_american" | "model_probability" | "market_probability"
  | "edge" | "expected_value" | "play_grade" | "best_angle" | "no_bet" | "held" | "hold_reason"
> & { id: number };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function numberEqual(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) < 1e-9;
}

function numberMatchesStoredPrecision(
  source: number | null | undefined,
  stored: number | null | undefined,
  decimalPlaces: number,
): boolean {
  if (source == null || stored == null) return source == null && stored == null;
  // prediction_records intentionally stores these columns at fixed schema
  // precision. Compare the captured source after the same decimal rounding;
  // a tighter float comparison rejects every legitimate persisted row.
  const scale = 10 ** decimalPlaces;
  return Math.round(source * scale) / scale === stored;
}

function memberMarketAtCapture(row: EplLockedRecord): MarketEdgeDto | null {
  const snapshot = row.snapshot_json as Record<string, unknown> | null;
  const market = snapshot?.member_market_at_capture;
  return market && typeof market === "object" ? market as MarketEdgeDto : null;
}

function memberProjectionAtCapture(
  row: EplLockedRecord,
): DailyEdgeResponse["games"][number]["soccerProjection"] | null {
  const snapshot = row.snapshot_json as Record<string, unknown> | null;
  const projection = snapshot?.member_projection_at_capture;
  return projection && typeof projection === "object"
    ? projection as DailyEdgeResponse["games"][number]["soccerProjection"]
    : null;
}

function memberMarketMatchesRecord(market: MarketEdgeDto, row: EplLockedRecord): boolean {
  const selectedSide = market.soccerPriceBoard?.rows.find((candidate) => candidate.selected)?.side ?? null;
  const verdict = market.verdict?.key ?? "no_play";
  const actionable = verdict === "best_angle" || verdict === "lean";
  const expectedLine = row.market === "total" ? market.line : null;
  const expectedHoldReason = market.held ? "missing_coherent_current_price" : null;
  return row.pick === row.side
    && (selectedSide === row.side || (selectedSide === null && row.side === null))
    && numberEqual(market.currentPriceAmerican, row.odds_american)
    && numberEqual(market.priceAmerican, row.odds_american)
    && numberMatchesStoredPrecision(market.modelProb, row.model_probability, 6)
    && numberMatchesStoredPrecision(market.marketFairProb, row.market_probability, 6)
    && numberMatchesStoredPrecision(market.modelMarketGapPct, row.edge, 3)
    && numberMatchesStoredPrecision(
      market.pinnacleEvPct == null ? null : market.pinnacleEvPct / 100,
      row.expected_value,
      4,
    )
    && numberEqual(expectedLine, row.line_value)
    && market.verdict.label === row.play_grade
    && row.best_angle === (verdict === "best_angle")
    && row.no_bet === !actionable
    && market.held === row.held
    && row.hold_reason === expectedHoldReason;
}

/**
 * Rebuilds a locked EPL member game only from its complete, immutable,
 * release-matched four-market database cohort. This is a reader repair: it
 * never recomputes or substitutes a side, grade, probability, price, or
 * projection, and one missing or incoherent market fails the whole game.
 */
export async function reconstructVerifiedEplLockedGames(input: {
  providerIds: number[];
  modelRelease: string;
  calibrationRelease: string;
  response: DailyEdgeResponse;
}, client: typeof supabase = supabase): Promise<{
  completeProviderIds: number[];
  incompleteProviderIds: number[];
  lockedResponse: DailyEdgeResponse;
}> {
  const providerIds = [...new Set(input.providerIds.filter(Number.isFinite))];
  if (providerIds.length === 0) {
    return { completeProviderIds: [], incompleteProviderIds: [], lockedResponse: input.response };
  }
  const externalIds = providerIds.map((id) => EPL_EXTERNAL_ID_OFFSET + id);
  const { data, error } = await client.from("prediction_records")
    .select("id,external_id,market,model_version,calibration_version,locked_at,snapshot_json,pick,side,line_value,odds_american,model_probability,market_probability,edge,expected_value,play_grade,best_angle,no_bet,held,hold_reason")
    .in("external_id", externalIds)
    .not("locked_at", "is", null);
  if (error) throw new Error(`verify EPL all-market locks: ${error.message}`);

  const rowsByProvider = new Map<number, Map<string, EplLockedRecord>>();
  for (const row of (data ?? []) as EplLockedRecord[]) {
    const providerId = row.external_id - EPL_EXTERNAL_ID_OFFSET;
    const snapshot = row.snapshot_json as Record<string, unknown> | null;
    const capturedMarket = memberMarketAtCapture(row);
    const exactAuthority = row.model_version === input.modelRelease
      && row.calibration_version === input.calibrationRelease
      && snapshot?.competition === EPL_COMPETITION;
    if (!row.locked_at || !exactAuthority || !capturedMarket || !memberMarketMatchesRecord(capturedMarket, row)) continue;
    const marketRows = rowsByProvider.get(providerId) ?? new Map<string, EplLockedRecord>();
    const existing = marketRows.get(row.market);
    if (!existing || Date.parse(row.locked_at) > Date.parse(existing.locked_at ?? "")) {
      marketRows.set(row.market, row);
    }
    rowsByProvider.set(providerId, marketRows);
  }

  const completeProviderIds = providerIds.filter((providerId) => {
    const rows = rowsByProvider.get(providerId);
    if (!rows || !EPL_LOCK_MARKETS.every((market) => rows.has(market))) return false;
    const projections = EPL_LOCK_MARKETS.map((market) => memberProjectionAtCapture(rows.get(market)!));
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
      const captured = (market: typeof EPL_LOCK_MARKETS[number]) => memberMarketAtCapture(rows.get(market)!)!;
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
  return {
    completeProviderIds,
    incompleteProviderIds: providerIds.filter((providerId) => !complete.has(providerId)),
    lockedResponse,
  };
}

export function eplProviderIdsDueForLock(response: DailyEdgeResponse, now = new Date()): number[] {
  const nowMs = now.getTime();
  return [...new Set(response.games
    .filter((game) => {
      const scheduledLockMs = Date.parse(game.scheduledLockAt ?? "");
      return Number.isFinite(scheduledLockMs) && nowMs >= scheduledLockMs;
    })
    .map((game) => Number(game.external_id))
    .filter(Number.isFinite))];
}
