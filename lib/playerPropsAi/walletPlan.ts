import { digest, invariant } from "./evidence";
import { reviewSlots, monthSlots, type ScheduledPropsGame, type PropsReviewSlot } from "./schedule";
import { PROPS_AI_BUDGET_RELEASE, PROPS_AI_MAX_INPUT_PER_REQUEST, PROPS_AI_MAX_OUTPUT_PER_REQUEST, PROPS_AI_MAX_PARTS } from "./releases";

export type RequestBound = { input_tokens: number; max_output_tokens: number };
export type CalendarSources = Record<"nba" | "nfl" | "mlb", { complete: true; source: string }>;
export type FundedSlot = PropsReviewSlot & { requests: RequestBound[] };
export type WalletPlan = { month: string; jobs: FundedSlot[]; companionSlots: PropsReviewSlot[]; sources: CalendarSources; hash: string; release: typeof PROPS_AI_BUDGET_RELEASE };
export function validateRequestBounds(requests: RequestBound[]) {
  invariant(Array.isArray(requests) && requests.length >= 1 && requests.length <= PROPS_AI_MAX_PARTS && requests.every(r => Number.isSafeInteger(r.input_tokens) && r.input_tokens > 0 && r.input_tokens <= PROPS_AI_MAX_INPUT_PER_REQUEST && Number.isSafeInteger(r.max_output_tokens) && r.max_output_tokens > 0 && r.max_output_tokens <= PROPS_AI_MAX_OUTPUT_PER_REQUEST), "Invalid full-source request envelope");
}
/** Pure: full published calendars and measured envelopes, never a current-slate guess. */
export function makePropsWalletPlan(args: { month: string; now:string; games: ScheduledPropsGame[]; bounds: Record<string, RequestBound[]>; sources: CalendarSources }): WalletPlan {
  invariant(/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month), "Invalid billing month");
  for (const sport of ["nba", "nfl", "mlb"] as const) invariant(args.sources[sport]?.complete === true && args.sources[sport].source.trim().length > 0, `Complete ${sport} monthly calendar source required, including an explicit no-games calendar`);
  const all = args.games.flatMap(reviewSlots), keys = all.map(s => s.key);
  invariant(new Set(keys).size === keys.length, "Duplicate calendar game date");
  const jobs = monthSlots(args.games,args.month,args.now).map(s => {
    const requests = args.bounds[s.key] ?? args.bounds[`${s.sport}|${s.gameId}`];
    validateRequestBounds(requests); return { ...s, requests: structuredClone(requests) };
  });
  const touched = new Set(jobs.map(s => `${s.sport}|${s.gameId}|${s.gameDay}`));
  const assigned=new Map(jobs.map(s=>[s.key,s.billingMonth]));
  const companionSlots = all.filter(s => touched.has(`${s.sport}|${s.gameId}|${s.gameDay}`)).map(s=>({...s,billingMonth:assigned.get(s.key)??s.billingMonth}));
  const body = { month: args.month, jobs, companionSlots, sources: args.sources, release: PROPS_AI_BUDGET_RELEASE };
  return { ...body, hash: digest(body) };
}
