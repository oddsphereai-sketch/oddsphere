import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import fixture from "../lib/services/nba/fixtures/nbaPlayerPropsProductPreview.json";
import {
  buildNbaPlayerPropsMemberSnapshot,
  type NbaPlayerPropsMemberSnapshot,
} from "../lib/services/nba/nbaPlayerPropsProductContract";

const snapshot = fixture as NbaPlayerPropsMemberSnapshot;
assert.equal(snapshot.publicEnabled, false);
assert.equal(snapshot.mode, "private_historical_visual_qa_only");
assert(snapshot.games.length > 0);
assert(snapshot.decisions.length > 0);
assert.equal(snapshot.diagnostics.canonicalMarkets, snapshot.decisions.length);

const rebuilt = buildNbaPlayerPropsMemberSnapshot({
  mode: snapshot.mode,
  generatedAt: snapshot.generatedAt,
  slateDate: snapshot.slateDate,
  games: snapshot.games,
  decisions: snapshot.decisions,
  inputRows: snapshot.diagnostics.inputRows,
});
assert.deepEqual(rebuilt, snapshot);

const scopes = new Set<string>();
const markets = new Set(snapshot.decisions.map((row) => row.market));
assert.deepEqual([...markets].sort(), [
  "assists",
  "points",
  "points_assists",
  "points_rebounds",
  "points_rebounds_assists",
  "rebounds",
  "rebounds_assists",
  "threes",
]);
const slateDates = new Set(snapshot.games.map((game) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(game.scheduledStart))));
assert.deepEqual([...slateDates], [snapshot.slateDate]);
for (const row of snapshot.decisions) {
  const scope = `${row.gameId}|${row.playerId}|${row.market}`;
  assert(!scopes.has(scope), `duplicate canonical scope ${scope}`);
  scopes.add(scope);
  assert.equal(row.side, row.projection > row.line ? "over" : "under");
  assert(row.priceLadder.length > 0);
  assert(row.priceLadder.every((quote) => Number.isInteger(quote.americanPrice) && quote.americanPrice !== 0));
  assert([...row.role, ...row.production, ...row.matchup].every((metric) => Number.isFinite(metric.value)));
  if (row.grade === "Best Angle" || row.grade === "Lean") {
    assert.notEqual(row.gradePolicySource, "forecast_only");
    assert(row.probability >= 0.5, `${row.decisionKey} has an actionable grade below 50% chosen-side probability`);
    if (row.gradePolicySource === "universal_market_relative_lean") {
      assert(["rebounds", "threes"].includes(row.market));
      assert.equal(row.grade, "Lean");
    }
    if (row.gradePolicySource === "combo_market_relative_lean") {
      assert(["points_rebounds", "points_assists", "rebounds_assists"].includes(row.market));
      assert.equal(row.grade, "Lean");
    }
    if (row.gradePolicySource === "forward_only_market_relative_lean") {
      assert.equal(row.market, "threes");
      assert.equal(row.grade, "Lean");
    }
  }
}

const publicPage = readFileSync(path.join(process.cwd(), "app/player-props/page.tsx"), "utf8");
const pills = readFileSync(path.join(process.cwd(), "app/player-props/components/PlayerPropsLeaguePills.tsx"), "utf8");
assert(!publicPage.includes("NbaPlayerPropsProductDashboard"));
assert.match(pills, /nbaEnabled && reviewMode/);
assert(!pills.includes('nbaEnabled ? (reviewMode'));

process.stdout.write("NBA player-props private product preview contract passed.\n");
