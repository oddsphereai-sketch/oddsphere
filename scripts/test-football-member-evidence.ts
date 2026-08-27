import assert from "node:assert/strict";
import {
  __FOOTBALL_MEMBER_EVIDENCE_TEST__,
  cfbFootballEvidenceStats,
  enrichCachedNflFootballEvidence,
  nflFootballEvidenceStats,
} from "@/lib/services/football/footballMemberEvidence";
import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";

const nfl = nflFootballEvidenceStats({
  awayTeam: "NE",
  homeTeam: "SEA",
  market: "total",
  awayQuarterback: { name: "Drake Maye", status: "projected" },
  homeQuarterback: { name: "Sam Darnold", status: "projected" },
  weather: { venueName: "Lumen Field", roofType: "outdoor", status: "outside_forecast_window", forecast: null },
});
assert(nfl.some((row) => row.label === "Decision-model input · Offensive plays per game"));
assert(nfl.some((row) => row.label === "Decision-model input · Explosive-play rate"));
assert(nfl.some((row) => row.label === "Current context · Expected quarterback" && row.awayValue?.includes("Drake Maye")));
assert(nfl.some((row) => row.label === "Current context · Venue and weather" && row.homeValue?.includes("Lumen Field")));
assert(nfl.every((row) => row.source === "feature_snapshot"));

const cfb = cfbFootballEvidenceStats({
  awayTeamName: "San José State Spartans",
  homeTeamName: "USC Trojans",
  market: "moneyline",
  awayQuarterback: { name: "Walker Eget", status: "projected" },
  homeQuarterback: { name: "Jayden Maiava", status: "projected" },
});
assert(cfb.some((row) => row.label === "Outcome-model input · EPA/play" && row.awayValue !== "Unavailable"));
assert(cfb.some((row) => row.label === "Outcome-model input · Frozen sample" && row.homeValue?.includes("prior games")));
assert(cfb.some((row) => row.label === "Current context · Expected quarterback" && row.homeValue?.includes("Jayden Maiava")));

assert.match(__FOOTBALL_MEMBER_EVIDENCE_TEST__.nflArtifactRelease, /nfl_r6_moneyline_runtime_artifact/);
assert.match(__FOOTBALL_MEMBER_EVIDENCE_TEST__.cfbArtifactRelease, /cfb_v1_joint_score_artifact/);

const legacyMarket = (): MarketEdgeDto => ({
  keyStats: [
    { label: "Current two-sided moneyline", awayValue: "NE +164", homeValue: "SEA -196", source: "current_line" },
    { label: "Expected quarterbacks · provider depth chart", awayValue: "Drake Maye · Projected", homeValue: "Sam Darnold · Projected", source: "feature_snapshot" },
    { label: "Provider-listed injuries", awayValue: "9 listed", homeValue: "7 listed", source: "feature_snapshot" },
  ],
} as MarketEdgeDto);
const cachedFixture = {
  snapshot: {
    games: [{
      awayTeam: "NE",
      homeTeam: "SEA",
      markets: { moneyline: legacyMarket(), total: legacyMarket(), first_inning: legacyMarket() },
    }],
  },
};
const enriched = enrichCachedNflFootballEvidence(cachedFixture);
for (const market of Object.values(enriched.snapshot.games[0]!.markets)) {
  assert(market.keyStats.some((row) => row.label.startsWith("Decision-model input ·")));
  assert(market.keyStats.some((row) => row.label === "Current context · Expected quarterback"));
  assert(market.keyStats.some((row) => row.label === "Current context · Provider-listed injuries"));
  assert(!market.keyStats.some((row) => row.label === "Current two-sided moneyline"), "market odds stay in Market & Price instead of the evidence card stack");
}
assert.strictEqual(enrichCachedNflFootballEvidence(enriched), enriched, "already-enriched snapshots remain byte-stable");

console.log("Football member evidence: model-input lineage, current context, and market tailoring passed.");
