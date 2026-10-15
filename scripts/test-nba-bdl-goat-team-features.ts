import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchNbaBdlTeamFeatureSnapshot,
  NBA_BDL_GOAT_TEAM_FEATURE_RELEASE,
  NBA_BDL_TEAM_FEATURE_MANIFEST,
  type NbaBdlTeamFeatureSelection,
} from "../lib/services/nba/balldontlieNbaGoat";
import { captureNbaBdlTeamFeatures } from "../lib/services/nba/captureNbaBdlTeamFeatures";
import type { SupabaseClient } from "@supabase/supabase-js";

const manifest: readonly NbaBdlTeamFeatureSelection[] = [
  { category: "general", type: "advanced", researchRole: "core" },
  { category: "hustle", type: null, researchRole: "rotation_context" },
];

const requestedUrls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  requestedUrls.push(url);
  const isAdvanced = url.includes("type=advanced");
  return new Response(JSON.stringify({
    data: [
      {
        team: { id: 1, abbreviation: "ATL", full_name: "Atlanta Hawks" },
        season: 2025,
        season_type: "regular",
        stats: isAdvanced
          ? { off_rating: 116.2, def_rating: 114.8, note: "provider-preserved" }
          : { contested_shots: 42.1, loose_balls_recovered: 5.2 },
      },
      {
        team: { id: 2, abbreviation: "BOS", full_name: "Boston Celtics" },
        season: 2025,
        season_type: "regular",
        stats: isAdvanced
          ? { off_rating: 119.1, def_rating: 110.4 }
          : { contested_shots: 45.3, loose_balls_recovered: 5.7 },
      },
    ],
    meta: { per_page: 100 },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

async function main(): Promise<void> {
  const snapshot = await fetchNbaBdlTeamFeatureSnapshot({
    season: 2025,
    seasonType: "regular",
    apiKey: "test-key",
    fetchImpl,
    manifest,
  });
  assert.equal(snapshot.release, NBA_BDL_GOAT_TEAM_FEATURE_RELEASE);
  assert.equal(snapshot.selectionsRequested, 2);
  assert.equal(snapshot.providerRequests, 2);
  assert.equal(snapshot.observations.length, 4);
  assert.equal(snapshot.observations[0]?.abbreviation, "ATL");
  assert.equal(snapshot.observations[0]?.stats.off_rating, 116.2);
  assert.equal(snapshot.observations[2]?.category, "hustle");
  assert.equal(snapshot.observations[2]?.statType, null);
  assert.ok(requestedUrls[0]?.includes("season=2025"));
  assert.ok(requestedUrls[0]?.includes("season_type=regular"));
  assert.ok(requestedUrls[0]?.includes("type=advanced"));
  assert.equal(
    new URL(requestedUrls[1]!).searchParams.has("type"),
    false,
    "hustle must omit the type parameter",
  );

  assert.equal(NBA_BDL_TEAM_FEATURE_MANIFEST.length, 43, "provider-complete team manifest changed unexpectedly");
  assert.equal(
    new Set(NBA_BDL_TEAM_FEATURE_MANIFEST.map((row) => `${row.category}:${row.type ?? "none"}`)).size,
    NBA_BDL_TEAM_FEATURE_MANIFEST.length,
    "provider manifest must not contain duplicate category/type requests",
  );
  assert.ok(NBA_BDL_TEAM_FEATURE_MANIFEST.some((row) => row.category === "playtype" && row.type === "prballhandler"));
  assert.ok(NBA_BDL_TEAM_FEATURE_MANIFEST.some((row) => row.category === "tracking" && row.type === "possessions"));
  assert.ok(NBA_BDL_TEAM_FEATURE_MANIFEST.some((row) => row.category === "shooting" && row.type === "by_zone_opponent"));

  await assert.rejects(
    () => fetchNbaBdlTeamFeatureSnapshot({
      season: 2025,
      seasonType: "regular",
      apiKey: "test-key",
      manifest: [manifest[0]!],
      fetchImpl: async () => new Response(JSON.stringify({
        data: [{
          team: { id: 1, abbreviation: "ATL", full_name: "Atlanta Hawks" },
          season: 2024,
          season_type: "regular",
          stats: { off_rating: 116 },
        }],
        meta: {},
      }), { status: 200 }),
    }),
    /identity mismatch/,
  );

  const accessedTables: string[] = [];
  const dryRunDb = {
    from(table: string) {
      accessedTables.push(table);
      assert.equal(table, "teams", "dry-run capture must not access a write table");
      return {
        select() {
          return {
            async eq(column: string, sport: string) {
              assert.equal(column, "sport");
              assert.equal(sport, "nba");
              return {
                data: [
                  { id: 101, abbreviation: "ATL" },
                  { id: 102, abbreviation: "BOS" },
                ],
                error: null,
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  const dryRun = await captureNbaBdlTeamFeatures({
    supabase: dryRunDb,
    season: 2025,
    seasonType: "regular",
    asOfDate: "2026-10-15",
    apply: false,
    apiKey: "test-key",
    fetchImpl,
    manifest,
  });
  assert.equal(dryRun.status, "dry_run");
  assert.equal(dryRun.observationsFetched, 4);
  assert.equal(dryRun.observationsWritten, 0);
  assert.equal(dryRun.teamsMatched, 2);
  assert.deepEqual(accessedTables, ["teams"]);

  await assert.rejects(
    () => captureNbaBdlTeamFeatures({
      supabase: dryRunDb,
      season: 2025,
      seasonType: "regular",
      asOfDate: "2026-02-31",
      apply: false,
      apiKey: "test-key",
      fetchImpl,
      manifest,
    }),
    /valid YYYY-MM-DD/,
  );

  const migration = readFileSync(
    new URL("../lib/db/schema-migration-v43-nba-goat-shadow-features.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /UNIQUE \(provider, release, season, season_type, as_of_date\)/);
  assert.match(migration, /UNIQUE \(batch_id, team_id, category, stat_type\)/);
  assert.match(migration, /ON DELETE RESTRICT/g);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.doesNotMatch(migration, /CREATE POLICY/i, "raw shadow payloads must not have client policies");

  const captureSource = readFileSync(
    new URL("../lib/services/nba/captureNbaBdlTeamFeatures.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(captureSource, /from\(["']nba_team_ratings["']\)/);
  assert.match(captureSource, /ignoreDuplicates:\s*true/);
  assert.match(captureSource, /\.neq\(["']status["'],\s*["']complete["']\)/);

  console.log("NBA BALLDONTLIE GOAT team-feature tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
