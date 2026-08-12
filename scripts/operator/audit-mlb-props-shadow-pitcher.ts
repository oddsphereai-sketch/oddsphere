import type { PlayerPropPreviewRow } from "../../app/mlb/props/components/PlayerPropsDashboard";
import {
  loadLatestMlbPropsBoardSnapshot,
  measureMlbPropsBoardSnapshot,
} from "../../lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, refreshMlbPropsBoard } from "../../lib/mlb/props/liveBoard";

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const slateDate = argument("date") ?? easternSlateDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) throw new Error("--date must use YYYY-MM-DD");

  const previous = await loadLatestMlbPropsBoardSnapshot(slateDate);
  const result = await refreshMlbPropsBoard({
    slateDate,
    refreshMode: "full",
    persist: false,
  });
  const shadow = result.snapshot.modelContext?.shadowPitcherPredictions ?? [];
  const board = result.snapshot.data.props;
  const boardImpact = compareBoards(previous?.data.props ?? [], board);
  const summaries = Object.fromEntries(
    ["pitcher_strikeouts", "pitcher_outs"].map((market) => {
      const rows = shadow.filter((row) => row.market === market);
      const scored = rows.filter((row) => row.prediction.overProbability !== null);
      const accuracyCandidates = scored.filter((row) =>
        (row.prediction.selectedProbability ?? 0) >= 0.55,
      );
      const missing = new Map<string, number>();
      for (const row of rows) {
        for (const feature of row.prediction.missingFeatures) {
          missing.set(feature, (missing.get(feature) ?? 0) + 1);
        }
      }
      const sideComparisons = scored.flatMap((row) => {
        const active = board.find((candidate) =>
          candidate.providerIds?.gameId === row.gameId
          && candidate.providerIds?.mlbStatsPlayerId === row.playerId
          && candidate.market === row.market
          && candidate.line === row.line,
        );
        return active ? [{ active: active.side, shadow: row.prediction.selectedSide }] : [];
      });
      return [market, {
        observations: rows.length,
        status: countBy(rows, (row) => row.prediction.status),
        scored: scored.length,
        accuracyCandidatesAt55: accuracyCandidates.length,
        selectedSides: countBy(scored, (row) => row.prediction.selectedSide ?? "missing"),
        activeSideComparisons: sideComparisons.length,
        activeSideDisagreements: sideComparisons.filter((row) => row.active !== row.shadow).length,
        missingFeatures: Object.fromEntries([...missing].sort((left, right) => right[1] - left[1])),
        probabilityRange: range(scored.map((row) => row.prediction.selectedProbability)),
      }];
    }),
  );
  console.log(JSON.stringify({
    slateDate,
    generatedAt: result.snapshot.asOfTimestamp,
    writesToProduction: false,
    activeRelease: result.snapshot.modelContext?.modelReleaseId ?? null,
    shadowRelease: shadow[0]?.prediction.releaseId ?? null,
    publishable: result.snapshot.validation.publishable,
    validationErrors: result.snapshot.validation.errors,
    boardRows: board.length,
    snapshotSize: measureMlbPropsBoardSnapshot(result.snapshot),
    providerCalls: result.providerCalls,
    pairedBoardImpact: {
      previousRelease: previous?.modelContext?.modelReleaseId ?? null,
      candidateRelease: result.snapshot.modelContext?.modelReleaseId ?? null,
      ...boardImpact,
    },
    markets: summaries,
  }, null, 2));
}

function compareBoards(
  previous: PlayerPropPreviewRow[],
  candidate: PlayerPropPreviewRow[],
) {
  const prior = new Map(previous.map((row) => [rowKey(row), row]));
  let matched = 0;
  let retainedActionable = 0;
  let promotedActionable = 0;
  let demotedActionable = 0;
  let weakStrikeoutRows = 0;
  let weakStrikeoutProbabilityChanges = 0;
  let weakStrikeoutProjectionChanges = 0;
  let weakBaselineActionablePromotions = 0;
  let weakBaselineActionableDemotions = 0;
  const promotions: Array<Record<string, unknown>> = [];
  const demotions: Array<Record<string, unknown>> = [];
  for (const row of candidate) {
    const before = prior.get(rowKey(row));
    if (!before) continue;
    matched++;
    const beforeActionable = actionable(before);
    const afterActionable = actionable(row);
    if (beforeActionable && afterActionable) retainedActionable++;
    else if (!beforeActionable && afterActionable) {
      promotedActionable++;
      promotions.push(changeSummary(before, row));
    } else if (beforeActionable && !afterActionable) {
      demotedActionable++;
      demotions.push(changeSummary(before, row));
    }
    if (row.modelInputWarnings?.includes("weak_pitcher_baseline")) {
      if (!beforeActionable && afterActionable) weakBaselineActionablePromotions++;
      if (beforeActionable && !afterActionable) weakBaselineActionableDemotions++;
    }
    if (row.market === "pitcher_strikeouts" && row.modelInputWarnings?.includes("weak_pitcher_baseline")) {
      weakStrikeoutRows++;
      if (before.finalProbability !== row.finalProbability) weakStrikeoutProbabilityChanges++;
      if (before.projection !== row.projection) weakStrikeoutProjectionChanges++;
    }
  }
  return {
    previousRows: previous.length,
    candidateRows: candidate.length,
    matchedRows: matched,
    retainedActionable,
    promotedActionable,
    demotedActionable,
    netActionable: promotedActionable - demotedActionable,
    weakStrikeoutRows,
    weakStrikeoutProbabilityChanges,
    weakStrikeoutProjectionChanges,
    weakBaselineActionablePromotions,
    weakBaselineActionableDemotions,
    promotionsByMarket: countBy(promotions, (row) => String(row.market)),
    demotionsByMarket: countBy(demotions, (row) => String(row.market)),
    promotions,
    demotions,
  };
}

function changeSummary(before: PlayerPropPreviewRow, after: PlayerPropPreviewRow) {
  return {
    player: after.player,
    market: after.market,
    side: after.side,
    line: after.line,
    odds: after.odds,
    book: after.book,
    beforeGrade: before.playGrade,
    afterGrade: after.playGrade,
    addedReasons: after.reasonCodes.filter((reason) => !before.reasonCodes.includes(reason)),
  };
}

function actionable(row: { playGrade: string; units: number }): boolean {
  return (row.playGrade === "LEAN" || row.playGrade === "BEST_ANGLE") && row.units > 0;
}

function rowKey(row: {
  providerIds?: { gameId?: string | null; mlbStatsPlayerId?: string | null };
  market: string;
  side: string;
  line: number;
  book: string;
}): string {
  return [row.providerIds?.gameId, row.providerIds?.mlbStatsPlayerId, row.market, row.side, row.line, row.book].join("|");
}

function countBy<T>(rows: T[], classifier: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = classifier(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function range(values: Array<number | null>): { minimum: number | null; maximum: number | null } {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    minimum: finite.length ? Math.min(...finite) : null,
    maximum: finite.length ? Math.max(...finite) : null,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
