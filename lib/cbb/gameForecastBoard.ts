import {buildCbbProvisionalBoard} from "./provisionalBoard";
import type {CbbForecast,CbbQuote} from "./types";
import type {CbbLegacyProvisionalBoard} from "./provisionalLifecycle";
import type {CbbMarketBehaviorReceipt} from "./marketBehaviorCandidate";

export const CBB_GAME_FORECAST_BOARD_RELEASE="cbb_game_forecast_board_2026_11_05_r1_unpriced_outcomes" as const;
export const CBB_GAME_FORECAST_GRADE_RELEASE="cbb_game_forecast_grade_2026_11_05_r1_no_unquoted_wagers" as const;
export const CBB_GAME_OUTCOME_RELEASE="cbb_game_outcome_2026_11_05_r1_frozen_winner" as const;

/** A game forecast is not an offered wager. Store its explicit winner even
 * without a price; never invent a spread/total line, payout, EV or promotion. */
export function attachCbbGameOutcome(board:CbbLegacyProvisionalBoard,forecast:CbbForecast,inputs:unknown):CbbLegacyProvisionalBoard{
  const selection=forecast.homeWinProbability>=.5?"first" as const:"second" as const;
  return {...board,gameForecast:{release:CBB_GAME_OUTCOME_RELEASE,homeId:forecast.homeId,awayId:forecast.awayId,
    homeWinProbability:forecast.homeWinProbability,selection,probability:selection==="first"?forecast.homeWinProbability:1-forecast.homeWinProbability,
    uncertainty:forecast.uncertainty,inputs}};
}
export function buildCbbGameForecastBoard(forecast:CbbForecast,inputs:unknown,quotes:CbbQuote[]=[],receipt?:CbbMarketBehaviorReceipt):CbbLegacyProvisionalBoard{
  if(forecast.inputStatus!=="complete")throw Error("A game forecast needs complete statistical/venue inputs");
  const board=buildCbbProvisionalBoard(forecast,quotes,{marketBehavior:receipt});
  return attachCbbGameOutcome({...board,release:CBB_GAME_FORECAST_BOARD_RELEASE,modelRelease:forecast.release,gradeRelease:CBB_GAME_FORECAST_GRADE_RELEASE,
    rows:board.rows.map(row=>({...row,grade:"Held" as const,reason:"game_forecast_without_qualified_wager",
      selection:null,line:null,price:null,probability:null,pushProbability:null,expectedValue:null,marketFairProbability:null})),
    marketContext:{...board.marketContext,verifiedMarketRead:receipt??null}},forecast,inputs);
}
