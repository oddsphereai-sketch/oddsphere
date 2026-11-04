import type { DailyEdgeGameDto } from "./labTypes";

/** Read the exact published presentation. In particular, never manufacture
 * new presentation semantics for an old locked payload. */
export function soccerPublishedScorePresentation(
  game: Pick<DailyEdgeGameDto, "soccerProjection">,
) {
  return game.soccerProjection?.coherentScorePresentation ?? null;
}
