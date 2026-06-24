/**
 * Playbook ↔ OddSphere slate team-match audit (READ-ONLY).
 *
 * Ticket: o-non-mlb-team-normalizer.
 *
 * Proves the sport-aware normalizer maps a live Playbook league cleanly onto
 * OUR slate. Loads our games/teams for a sport+date and the Playbook splits
 * for the matching league, resolves both sides to canonical abbreviations,
 * and prints matched / unmatched lists with a pass/fail on full coverage.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-team-match-audit.ts \
 *     [--sport wnba] [--date YYYY-MM-DD] [--json]
 *
 * SAFETY: read-only. No DB writes, no grading, no line-movement, no ingest.
 * Key from PLAYBOOK_API_KEY only; never printed.
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag, todayUTC } from "./_cliCommon";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import {
  buildGameKey,
  normalizeTeamAbbr,
  hasRegistry,
  type NormalizerSport,
} from "../../lib/providers/playbook/playbookTeamNormalizer";
import type { PlaybookSplitGame } from "../../lib/providers/playbook/types";

// OddSphere sport key -> Playbook league code.
const LEAGUE_FOR_SPORT: Record<string, string> = {
  wnba: "wnba", nba: "nba", nhl: "nhl", nfl: "nfl", ncaaf: "ncaaf", cfb: "ncaaf",
};

const API_KEY = process.env.PLAYBOOK_API_KEY ?? "";
function redact(s: string): string {
  let o = API_KEY ? s.split(API_KEY).join("***REDACTED***") : s;
  return o.replace(/api_key=[^&\s"']+/gi, "api_key=***REDACTED***");
}

type OurGame = { id: number; awayAbbr: string; homeAbbr: string; awayName: string; homeName: string; status: string; pregame: boolean };

// Pregame public splits only apply to games that have NOT started. Any
// terminal/live status is excluded from the expected-match denominator —
// Playbook (correctly) omits finished games from its pregame splits feed.
const NON_PREGAME_STATUSES = new Set([
  "final", "completed", "complete", "closed", "in_progress", "in progress",
  "live", "postponed", "canceled", "cancelled", "suspended",
]);

async function loadOurSlate(sport: string, date: string): Promise<OurGame[]> {
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name");
  const abbr = new Map<number, string>();
  const name = new Map<number, string>();
  for (const t of teams ?? []) {
    abbr.set(t.id as number, (t.abbreviation as string) ?? "");
    name.set(t.id as number, (t.name as string) ?? "");
  }
  const { data: games } = await supabase
    .from("games")
    .select("id, home_team_id, away_team_id, slate_date, sport, status")
    .eq("sport", sport).eq("slate_date", date);
  return (games ?? []).map((g) => {
    const status = String(g.status ?? "").toLowerCase();
    return {
      id: g.id as number,
      awayAbbr: abbr.get(g.away_team_id as number) ?? "",
      homeAbbr: abbr.get(g.home_team_id as number) ?? "",
      awayName: name.get(g.away_team_id as number) ?? "",
      homeName: name.get(g.home_team_id as number) ?? "",
      status,
      pregame: !NON_PREGAME_STATUSES.has(status),
    };
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("✗ READ-ONLY. --write unsupported.");
    process.exit(1);
  }
  const sport = (readStringFlag(argv, "--sport") ?? "wnba").toLowerCase();
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");
  const league = LEAGUE_FOR_SPORT[sport];

  console.log(`[playbook-team-match-audit] sport=${sport} date=${date} league=${league ?? "?"} registry=${league ? hasRegistry(sport as NormalizerSport) : "?"}`);
  if (!league) {
    console.error(`✗ Unsupported --sport "${sport}". Try: ${Object.keys(LEAGUE_FOR_SPORT).join(", ")}`);
    process.exit(1);
  }
  if (!API_KEY) {
    console.error("✗ PLAYBOOK_API_KEY not set in .env.local.");
    process.exit(1);
  }

  // Our slate.
  const our = await loadOurSlate(sport, date);
  const ourKeyed = our.map((g) => ({
    ...g,
    // Our side: trust our canonical abbreviation directly.
    key: g.awayAbbr && g.homeAbbr ? `${g.awayAbbr}@${g.homeAbbr}` : null,
  }));

  // Playbook side.
  const client = new PlaybookClient(API_KEY);
  let pbRows: PlaybookSplitGame[] = [];
  try {
    const res = await client.splits(league);
    pbRows = res.body.data ?? [];
  } catch (e) {
    console.error(`✗ Playbook fetch failed: ${redact((e as Error).message)}`);
    process.exit(2);
  }
  const pbKeyed = pbRows.map((r) => ({
    gameId: r.gameId,
    away: r.awayTeamName ?? "",
    home: r.homeTeamName ?? "",
    awayAbbr: normalizeTeamAbbr(sport as NormalizerSport, r.awayTeamName),
    homeAbbr: normalizeTeamAbbr(sport as NormalizerSport, r.homeTeamName),
    key: buildGameKey(sport as NormalizerSport, r.awayTeamName, r.homeTeamName),
  }));

  const pbKeySet = new Set(pbKeyed.map((p) => p.key).filter(Boolean) as string[]);
  const ourKeySet = new Set(ourKeyed.map((g) => g.key).filter(Boolean) as string[]);

  // Pregame public splits only apply pre-start. Final/live games are excluded
  // from the expected-match denominator (Playbook omits them by design).
  const pregame = ourKeyed.filter((g) => g.pregame);
  const excludedFinal = ourKeyed.filter((g) => !g.pregame);
  const matched = pregame.filter((g) => g.key && pbKeySet.has(g.key));
  const ourUnmatched = pregame.filter((g) => !g.key || !pbKeySet.has(g.key));
  const pbUnresolved = pbKeyed.filter((p) => !p.key);
  const pbUnmatchedVsOurs = pbKeyed.filter((p) => p.key && !ourKeySet.has(p.key));

  const report = {
    sport, date, league,
    ourSlateGames: our.length,
    ourPregameGames: pregame.length,
    excludedNonPregame: excludedFinal.map((g) => ({ game: `${g.awayAbbr}@${g.homeAbbr}`, status: g.status })),
    playbookGames: pbRows.length,
    matchedPregame: matched.length,
    matchRatePregame: pregame.length ? `${matched.length}/${pregame.length}` : "0/0",
    ourUnmatched: ourUnmatched.map((g) => ({
      game: `${g.awayAbbr}@${g.homeAbbr}`, names: `${g.awayName} @ ${g.homeName}`,
      reason: !g.key ? "our abbr missing" : "no Playbook game with this key",
    })),
    playbookUnresolved: pbUnresolved.map((p) => ({ gameId: p.gameId, names: `${p.away} @ ${p.home}` })),
    playbookExtraVsOurSlate: pbUnmatchedVsOurs.length,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nOur slate: ${report.ourSlateGames} games (${pregame.length} pregame, ${excludedFinal.length} final/live) | Playbook ${league}: ${report.playbookGames} games`);
    console.log(`Pregame match rate (our pregame games found in Playbook): ${report.matchRatePregame}`);
    console.log(`Playbook games unresolved by normalizer: ${pbUnresolved.length}`);
    console.log(`Playbook games beyond our slate (extra, mostly future dates): ${pbUnmatchedVsOurs.length}`);
    if (excludedFinal.length) {
      console.log("\nEXCLUDED (non-pregame — splits N/A):");
      for (const e of report.excludedNonPregame) console.log(`  – ${e.game}  status=${e.status}`);
    }
    if (report.ourUnmatched.length) {
      console.log("\nOUR PREGAME UNMATCHED:");
      for (const u of report.ourUnmatched) console.log(`  ✗ ${u.game}  (${u.names})  — ${u.reason}`);
    }
    if (pbUnresolved.length) {
      console.log("\nPLAYBOOK UNRESOLVED (normalizer returned null):");
      for (const p of report.playbookUnresolved) console.log(`  ? ${p.names}`);
    }
    if (matched.length) {
      console.log("\nMATCHED:");
      for (const m of matched) console.log(`  ✓ ${m.key}  (${m.awayName} @ ${m.homeName})`);
    }
  }

  const fullCover = pregame.length > 0 && matched.length === pregame.length && pbUnresolved.length === 0;
  console.log(`\n${fullCover ? "✓" : "✗"} ${matched.length}/${pregame.length} of our PREGAME ${sport} games mapped; ${pbUnresolved.length} Playbook rows unresolved (${excludedFinal.length} non-pregame excluded).`);
  process.exit(fullCover ? 0 : 1);
}

main().catch((e) => {
  console.error(`FATAL: ${redact((e as Error).message ?? String(e))}`);
  process.exit(2);
});
