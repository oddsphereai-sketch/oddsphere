import type { Game } from "../domain/Game";
import type { GamePrediction } from "../domain/Prediction";
import type { SharpSignal } from "../domain/SharpSignal";
import type { Lineup } from "../domain/Lineup";
import type { WeatherForecast } from "../domain/Weather";
import type { Team } from "../domain/Team";
import type { Player } from "../domain/Player";

/**
 * Props for the DailyEdgeCard component.
 *
 * Composes everything the card and its expanded breakdown need so the
 * component itself never queries Supabase directly — its parent hook
 * (`useDailyEdge`) does the data assembly.
 */
export type DailyEdgeCardProps = {
  game: Game;
  homeTeam: Team;
  awayTeam: Team;
  homePitcher: Player | null;
  awayPitcher: Player | null;
  prediction: GamePrediction | null;
  signals: SharpSignal[]; // 0+ signals for this game (per-market)
  homeLineup: Lineup[];
  awayLineup: Lineup[];
  weather: WeatherForecast | null;
};
