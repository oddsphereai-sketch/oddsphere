import type { DailyEdgeGameDto, DailyEdgePredictionDto, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET } from "./uclCompetitionContext";
import { uclTeamAsset, uclTeamLogo } from "./uclTeamAssets";

export const UCL_STORED_MEMBER_READER_RELEASE = "ucl_stored_member_reader_2026_11_10_r1_exact_saved_cards";
export type UclStoredMemberRecord = {
  external_id: number; game_date: string | null; market: string; model_version: string;
  calibration_version: string | null; locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};
export type UclStoredFixture = { external_id: number; game_date: string; home_team_id: number; away_team_id: number };
export type UclStoredTeam = { id: number; abbreviation: string; display_name: string };
const markets = ["match_result", "double_chance", "total", "btts"] as const;

/** Restore saved member payloads, never run a model or infer a missing forecast.
 * A cohort must have all four markets from the exact same writer capture.
 * Locked cohorts have precedence and retain their exact stored evidence. */
export function restoreUclStoredMemberGame(fixture: UclStoredFixture, teams: UclStoredTeam[], records: UclStoredMemberRecord[], now = new Date()): DailyEdgeGameDto | null {
  const home = teams.find(team => team.id === fixture.home_team_id), away = teams.find(team => team.id === fixture.away_team_id);
  if (!home?.abbreviation || !away?.abbreviation || home.id === away.id) return null;
  const cohorts = new Map<string, UclStoredMemberRecord[]>();
  for (const row of records) {
    const s = row.snapshot_json;
    if (row.external_id !== fixture.external_id || Date.parse(row.game_date ?? "") !== Date.parse(fixture.game_date)
      || !markets.includes(row.market as typeof markets[number]) || s?.competition !== UCL_COMPETITION
      || s.model_release !== row.model_version || s.calibration_release !== row.calibration_version
      || !Number.isFinite(Date.parse(String(s.captured_at))) || Date.parse(String(s.captured_at)) > now.getTime()) continue;
    const key = JSON.stringify([row.model_version, row.calibration_version, s.captured_at, Boolean(row.locked_at)]);
    cohorts.set(key, [...(cohorts.get(key) ?? []), row]);
  }
  const ordered = [...cohorts.values()].sort((a, b) => Number(Boolean(b[0]!.locked_at)) - Number(Boolean(a[0]!.locked_at))
    || Date.parse(String(b[0]!.snapshot_json!.captured_at)) - Date.parse(String(a[0]!.snapshot_json!.captured_at)));
  // Any stored lock prevents an unlocked fallback, including an incomplete lock.
  const hasLock = records.some(row => row.external_id === fixture.external_id && row.locked_at);
  for (const cohort of ordered) {
    const anchor = cohort.find(row => row.market === "match_result");
    if (!anchor || (hasLock && !anchor.locked_at) || cohort.length !== 4 || new Set(cohort.map(row => row.market)).size !== 4) continue;
    const s = anchor.snapshot_json!;
    const scheduledLockAt = String(s.scheduled_lock_at ?? "");
    if (!Number.isFinite(Date.parse(scheduledLockAt)) || Date.parse(scheduledLockAt) !== Date.parse(fixture.game_date) - 60 * 60_000
      || (!anchor.locked_at && now.getTime() >= Date.parse(scheduledLockAt))) continue;
    const projection = s.member_projection_at_capture as DailyEdgeGameDto["soccerProjection"];
    if (!projection?.coherentScorePresentation?.score || !cohort.every(row =>
      JSON.stringify(row.snapshot_json!.member_projection_at_capture) === JSON.stringify(projection))) continue;
    const captured = (name: typeof markets[number]) => cohort.find(row => row.market === name)!.snapshot_json!.member_market_at_capture as MarketEdgeDto;
    const mr = captured("match_result"), total = captured("total"), btts = captured("btts"), dc = captured("double_chance");
    if (![mr, total, btts, dc].every(m => m && m.verdict && Array.isArray(m.keyStats) && Array.isArray(m.reviewFlags))) continue;
    const prediction = (m: MarketEdgeDto): DailyEdgePredictionDto => ({ pick: m.pick, confidence: m.modelProb,
      grade: m.grade, sharpStatus: m.sharpStatus, signalType: m.signalType, marketSignal: m.marketSignal });
    const at = String(s.captured_at);
    const game: DailyEdgeGameDto = {
      id: `soccer-ucl-${fixture.external_id - UCL_EXTERNAL_ID_OFFSET}`, sport: "soccer", external_id: fixture.external_id - UCL_EXTERNAL_ID_OFFSET,
      homeTeam: home.abbreviation, awayTeam: away.abbreviation, homeTeamDisplayName: home.display_name, awayTeamDisplayName: away.display_name,
      homeTeamLogo: uclTeamLogo(home.abbreviation), awayTeamLogo: uclTeamLogo(away.abbreviation),
      homeTeamPrimaryColor: uclTeamAsset(home.abbreviation)?.primaryColor ?? null, awayTeamPrimaryColor: uclTeamAsset(away.abbreviation)?.primaryColor ?? null,
      gameStartAt: fixture.game_date, gameTime: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(fixture.game_date)), gameStartMinutes: 0,
      scheduledLockAt, lockState: anchor.locked_at ? "locked" : "open", lockedAt: anchor.locked_at ? cohort.map(row => row.locked_at!).sort().at(-1)! : null,
      generatedAt: at, updatedAt: at, holdReason: null, homeStarter: null, awayStarter: null,
      predictions: { ml: prediction(mr), total: { ...prediction(total), pick: total.soccerTotalContext?.displayed_side ?? total.pick, line: total.line }, nrfi: { ...prediction(btts), pick: btts.soccerBttsContext?.displayed_side ?? btts.pick } },
      markets: { moneyline: mr, total, first_inning: btts }, soccerDoubleChanceMarket: dc,
      projected: projection.coherentScorePresentation.score, soccerProjection: projection,
      soccerCompetitionContext: s.competition_context as DailyEdgeGameDto["soccerCompetitionContext"],
      soccerModelProvenance: s.model_provenance as DailyEdgeGameDto["soccerModelProvenance"],
      decisionLine: mr.displayReason ?? mr.whyLine ?? "", sharpSignals: [], result: null,
      status: { lineupConfirmed: typeof s.lineup_confirmed === "boolean" ? s.lineup_confirmed : null, linesLocked: [mr, total, btts, dc].some(m => m.currentPriceAmerican !== null),
        sharpSignalPending: true, marketDataLimited: ![mr, total, btts, dc].some(m => m.currentPriceAmerican !== null) },
      breakdown: { verdict: mr.verdict, sharpRead: { key: "no_data", sentence: "See the saved market evidence below." },
        modelBreakdown: `Last published club model forecast. Release ${anchor.model_version}.` },
    };
    return structuredClone(game);
  }
  return null;
}
