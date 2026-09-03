import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { supabase } from "@/lib/db/supabase";
import type { PredictionRecordRow, TrackedMarketV17 } from "@/lib/types/domain/Tracking";
import type { EplShadowSlate } from "./buildEplShadowSlate";
import { EPL_SHADOW_MODEL_RELEASE } from "./eplShadowModel";
import { mergeEplForwardEvidenceHistory, type EplForwardEvidenceCapture } from "./eplForwardEvidenceCapture";

export const EPL_COMPETITION = "english_premier_league" as const;
export const EPL_LOCK_MINUTES = 60;
export const EPL_EXTERNAL_ID_OFFSET = 20_000_000;

const providerExternalId = (id: number, offset = EPL_EXTERNAL_ID_OFFSET) => offset + id;

export type ClubSoccerPipelineConfig = {
  competition: string;
  externalIdOffset: number;
  externalIdUpperBound?: number;
  slugPrefix: string;
  providerIdKey: string;
  predictionSource: string;
  lockMinutes?: number;
  contextForGame?: (providerId: number) => Record<string, unknown> | null;
  /** UCL-only lock recovery: preserve the last priced tuple when its quote
   * disappears at T-60, and return exact already-locked IDs for snapshot repair. */
  preservePriorPricedTupleOnMissingLock?: boolean;
  returnPreservedLockedRecordIds?: boolean;
};

export const EPL_PIPELINE_CONFIG: ClubSoccerPipelineConfig = {
  competition: EPL_COMPETITION,
  externalIdOffset: EPL_EXTERNAL_ID_OFFSET,
  externalIdUpperBound: 30_000_000,
  slugPrefix: "epl",
  providerIdKey: "balldontlie_epl",
  predictionSource: "epl_club_model",
  lockMinutes: EPL_LOCK_MINUTES,
};

export type EplLockCandidate = { gameId: number; externalId: number; kickoff: string; unlockedMarkets: number };

type EplPriorPredictionRecord = {
  id?: number;
  model_version: string;
  calibration_version?: string | null;
  locked_at: string | null;
  held: boolean | null;
  snapshot_json: Record<string, unknown> | null;
};

export function eplPriorRowsBlockWrite(rows: EplPriorPredictionRecord[]): boolean {
  return rows.some((prior) => prior.locked_at !== null);
}

/**
 * Cheap minute-sweep classification. Paid providers are called only when a
 * game has actually crossed T-60 and still needs its immutable final capture.
 */
