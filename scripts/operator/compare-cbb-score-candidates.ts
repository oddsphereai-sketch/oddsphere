import { readFile, writeFile } from "node:fs/promises";
import { evaluateCbbRows, cbbMonthlyMetrics, type CbbEvaluationRow } from "../../lib/cbb/evaluation";
const dir = "/private/tmp/oddsphere-cbb-data";
async function main() {
  const baseline: CbbEvaluationRow[] = JSON.parse(await readFile(`${dir}/confirmation-rows.json`, "utf8"));
  const candidate: CbbEvaluationRow[] = JSON.parse(await readFile(`${dir}/candidate-r2-diagnostic.json`, "utf8"));
  const byId = new Map(baseline.map(row => [row.game.id, row]));
  if (candidate.length !== baseline.length || candidate.some(row => !byId.has(row.game.id))) throw new Error("CBB paired cohort mismatch");
  const dates = new Map<string, Array<{ margin: number; total: number; winner: number }>>();
  let corrections = 0, harms = 0;
  for (const row of candidate) {
    const old = byId.get(row.game.id)!;
    const m = row.game.homeScore - row.game.awayScore, t = row.game.homeScore + row.game.awayScore;
    const winner = row.game.homeScore > row.game.awayScore;
    const oldWin = (old.forecast.homeWinProbability >= 0.5) === winner, newWin = (row.forecast.homeWinProbability >= 0.5) === winner;
    corrections += Number(!oldWin && newWin); harms += Number(oldWin && !newWin);
    const day = row.game.date.slice(0, 10);
    dates.set(day, [...(dates.get(day) ?? []), {
      margin: Math.abs(row.forecast.margin - m) - Math.abs(old.forecast.margin - m),
      total: Math.abs(row.forecast.total - t) - Math.abs(old.forecast.total - t), winner: Number(newWin) - Number(oldWin),
    }]);
  }
  const blocks = [...dates.values()].map(rows => ({ n: rows.length,
    margin: rows.reduce((sum, row) => sum + row.margin, 0), total: rows.reduce((sum, row) => sum + row.total, 0),
    winner: rows.reduce((sum, row) => sum + row.winner, 0) }));
  let seed = 20261028;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const samples: { margin: number; total: number; winner: number }[] = [];
  for (let iteration = 0; iteration < 2000; iteration++) {
    let n = 0, margin = 0, total = 0, winner = 0;
    for (let j = 0; j < blocks.length; j++) { const b = blocks[Math.floor(random() * blocks.length)]; n += b.n; margin += b.margin; total += b.total; winner += b.winner; }
    samples.push({ margin: margin / n, total: total / n, winner: winner / n });
  }
  const interval = (key: keyof typeof samples[number]) => {
    const sorted = samples.map(row => row[key]).sort((a, b) => a - b); return [sorted[50], sorted[1949]];
  };
  const oldMonths = cbbMonthlyMetrics(baseline), newMonths = cbbMonthlyMetrics(candidate);
  const group = (predicate: (row: CbbEvaluationRow) => boolean) => {
    const next = candidate.filter(predicate), ids = new Set(next.map(row => row.game.id));
    return { baseline: evaluateCbbRows(baseline.filter(row => ids.has(row.game.id))), candidate: evaluateCbbRows(next) };
  };
  const report = { productionWrites: 0, games: candidate.length, corrections, harms, netWinners: corrections - harms,
    uncertainty: { method: "2000 fixed-seed calendar-date block bootstrap", independentDates: blocks.length,
      scope: "within opened retrospective cohort; excludes selection bias, future seasons and persistent team dependence",
      marginMaeDelta95: interval("margin"), totalMaeDelta95: interval("total"), winnerAccuracyDelta95: interval("winner") },
    baseline: evaluateCbbRows(baseline), candidate: evaluateCbbRows(candidate),
    monthly: Object.fromEntries(Object.keys(newMonths).map(month => [month, { baseline: oldMonths[month], candidate: newMonths[month] }])),
    overtime: group(row => row.game.overtime), regulation: group(row => !row.game.overtime),
    neutral: group(row => row.game.neutral === true), homeVenue: group(row => row.game.neutral === false),
    harmfulWinnerChanges: candidate.filter(row => { const old = byId.get(row.game.id)!; const winner = row.game.homeScore > row.game.awayScore;
      return (old.forecast.homeWinProbability >= 0.5) === winner && (row.forecast.homeWinProbability >= 0.5) !== winner;
    }).map(row => ({ gameId: row.game.id, date: row.game.date, actualMargin: row.game.homeScore - row.game.awayScore,
      oldMargin: byId.get(row.game.id)!.forecast.margin, newMargin: row.forecast.margin })) };
  await writeFile(`${dir}/score-paired-comparison.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ games: report.games, corrections, harms, uncertainty: report.uncertainty,
    monthly: Object.fromEntries(Object.entries(report.monthly).map(([month, value]) => [month, { n: value.candidate.games,
      marginDelta: value.candidate.marginMae - value.baseline.marginMae, totalDelta: value.candidate.totalMae - value.baseline.totalMae,
      winnerDelta: value.candidate.wins - value.baseline.wins }])) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
