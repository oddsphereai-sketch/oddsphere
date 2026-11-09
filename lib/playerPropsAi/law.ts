import type { GamePacket, Player, Sport } from "./evidenceContract";
import { COMBOS } from "./evidenceContract";
import { invariant, digest } from "./evidence";
import { PROPS_AI_LAW_RELEASE, PROPS_AI_SCENARIOS } from "./releases";
import { readerEvidence, validatePlayerCoverage, type ReaderCoverage } from "./readerCoverage";

const NBA = ["points", "rebounds", "assists", "threes"] as const;
const NFL = ["passing_attempts", "passing_completions", "passing_yards", "passing_tds", "interceptions", "rushing_attempts", "rushing_yards", "receptions", "receiving_yards", "touchdowns"] as const;
const MLB_PITCHER = ["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs"] as const;
const MLB_BATTER = ["batter_singles", "batter_doubles", "batter_triples", "batter_home_runs", "batter_walks", "batter_strikeouts", "batter_rbis", "batter_runs_scored", "batter_stolen_bases"] as const;
export function primitives(sport: Sport, player: Pick<Player, "markets">): string[] {
  if (sport === "nba") return [...NBA];
  if (sport === "nfl") {
    const required = new Set(player.markets.flatMap(m => m === "anytime_td" ? ["touchdowns"] : COMBOS[m] ?? [m]));
    if ([...required].some(m => m.startsWith("passing_") || m === "interceptions")) for (const m of ["passing_attempts", "passing_completions", "passing_tds", "interceptions"]) required.add(m);
    return NFL.filter(m => required.has(m));
  }
  return [...(player.markets.some(m => m.startsWith("pitcher_")) ? MLB_PITCHER : []), ...(player.markets.some(m => m.startsWith("batter_")) ? MLB_BATTER : [])];
}
export type PlayerLaw = { weights: number[]; outcomes: Record<string, number[]> };
export type PlayerReview = { assessment: string; coverage: ReaderCoverage; evidenceIds: string[]; gaps: string[]; law: PlayerLaw | null; confidence: number[]; exceptions: (string | null)[]; priorRead?:Record<string,string> };
export type GameReview = { players: Record<string, PlayerReview> };
export type AcceptedPlayerLaw = { release: typeof PROPS_AI_LAW_RELEASE; hash: string; weights: number[]; outcomes: Record<string, number[]> };
/** Dependencies of the canonical mathematical contract, including nested combos. */
export function marketUsesStatistic(market:string,statistic:string):boolean{
  if(market===statistic)return true;
  if(market==="anytime_td")return statistic==="touchdowns";
  if(market==="batter_total_bases"&&statistic==="batter_hits")return true;
  if(market==="batter_hits"||market==="batter_total_bases")return ["batter_singles","batter_doubles","batter_triples","batter_home_runs"].includes(statistic);
  return Boolean(COMBOS[market]?.some(component=>marketUsesStatistic(component,statistic)));
}