export async function findEplGamesEnteringLock(
  now: Date = new Date(),
  options: { modelRelease?: string; lockMinutes?: number; externalIdOffset?: number; externalIdUpperBound?: number; client?: typeof supabase } = {},
): Promise<EplLockCandidate[]> {
  const client = options.client ?? supabase;
  const lockMinutes = options.lockMinutes ?? EPL_LOCK_MINUTES;
  const lockWindowEnd = new Date(now.getTime() + lockMinutes * 60_000).toISOString();
  const { data: records, error: recordError } = await client
    .from("prediction_records")
    .select("game_id,market,locked_at")
    .eq("model_version", options.modelRelease ?? EPL_SHADOW_MODEL_RELEASE)
    .is("locked_at", null);
  if (recordError) throw new Error(`load EPL prediction locks: ${recordError.message}`);
  const unlockedByGame = new Map<number, number>();
  for (const row of (records ?? []) as Array<{ game_id: number; market: string; locked_at: string | null }>) {
    if (!row.locked_at) unlockedByGame.set(row.game_id, (unlockedByGame.get(row.game_id) ?? 0) + 1);
  }
  const gameIds = [...unlockedByGame.keys()];
  if (gameIds.length === 0) return [];
  const { data: games, error } = await client
    .from("games")
    .select("id,external_id,game_date,status")
    .eq("sport", "soccer")
    .in("id", gameIds)
    .gt("game_date", now.toISOString())
    .lte("game_date", lockWindowEnd);
  if (error) throw new Error(`load EPL lock candidates: ${error.message}`);
  const rows = (games ?? []) as Array<{ id: number; external_id: number; game_date: string | null; status: string | null }>;
  return rows
    .filter((row) => row.external_id >= (options.externalIdOffset ?? EPL_EXTERNAL_ID_OFFSET))
    .filter((row) => options.externalIdUpperBound === undefined || row.external_id < options.externalIdUpperBound)
    .filter((row) => !["final", "completed", "canceled", "cancelled", "postponed"].includes((row.status ?? "").toLowerCase()))
    .map((row) => ({ gameId: row.id, externalId: row.external_id, kickoff: row.game_date!, unlockedMarkets: unlockedByGame.get(row.id) ?? 0 }))
    .filter((row) => row.unlockedMarkets > 0);
}

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function canonicalSide(market: MarketEdgeDto, trackedMarket: TrackedMarketV17): string | null {
  const selected = market.soccerPriceBoard?.rows.find((row) => row.selected)?.side ?? null;
  if (!selected) return null;
  if (trackedMarket === "match_result" && (selected === "home" || selected === "draw" || selected === "away")) return selected;
  if (trackedMarket === "double_chance" && (selected === "home_or_draw" || selected === "away_or_draw" || selected === "home_or_away")) return selected;
  if (trackedMarket === "total" && (selected === "over" || selected === "under")) return selected;
  if (trackedMarket === "btts" && (selected === "yes" || selected === "no")) return selected;
  return null;
}

function expectedValue(modelProbability: number | null, price: number | null): number | null {
  if (modelProbability === null || price === null) return null;
  const decimal = price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
  return modelProbability * decimal - 1;
}

function immutableJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordFromMarket(input: {
  game: DailyEdgeGameDto;
  internalGameId: number;
  externalId: number;
  market: MarketEdgeDto;
  trackedMarket: "match_result" | "double_chance" | "total" | "btts";
  modelRelease: string;
  calibrationRelease: string;
  now: Date;
  config: ClubSoccerPipelineConfig;
}): PredictionRecordRow {
  const side = canonicalSide(input.market, input.trackedMarket);
  const kickoffMs = Date.parse(input.game.gameStartAt ?? "");
  const lockAt = Number.isFinite(kickoffMs) ? new Date(kickoffMs - (input.config.lockMinutes ?? EPL_LOCK_MINUTES) * 60_000).toISOString() : null;
  const shouldLock = lockAt !== null && input.now.getTime() >= Date.parse(lockAt);
  const verdict = input.market.verdict?.key ?? "no_play";
  const actionable = verdict === "best_angle" || verdict === "lean";
  const missingPrice = input.market.currentPriceAmerican === null || side === null;
  return {
    game_prediction_id: null,
    game_id: input.internalGameId,
    external_id: input.externalId,
    sport: "soccer",
    slate_date: etDate(input.game.gameStartAt ?? new Date().toISOString()),
    game_date: input.game.gameStartAt ?? null,
    matchup: `${input.game.awayTeam}@${input.game.homeTeam}`,
    market: input.trackedMarket,
    pick: side,
    side,
    line_value: input.trackedMarket === "total" ? input.market.line : null,
    odds_american: input.market.currentPriceAmerican ?? null,
    odds_decimal: null,
    model_used: input.modelRelease,
    model_version: input.modelRelease,
    prediction_source: input.config.predictionSource,
    confidence: input.market.modelProb == null ? null : input.market.modelProb * 100,
    model_probability: input.market.modelProb ?? null,
    market_probability: input.market.marketFairProb ?? null,
    edge: input.market.modelProb == null || input.market.marketFairProb == null ? null : (input.market.modelProb - input.market.marketFairProb) * 100,
    expected_value: expectedValue(input.market.modelProb, input.market.currentPriceAmerican ?? null),
    play_grade: input.market.verdict?.label ?? "No Play",
    prediction_type: input.trackedMarket,
    best_angle: verdict === "best_angle",
    no_bet: !actionable,
    no_bet_reason: actionable ? null : input.market.riskLine ?? input.market.displayReason ?? "not_actionable",
    market_aligned: Math.abs(input.market.modelMarketGapPct ?? 999) <= 3,
    data_quality_tier: missingPrice ? "low" : "medium",
    source_quality: input.market.marketSource ?? "sharpapi",
    provisional: false,
    held: missingPrice,
    hold_reason: missingPrice ? "missing_coherent_current_price" : null,
    launch_day: false,
    manual_outcome_expected: false,
    // `scheduled_lock_at` records the intended T-60 boundary; `locked_at`
    // records when the immutable snapshot was actually captured.
    locked_at: shouldLock ? input.now.toISOString() : null,
    published_at: null,
    snapshot_json: {
      competition: input.config.competition,
      model_release: input.modelRelease,
      calibration_release: input.calibrationRelease,
      captured_at: input.now.toISOString(),
      scheduled_lock_at: lockAt,
      selected_display_pick: input.market.pick,
      // The exact member market rendered from this record at lock. UCL's
      // atomic lock reader uses this stored payload, never a newly built tuple.
      member_market_at_capture: immutableJsonValue(input.market),
      member_projection_at_capture: immutableJsonValue(input.game.soccerProjection ?? null),
      forecast: input.market.soccerMatchResultContext ?? input.market.soccerDoubleChanceContext ?? input.market.soccerTotalContext ?? input.market.soccerBttsContext ?? null,
      complete_price_board: input.market.soccerPriceBoard ?? null,
      opening_price: input.market.lineOpenAmerican,
      current_price: input.market.currentPriceAmerican,
      current_sportsbook: input.market.currentPriceSportsbook,
      odds_trail: input.market.oddsTrail ?? [],
      splits: input.market.publicSplits ?? [],
      grade_reason: input.market.riskLine ?? input.market.displayReason ?? null,
      lineup_confirmed: input.game.status.lineupConfirmed,
      regulation_time: true,
      competition_context: input.config.contextForGame?.(Number(input.game.external_id)) ?? null,
      model_provenance: input.game.soccerModelProvenance ?? null,
    },
    calibration_version: input.calibrationRelease,
  };
}

