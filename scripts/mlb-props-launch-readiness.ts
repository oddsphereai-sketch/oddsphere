import { refreshMlbPropsBoard } from "../lib/mlb/props/liveBoard";
import { evaluateMlbPropsLaunchReadiness, loadMlbPropsLaunchReadiness } from "../lib/mlb/props/launchReadiness";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const date = arg("date") ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must use YYYY-MM-DD");
  const persist = arg("persist") === "true";
  const refreshMode = arg("full") === "false" ? "fast" : "full";
  const result = await refreshMlbPropsBoard({ slateDate: date, refreshMode, persist });
  const readiness = await loadMlbPropsLaunchReadiness(date);
  const currentSnapshotReadiness = evaluateMlbPropsLaunchReadiness({
    slateDate: date,
    snapshots: [result.snapshot],
    tracking: readiness.tracking,
  });
  const currentDataChecks = currentSnapshotReadiness.checks.filter((check) => ![
    "REFRESH_CRON_ENABLED",
    "TRACKING_ENABLED",
    "TRACKING_TABLE_AVAILABLE",
    "SETTLEMENT_CRON_ENABLED",
    "PUBLIC_FLAGS_COHERENT",
    "CONSECUTIVE_VALID_SNAPSHOTS",
    "SNAPSHOT_SEQUENCE_SPAN",
    "LATEST_SETTLEMENT_HEALTHY",
  ].includes(check.code));
  const missingResearch = new Map<string, { rows: number; examples: string[] }>();
  for (const row of result.snapshot.data.props) {
    for (const feature of row.missingFeatures) {
      const current = missingResearch.get(feature) ?? { rows: 0, examples: [] };
      current.rows += 1;
      const example = `${row.player} · ${row.marketLabel}`;
      if (current.examples.length < 5 && !current.examples.includes(example)) current.examples.push(example);
      missingResearch.set(feature, current);
    }
  }
  console.log(JSON.stringify({
    date,
    persist,
    published: result.published,
    snapshotId: result.snapshot.snapshotId,
    asOfTimestamp: result.snapshot.asOfTimestamp,
    refreshMode: result.snapshot.refreshMode,
    games: result.snapshot.data.summary.gamesWithProps,
    props: result.snapshot.data.props.length,
    scoredProps: result.snapshot.data.summary.scoredProps,
    actionableRows: result.snapshot.validation.actionableRows,
    sourceRows: result.snapshot.validation.sourceRows,
    mappedRows: result.snapshot.validation.mappedRows,
    staleOddsRows: result.snapshot.validation.staleOddsRows,
    publishable: result.snapshot.validation.publishable,
    errors: result.snapshot.validation.errors,
    warnings: result.snapshot.validation.warnings,
    missingResearch: Object.fromEntries([...missingResearch.entries()].sort((a, b) => b[1].rows - a[1].rows)),
    movement: result.snapshot.movement,
    trackingSync: result.tracking,
    providerCalls: result.providerCalls,
    currentSnapshot: {
      dataReady: currentDataChecks.filter((check) => check.critical).every((check) => check.ok),
      blockers: currentDataChecks.filter((check) => check.critical && !check.ok).map((check) => check.code),
      warnings: currentDataChecks.filter((check) => !check.critical && !check.ok).map((check) => check.code),
      checks: currentDataChecks,
    },
    launch: readiness,
  }, null, 2));
  if (!result.snapshot.validation.publishable || !readiness.readyToOpen) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
