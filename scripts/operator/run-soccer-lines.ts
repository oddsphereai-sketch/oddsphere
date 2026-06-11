/**
 * Operator runner for the soccer `lines` + `line_history` writer.
 *
 * Usage (dry-run, safe, no env required):
 *   npx tsx --env-file=.env.local scripts/operator/run-soccer-lines.ts --date 2026-06-11
 *
 * Usage (apply — both gates required):
 *   SOCCER_LINES_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local scripts/operator/run-soccer-lines.ts --date 2026-06-11 --apply
 *
 * The writer itself enforces the two-key gate; this script just parses
 * args and routes the result to stdout so the operator sees the same
 * row counts they'd see in the cron logs.
 */
import { writeSoccerLines } from "../../lib/services/soccer/writeSoccerLines";

function arg(name: string): string | undefined {
  const ix = process.argv.findIndex((a) => a === `--${name}`);
  if (ix < 0) return undefined;
  return process.argv[ix + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const date = arg("date");
  if (date === undefined) {
    console.error("Usage: run-soccer-lines.ts --date YYYY-MM-DD [--apply]");
    process.exit(2);
  }
  const apply = flag("apply");

  const result = await writeSoccerLines({
    slateDate: date,
    apply,
    logger: (m) => console.log(m),
  });

  console.log("\n========== Result ==========");
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
