import type { ScoreDistribution } from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import type { UclEloPair } from "./uclEloStrengthFoundation";

export const UCL_ELO_CONSENSUS_RELEASE =
  "ucl_elo_consensus_2026_10_14_r1_mean_preserving_local_public" as const;

type ResultSide = "home" | "draw" | "away";
type ResultVector = Record<ResultSide, number>;
const SIDES = ["home", "draw", "away"] as const;
const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));

function resultSide(home: number, away: number): ResultSide {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function expectedTotal(joint: ScoreDistribution): number {
  let total = 0;
  for (let home = 0; home < joint.length; home += 1) {
    for (let away = 0; away < joint[home]!.length; away += 1) total += (home + away) * joint[home]![away]!;
  }
  return total;
}

function normalizeJoint(joint: ScoreDistribution): void {
  const mass = joint.flat().reduce((sum, value) => sum + value, 0);
  for (const row of joint) for (let index = 0; index < row.length; index += 1) row[index] = row[index]! / mass;
}

function applyPartition(
  joint: ScoreDistribution,
  groups: Array<{ target: number; contains: (home: number, away: number) => boolean }>,
): void {
  const current = groups.map((group) => joint.reduce((sum, row, home) => sum + row.reduce(
    (inside, value, away) => inside + (group.contains(home, away) ? value : 0), 0,
  ), 0));
  for (let home = 0; home < joint.length; home += 1) {
    for (let away = 0; away < joint[home]!.length; away += 1) {
      const index = groups.findIndex((group) => group.contains(home, away));
      joint[home]![away] = joint[home]![away]! * groups[index]!.target / Math.max(1e-12, current[index]!);
    }
  }
  normalizeJoint(joint);
}

function reconcileJoint(base: ScoreDistribution, result: ResultVector, over: number, btts: number): ScoreDistribution {
  const joint = base.map((row) => [...row]);
  applyPartition(joint, SIDES.map((side) => ({ target: result[side], contains: (home, away) => resultSide(home, away) === side })));
  applyPartition(joint, [
    { target: over, contains: (home, away) => home + away > 2.5 },
    { target: 1 - over, contains: (home, away) => home + away < 2.5 },
  ]);
  applyPartition(joint, [
    { target: btts, contains: (home, away) => home > 0 && away > 0 },
    { target: 1 - btts, contains: (home, away) => home === 0 || away === 0 },
  ]);
  return joint;
}

function tiltExpectedTotal(joint: ScoreDistribution, target: number): ScoreDistribution {
  const meanAt = (theta: number) => {
    let mass = 0;
    let total = 0;
    for (let home = 0; home < joint.length; home += 1) {
      for (let away = 0; away < joint[home]!.length; away += 1) {
        const value = joint[home]![away]! * Math.exp(theta * (home + away));
        mass += value;
        total += (home + away) * value;
      }
    }
    return total / mass;
  };
  let low = -4;
  let high = 4;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (meanAt(middle) < target) low = middle;
    else high = middle;
  }
  const theta = (low + high) / 2;
  let mass = 0;
  const tilted = joint.map((row, home) => row.map((probability, away) => {
    const value = probability * Math.exp(theta * (home + away));
    mass += value;
    return value;
  }));
  return tilted.map((row) => row.map((value) => value / mass));
}

export function reconcileUclMeanPreserving(
  base: ScoreDistribution,
  result: ResultVector,
  over: number,
  btts: number,
): ScoreDistribution {
  const targetMean = expectedTotal(base);
  let joint = base.map((row) => [...row]);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    joint = reconcileJoint(joint, result, over, btts);
    joint = tiltExpectedTotal(joint, targetMean);
    const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    const residual = Math.max(
      ...SIDES.map((side) => Math.abs(markets.match_result[side] - result[side])),
      Math.abs(markets.total.over - over),
      Math.abs(markets.btts.yes - btts),
      Math.abs(expectedTotal(joint) - targetMean),
    );
    if (residual <= 1e-10) break;
  }
  return joint;
}

export function logPoolUclResult(left: ResultVector, right: ResultVector, rightWeight: number): ResultVector {
  const values = SIDES.map((side) => Math.exp(
    (1 - rightWeight) * Math.log(clip(left[side])) + rightWeight * Math.log(clip(right[side])),
  ));
  const total = values.reduce((sum, value) => sum + value, 0);
  return { home: values[0]! / total, draw: values[1]! / total, away: values[2]! / total };
}

function eloVector(base: ResultVector, homeElo: number, awayElo: number): ResultVector {
  const conditionalHome = 1 / (1 + 10 ** (-((homeElo + 45 - awayElo) / 400)));
  return {
    home: (1 - base.draw) * conditionalHome,
    draw: base.draw,
    away: (1 - base.draw) * (1 - conditionalHome),
  };
}

export function deriveUclEloConsensusJoint(base: ScoreDistribution, elo: UclEloPair): ScoreDistribution {
  const markets = deriveSoccerMarketProbabilities({ joint: base, totalLine: 2.5 });
  const local = eloVector(markets.match_result, elo.homeLocal, elo.awayLocal);
  const strength = elo.homePublic !== null && elo.awayPublic !== null
    ? logPoolUclResult(local, eloVector(markets.match_result, elo.homePublic, elo.awayPublic), 0.5)
    : local;
  const result = logPoolUclResult(markets.match_result, strength, 0.25);
  return reconcileUclMeanPreserving(base, result, markets.total.over, markets.btts.yes);
}

export function uclJointExpectedGoals(joint: ScoreDistribution): { home: number; away: number } {
  let homeExpected = 0;
  let awayExpected = 0;
  for (let home = 0; home < joint.length; home += 1) {
    for (let away = 0; away < joint[home]!.length; away += 1) {
      homeExpected += home * joint[home]![away]!;
      awayExpected += away * joint[home]![away]!;
    }
  }
  return { home: homeExpected, away: awayExpected };
}
