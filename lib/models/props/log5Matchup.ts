/**
 * Bill James log5 — batter-vs-pitcher matchup math.
 *
 * Given a batter's true rate, a pitcher's true allowed rate, and a league
 * baseline, log5 computes the expected matchup-specific rate.
 *
 * Formula:
 *                          (b · p) / lg
 *   log5(b, p, lg) = ─────────────────────────────────
 *                    (b · p) / lg + (1−b)(1−p) / (1−lg)
 *
 * Properties:
 *   • log5(b, lg, lg) = b   — pitcher is league-average → batter retains rate
 *   • log5(lg, p, lg) = p   — batter is league-average → pitcher's rate wins
 *   • log5(b, p, b)  = p   — when league = batter, result is the pitcher
 *   • log5(0.5, 0.5, 0.5) = 0.5   — symmetric neutral case
 *   • log5(0.3, 0.3, 0.25) ≈ 0.3553  — canonical above-league matchup
 *
 * Reference:
 *   Bill James, _The Bill James Baseball Abstract_ (1981).
 *   Tom Tango et al., _The Book: Playing the Percentages in Baseball_ (2007),
 *   pp. 374-377 (derivation and empirical validation).
 */

export function log5(
  batterRate: number,
  pitcherAllowedRate: number,
  leagueRate: number
): number {
  if (leagueRate <= 0 || leagueRate >= 1) {
    throw new Error(
      `log5: leagueRate must be in (0, 1), got ${leagueRate}`
    );
  }
  if (batterRate < 0 || batterRate > 1) {
    throw new Error(
      `log5: batterRate must be in [0, 1], got ${batterRate}`
    );
  }
  if (pitcherAllowedRate < 0 || pitcherAllowedRate > 1) {
    throw new Error(
      `log5: pitcherAllowedRate must be in [0, 1], got ${pitcherAllowedRate}`
    );
  }

  // Boundary cases that would otherwise produce 0/0 or NaN
  if (batterRate === 0 || pitcherAllowedRate === 0) return 0;
  if (batterRate === 1 && pitcherAllowedRate === 1) return 1;

  const numerator = (batterRate * pitcherAllowedRate) / leagueRate;
  const denominator =
    numerator +
    ((1 - batterRate) * (1 - pitcherAllowedRate)) / (1 - leagueRate);

  return numerator / denominator;
}
