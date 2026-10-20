import { buildUclDailyEdgePreview, type UclStoredPriceObservation } from "../../lib/services/ucl/buildUclDailyEdgePreview";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function main() {
  const slate = await buildUclSlate();
  let observations: UclStoredPriceObservation[] = [];
  const response = await buildUclDailyEdgePreview(slate, { captureAllBookPrices: (rows) => { observations = rows; } });
  const games = response.games.map((game) => {
    const providerId = Number(game.external_id);
    const evaluated = game.markets.first_inning.sportsbook?.toLowerCase() ?? null;
    const rows = observations.filter((row) => row.providerId === providerId && row.market === "btts" && row.sportsbook);
    const byBook = new Map<string, Partial<Record<"yes" | "no", UclStoredPriceObservation>>>();
    for (const row of rows) {
      if (row.side !== "yes" && row.side !== "no") continue;
      const book = row.sportsbook!.toLowerCase();
      const bucket = byBook.get(book) ?? {};
      const prior = bucket[row.side];
      if (!prior || Date.parse(row.recordedAt) > Date.parse(prior.recordedAt)) bucket[row.side] = row;
      byBook.set(book, bucket);
    }
    const vectors = [...byBook.entries()].flatMap(([book, sides]) => {
      if (!sides.yes || !sides.no) return [];
      const yes = implied(sides.yes.american);
      const no = implied(sides.no.american);
      return [{ book, yes: yes / (yes + no) }];
    });
    const alternatives = vectors.filter((row) => row.book !== evaluated);
    const consensus = alternatives.length >= 2 ? median(alternatives.map((row) => row.yes)) : null;
    const leaveOneOutMedians = vectors.length >= 3
      ? vectors.map((excluded) => median(vectors.filter((row) => row.book !== excluded.book).map((row) => row.yes))!)
      : [];
    const robustTargetExcludedNo = leaveOneOutMedians.length > 0 && leaveOneOutMedians.every((value) => value < 0.5);
    return {
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      modelYes: game.soccerProjection?.goalOutlookProbabilities?.bttsYes ?? null,
      modelSide: game.markets.first_inning.pick,
      evaluatedBook: evaluated,
      alternativeBooks: alternatives.length,
      targetExcludedMedianYes: consensus,
      targetExcludedSide: consensus === null ? null : consensus >= 0.5 ? "Yes" : "No",
      leaveOneOutMedianRange: leaveOneOutMedians.length
        ? { minimum: Math.min(...leaveOneOutMedians), maximum: Math.max(...leaveOneOutMedians) }
        : null,
      robustTargetExcludedNo,
      vectors,
    };
  });
  console.log(JSON.stringify({
    mode: "read_only_no_runtime_change",
    fixtures: games.length,
    modelYes: games.filter((game) => game.modelSide === "Yes").length,
    targetExcludedNo: games.filter((game) => game.targetExcludedSide === "No").length,
    robustTargetExcludedNo: games.filter((game) => game.robustTargetExcludedNo).length,
    games,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
