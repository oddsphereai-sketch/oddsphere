/**
 * SELECT-only equal-input replay of the MLB props r41 final projection-side
 * actionability gate against the latest immutable r40 canonical snapshot.
 */
import type { PlayerPropPreviewRow } from "../../app/mlb/props/components/PlayerPropsDashboard";
import {
  loadLatestMlbPropsBoardSnapshot,
  loadMlbPropsBoardSnapshotById,
} from "../../lib/mlb/props/boardSnapshotStore";
import { MLB_PROP_MARKET_KEYS } from "../../lib/mlb/props/config";
import { MLB_PROPS_MODEL_RELEASE_ID } from "../../lib/mlb/props/marketModelVersions";
import {
  applyMlbPropsProjectionSideActionability,
  checkProjectionSideIntegrity,
} from "../../lib/mlb/props/projectionSideIntegrity";

const INCUMBENT_RELEASE = "mlb_props_2026_09_02_r40";
const CANDIDATE_RELEASE = "mlb_props_2026_09_02_r41";
const ACTIONABLE = new Set(["BEST_ANGLE", "LEAN"]);
const HEALTH = new Set(["PENDING_DATA", "RESEARCH"]);

function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function counts(values: readonly string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [
    value,
    values.filter((candidate) => candidate === value).length,
  ]));
}

function actionable(row: PlayerPropPreviewRow): boolean {
  return ACTIONABLE.has(row.playGrade);
}

function ordinaryActionContradiction(row: PlayerPropPreviewRow): boolean {
  if (!actionable(row)) return false;
  if (row.market === "batter_home_runs" && row.offerContract === "milestone") return false;
  return checkProjectionSideIntegrity(row).status === "contradiction";
}

function rowBehavior(row: PlayerPropPreviewRow) {
  return {
    projection: row.projection,
    modelProbability: row.modelProbability,
    independentProbability: row.independentProbability,
    marketProbability: row.marketProbability,
    finalProbability: row.finalProbability,
    overProbability: row.overProbability,
    underProbability: row.underProbability,
    side: row.side,
    line: row.line,
    odds: row.odds,
    book: row.book,
    expectedValue: row.expectedValue,
    modelEdge: row.modelEdge,
    fairOdds: row.fairOdds,
  };
}

