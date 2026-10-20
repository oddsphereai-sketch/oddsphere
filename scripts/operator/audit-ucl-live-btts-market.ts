import { buildUclDailyEdgePreview, type UclStoredPriceObservation } from "../../lib/services/ucl/buildUclDailyEdgePreview";
import { readUclStoredPriceHistory } from "../../lib/services/ucl/uclLineHistoryStore";
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
  const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
  let observations: UclStoredPriceObservation[] = [];
  const response = await buildUclDailyEdgePreview(slate, {
    storedPriceHistory,
    captureAllBookPrices: (rows) => { observations = rows; },
  });
  const games = response.games.map((game) => {
    const providerId = Number(game.external_id);
    const evaluated = (game.markets.first_inning.currentPriceSportsbook
      ?? game.markets.first_inning.soccerPriceBoard?.sportsbook)?.toLowerCase() ?? null;
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
      runtimeShadow: game.soccerModelProvenance?.bttsShadow ?? null,
      vectors,
    };
  });
  console.log(JSON.stringify({
    mode: "read_only_no_runtime_change",
    fixtures: games.length,
    storedPriceObservations: storedPriceHistory.length,
    modelYes: games.filter((game) => game.modelSide === "Yes").length,
    targetExcludedNo: games.filter((game) => game.targetExcludedSide === "No").length,
    robustTargetExcludedNo: games.filter((game) => game.robustTargetExcludedNo).length,
    shadowAvailable: games.filter((game) => game.runtimeShadow?.available).length,
    shadowCandidateNo: games.filter((game) => game.runtimeShadow?.candidateSide === "no").length,
    lanes: Object.fromEntries(["aligned", "corrected", "conflicted", "unavailable"].map((lane) => [
      lane,
      games.filter((game) => (game.runtimeShadow?.lane ?? "unavailable") === lane).length,
    ])),
    movement: {
      available: games.filter((game) => game.runtimeShadow?.movementSide).length,
      supportsConsensus: games.filter((game) => game.runtimeShadow?.movementCorroboratesConsensus).length,
      resistsConsensus: games.filter((game) => game.runtimeShadow?.movementResistsConsensus).length,
    },
    sideChanges: games.filter((game) => game.runtimeShadow && game.runtimeShadow.candidateSide !== game.runtimeShadow.modelSide).length,
    promotions: games.filter((game) => game.runtimeShadow?.gradeEffect === "promotion").length,
    demotions: games.filter((game) => game.runtimeShadow?.gradeEffect === "demotion").length,
    unchanged: games.filter((game) => game.runtimeShadow?.gradeEffect === "unchanged").length,
    currentVerdicts: Object.fromEntries(["lean", "watchlist", "no_play"].map((verdict) => [
      verdict,
      games.filter((game) => game.runtimeShadow?.currentVerdict === verdict).length,
    ])),
    candidateVerdicts: Object.fromEntries(["lean", "watchlist", "no_play"].map((verdict) => [
      verdict,
      games.filter((game) => game.runtimeShadow?.candidateVerdict === verdict).length,
    ])),
    games,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
