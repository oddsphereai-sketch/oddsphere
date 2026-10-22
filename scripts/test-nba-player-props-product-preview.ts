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
const mlbPage = readFileSync(path.join(process.cwd(), "app/mlb/props/page.tsx"), "utf8");
const previewPage = readFileSync(path.join(process.cwd(), "app/dev/nba-props-preview/page.tsx"), "utf8");
const dashboard = readFileSync(path.join(process.cwd(), "app/player-props/components/NbaPlayerPropsProductDashboard.tsx"), "utf8");
const pills = readFileSync(path.join(process.cwd(), "app/player-props/components/PlayerPropsLeaguePills.tsx"), "utf8");
const leagueRegistry = readFileSync(path.join(process.cwd(), "app/player-props/lib/playerPropsLeagues.ts"), "utf8");
assert.match(publicPage, /NBA_PLAYER_PROPS_MEMBER_ENABLED/);
assert.match(publicPage, /NbaPlayerPropsProductDashboard/);
assert.match(publicPage, /readNbaPlayerPropsPrivateSnapshot/);
assert.match(publicPage, /nbaPlayerPropsSlateDate\(\)/);
assert.match(publicPage, /query\.league === "nba"/);
assert.match(previewPage, /readNbaPlayerPropsPrivateSnapshot/);
assert.match(previewPage, /nbaPlayerPropsSlateDate\(\)/);
assert.match(previewPage, /currentCandidate \? "live" : "historical"/);
assert.match(dashboard, /data-product-zone="full-board"/);
assert.match(dashboard, /Our pick/);
assert.match(dashboard, /Market offer/);
assert.match(dashboard, /Model projection/);
assert.match(dashboard, /Other-book market/);
assert.match(dashboard, /Why this pick/);
assert.match(dashboard, /Compare all/);
assert.match(dashboard, /View every model input/);
assert.match(dashboard, /FEATURED_METRIC_KEYS/);
assert.match(dashboard, /Same-book market flat/);
assert.match(dashboard, /data-member-surface/);
assert.match(dashboard, /reviewMode \? <aside/);
assert.match(pills, /playerPropsLeagueDefinitions/);
assert.match(leagueRegistry, /args\.nbaEnabled \? \(reviewMode/);
assert.match(leagueRegistry, /player-props\?league=nba/);
assert.match(mlbPage, /NBA_PLAYER_PROPS_MEMBER_ENABLED/);
assert.equal((mlbPage.match(/nbaEnabled=\{nbaEnabled\}/g) ?? []).length, 3, "every MLB board state keeps the active NBA destination in the shared league rail");

process.stdout.write("NBA player-props private product preview contract passed.\n");
