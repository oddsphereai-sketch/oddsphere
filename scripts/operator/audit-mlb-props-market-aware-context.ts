import type { PlayerPropPreviewRow } from "../../app/mlb/props/components/PlayerPropsDashboard";
import { loadLatestMlbPropsBoardSnapshot } from "../../lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, refreshMlbPropsBoard } from "../../lib/mlb/props/liveBoard";

const ACTIONABLE = new Set(["BEST_ANGLE", "LEAN"]);
const POSITIVE = new Set(["BEST_ANGLE", "LEAN", "WATCHLIST"]);

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const slateDate = argument("date") ?? easternSlateDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) throw new Error("--date must use YYYY-MM-DD");

  const previous = await loadLatestMlbPropsBoardSnapshot(slateDate);
  if (!previous) throw new Error(`No production MLB props snapshot exists for ${slateDate}.`);
  const candidate = await refreshMlbPropsBoard({
    slateDate,
    refreshMode: "full",
    persist: false,
  });

  const before = previous.data.props;
  const after = candidate.snapshot.data.props;
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const matched = after.flatMap((row) => {
    const prior = beforeById.get(row.id);
    return prior ? [{ prior, row }] : [];
  });
  const gradeTransitions = countBy(matched, ({ prior, row }) => `${prior.playGrade}->${row.playGrade}`);
  const actionablePromotions = matched.filter(({ prior, row }) => !ACTIONABLE.has(prior.playGrade) && ACTIONABLE.has(row.playGrade));
  const actionableDemotions = matched.filter(({ prior, row }) => ACTIONABLE.has(prior.playGrade) && !ACTIONABLE.has(row.playGrade));
  const watchlistPromotions = matched.filter(({ prior, row }) => prior.playGrade === "NO_PLAY" && row.playGrade === "WATCHLIST");
  const lockedMismatches = matched.filter(({ prior, row }) => prior.lockStatus && !sameLockedRecord(prior, row));

  console.log(JSON.stringify({
    slateDate,
    generatedAt: candidate.snapshot.asOfTimestamp,
    writesToProduction: false,
    previousRelease: previous.modelContext?.modelReleaseId ?? null,
    candidateRelease: candidate.snapshot.modelContext?.modelReleaseId ?? null,
    publishable: candidate.snapshot.validation.publishable,
    validationErrors: candidate.snapshot.validation.errors,
    providerCalls: candidate.providerCalls,
    rows: { before: before.length, after: after.length, matched: matched.length },
    probabilitiesChanged: matched.filter(({ prior, row }) => prior.finalProbability !== row.finalProbability).length,
    projectionsChanged: matched.filter(({ prior, row }) => prior.projection !== row.projection).length,
    marketEvidenceRows: {
      targetExcludedReference: after.filter((row) => row.reasonCodes.includes("TARGET_EXCLUDED_MARKET_REFERENCE")).length,
      openingMovement: after.filter((row) => row.reasonCodes.includes("MARKET_MOVEMENT_CONTEXT")).length,
      crossMarketMovement: after.filter((row) => row.reasonCodes.includes("CROSS_MARKET_MOVEMENT_CONTEXT")).length,
      verifiedSplits: after.filter((row) => row.reasonCodes.includes("VERIFIED_SPLIT_CONTEXT")).length,
      exactValueWatchlists: after.filter((row) => row.reasonCodes.includes("MARKET_AWARE_VALUE_WATCHLIST")).length,
    },
    gradeTransitions,
    actionable: {
      before: before.filter((row) => ACTIONABLE.has(row.playGrade)).length,
      after: after.filter((row) => ACTIONABLE.has(row.playGrade)).length,
      promotionCount: actionablePromotions.length,
      demotionCount: actionableDemotions.length,
      promotionSamples: actionablePromotions.map(changeSummary).slice(0, 10),
      demotionSamples: actionableDemotions.map(changeSummary).slice(0, 10),
    },
    watchlistPromotions: {
      count: watchlistPromotions.length,
      samples: watchlistPromotions.map(changeSummary).slice(0, 10),
    },
    lockedRecordCheck: {
      matchedLockedRows: matched.filter(({ prior }) => Boolean(prior.lockStatus)).length,
      mismatches: lockedMismatches.map(changeSummary).slice(0, 20),
    },
    categories: categoryHealth(before, after),
  }, null, 2));
}

function categoryHealth(before: PlayerPropPreviewRow[], after: PlayerPropPreviewRow[]) {
  const markets = [...new Set([...before, ...after].map((row) => row.market))].sort();
  return Object.fromEntries(markets.map((market) => {
    const prior = before.filter((row) => row.market === market);
    const candidate = after.filter((row) => row.market === market);
    return [market, {
      rowsBefore: prior.length,
      rowsAfter: candidate.length,
      gradesBefore: countBy(prior, (row) => row.playGrade),
      gradesAfter: countBy(candidate, (row) => row.playGrade),
      positiveBefore: prior.filter((row) => POSITIVE.has(row.playGrade)).length,
      positiveAfter: candidate.filter((row) => POSITIVE.has(row.playGrade)).length,
      actionableBefore: prior.filter((row) => ACTIONABLE.has(row.playGrade)).length,
      actionableAfter: candidate.filter((row) => ACTIONABLE.has(row.playGrade)).length,
    }];
  }));
}

function sameLockedRecord(before: PlayerPropPreviewRow, after: PlayerPropPreviewRow): boolean {
  return [
    "projection",
    "modelProbability",
    "marketProbability",
    "finalProbability",
    "side",
    "line",
    "odds",
    "book",
    "playGrade",
    "units",
    "keyFeatures",
    "missingFeatures",
    "reasonCodes",
  ].every((field) => JSON.stringify(before[field as keyof PlayerPropPreviewRow]) === JSON.stringify(after[field as keyof PlayerPropPreviewRow]));
}

function changeSummary({ prior, row }: { prior: PlayerPropPreviewRow; row: PlayerPropPreviewRow }) {
  return {
    player: row.player,
    market: row.market,
    side: row.side,
    line: row.line,
    book: row.book,
    odds: row.odds,
    beforeGrade: prior.playGrade,
    afterGrade: row.playGrade,
    beforeProbability: prior.finalProbability,
    afterProbability: row.finalProbability,
    beforeProjection: prior.projection,
    afterProjection: row.projection,
    edge: row.modelEdge,
    expectedValue: row.expectedValue,
  };
}

function countBy<T>(rows: readonly T[], keyFor: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
