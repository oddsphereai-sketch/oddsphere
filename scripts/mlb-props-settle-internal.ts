import { settleInternalMlbProps } from "../lib/mlb/props/internalTracking";

function dateArg(): string | null {
  const value = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ?? null;
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--date must use YYYY-MM-DD");
  return value;
}

async function main() {
  const date = dateArg();
  const result = await settleInternalMlbProps({ dates: date ? [date] : undefined });
  console.log(JSON.stringify({ ok: true, date, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
