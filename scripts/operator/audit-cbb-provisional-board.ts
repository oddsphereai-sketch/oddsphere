/** Private exact-quote board census; it does not write predictions or grades. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCbbProvisionalBoard } from "../../lib/cbb/provisionalBoard";
import type { CbbForecast, CbbQuote } from "../../lib/cbb/types";

const path = resolve(process.argv.find(arg => arg.startsWith("--preview="))?.slice(10) ??
  "/private/tmp/oddsphere-cbb-data/preview-market-2026-11-01.json");
const body = JSON.parse(readFileSync(path, "utf8")) as { generatedAt: string; activation: { status: string };
  cards: Array<{ game: { id: number; home_team: { full_name: string }; visitor_team: { full_name: string } };
    forecast: CbbForecast; marketReview: Array<{ quote: CbbQuote }> }> };
if (body.activation.status !== "prelaunch") throw new Error("Only a private CBB preview may be audited");
const games = body.cards.map(card => {
  const quotes = card.marketReview.map(row => row.quote);
  if (new Set(quotes.map(quote => quote.gameId)).size !== 1 || quotes[0]?.gameId !== card.game.id) {
    throw new Error("CBB preview quote identity mismatch");
  }
  const board = buildCbbProvisionalBoard(card.forecast, quotes);
  return { gameId: card.game.id, away: card.game.visitor_team.full_name,
    home: card.game.home_team.full_name, targetBook: board.targetBook,
    score: board.score, marketContext: board.marketContext, grades: board.rows };
});
const all = games.flatMap(game => game.grades);
const counts = Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map(grade =>
  [grade, all.filter(row => row.grade === grade).length]));
console.log(JSON.stringify({ scope: "private_provisional_candidate_not_live", productionWrites: 0,
  source: path, sourceGeneratedAt: body.generatedAt, games: games.length, marketRows: all.length,
  counts, gamesDetail: games }, null, 2));