export async function seedEplSlate(input: { slate: EplShadowSlate; apply: boolean; config?: ClubSoccerPipelineConfig; client?: typeof supabase }) {
  const config = input.config ?? EPL_PIPELINE_CONFIG;
  const client = input.client ?? supabase;
  const providerIds = input.slate.matches.flatMap((match) => [match.id, match.homeTeam.id, match.awayTeam.id]);
  const externalIdUpperBound = config.externalIdUpperBound;
  if (externalIdUpperBound !== undefined && providerIds.some((id) => providerExternalId(id, config.externalIdOffset) >= externalIdUpperBound)) {
    throw new Error(`${config.competition} provider ID exceeds reserved external-id namespace`);
  }
  const teamMap = new Map<number, number>();
  const uniqueTeams = new Map(input.slate.matches.flatMap((match) => [[match.homeTeam.id, match.homeTeam], [match.awayTeam.id, match.awayTeam]]));
  let teamsWritten = 0;
  let gamesWritten = 0;
  const errors: string[] = [];
  for (const team of uniqueTeams.values()) {
    const payload = {
      external_id: providerExternalId(team.id, config.externalIdOffset), sport: "soccer", slug: `${config.slugPrefix}-${team.abbreviation.toLowerCase()}`,
      abbreviation: team.abbreviation, display_name: team.name, short_display_name: team.short_name,
      name: team.name, location: team.location, league: config.competition, division: null,
      logo_url: null, primary_color: null, provider_ids: { [config.providerIdKey]: { id: String(team.id) } },
    };
    if (!input.apply) continue;
    const { data, error } = await client.from("teams").upsert(payload, { onConflict: "sport,external_id" }).select("id").single();
    if (error) errors.push(`team ${team.abbreviation}: ${error.message}`);
    else { teamMap.set(team.id, (data as { id: number }).id); teamsWritten++; }
  }
  if (input.apply) {
    for (const match of input.slate.matches) {
      const competitionContext = config.contextForGame?.(match.id) ?? null;
      const stage = typeof competitionContext?.stage === "string" ? competitionContext.stage : null;
      const postseason = stage !== null && !["league_phase", "group_stage", "unknown"].includes(stage);
      const payload = {
        external_id: providerExternalId(match.id, config.externalIdOffset), sport: "soccer", home_team_id: teamMap.get(match.homeTeam.id) ?? null,
        away_team_id: teamMap.get(match.awayTeam.id) ?? null, game_date: match.kickoff, slate_date: etDate(match.kickoff),
        season: input.slate.season, season_type: postseason ? "postseason" : "regular", postseason, status: match.status,
        home_score: match.homeScore, away_score: match.awayScore, venue: match.venue,
      };
      const { error } = await client.from("games").upsert(payload, { onConflict: "sport,external_id" });
      if (error) errors.push(`game ${match.id}: ${error.message}`); else gamesWritten++;
    }
  }
  return { mode: input.apply ? "write" as const : "dry-run" as const, teamsProposed: uniqueTeams.size, teamsWritten, gamesProposed: input.slate.matches.length, gamesWritten, errors };
}

