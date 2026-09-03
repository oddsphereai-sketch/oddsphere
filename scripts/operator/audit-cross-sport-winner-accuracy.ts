/**
 * Read-only release-pure winner-accuracy scorecard.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-cross-sport-winner-accuracy.ts \
 *     --window morning --format markdown
 *
 * `nightly` evaluates locks from the current America/New_York calendar day.
 * `morning` evaluates locks from the previous America/New_York calendar day.
 * `--date YYYY-MM-DD` overrides the default date for either daily mode.
 */

import {
  etDate,
  loadWinnerAccuracyScorecards,
  previousDate,
  type WinnerAccuracyScorecardQueryResult,
  type WinnerAccuracyWindow,
} from "../../lib/services/tracking/winnerAccuracyScorecardQuery";

type OutputFormat = "markdown" | "json";

function parseArgs(argv: string[]): { window: WinnerAccuracyWindow; format: OutputFormat; date: string | null } {
  let window: WinnerAccuracyWindow = "morning";
  let format: OutputFormat = "markdown";
  let date: string | null = null;
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") throw new Error("--apply is not supported; this audit is SELECT-only.");
    if (arg === "--window") {
      const value = argv[++index] as WinnerAccuracyWindow;
      if (!( ["nightly", "morning", "all"] as string[]).includes(value)) throw new Error("Invalid --window.");
      window = value;
    } else if (arg === "--format") {
      const value = argv[++index] as OutputFormat;
      if (value !== "markdown" && value !== "json") throw new Error("Invalid --format.");
      format = value;
    } else if (arg === "--date") {
      date = argv[++index] ?? null;
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid --date.");
    }
  }
  if (window === "all" && date !== null) throw new Error("--date cannot be combined with --window all.");
  return { window, format, date };
}

function metric(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function markdown(result: WinnerAccuracyScorecardQueryResult): string {
  const lines = [
    "# Cross-sport winner accuracy", "",
    `Contract: \`${result.contract}\``,
    `Locked window: ${result.window}${result.lockedDate === null ? "" : ` (${result.lockedDate} ET)`}`,
    `Monitoring: ${result.monitoring.state} (${result.monitoring.code})`,
    `Settled directional rows omitted for incomplete winner vectors: ${result.omittedIncompleteRows}`, "",
    "| Sport | Release | N | Winner | Market favorite | Model Brier | Market Brier | Underdog P/R | Draw P/R | Action ROI | CLV coverage |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of result.scorecards) {
    const draw = row.drawDetection === null ? "—" : `${metric(row.drawDetection.precisionPct)}/${metric(row.drawDetection.recallPct)}`;
    lines.push(`| ${row.sport.toUpperCase()} | ${row.releaseKey} | ${row.winnerAccuracy.sample} | ${metric(row.winnerAccuracy.accuracyPct)} | ${metric(row.marketFavoriteBenchmark.accuracyPct)} | ${row.modelProbability.brierScore?.toFixed(4) ?? "—"} | ${row.marketProbability.brierScore?.toFixed(4) ?? "—"} | ${metric(row.upsetDetection.precisionPct)}/${metric(row.upsetDetection.recallPct)} | ${draw} | ${metric(row.exactPriceReturns.actionableOnly.roiPct)} | ${metric(row.clv.actionableOnly.coveragePct)} |`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const today = etDate(new Date());
  const lockedDate = opts.window === "all"
    ? null
    : opts.date ?? (opts.window === "morning" ? previousDate(today) : today);
  const result = await loadWinnerAccuracyScorecards({
    window: opts.window,
    lockedDate,
    recordCap: opts.window === "all" ? 10_000 : undefined,
  });
  console.log(opts.format === "json" ? JSON.stringify(result, null, 2) : markdown(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
