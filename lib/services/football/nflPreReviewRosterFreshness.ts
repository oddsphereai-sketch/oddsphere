import {reviewSlots} from '../../playerPropsAi/schedule';
import {hasNflStoredLockedDecision, type NflForwardStoredEvidence, type NflForwardCapturePlan} from './nflForwardEvidence';
import type {NflPreviewGame} from './balldontlieNflPreviewSlate';

export const NFL_PRE_REVIEW_ROSTER_RELEASE =
  'nfl_pre_review_roster_2026_11_26_r2_targeted_capture_priority' as const;
const PREPARATION_LEAD_MS = 15 * 60_000;
const utcInstant = (value: string | null | undefined) =>
  typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

/** Existing scheduled forward captures prepare source metadata for the two
 * existing review windows. This never claims/replays a review or changes its
 * clock. A captured roster remains its original timestamp, including failures.
 */
export function needsNflPreReviewRoster(args: {
  start: string;
  now: string;
  capturedAt: string | null | undefined;
}): boolean {
  const start = utcInstant(args.start), now = utcInstant(args.now);
  const lock = start - 3_600_000;
  if (!Number.isFinite(start) || !Number.isFinite(now) || now >= lock) return false;
  let windows: ReturnType<typeof reviewSlots>;
  try {
    windows = reviewSlots({sport: 'nfl', id: 'roster-source-only', start: args.start,
      lock: new Date(lock).toISOString()});
  } catch {
    // A fixture that cannot have the existing day-of pair cannot authorize an
    // extra preparation window. Its ordinary opening/T60 paths remain intact.
    return false;
  }
  const duePreparation = windows.map(slot => Date.parse(slot.dueAt) - PREPARATION_LEAD_MS)
    .filter(at => at <= now);
  if (!duePreparation.length) return false;
  const requiredAt = Math.max(...duePreparation), capturedAt = utcInstant(args.capturedAt);
  return !Number.isFinite(capturedAt) || capturedAt < requiredAt || capturedAt > now;
}

function rosterPreparationState(existing: readonly NflForwardStoredEvidence[], now: string,
  frozenGameIds: ReadonlySet<string>) {
  const at=utcInstant(now), latest=new Map<string,NflForwardStoredEvidence>(), openings=new Set<string>();
  const locked=new Set([...frozenGameIds,...existing.filter(row=>row.stage==='t60'||hasNflStoredLockedDecision(row)).map(row=>row.providerGameId)]);
  for(const row of existing){
    const captured=utcInstant(row.capturedAt);
    if(!Number.isFinite(at)||!Number.isFinite(captured)||captured>at)continue;
    if(row.stage==='opening')openings.add(row.providerGameId);
    const prior=latest.get(row.providerGameId);
    if(!prior||captured>utcInstant(prior.capturedAt))latest.set(row.providerGameId,row);
  }
  return {latest,openings,locked};
}
function gameNeedsRoster(start:string,now:string,row:NflForwardStoredEvidence):boolean{
  const depth=row.payload.providerStartersAndDepth??row.payload.startersAndDepth;
  return needsNflPreReviewRoster({start,now,capturedAt:depth?.away.capturedAt})
    ||needsNflPreReviewRoster({start,now,capturedAt:depth?.home.capturedAt});
}
/** The ordinary hourly price cadence cannot suppress a due source-preparation
 * boundary. Only a previously opened, still-unlocked game can request it.
 */
export function nflPreReviewRosterDueGames(args:{existing:readonly NflForwardStoredEvidence[];
  now:string;frozenGameIds:ReadonlySet<string>}):Set<string>{
  const {latest,openings,locked}=rosterPreparationState(args.existing,args.now,args.frozenGameIds);
  return new Set([...latest].filter(([id,row])=>openings.has(id)&&!locked.has(id)
    &&gameNeedsRoster(row.gameStartAt,args.now,row)).map(([id])=>id));
}
/** Add bounded normal unlocked captures for those source targets only. Fresh
 * provider fixture clocks requalify eligibility before a plan is created.
 * Original opening/T60 plans, order and locked authority retain precedence.
 */
export function withNflPreReviewRosterCaptures(args:{planned:readonly NflForwardCapturePlan[];
  games:readonly NflPreviewGame[];existing:readonly NflForwardStoredEvidence[];now:string;
  frozenGameIds:ReadonlySet<string>}):NflForwardCapturePlan[]{
  const {latest,openings,locked}=rosterPreparationState(args.existing,args.now,args.frozenGameIds);
  const seen=new Set(args.planned.map(plan=>plan.game.providerGameId));
  const added:NflForwardCapturePlan[]=[];
  for(const game of args.games){
    const id=game.providerGameId,row=latest.get(id);
    if(seen.has(id)||!row||!openings.has(id)||locked.has(id)
      ||!gameNeedsRoster(game.scheduledStart,args.now,row))continue;
    seen.add(id);added.push({game,stage:'unlocked',captureTiming:'on_time',
      cutoffAt:new Date(utcInstant(game.scheduledStart)-3_600_000).toISOString(),t60LagMinutes:null});
  }
  return [...args.planned,...added];
}