export async function writeEplPredictionRecords(input: { slate: EplShadowSlate; response: DailyEdgeResponse; forwardEvidence?: EplForwardEvidenceCapture[]; apply: boolean; now?: Date; config?: ClubSoccerPipelineConfig; client?: typeof supabase }) {
  const now = input.now ?? new Date();
  const config = input.config ?? EPL_PIPELINE_CONFIG;
  const client = input.client ?? supabase;
  const externalIds = input.slate.matches.map((match) => providerExternalId(match.id, config.externalIdOffset));
  const externalIdUpperBound = config.externalIdUpperBound;
  if (externalIdUpperBound !== undefined && externalIds.some((id) => id >= externalIdUpperBound)) {
    throw new Error(`${config.competition} provider ID exceeds reserved external-id namespace`);
  }
  const gameIdByExternal = new Map<number, number>();
  if (input.apply) {
    const { data, error } = await client.from("games").select("id,external_id").eq("sport", "soccer").in("external_id", externalIds);
    if (error) throw new Error(`load EPL games: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: number; external_id: number }>) gameIdByExternal.set(row.external_id, row.id);
  }
  const proposed: PredictionRecordRow[] = [];
  for (const game of input.response.games) {
    const providerId = Number(game.external_id);
    if (!Number.isFinite(providerId)) continue;
    const externalId = providerExternalId(providerId, config.externalIdOffset);
    const internalGameId = gameIdByExternal.get(externalId) ?? externalId;
    if (Date.parse(game.gameStartAt ?? "") <= now.getTime()) continue;
    proposed.push(
      recordFromMarket({ game, internalGameId, externalId, market: game.markets.moneyline, trackedMarket: "match_result", modelRelease: input.slate.modelRelease, calibrationRelease: input.slate.calibrationRelease, now, config }),
      ...(game.soccerDoubleChanceMarket ? [recordFromMarket({ game, internalGameId, externalId, market: game.soccerDoubleChanceMarket, trackedMarket: "double_chance", modelRelease: input.slate.modelRelease, calibrationRelease: input.slate.calibrationRelease, now, config })] : []),
      recordFromMarket({ game, internalGameId, externalId, market: game.markets.total, trackedMarket: "total", modelRelease: input.slate.modelRelease, calibrationRelease: input.slate.calibrationRelease, now, config }),
      recordFromMarket({ game, internalGameId, externalId, market: game.markets.first_inning, trackedMarket: "btts", modelRelease: input.slate.modelRelease, calibrationRelease: input.slate.calibrationRelease, now, config }),
    );
  }
  let written = 0;
  let lockedPreserved = 0;
  let priorTuplesLocked = 0;
  const lockedRecordIds: number[] = [];
  const errors: string[] = [];
  const captureWarnings: string[] = [];
  const captureByProviderId = new Map((input.forwardEvidence ?? []).map((capture) => [capture.providerFixtureId, capture]));
  const attachCapture = (row: PredictionRecordRow, priorSnapshot: Record<string, unknown> | null) => {
    if (row.market !== "match_result") return;
    if (config.competition !== EPL_COMPETITION) return;
    const providerId = Number(row.external_id) - config.externalIdOffset;
    const capture = captureByProviderId.get(providerId);
    if (!capture) return;
    try {
      row.snapshot_json = {
        ...(row.snapshot_json ?? {}),
        epl_forward_evidence_history: mergeEplForwardEvidenceHistory(priorSnapshot, capture),
      };
    } catch (error) {
      const priorHistory = priorSnapshot?.epl_forward_evidence_history;
      if (priorHistory !== undefined) row.snapshot_json = { ...(row.snapshot_json ?? {}), epl_forward_evidence_history: priorHistory };
      captureWarnings.push(`${row.matchup}: ${error instanceof Error ? error.message : "forward evidence capture omitted"}`);
    }
  };
  if (input.apply) {
    for (const row of proposed) {
      const { data: existing, error: existingError } = await client.from("prediction_records")
        .select("id,model_version,calibration_version,locked_at,held,snapshot_json")
        .eq("game_id", row.game_id)
        .eq("market", row.market)
        .eq("slate_date", row.slate_date);
      if (existingError) { errors.push(`${row.matchup} ${row.market}: ${existingError.message}`); continue; }
      const priorRows = (existing ?? []) as EplPriorPredictionRecord[];
      if (eplPriorRowsBlockWrite(priorRows)) {
        lockedPreserved++;
        if (config.returnPreservedLockedRecordIds) {
          const exactLocked = priorRows.find((candidate) =>
            candidate.locked_at !== null
            && candidate.model_version === row.model_version
            && candidate.calibration_version === row.calibration_version
            && candidate.snapshot_json?.competition === config.competition,
          );
          if (typeof exactLocked?.id === "number") lockedRecordIds.push(exactLocked.id);
        }
        continue;
      }
      const prior = priorRows.find((candidate) => candidate.model_version === row.model_version && candidate.calibration_version === row.calibration_version) ?? null;
      if (config.preservePriorPricedTupleOnMissingLock && row.locked_at && row.held && prior?.held === false) {
        const { error } = await client.from("prediction_records")
          .update({ locked_at: row.locked_at })
          .eq("id", prior.id!)
          .is("locked_at", null);
        if (error) errors.push(`${row.matchup} ${row.market}: ${error.message}`);
        else {
          priorTuplesLocked++;
          if (typeof prior.id === "number") lockedRecordIds.push(prior.id);
        }
        continue;
      }
      if (row.held && prior?.held === false) continue;
      attachCapture(row, prior?.snapshot_json ?? null);
      const { error } = await client.from("prediction_records").upsert(row as unknown as Record<string, unknown>, { onConflict: "game_id,market,model_version,slate_date" });
      if (error) errors.push(`${row.matchup} ${row.market}: ${error.message}`); else written++;
    }
  } else {
    for (const row of proposed) attachCapture(row, null);
  }
  return { mode: input.apply ? "write" as const : "dry-run" as const, proposed, written, lockedPreserved, priorTuplesLocked, lockedRecordIds, errors, captureWarnings };
}
