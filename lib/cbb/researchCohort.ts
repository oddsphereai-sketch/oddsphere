import { CBB_SCORE_RESEARCH_RELEASE } from "./scoreResearch";
import type { CbbForecast } from "./types";

/** Prevent private CBB audits from silently blending independent releases. */
export function assertCbbR2ResearchCohort(rows: Array<{ game: { id: number }; forecast: CbbForecast }>) {
  if (!rows.length || new Set(rows.map(row => row.game.id)).size !== rows.length) {
    throw new Error("empty or duplicate CBB research games");
  }
  for (const row of rows) {
    if (!Number.isSafeInteger(row.game.id) ||
      ![row.forecast.homeScore, row.forecast.awayScore, row.forecast.total, row.forecast.margin].every(Number.isFinite) ||
      row.forecast.release !== CBB_SCORE_RESEARCH_RELEASE || row.forecast.gameId !== row.game.id ||
      Math.abs(row.forecast.homeScore + row.forecast.awayScore - row.forecast.total) > 1e-8 ||
      Math.abs(row.forecast.homeScore - row.forecast.awayScore - row.forecast.margin) > 1e-8) {
      throw new Error(`CBB r2 research release/score mismatch: ${row.game.id}`);
    }
  }
}
