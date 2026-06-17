/**
 * Phase 6B.23 — Probe BDL slate provider for today's MLB games to see
 * what status / home_score / away_score it actually returns. Read-only.
 */
import { getSlateProvider } from "../../lib/providers/factory";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  console.log(`\nProbing BDL slate provider for ${ET_TODAY}...\n`);
  const provider = getSlateProvider();
  const games = await provider.getGames(ET_TODAY, "mlb");
  console.log(`Provider returned ${games.length} games.\n`);
  for (const g of games) {
    const gAny = g as any;
    console.log(
      `  ext=${gAny.external_id}  status=${gAny.status ?? "null"}  score=${gAny.away_score ?? "-"}-${gAny.home_score ?? "-"}  away=${gAny.away_team_name ?? gAny.away_team ?? "?"}  home=${gAny.home_team_name ?? gAny.home_team ?? "?"}`,
    );
  }
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
