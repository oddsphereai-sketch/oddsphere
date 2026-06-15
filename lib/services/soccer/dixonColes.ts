/**
 * Dixon-Coles bivariate Poisson score model — WC-3 pure math.
 *
 * Reference: Dixon & Coles (1997) "Modelling Association Football Scores
 * and Inefficiencies in the Football Betting Market." Standard model for
 * national-team / club soccer; chosen because the joint score
 * distribution yields all four WC-1 launch markets (match_result,
 * double_chance, total, btts) from a single coherent source. See
 * project-wc-model-standard §4.
 *
 * No DB. No HTTP. No vendor I/O. Pure math.
 *
 * Pipeline:
 *   1. computeLambda(att, def, alpha, hostAdj, venueAdj, oppositeHostAdj)
 *      → expected goals for one side.
 *   2. bivariatePoissonScoreDistribution(λ_H, λ_A, τ) → 9×9 joint matrix
 *      P(home_goals=h, away_goals=a) for h,a in 0..8. Includes
 *      Dixon-Coles low-score correction. Sum-normalized.
 *   3. Caller derives match_result, double_chance, total, btts from the
 *      joint matrix (lib/services/soccer/soccerMarketProbabilities.ts).
 *
 * Tail mass beyond 8-8 (vanishingly small for typical WC λ's < 2.5) is
 * dropped before renormalization.
 */

/** Maximum goal count modeled per side. 9 means h,a ∈ {0,1,…,8}. */
export const GOAL_GRID_SIZE = 9 as const;

/** Joint score distribution as a 2D array [home_goals][away_goals]. */
export type ScoreDistribution = number[][];

/**
 * Compute λ (expected goals) for one side in a fixture.
 *
 * λ = exp(α + ownAtt − oppDef + ownHostAdj − oppHostAdj + venueAdj)
 *
 * NOTE the −oppHostAdj term: if the OPPONENT is the host playing at home,
 * they get +host_goal_adjustment goals; symmetrically, the visiting team's
 * λ_A drops by the same amount. We pass that explicitly via opposingHostAdj
 * to keep the function pure.
 *
 * @param att     own attack-strength scalar (z-scored Elo × att_scale)
 * @param def     opponent defense-strength scalar
 * @param alpha   global goals constant (EXTERNAL_PRIORS_V1.alpha)
 * @param ownHostAdj  +host_goal_adjustment if this side is the host
 *                    AND playing at home, else 0
 * @param opposingHostAdj +host_goal_adjustment if the OPPONENT is host
 *                    AND playing at home, else 0
 * @param venueAdj  e.g., altitude bonus for Estadio Azteca for the
 *                  Mexico-side λ only
 */
export function computeLambda(opts: {
  att: number;
  def: number;
  alpha: number;
  ownHostAdj: number;
  opposingHostAdj: number;
  venueAdj: number;
}): number {
  const { att, def, alpha, ownHostAdj, opposingHostAdj, venueAdj } = opts;
  const exponent = alpha + att - def + ownHostAdj - opposingHostAdj + venueAdj;
  // Safety: extreme exponents (>5) would yield λ > 148; clamp at 5.
  const clamped = Math.max(-5, Math.min(5, exponent));
  return Math.exp(clamped);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let v = 1;
  for (let i = 2; i <= n; i++) v *= i;
  return v;
}

function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Build the bivariate Poisson joint distribution with Dixon-Coles
 * low-score correction.
 *
 * τ (tau) is the four-cell adjustment that inflates draws and corrects
 * Poisson's under-prediction at (0,0)/(1,1) etc. Range typically
 * −0.2 < τ < 0.0. EXTERNAL_PRIORS_V1.tau is the launch value.
 *
 * Concrete adjustment (per Dixon-Coles 1997 Eq. (4)):
 *   P(0,0) ← P(0,0) × (1 − λ_H × λ_A × τ)
 *   P(0,1) ← P(0,1) × (1 + λ_H × τ)
 *   P(1,0) ← P(1,0) × (1 + λ_A × τ)
 *   P(1,1) ← P(1,1) × (1 − τ)
 *
 * The matrix is renormalized after correction so cells sum to 1.0.
 *
 * @param lambdaHome  λ_H from computeLambda
 * @param lambdaAway  λ_A from computeLambda
 * @param tau          Dixon-Coles low-score correction parameter
 * @returns 9×9 matrix joint[h][a] = P(home_goals=h, away_goals=a)
 */
