import { etDate, instant, invariant } from "./evidence";
import type { Sport, Stage } from "./evidenceContract";
export type ScheduledPropsGame = { sport: Sport; id: string; start: string; lock: string };
export type PropsReviewSlot = { key: string; sport: Sport; gameId: string; gameDay: string; start: string; lock: string; dueAt: string; stage: Stage; billingMonth: string };
export const PROPS_AI_FINAL_LEAD_MS=25*60000;
/** A missed early slot cannot be bought after final time, regardless of final job state. */
export function isMissedPropsEarlyWindow(stage:Stage,lock:string,now:string):boolean{
  return stage==='early'&&instant(now)>=instant(lock)-PROPS_AI_FINAL_LEAD_MS;
}
/** Final work starts before lock; a completed result can never cross the existing lock. */
export function reviewSlots(game: ScheduledPropsGame): PropsReviewSlot[] {
  const start = instant(game.start), lock = instant(game.lock), day = etDate(game.start);
  invariant(lock <= start, "Invalid lock/start order");
  let early = start - 8 * 3600000;
  while (etDate(new Date(early).toISOString()) !== day) early += 15 * 60000;
  const final = lock - PROPS_AI_FINAL_LEAD_MS;
  invariant(early < final && etDate(new Date(final).toISOString()) === day, "Cannot fit two game-day review windows before lock");
  return (["early", "final"] as const).map((stage, i) => {
    const dueAt = new Date(i ? final : early).toISOString();
    // A release change cannot purchase two more reviews of the same game/day.
    return { key: `props-ai|${game.sport}|${game.id}|${day}|${stage}`,
      sport: game.sport, gameId: game.id, gameDay: day, start: game.start, lock: game.lock, dueAt, stage, billingMonth: dueAt.slice(0, 7) };
  });
}
export function monthSlots(games: ScheduledPropsGame[], utcMonth: string, now: string): PropsReviewSlot[] {
  invariant(/^\d{4}-(0[1-9]|1[0-2])$/.test(utcMonth), "Invalid UTC billing month");
  invariant(new Set(games.map(g => `${g.sport}|${g.id}|${etDate(g.start)}`)).size === games.length, "Duplicate calendar games");
  return games.flatMap(reviewSlots).filter(slot => slot.billingMonth === utcMonth || slot.billingMonth < utcMonth && now.slice(0, 7) === utcMonth && instant(slot.dueAt) < instant(now) && instant(now) < instant(slot.lock))
    .map(slot => ({ ...slot, billingMonth: utcMonth }));
}
