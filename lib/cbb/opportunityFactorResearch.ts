import type { CbbScoreFeatureRow } from "./scoreResearch";
import type { CbbBox, CbbFourFactors, CbbTrainingGame } from "./types";

export const CBB_OPPORTUNITY_FACTOR_RESEARCH_RELEASE = "cbb_private_2026_10_29_r22_opportunity_factors";
export type CbbOpportunityFactorVariant = "pooled" | "pooled_recency_90";
const keys = ["efg", "turnoverRate", "offensiveReboundRate", "freeThrowRate"] as const;
const neutral: CbbFourFactors = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };
type Counts = { numerator: CbbFourFactors; denominator: CbbFourFactors };
const zero = (): CbbFourFactors => ({ efg: 0, turnoverRate: 0, offensiveReboundRate: 0, freeThrowRate: 0 });
const empty = (): Counts => ({ numerator: zero(), denominator: zero() });

function add(counts: Counts, own: CbbBox, opponent: CbbBox, possessions: number, weight: number) {
  const values: Record<keyof CbbFourFactors, [number, number]> = {
    efg: [own.fgm! + 0.5 * own.fg3m!, own.fga!],
    turnoverRate: [own.turnovers!, possessions],
    offensiveReboundRate: [own.oreb!, own.oreb! + opponent.dreb!],
    freeThrowRate: [own.fta!, own.fga!],
  };
  for (const key of keys) {
    const [numerator, denominator] = values[key];
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      throw new Error("CBB opportunity factor received an invalid accepted box");
    }
    counts.numerator[key] += weight * numerator;
    counts.denominator[key] += weight * denominator;
  }
}

/** Research only: pool prior observed opportunities, not observed rates. */
export function opportunityFactorFit(history: CbbTrainingGame[], boxes: CbbBox[], season: number, asOf: string,
  variant: CbbOpportunityFactorVariant) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || !["pooled", "pooled_recency_90"].includes(variant)) {
    throw new Error("CBB opportunity factor invalid fit request");
  }
  const boxByGameTeam = new Map<string, CbbBox>();
  for (const box of boxes) {
    const key = `${box.game.id}:${box.team.id}`;
    if (boxByGameTeam.has(key)) throw new Error("duplicate CBB factor box identity");
    boxByGameTeam.set(key, box);
  }
  const offense = new Map<number, Counts>(), allowed = new Map<number, Counts>();
  let games = 0;
  for (const game of history) {
    if (game.season !== season || game.neutral === null ||
      Date.parse(game.date) + 6 * 60 * 60 * 1000 > timestamp) continue;
    const home = boxByGameTeam.get(`${game.id}:${game.homeId}`);
    const away = boxByGameTeam.get(`${game.id}:${game.awayId}`);
    if (!home || !away) throw new Error("CBB opportunity factor missing accepted box pair");
    const ageDays = Math.max(0, (timestamp - Date.parse(game.date)) / 86400000);
    const weight = variant === "pooled_recency_90" ? Math.exp(-ageDays / 90) : 1;
    for (const [ownId, oppId, own, opp] of [
      [game.homeId, game.awayId, home, away], [game.awayId, game.homeId, away, home],
    ] as const) {
      const ownOffense = offense.get(ownId) ?? empty();
      const oppAllowed = allowed.get(oppId) ?? empty();
      add(ownOffense, own, opp, game.possessions, weight);
      add(oppAllowed, own, opp, game.possessions, weight);
      offense.set(ownId, ownOffense); allowed.set(oppId, oppAllowed);
    }
    games++;
  }
  const rates = (counts: Counts | undefined): CbbFourFactors => Object.fromEntries(keys.map(key =>
    [key, counts && counts.denominator[key] > 0 ? counts.numerator[key] / counts.denominator[key] : neutral[key]])) as CbbFourFactors;
  return { games, offense: new Map([...offense].map(([id, counts]) => [id, rates(counts)])),
    allowed: new Map([...allowed].map(([id, counts]) => [id, rates(counts)])) };
}

/** Replace the same eight r2 feature slots; all score/probability math is unchanged. */
export function enrichOpportunityFactors(rows: CbbScoreFeatureRow[], history: CbbTrainingGame[], boxes: CbbBox[],
  variant: CbbOpportunityFactorVariant): CbbScoreFeatureRow[] {
  const fits = new Map<string, ReturnType<typeof opportunityFactorFit>>();
  return rows.map(row => {
    const { game, forecast } = row;
    if (Date.parse(forecast.asOf) > Date.parse(game.date)) throw new Error("CBB factor forecast after game start");
    const key = `${game.season}:${forecast.asOf}`;
    let fit = fits.get(key);
    if (!fit) { fit = opportunityFactorFit(history, boxes, game.season, forecast.asOf, variant); fits.set(key, fit); }
    const match = (own: number, opponent: number, factor: keyof CbbFourFactors) =>
      ((fit!.offense.get(own)?.[factor] ?? neutral[factor]) + (fit!.allowed.get(opponent)?.[factor] ?? neutral[factor])) / 2;
    const home = keys.map(factor => match(game.homeId, game.awayId, factor));
    const away = keys.map(factor => match(game.awayId, game.homeId, factor));
    const features = [...row.features];
    for (let i = 0; i < keys.length; i++) {
      features[7 + i] = (home[i] - away[i]) * 10;
      features[11 + i] = (home[i] + away[i] - 2 * neutral[keys[i]]) * 10;
    }
    if (!features.every(Number.isFinite)) throw new Error("CBB opportunity factor produced nonfinite feature");
    return { ...row, features };
  });
}
