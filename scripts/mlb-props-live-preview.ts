import { measureMlbPropsBoardSnapshot } from "../lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, refreshMlbPropsBoard } from "../lib/mlb/props/liveBoard";
import { writeMlbPropsLivePreviewSnapshot } from "../lib/mlb/props/livePreviewStore";

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function booleanArgument(name: string, fallback = false): boolean {
  const raw = argument(name);
  if (raw === null) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name} must be true or false`);
}

async function main() {
  const slateDate = argument("date") ?? easternSlateDate();
  const persist = booleanArgument("persist");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) throw new Error("--date must use YYYY-MM-DD");

  const result = await refreshMlbPropsBoard({ slateDate, refreshMode: "full", persist });
  const destination = await writeMlbPropsLivePreviewSnapshot(result.snapshot);
  const size = measureMlbPropsBoardSnapshot(result.snapshot);

  console.log(JSON.stringify({
    slateDate,
    destination,
    persisted: result.published,
    scoringRunId: result.scoringRunId,
    tracking: result.tracking,
    asOfTimestamp: result.snapshot.asOfTimestamp,
    props: result.snapshot.data.props.length,
    games: result.snapshot.data.summary.gamesWithProps,
    books: result.snapshot.data.summary.booksCovered,
    markets: result.snapshot.data.summary.marketsAvailable,
    staleOddsRows: result.snapshot.validation.staleOddsRows,
    publishable: result.snapshot.validation.publishable,
    errors: result.snapshot.validation.errors,
    warnings: result.snapshot.validation.warnings,
    bdlApiCalls: result.providerCalls.balldontlie,
    bdlApiCallsByStage: {
      odds: result.providerCalls.balldontlieOdds,
      research: result.providerCalls.balldontlieResearch,
      lineups: result.providerCalls.balldontlieLineups,
    },
    jsonBytes: size.jsonBytes,
    gzipBytes: size.gzipBytes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
