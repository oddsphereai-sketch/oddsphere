import { inspectMlbPropsProviders } from "../lib/mlb/props/providerInspection";

async function main() {
  const args = parseArgs();
  const summary = await inspectMlbPropsProviders({
    date: args.date,
    providerMode: args.provider,
  });
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return [...argv].reverse().find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  };
  return {
    date: get("date", new Date().toISOString().slice(0, 10)),
    provider: get("provider", process.env.ODDSPHERE_MLB_PROVIDER ?? "real"),
  };
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
