/** Read-only, same-input r21 versus r22 NBA posture-grade report. */

import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";

const dates = process.argv.slice(2);
if (!dates.length) throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");

const actionable = (grade: string) => grade === "best_angle" || grade === "lean";

type AuditRow = {
  date: string;
  gameExternalId: number;
  matchup: string;
  market: "moneyline" | "spread" | "total";
  r21: string;
  r22: string;
  promotion: boolean;
  demotion: boolean;
  bestAnglePromotion: boolean;
  bestAngleDemotion: boolean;
  rationale: string[];
};

async function main(): Promise<void> {
  const rows: AuditRow[] = [];
  let games = 0;
  for (const date of dates) {
    const { nbaDto } = await buildNbaDailyEdgePipeline(date, { includeR21GradePolicyAudit: true });
    games += nbaDto.games.length;
    for (const game of nbaDto.games) for (const comparison of game.intelligence.grade_policy_audit ?? []) {
      rows.push({
        date,
        gameExternalId: game.game_external_id,
        matchup: game.matchup,
        market: comparison.market,
        r21: comparison.r21.grade,
        r22: comparison.r22.grade,
        promotion: !actionable(comparison.r21.grade) && actionable(comparison.r22.grade),
        demotion: actionable(comparison.r21.grade) && !actionable(comparison.r22.grade),
        bestAnglePromotion: comparison.r21.grade !== "best_angle" && comparison.r22.grade === "best_angle",
        bestAngleDemotion: comparison.r21.grade === "best_angle" && comparison.r22.grade !== "best_angle",
        rationale: comparison.r22.rationale,
      });
    }
  }
  const grades = ["best_angle", "lean", "watch", "caution", "no_market", "held"];
  const counts = (release: "r21" | "r22") => Object.fromEntries(["moneyline", "spread", "total"].map(market => [market,
    Object.fromEntries(grades.map(grade => [grade, rows.filter(row => row.market === market && row[release] === grade).length]))]));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, sameInput: true, dates,
    summary: {
      games,
      markets: rows.length,
      r21Counts: counts("r21"),
      r22Counts: counts("r22"),
      r21Actionables: rows.filter(row => actionable(row.r21)).length,
      r22Actionables: rows.filter(row => actionable(row.r22)).length,
      promotions: rows.filter(row => row.promotion).length,
      demotions: rows.filter(row => row.demotion).length,
      bestAnglePromotions: rows.filter(row => row.bestAnglePromotion).length,
      bestAngleDemotions: rows.filter(row => row.bestAngleDemotion).length,
    }, rows }, null, 2));
}

void main();
