import {
  BallDontLieEplProvider,
  type BdlEplMatch,
  type BdlEplMatchLineup,
  type BdlEplOdds,
  type BdlEplPlayerInjury,
  type BdlEplPregameForm,
  type BdlEplStanding,
  type BdlEplTeam,
  type BdlEplTeamMatchStats,
} from "./BallDontLieEplProvider";

/** Official dedicated BALLDONTLIE Champions League product. It deliberately
 * shares the typed club-soccer envelope with EPL; only the provider namespace
 * differs. The UCL API has no league-id query parameter. */
export const BALLDONTLIE_UCL_API_BASE_URL = "https://api.balldontlie.io/ucl/v1" as const;

export type BdlUclMatch = BdlEplMatch;
export type BdlUclMatchLineup = BdlEplMatchLineup;
export type BdlUclOdds = BdlEplOdds;
export type BdlUclPlayerInjury = BdlEplPlayerInjury;
export type BdlUclPregameForm = BdlEplPregameForm;
export type BdlUclStanding = BdlEplStanding;
export type BdlUclTeam = BdlEplTeam;
export type BdlUclTeamMatchStats = BdlEplTeamMatchStats;

export class BallDontLieUclProvider extends BallDontLieEplProvider {
  constructor(apiKey: string, fetchImpl: typeof fetch = globalThis.fetch) {
    super(apiKey, fetchImpl, BALLDONTLIE_UCL_API_BASE_URL, "UCL");
  }
}
