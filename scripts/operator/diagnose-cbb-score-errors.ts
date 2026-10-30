import { readFile, writeFile } from "node:fs/promises";
import type { CbbEvaluationRow } from "../../lib/cbb/evaluation";
const directory = "/private/tmp/oddsphere-cbb-data";
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const sd = (values: number[]) => Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2)));
const slope = (x: number[], y: number[]) => mean(x.map((value, i) => (value - mean(x)) * (y[i] - mean(y)))) / sd(x) ** 2;
const mae = (x: number[], y: number[]) => mean(x.map((value, i) => Math.abs(value - y[i])));
async function main() {
  const rows: CbbEvaluationRow[] = JSON.parse(await readFile(`${directory}/confirmation-rows.json`, "utf8"));
  const margins = rows.map(row => row.forecast.margin), actualMargins = rows.map(row => row.game.homeScore - row.game.awayScore);
  const totals = rows.map(row => row.forecast.total), actualTotals = rows.map(row => row.game.homeScore + row.game.awayScore);
  const paces = rows.map(row => row.forecast.possessions), actualPaces = rows.map(row => row.game.tempo);
  const group = (name: string, predicate: (row: CbbEvaluationRow) => boolean) => {
    const subset = rows.filter(predicate);
    return { name, games: subset.length,
      marginMae: mean(subset.map(row => Math.abs(row.forecast.margin - row.game.homeScore + row.game.awayScore))),
      totalMae: mean(subset.map(row => Math.abs(row.forecast.total - row.game.homeScore - row.game.awayScore))),
      totalBias: mean(subset.map(row => row.forecast.total - row.game.homeScore - row.game.awayScore)) };
  };
  const report = {
    games: rows.length,
    margin: { predictedSd: sd(margins), actualSd: sd(actualMargins), diagnosticSlope: slope(margins, actualMargins), mae: mae(margins, actualMargins) },
    total: { predictedSd: sd(totals), actualSd: sd(actualTotals), diagnosticSlope: slope(totals, actualTotals),
      bias: mean(totals.map((value, i) => value - actualTotals[i])), mae: mae(totals, actualTotals) },
    pace: { predictedSd: sd(paces), actualSd: sd(actualPaces), diagnosticSlope: slope(paces, actualPaces), mae: mae(paces, actualPaces) },
    oracleActualTempoTotalMae: mae(rows.map(row => (row.forecast.total - row.forecast.uncertainty.totalCorrection) * row.game.tempo / row.forecast.possessions + row.forecast.uncertainty.totalCorrection), actualTotals),
    oracleWarning: "Postgame actual pace is diagnostic only, never a runtime feature or candidate performance claim.",
    groups: [group("overtime", row => row.game.overtime), group("regulation", row => !row.game.overtime),
      group("projected_margin_under_5", row => Math.abs(row.forecast.margin) < 5),
      group("projected_margin_over_15", row => Math.abs(row.forecast.margin) > 15)],
  };
  await writeFile(`${directory}/score-error-diagnosis.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
