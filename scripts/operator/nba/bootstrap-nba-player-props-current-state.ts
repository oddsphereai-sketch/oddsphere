/**
 * One-time, bounded player-level state bootstrap for the private NBA props
 * candidate. Dry-run by default; --apply is required to persist. The regular
 * NBA cron only performs incremental exact-date collection afterward.
 */
import { supabase } from "../../../lib/db/supabase";
import {
  collectNbaPlayerPropsCurrentState,
  readNbaPlayerPropsCurrentState,
  writeNbaPlayerPropsCurrentState,
} from "../../../lib/services/nba/nbaPlayerPropsCurrentState";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const season = Number(value("--season"));
  const maxPages = Number(value("--max-pages-per-dataset") ?? "250");
  const apply = process.argv.includes("--apply");
  if (!Number.isInteger(season) || season < 1996 || season > 2100) throw new Error("--season is invalid.");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) {
    throw new Error("--max-pages-per-dataset must be from 1 through 500.");
  }
  const previous = await readNbaPlayerPropsCurrentState({ client: supabase, season });
  const collected = await collectNbaPlayerPropsCurrentState({
    previous,
    season,
    fullSeason: true,
    apiKey,
    maxPages,
  });
  // Two season-type game feeds plus batched box/advanced feeds. This is a hard
  // guard, not a target; actual request counts are reported from the provider.
  const gameBatches = Math.max(1, Math.ceil(collected.state.games.length / 100));
  const maximumRequests = maxPages * (2 + gameBatches * 2) * 5;
  if (collected.providerRequests > maximumRequests) {
    throw new Error(`NBA props bootstrap exceeded its ${maximumRequests}-request retry ceiling.`);
  }
  const storage = apply
    ? await writeNbaPlayerPropsCurrentState({ client: supabase, state: collected.state })
    : null;
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry_run",
    publicEnabled: collected.state.publicEnabled,
    season,
    providerRequests: collected.providerRequests,
    requestCeiling: maximumRequests,
    games: collected.state.games.length,
    boxes: collected.state.boxes.length,
    advanced: collected.state.advanced.length,
    players: collected.state.players.length,
    gamesAdded: collected.gamesAdded,
    boxesAdded: collected.boxesAdded,
    advancedAdded: collected.advancedAdded,
    storage,
  }, null, 2));
}

void main();
