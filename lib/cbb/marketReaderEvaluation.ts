import { evaluateCbbRows } from "./evaluation";
import { settleCbbMarket, cbbThresholdProbabilities } from "./model";
import { applyCbbMarketHead, type CbbMarketHead } from "./marketReaderResearch";
import type { CbbScoreFeatureRow } from "./scoreResearch";
import type { CbbQuote, CbbMarket } from "./types";
export type CbbMarketEvaluationRow = CbbScoreFeatureRow & { targets: CbbQuote[] };
export function evaluateCbbMarketReaderRows(rows: CbbMarketEvaluationRow[], model?: CbbMarketHead) {
  const evaluated = rows.map(r => ({ ...r, forecast: model ? applyCbbMarketHead(r, model) : r.forecast }));
  const first = (r: CbbScoreFeatureRow, market: CbbMarket, line: number | null) => market === "moneyline" ? r.forecast.homeWinProbability >= 0.5 :
    market === "spread" ? r.forecast.margin + line! > 0 : r.forecast.total > line!;
  const markets = Object.fromEntries((["moneyline", "spread", "total"] as const).map(market => {
    let wins = 0, losses = 0, pushes = 0, corrections = 0, harms = 0, units = 0, brier = 0, logLoss = 0;
    for (const [i, row] of evaluated.entries()) {
      const targets = row.targets.filter(q => q.market === market);
      if (targets.length !== 1 || targets[0].gameId !== row.game.id) throw new Error("CBB evaluation requires one exact target per market/game");
      const quote = targets[0], oldSide = first(rows[i], market, quote.line), side = first(row, market, quote.line);
      const old = settleCbbMarket(market, oldSide ? "first" : "second", quote.line, row.game.homeScore, row.game.awayScore);
      const next = settleCbbMarket(market, side ? "first" : "second", quote.line, row.game.homeScore, row.game.awayScore);
      wins += Number(next === "win"); losses += Number(next === "loss"); pushes += Number(next === "push");
      corrections += Number(old === "loss" && next === "win"); harms += Number(old === "win" && next === "loss");
      const price = side ? quote.firstPrice : quote.secondPrice;
      units += next === "push" ? 0 : next === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price;
      if (next !== "push") {
        const probabilities = cbbThresholdProbabilities(row.forecast, market, quote.line);
        const p = Math.max(1e-9, Math.min(1 - 1e-9, probabilities.first / (probabilities.first + probabilities.second)));
        const actual = market === "total" ? row.game.homeScore + row.game.awayScore - quote.line! : row.game.homeScore - row.game.awayScore + (market === "spread" ? quote.line! : 0);
        const y = Number(actual > 0); brier += (p - y) ** 2; logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
      }
    }
    return [market, { wins, losses, pushes, accuracy: wins / Math.max(1, wins + losses), corrections, harms,
      hypotheticalOneRiskedUnits: units, brier: brier / Math.max(1, wins + losses), logLoss: logLoss / Math.max(1, wins + losses) }];
  }));
  return { score: evaluateCbbRows(evaluated), markets };
}