export function bivariatePoissonScoreDistribution(
  lambdaHome: number,
  lambdaAway: number,
  tau: number,
): ScoreDistribution {
  if (lambdaHome <= 0 || lambdaAway <= 0) {
    throw new Error(`bivariatePoissonScoreDistribution: λ must be > 0 (got home=${lambdaHome}, away=${lambdaAway})`);
  }

  const joint: ScoreDistribution = [];
  // Build independent Poisson product P(h) × P(a).
  for (let h = 0; h < GOAL_GRID_SIZE; h++) {
    const row: number[] = [];
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a < GOAL_GRID_SIZE; a++) {
      const pa = poissonPmf(a, lambdaAway);
      row.push(ph * pa);
    }
    joint.push(row);
  }

  // Apply Dixon-Coles low-score correction on the four corner cells.
  // Use multiplicative factors that match Dixon-Coles (1997).
  joint[0][0] *= 1 - lambdaHome * lambdaAway * tau;
  joint[0][1] *= 1 + lambdaHome * tau;
  joint[1][0] *= 1 + lambdaAway * tau;
  joint[1][1] *= 1 - tau;

  // Guard against negative cell values (would require pathological τ).
  for (let h = 0; h < GOAL_GRID_SIZE; h++) {
    for (let a = 0; a < GOAL_GRID_SIZE; a++) {
      if (joint[h][a] < 0) joint[h][a] = 0;
    }
  }

  // Renormalize so cells sum to exactly 1.0.
  let total = 0;
  for (let h = 0; h < GOAL_GRID_SIZE; h++) {
    for (let a = 0; a < GOAL_GRID_SIZE; a++) total += joint[h][a];
  }
  if (total <= 0) {
    throw new Error(`bivariatePoissonScoreDistribution: total mass is non-positive (${total})`);
  }
  for (let h = 0; h < GOAL_GRID_SIZE; h++) {
    for (let a = 0; a < GOAL_GRID_SIZE; a++) joint[h][a] /= total;
  }

  return joint;
}

/** Convenience: total predicted goals from the joint distribution. */
export function expectedTotalFromDistribution(joint: ScoreDistribution): number {
  let total = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h].length; a++) {
      total += (h + a) * joint[h][a];
    }
  }
  return total;
}

/**
 * Per-total-goals mass: index t holds P(home+away = t). Descriptive — used to
 * show the median / most-likely total alongside the mean, so the right-skew
 * (mean > median) is explained on the card rather than driving the pick.
 */
export function totalGoalsMass(joint: ScoreDistribution): number[] {
  const maxTotal = (joint.length - 1) + (joint[0]?.length ?? 1) - 1;
  const mass = new Array<number>(maxTotal + 1).fill(0);
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h].length; a++) mass[h + a] += joint[h][a];
  }
  return mass;
}

/** Median total goals: smallest T with cumulative P(total ≤ T) ≥ 0.5. */
export function medianTotalFromDistribution(joint: ScoreDistribution): number {
  const mass = totalGoalsMass(joint);
  let cum = 0;
  for (let t = 0; t < mass.length; t++) {
    cum += mass[t];
    if (cum >= 0.5) return t;
  }
  return mass.length - 1;
}

/** Most-likely (mode) total goals: argmax_T P(total = T). */
export function mostLikelyTotalFromDistribution(joint: ScoreDistribution): number {
  const mass = totalGoalsMass(joint);
  let best = 0;
  for (let t = 1; t < mass.length; t++) if (mass[t] > mass[best]) best = t;
  return best;
}

/** Convenience: P(h_goals = a_goals) — useful for draw checks. */
export function probabilityOfDraw(joint: ScoreDistribution): number {
  let p = 0;
  const n = joint.length;
  for (let i = 0; i < n; i++) p += joint[i][i];
  return p;
}
