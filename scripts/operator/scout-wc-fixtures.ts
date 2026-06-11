/**
 * Read-only scout: list today's BDL FIFA fixtures with stage + kickoff,
 * highlight World Cup ones, sorted by datetime ascending.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/scout-wc-fixtures.ts \
 *     [--date YYYY-MM-DD]
 */

import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().split("T")[0];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
  }
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  if (!bdlKey) {
    console.error("Missing BALLDONTLIE_API_KEY.");
    process.exit(1);
  }
  const bdl = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  const matches = await bdl.listMatches({ start_date: date, end_date: date, per_page: 25 });
  matches.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));

  console.log(`\nBDL FIFA fixtures returned (whole tournament): ${matches.length}\n`);

  // Filter by datetime falling on `date` (UTC + ET windows both).
  const targetDateUtc = date;
  const onTargetDate = matches.filter((m) => {
    const d = String(m.datetime ?? "");
    return d.startsWith(targetDateUtc);
  });
  console.log(`Fixtures with UTC datetime on ${date}: ${onTargetDate.length}`);
  for (const m of onTargetDate) {
    console.log(
      `  id=${m.provider_match_id}  ${m.datetime}  ${m.away_team_name} @ ${m.home_team_name}  ` +
        `stage="${m.stage_name}"  group=${m.group_name ?? "-"}  stadium=${m.stadium_name ?? "-"}, ${m.stadium_country ?? "-"}  status=${m.status}`,
    );
  }

  // Also show next 5 upcoming after today (just to be sure WC opener isn't tomorrow UTC).
  console.log("\nFirst 8 fixtures by ascending datetime (overall):");
  for (const m of matches.slice(0, 8)) {
    console.log(
      `  id=${m.provider_match_id}  ${m.datetime}  ${m.away_team_name} @ ${m.home_team_name}  ` +
        `stage="${m.stage_name}"  group=${m.group_name ?? "-"}  status=${m.status}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
