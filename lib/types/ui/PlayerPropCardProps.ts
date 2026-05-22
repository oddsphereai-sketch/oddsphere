import type {
  PredictionBreakdown,
  PropPrediction,
} from "../domain/PropPrediction";
import type { Player } from "../domain/Player";
import type { Game } from "../domain/Game";
import type { Team } from "../domain/Team";

/**
 * Props for the PlayerPropCard component (Tonight's Best view).
 *
 * Breakdown is optional — only loaded when the user expands the card. The
 * `onShowBreakdown` callback notifies the parent so it can lazy-fetch.
 */
export type PlayerPropCardProps = {
  prediction: PropPrediction;
  player: Player;
  pitcher: Player | null; // matchup pitcher
  game: Game;
  team: Team; // player's team
  opposingTeam: Team;
  breakdown?: PredictionBreakdown | null;
  onShowBreakdown?: () => void;
};
