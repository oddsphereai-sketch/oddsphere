/**
 * Probe BDL for multiple dates to isolate whether the empty result is
 * date-specific or provider-wide. Read-only.
 */
import { getSlateProvider } from "../../lib/providers/factory";

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const YEST = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const TWO = new Date(Date.now() - 2*86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function probe(d: string) {
  const provider = getSlateProvider();
  try {
    const games = await provider.getGames(d, "mlb");
    console.log(`\n${d}: ${games.length} games`);
    for (const g of games.slice(0, 3)) {
      const ga = g as any;
      console.log(`  ext=${ga.external_id}  status=${ga.status}  score=${ga.away_score ?? "-"}-${ga.home_score ?? "-"}`);
    }
  } catch (e: any) {
    console.log(`\n${d}: ERROR ${e?.message ?? e}`);
  }
}

async function main() {
  console.log(`SLATE_PROVIDER env: ${process.env.SLATE_PROVIDER ?? "(default)"}`);
  console.log(`BDL_API_KEY set: ${process.env.BDL_API_KEY ? "yes" : "no"}`);
  await probe(TODAY);
  await probe(YEST);
  await probe(TWO);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