async function main(): Promise<void> {
  if (MLB_PROPS_MODEL_RELEASE_ID !== CANDIDATE_RELEASE) {
    throw new Error(`Expected candidate runtime ${CANDIDATE_RELEASE}; received ${MLB_PROPS_MODEL_RELEASE_ID}.`);
  }
  const date = option("date") ?? easternDate();
  const snapshotId = option("snapshot-id");
  const snapshot = snapshotId
    ? await loadMlbPropsBoardSnapshotById(date, snapshotId)
    : await loadLatestMlbPropsBoardSnapshot(date);
  if (!snapshot) throw new Error(`No MLB props snapshot exists for ${date}.`);
  if (snapshot.modelContext?.modelReleaseId !== INCUMBENT_RELEASE) {
    throw new Error(`Expected incumbent ${INCUMBENT_RELEASE}; received ${snapshot.modelContext?.modelReleaseId ?? "missing"}.`);
  }
  const before = snapshot.data.props;
  const after = applyMlbPropsProjectionSideActionability(before);
  const afterById = new Map(after.map((row) => [row.id, row]));
  const demotions = before.flatMap((row) => {
    const candidate = afterById.get(row.id)!;
    return actionable(row) && !actionable(candidate) ? [{
      id: row.id,
      player: row.player,
      game: `${row.team}@${row.opponent}`,
      market: row.market,
      side: row.side,
      line: row.line,
      projection: row.projection,
      probability: row.finalProbability,
      book: row.book,
      odds: row.odds,
      expectedValue: row.expectedValue,
      beforeGrade: row.playGrade,
      afterGrade: candidate.playGrade,
      locked: row.lockStatus?.status === "locked",
    }] : [];
  });
  const promotions = before.filter((row) => !actionable(row) && actionable(afterById.get(row.id)!));
  const behaviorChanges = before.filter((row) =>
    JSON.stringify(rowBehavior(row)) !== JSON.stringify(rowBehavior(afterById.get(row.id)!)));
  const lockedChanges = before.filter((row) =>
    row.lockStatus?.status === "locked" && row !== afterById.get(row.id));
  const category = Object.fromEntries(MLB_PROP_MARKET_KEYS.map((market) => {
    const incumbent = before.filter((row) => row.market === market);
    const candidate = after.filter((row) => row.market === market);
    return [market, {
      rows: incumbent.length,
      incumbentGrades: counts(incumbent.map((row) => row.playGrade)),
      candidateGrades: counts(candidate.map((row) => row.playGrade)),
      actionableBefore: incumbent.filter(actionable).length,
      actionableAfter: candidate.filter(actionable).length,
      promotions: incumbent.filter((row) => !actionable(row) && actionable(afterById.get(row.id)!)).length,
      demotions: incumbent.filter((row) => actionable(row) && !actionable(afterById.get(row.id)!)).length,
    }];
  }));
  const newlyFlatCategories = Object.entries(category).flatMap(([market, value]) =>
    value.actionableBefore > 0 && value.actionableAfter === 0 ? [market] : []);
  const safetyOnlyFlatCategories = newlyFlatCategories.filter((market) => {
    const incumbentActions = before.filter((row) => row.market === market && actionable(row));
    return incumbentActions.length > 0 && incumbentActions.every(ordinaryActionContradiction);
  });
  const unexplainedFlatCategories = newlyFlatCategories.filter((market) =>
    !safetyOnlyFlatCategories.includes(market));
  const report = {
    auditRelease: "mlb_props_post_calibration_coherence_audit_2026_09_02_r1",
    readOnly: true,
    databaseSelects: 2,
    providerCalls: 0,
    writes: 0,
    incumbentRelease: INCUMBENT_RELEASE,
    candidateRelease: CANDIDATE_RELEASE,
    snapshot: { id: snapshot.snapshotId, at: snapshot.asOfTimestamp, rows: before.length },
    board: {
      incumbentGrades: counts(before.map((row) => row.playGrade)),
      candidateGrades: counts(after.map((row) => row.playGrade)),
      actionableBefore: before.filter(actionable).length,
      actionableAfter: after.filter(actionable).length,
      promotions: promotions.length,
      demotions: demotions.length,
      ordinaryActionContradictionsBefore: before.filter(ordinaryActionContradiction).length,
      ordinaryActionContradictionsAfter: after.filter(ordinaryActionContradiction).length,
      oneSidedHomeRunActionsBefore: before.filter((row) => actionable(row) && row.market === "batter_home_runs" && row.offerContract === "milestone").length,
      oneSidedHomeRunActionsAfter: after.filter((row) => actionable(row) && row.market === "batter_home_runs" && row.offerContract === "milestone").length,
      newlyFlatCategories,
      safetyOnlyFlatCategories,
      unexplainedFlatCategories,
    },
    immutableOutputs: {
      projectionProbabilitySidePriceEconomicsChanges: behaviorChanges.length,
      healthRowsBefore: before.filter((row) => HEALTH.has(row.playGrade)).length,
      healthRowsAfter: after.filter((row) => HEALTH.has(row.playGrade)).length,
      lockedRows: before.filter((row) => row.lockStatus?.status === "locked").length,
      lockedRowsChanged: lockedChanges.length,
    },
    demotions,
    category,
  };
  if (behaviorChanges.length) throw new Error(`Candidate changes ${behaviorChanges.length} forecast/economic tuples.`);
  if (lockedChanges.length) throw new Error(`Candidate reinterprets ${lockedChanges.length} locked rows.`);
  if (report.board.ordinaryActionContradictionsAfter) {
    throw new Error(`Candidate leaves ${report.board.ordinaryActionContradictionsAfter} ordinary actionable contradictions.`);
  }
  if (unexplainedFlatCategories.length) {
    throw new Error(`Candidate unexpectedly flattens ${unexplainedFlatCategories.join(", ")}.`);
  }
  console.log(JSON.stringify(report, null, process.argv.includes("--compact") ? 0 : 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
