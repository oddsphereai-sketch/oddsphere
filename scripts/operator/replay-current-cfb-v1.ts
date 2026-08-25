import fs from "node:fs";
import path from "node:path";
import type { NcaafBookOdds } from "../../lib/services/football/balldontlieNcaafSlate";
import { buildCfbV1DecisionBundle } from "../../lib/services/football/cfbV1Decision";

type InputGame = {
  providerGameId: string;
  scheduledStart: string;
  away: { abbreviation: string };
  home: { abbreviation: string };
  currentBooks: NcaafBookOdds[];
};

const source = path.resolve(process.cwd(), process.argv[2] ?? "football-research/cache/cfb-model/current/cfb_current_inputs.json");
const output = path.resolve(process.cwd(), process.argv[3] ?? "football-research/reports/cfb_v1_current_decisions_2026_08_25_r1.json");
const payload = JSON.parse(fs.readFileSync(source, "utf8")) as { release: string; generatedAt: string; games: InputGame[] };
const bundles = payload.games.map((game) => buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: game.currentBooks,
}));
const decisions = bundles.flatMap((bundle) => bundle.evaluatedBets);
const counts = Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, decisions.filter((row) => row.grade === grade).length]));
const byMarket = Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, {
  decisions: decisions.filter((row) => row.market === market).length,
  held: bundles.filter((row) => row.heldMarkets.some((held) => held.market === market)).length,
  grades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, decisions.filter((row) => row.market === market && row.grade === grade).length])),
}]));
const result = {
  release: "cfb_v1_current_decision_replay_2026_08_25_r1",
  sourceRelease: payload.release,
  generatedAt: payload.generatedAt,
  games: bundles.length,
  decisions: decisions.length,
  heldMarkets: bundles.reduce((sum, bundle) => sum + bundle.heldMarkets.length, 0),
  counts,
  byMarket,
  bundles,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, games: result.games, decisions: result.decisions, heldMarkets: result.heldMarkets, counts, byMarket }, null, 2));
