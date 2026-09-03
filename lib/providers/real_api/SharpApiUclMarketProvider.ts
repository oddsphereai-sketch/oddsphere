import { SharpApiClient } from "./_sharpApiClient";
import {
  SHARP_UCL_LEAGUE,
  SharpApiEplMarketProvider,
  uclTeamsMatch,
  type EplSharpFixtureMarket,
  type EplSharpOddsRecord,
  type EplSharpSplitsEvent,
} from "./SharpApiEplMarketProvider";

export type UclSharpFixtureMarket = EplSharpFixtureMarket;
export type UclSharpOddsRecord = EplSharpOddsRecord;
export type UclSharpSplitsEvent = EplSharpSplitsEvent;

/** UCL specialization of the shared four-market soccer provider. */
export class SharpApiUclMarketProvider extends SharpApiEplMarketProvider {
  constructor(client: SharpApiClient) {
    super(client, SHARP_UCL_LEAGUE, uclTeamsMatch, 10);
  }
}
