/**
 * Read-only by default:
 *   npx tsx --env-file=.env.local scripts/operator/nba/capture-nba-goat-team-features.ts \
 *     --season 2025 --season-type regular --as-of 2026-10-15
 *
 * Writes require both --apply and NBA_GOAT_SHADOW_WRITES_ENABLED=true.
 */

import { supabase } from "../../../lib/db/supabase";
import { captureNbaBdlTeamFeatures } from "../../../lib/services/nba/captureNbaBdlTeamFeatures";
import type { NbaBdlSeasonType } from "../../../lib/services/nba/balldontlieNbaGoat";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const season = Number(value("--season"));
  const rawSeasonType = value("--season-type") ?? "regular";
  const asOfDate = value("--as-of") ?? new Date().toISOString().slice(0, 10);
  const requestedApply = process.argv.includes("--apply");
  if (!Number.isInteger(season)) throw new Error("--season is required and must be an integer.");
  if (rawSeasonType !== "regular" && rawSeasonType !== "playoffs" && rawSeasonType !== "ist") {
    throw new Error("--season-type must be regular, playoffs, or ist.");
  }
  const seasonType: NbaBdlSeasonType = rawSeasonType;
  if (requestedApply && process.env.NBA_GOAT_SHADOW_WRITES_ENABLED !== "true") {
    throw new Error("--apply requires NBA_GOAT_SHADOW_WRITES_ENABLED=true.");
  }
  const result = await captureNbaBdlTeamFeatures({
    supabase,
    season,
    seasonType,
    asOfDate,
    apply: requestedApply,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
