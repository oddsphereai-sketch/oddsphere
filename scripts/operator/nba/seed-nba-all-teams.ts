/**
 * Operator: seed all 30 NBA teams into the `teams` table.
 *
 * Source: ESPN site.api /teams endpoint (same source seedNbaGames uses
 * for game-by-game team data, just enumerated). Returns the full
 * 30-team catalogue regardless of which teams have games today.
 *
 * Why: pre-2026-06-10, only teams that appeared in scheduled games got
 * upserted (via seedNbaGames). Result: any matchup involving an unseeded
 * team would silently drop in refreshNbaTeamRatings ("no matching
 * teams.abbreviation in DB") and downstream pipelines. This script
 * makes the catalogue complete so any real NBA matchup can be ingested.
 *
 * Idempotent: upserts on (sport='nba', external_id). Re-runnable safely.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/nba/seed-nba-all-teams.ts
 *
 *   Apply:
 *     npx tsx --env-file=.env.local scripts/operator/nba/seed-nba-all-teams.ts --apply
 *
 * Scope: writes ONLY to `teams` rows where sport='nba'. Never touches
 * MLB / NHL / NFL teams. Never touches games, lines, predictions, or
 * tracking. Never logs SHARPAPI_KEY (none required).
 */
import { supabase } from "../../../lib/db/supabase";

const ESPN_TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50";

type EspnTeam = {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  name: string;
  location: string;
  slug: string;
  color?: string;
  logos?: Array<{ href: string }>;
};

type TeamPayload = {
  external_id: number;
  sport: "nba";
  slug: string;
  abbreviation: string;
  display_name: string;
  short_display_name: string;
  name: string;
  location: string;
  league: null;
  division: null;
  logo_url: string | null;
  primary_color: string | null;
  provider_ids: { espn: { id: string } };
};

function toPayload(t: EspnTeam): TeamPayload {
  return {
    external_id: Number.parseInt(t.id, 10),
    sport: "nba",
    slug: t.abbreviation.toLowerCase(),
    abbreviation: t.abbreviation,
    display_name: t.displayName,
    short_display_name: t.shortDisplayName,
    name: t.name,
    location: t.location,
    league: null,
    division: null,
    logo_url: t.logos?.[0]?.href ?? null,
    primary_color: t.color ? `#${t.color}` : null,
    provider_ids: { espn: { id: t.id } },
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log("=".repeat(80));
  console.log(`SEED NBA ALL TEAMS  mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log("=".repeat(80));

  // 1. Fetch ESPN catalogue
  const r = await fetch(ESPN_TEAMS_URL);
  if (!r.ok) {
    console.error(`ESPN /teams HTTP ${r.status}`);
    process.exit(1);
  }
  const json = (await r.json()) as {
    sports?: Array<{
      leagues?: Array<{ teams?: Array<{ team: EspnTeam }> }>;
    }>;
  };
  const teams = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  console.log(`\nFetched ${teams.length} NBA teams from ESPN`);
  if (teams.length === 0) {
    console.error("Empty team list from ESPN");
    process.exit(1);
  }

  // 2. Load current DB state for diff visibility
  const { data: existing, error: exErr } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation, name")
    .eq("sport", "nba");
  if (exErr) {
    console.error(`load existing teams failed: ${exErr.message}`);
    process.exit(1);
  }
  const existingByExt = new Map<number, { id: number; abbreviation: string }>();
  for (const t of existing ?? []) {
    existingByExt.set(t.external_id, { id: t.id, abbreviation: t.abbreviation });
  }
  console.log(`Current NBA teams in DB: ${existing?.length ?? 0}`);

  // 3. Build payloads + classify (new vs update vs unchanged)
  const payloads = teams.map(({ team }) => toPayload(team));
  let toInsertCount = 0;
  let toUpdateCount = 0;
  const planLines: string[] = [];
  for (const p of payloads) {
    const cur = existingByExt.get(p.external_id);
    if (cur === undefined) {
      toInsertCount++;
      planLines.push(`  + INSERT ${p.abbreviation.padEnd(4)} ${p.display_name}`);
    } else if (cur.abbreviation !== p.abbreviation) {
      toUpdateCount++;
      planLines.push(
        `  ~ UPDATE id=${cur.id}  ${cur.abbreviation} → ${p.abbreviation}  ${p.display_name}`,
      );
    } else {
      planLines.push(`    ok    ${p.abbreviation.padEnd(4)} ${p.display_name}`);
    }
  }
  console.log("\nPlan:");
  for (const l of planLines) console.log(l);
  console.log(`\nSummary: insert=${toInsertCount}  update=${toUpdateCount}  unchanged=${payloads.length - toInsertCount - toUpdateCount}`);

  if (!apply) {
    console.log("\n[DRY-RUN] no DB writes. Re-run with --apply.");
    return;
  }

  // 4. Apply upserts on (sport, external_id)
  console.log("\nApplying upserts…");
  let written = 0;
  const errs: string[] = [];
  for (const p of payloads) {
    const { error } = await supabase
      .from("teams")
      .upsert(p, { onConflict: "sport,external_id" });
    if (error) {
      errs.push(`${p.abbreviation}: ${error.message}`);
    } else {
      written++;
    }
  }
  console.log(`✅ wrote ${written}/${payloads.length}  errors=${errs.length}`);
  for (const e of errs) console.log(`  ✗ ${e}`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