export function validateLaw(sport: Sport, player: Pick<Player, "markets">, law: PlayerLaw): AcceptedPlayerLaw {
  const keys = primitives(sport, player);
  invariant(keys.length > 0 && Object.keys(law.outcomes).sort().join("|") === keys.slice().sort().join("|"), "Wrong/missing scenario primitives");
  invariant(law.weights.length === PROPS_AI_SCENARIOS && law.weights.every(w => Number.isSafeInteger(w) && w >= 0 && w <= 10000), "Invalid relative scenario weights");
  const total = law.weights.reduce((a, b) => a + b, 0); invariant(total > 0, "Empty scenario law");
  for (const key of keys) invariant(law.outcomes[key].length === PROPS_AI_SCENARIOS && law.outcomes[key].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 10000 && (key.endsWith("yards") || n >= 0)), `Invalid integer stat units: ${key}`);
  for (let i = 0; i < PROPS_AI_SCENARIOS; i++) {
    const v = (key: string) => law.outcomes[key]?.[i];
    if (sport === "nba") invariant(v("points") >= 3 * v("threes"), "NBA scenario points contradict made threes");
    if (sport === "nfl" && v("passing_attempts") !== undefined) {
      invariant(v("passing_completions") <= v("passing_attempts"), "NFL completions exceed attempts");
      invariant(v("passing_tds") <= v("passing_completions") && v("interceptions") <= v("passing_attempts") - v("passing_completions"), "NFL passing event identity violated");
    }
    if (sport === "mlb") {
      // An uncaught third strike can credit a strikeout without recording an out.
      // K <= outs would incorrectly reject physically possible baseball outcomes.
      if (v("batter_home_runs") !== undefined) invariant(v("batter_runs_scored") >= v("batter_home_runs") && v("batter_rbis") >= v("batter_home_runs"), "MLB home runs contradict runs/RBIs");
    }
  }
  const result = { release: PROPS_AI_LAW_RELEASE, weights: law.weights.map(w => w / total), outcomes: structuredClone(law.outcomes) };
  return { ...result, hash: digest(result) };
}
export function scenarioStat(law: AcceptedPlayerLaw, market: string, i: number): number {
  if (market === "anytime_td") return Number(law.outcomes.touchdowns[i] >= 1);
  if (market === "batter_hits") return ["batter_singles", "batter_doubles", "batter_triples", "batter_home_runs"].reduce((n, k) => n + law.outcomes[k][i], 0);
  if (market === "batter_total_bases") return law.outcomes.batter_singles[i] + 2 * law.outcomes.batter_doubles[i] + 3 * law.outcomes.batter_triples[i] + 4 * law.outcomes.batter_home_runs[i];
  if (COMBOS[market]) return COMBOS[market].reduce((n, key) => n + scenarioStat(law, key, i), 0);
  invariant(law.outcomes[market], `Unsupported scenario market: ${market}`); return law.outcomes[market][i];
}
export function lawForecast(law: AcceptedPlayerLaw, market: string, line: number, milestone = false) {
  invariant(Number.isFinite(line), "Missing exact line");
  let mean = 0, over = 0, under = 0, push = 0;
  for (let i = 0; i < law.weights.length; i++) {
    const value = scenarioStat(law, market, i), w = law.weights[i]; mean += w * value;
    if (milestone || market === "anytime_td") { if (value >= line) over += w; else under += w; }
    else if (value > line) over += w; else if (value < line) under += w; else push += w;
  }
  return { mean, over, under, push, preferredSide: over >= under ? "over" as const : "under" as const };
}
export function validateGameReview(packet: GamePacket, review: GameReview) {
  const reader = readerEvidence(packet);
  invariant(Object.keys(review.players).sort().join("|") === packet.players.map(p => p.id).sort().join("|"), "Review omitted/added players");
  return packet.players.map(player => {
    const row = review.players[player.id];
    invariant(typeof row.assessment === "string" && row.assessment.trim().length > 0 && row.assessment.length <= 180, "Missing/oversize individual assessment");
    invariant(row.evidenceIds.length > 0 && row.evidenceIds.length <= 6 && row.evidenceIds.every(id => player.evidence.some(e => e.id === id)), "Fabricated/cross-player evidence citation");
    invariant(row.confidence.length === player.markets.length && row.confidence.every(c => [0, 1, 2].includes(c)), "Missing/invalid market confidence");
    invariant(row.exceptions.length === player.markets.length && row.exceptions.every(s => s === null || typeof s === "string" && s.trim().length > 0 && s.length <= 140), "Missing/invalid market exceptions");
    invariant(row.gaps.length <= 6 && row.gaps.every(s => typeof s === "string" && s.length > 0 && s.length <= 140), "Invalid evidence gaps");
    invariant(row.law !== null || row.gaps.length > 0 && row.exceptions.every(s => s !== null), "Unsupported player requires explicit exceptions");
    return { playerId: player.id, ...row, coverage: validatePlayerCoverage(player,reader[player.id],row.coverage), law: row.law ? validateLaw(packet.sport, player, row.law) : null };
  });
}
