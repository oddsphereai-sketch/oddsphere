/**
 * Phase 7B.1 — NBA team ratings refresh from Basketball Reference.
 *
 * Real, automated, idempotent. Scrapes BBR's per-possession team table
 * (allowed paths under robots.txt; honors Crawl-delay: 3) and upserts
 * one row per team into `nba_team_ratings` for the requested season +
 * season_type.
 *
 * Two-key write gate:
 *   • CLI flag: --apply
 *   • Env var:  NBA_RATINGS_DB_WRITES_ENABLED=true
 * Default: DRY-RUN.
 *
 * Scope:
 *   • Reads:  BBR public HTML pages, our `teams` table (to resolve BBR
 *             abbreviation → teams.id).
 *   • Writes: `nba_team_ratings` (sport='nba' implicit via team_id FK).
 *             NEVER writes any other table.
 *
 * Examples:
 *   Dry-run season 2026:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-team-ratings.ts --season 2026
 *
 *   Apply season 2026 + playoffs:
 *     NBA_RATINGS_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-team-ratings.ts \
 *       --season 2026 --include-playoffs --apply
 */

import { supabase } from "../../../lib/db/supabase";
import {
  fetchBbrSeasonTeamRatings,
  fetchBbrPlayoffTeamRatings,
  normalizeBbrAbbr,
  type BbrTeamRatings,
} from "../../../lib/providers/real_api/_basketballReferenceClient";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_RATINGS_WRITES_ENV = "NBA_RATINGS_DB_WRITES_ENABLED";

type NbaTeamRow = {
  id: number;
  abbreviation: string;
};

type UpsertPayload = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  source: string;
  source_url: string;
  fetched_at: string;
};

async function loadNbaTeams(): Promise<NbaTeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "nba");
  if (error !== null) {
    throw new Error(`load NBA teams failed: ${error.message}`);
  }
  return ((data as unknown) ?? []) as NbaTeamRow[];
}

function matchToTeamRow(
  bbr: BbrTeamRatings,
  teamRows: NbaTeamRow[],
): NbaTeamRow | null {
  const normalizedBbrAbbr = normalizeBbrAbbr(bbr.abbreviation);
  return (
    teamRows.find((t) => t.abbreviation.toUpperCase() === normalizedBbrAbbr.toUpperCase()) ??
    null
  );
}

function buildPayload(
  row: BbrTeamRatings,
  team: NbaTeamRow,
  season: number,
  seasonType: "regular" | "playoffs",
): UpsertPayload {
  return {
    team_id: team.id,
    season,
    season_type: seasonType,
    off_rating: row.off_rating,
    def_rating: row.def_rating,
    net_rating: row.net_rating,
    pace: row.pace,
    source: "basketball-reference",
    source_url: row.source_url,
    fetched_at: row.fetched_at,
  };
}

async function upsertRatings(
  rows: UpsertPayload[],
  write: boolean,
): Promise<{ written: number; errors: number }> {
  if (!write) {
    console.log(`  [dry-run] would upsert ${rows.length} nba_team_ratings row(s):`);
    for (const r of rows) {
      console.log(
        `    team_id=${r.team_id} ${r.season_type}-${r.season}  ` +
          `ORtg=${r.off_rating}  DRtg=${r.def_rating}  ` +
          `Net=${r.net_rating}  Pace=${r.pace}  source_url=${r.source_url}`,
      );
    }
    return { written: 0, errors: 0 };
  }
  let written = 0;
  let errors = 0;
  for (const r of rows) {
    const { error } = await supabase
      .from("nba_team_ratings")
      .upsert(r, { onConflict: "team_id,season,season_type" });
    if (error) {
      console.log(`  ✗ upsert team_id=${r.team_id} failed: ${error.message}`);
      errors++;
    } else {
      written++;
    }
  }
  return { written, errors };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonRaw = readStringFlag(argv, "--season");
  if (seasonRaw === undefined) {
    console.error("✗ --season YYYY required (e.g. --season 2026)");
    process.exit(1);
  }
  const season = Number.parseInt(seasonRaw, 10);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    console.error(`✗ --season must be a 4-digit year, got "${seasonRaw}"`);
    process.exit(1);
  }
  const includePlayoffs = readBoolFlag(argv, "--include-playoffs");
  const apply = readBoolFlag(argv, "--apply");

  let write = false;
  if (apply) {
    if (process.env[NBA_RATINGS_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_RATINGS_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(
    `[nba-refresh-ratings] mode=${write ? "WRITE" : "DRY-RUN"}  season=${season}  playoffs=${includePlayoffs}`,
  );
  console.log("─".repeat(70));

  // Load existing NBA teams from DB so we can match BBR abbreviations.
  const teams = await loadNbaTeams();
  console.log(`Loaded ${teams.length} NBA teams from DB.`);
  if (teams.length === 0) {
    console.error("✗ No NBA teams in DB — run seed-nba-finals.ts first.");
    process.exit(1);
  }

  // Fetch BBR season-wide ratings.
  console.log("\nFetching BBR season-wide ratings…");
  const seasonResult = await fetchBbrSeasonTeamRatings(season);
  if (seasonResult.status !== "ok") {
    console.log(
      `  ✗ BBR season fetch failed: status=${seasonResult.status} http=${seasonResult.http_status ?? "?"} notes=${seasonResult.notes ?? ""}`,
    );
  } else {
    console.log(`  ✓ ${seasonResult.rows.length} BBR rows parsed`);
  }

  let playoffResult: typeof seasonResult | null = null;
  if (includePlayoffs) {
    console.log("\nFetching BBR playoff ratings…");
    playoffResult = await fetchBbrPlayoffTeamRatings(season);
    if (playoffResult.status !== "ok") {
      console.log(
        `  ✗ BBR playoff fetch failed: status=${playoffResult.status} http=${playoffResult.http_status ?? "?"} notes=${playoffResult.notes ?? ""}`,
      );
    } else {
      console.log(`  ✓ ${playoffResult.rows.length} BBR playoff rows parsed`);
    }
  }

  // Build upsert payloads filtered to teams we have in DB.
  const payloads: UpsertPayload[] = [];
  for (const r of seasonResult.rows) {
    const t = matchToTeamRow(r, teams);
    if (t === null) {
      console.log(
        `  ⏭ skip BBR row ${r.abbreviation} (${r.team_name}) — no matching teams.abbreviation in DB`,
      );
      continue;
    }
    payloads.push(buildPayload(r, t, season, "regular"));
  }
  if (playoffResult && playoffResult.status === "ok") {
    for (const r of playoffResult.rows) {
      const t = matchToTeamRow(r, teams);
      if (t === null) continue;
      payloads.push(buildPayload(r, t, season, "playoffs"));
    }
  }
  console.log(
    `\nReady to upsert ${payloads.length} row(s) (filtered to DB-resident teams).`,
  );

  const result = await upsertRatings(payloads, write);
  console.log(`\n─${"─".repeat(70)}`);
  console.log(
    `${write ? "WRITE" : "DRY-RUN"} complete: ${result.written} written, ${result.errors} errors.`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
