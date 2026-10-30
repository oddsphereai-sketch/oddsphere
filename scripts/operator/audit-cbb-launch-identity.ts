/** Read-only exact-identity audit for the CBB launch slate and source boundaries. */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { matchCbbVenue, type EspnCbbEvent } from "../../lib/cbb/dataset";
import { normalizeCbbOwlsCurrent } from "../../lib/cbb/owlsMarketEvidence";
import { completeCbbTeamIdentitiesFromEvents, resolveCbbTeamIdentities, type EspnCbbTeam } from "../../lib/cbb/teamIdentity";
import { chooseCbbCompleteTargetBook } from "../../lib/cbb/totalOnlyMarketResearch";
import { selectCbbSlateGames } from "../../lib/services/cbb/seedCbbGamesService";
import type { RawOwlsOddsResponse } from "../../lib/providers/owls/owlsSharpBookOdds";
import type { CbbGame, CbbPlayer, CbbTeam } from "../../lib/cbb/types";
import candidate from "../../lib/cbb/artifacts/candidate-r2.json";

const args = process.argv.slice(2);
if (args.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB identity audit is read-only");
const directory = resolve(args.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const date = args.find(arg => arg.startsWith("--date="))?.slice(7) ?? "2026-11-01";
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(resolve(directory, name), "utf8"));

async function main() {
  const receiptName = (await readdir(directory)).filter(name =>
    /^owls-cbb-private-\d+-[0-9a-f]{16}\.json$/.test(name)).sort().at(-1);
  if (!receiptName) throw new Error("CBB identity audit has no immutable market receipt");
  const receiptText = await readFile(resolve(directory, receiptName), "utf8");
  const expectedHash = receiptName.match(/-([0-9a-f]{16})\.json$/)?.[1];
  if (createHash("sha256").update(receiptText).digest("hex").slice(0, 16) !== expectedHash) {
    throw new Error("CBB identity audit market receipt integrity failed");
  }
  const market = JSON.parse(receiptText) as { fetchedAt: string; odds: RawOwlsOddsResponse };
  const [schedule, catalog, espn, players] = await Promise.all([
    read<{ data: CbbGame[] }>("games-2026.json"),
    read<{ data: CbbTeam[] }>("teams.json"),
    read<{ data: EspnCbbTeam[] }>("espn-teams.json"),
    read<{ data: CbbPlayer[] }>("active-players.json"),
  ]);
  const asOf = new Date().toISOString();
  const games = selectCbbSlateGames(schedule.data, date, 2026);
  const identities = resolveCbbTeamIdentities(catalog.data, espn.data);
  const catalogById = new Map(catalog.data.map(team => [team.id, team]));
  const rosterTeamIds = new Set(players.data.map(player => player.team.id));
  const scoreboard = await read<{ fetchedAt: string; events: EspnCbbEvent[] }>(`espn-${date}.json`);
  const completeIdentities = completeCbbTeamIdentitiesFromEvents({ identities, games,
    events: scoreboard.events, fetchedAt: scoreboard.fetchedAt });
  const rows = games.map(game => {
    const home = completeIdentities.get(game.home_team.id), away = completeIdentities.get(game.visitor_team.id);
    const venue = matchCbbVenue(game, scoreboard.events, scoreboard.fetchedAt);
    const named = normalizeCbbOwlsCurrent(game, market.odds, market.fetchedAt, asOf);
    const targetBook = chooseCbbCompleteTargetBook(named.quotes);
    const defects = [] as string[];
    for (const [side, team, identity] of [["home", game.home_team, home], ["away", game.visitor_team, away]] as const) {
      const catalogTeam = catalogById.get(team.id);
      if (!catalogTeam || catalogTeam.full_name !== team.full_name) defects.push(`${side}_bdl_catalog_identity`);
      if (!identity?.status.startsWith("verified_") || !identity.logoUrl) defects.push(`${side}_espn_logo_identity`);
      if (!rosterTeamIds.has(team.id)) defects.push(`${side}_active_roster_id_absent`);
      const prior = candidate.prior.teams[String(team.id) as keyof typeof candidate.prior.teams];
      if (!prior || !Number.isFinite(prior.offense) || !Number.isFinite(prior.defense) ||
        !Number.isFinite(prior.pace) || !Number.isInteger(prior.games) || prior.games < 1) {
        defects.push(`${side}_independent_prior_stat_id_absent`);
      }
    }
    if (!venue?.timeConfirmed) defects.push("espn_event_time_or_venue_identity");
    if (!targetBook) defects.push("complete_named_market_target_unavailable");
    return { gameId: game.id, matchup: `${game.visitor_team.full_name} @ ${game.home_team.full_name}`,
      teams: { home: { id: game.home_team.id, abbr: game.home_team.abbreviation, espnId: home?.espnTeamId ?? null,
        logo: home?.logoUrl ?? null }, away: { id: game.visitor_team.id, abbr: game.visitor_team.abbreviation,
        espnId: away?.espnTeamId ?? null, logo: away?.logoUrl ?? null } },
      venue: venue?.venue ?? null, targetBook, namedMarkets: named.quotes.length, defects };
  });
  const collisions = new Map<string, number[]>();
  const missingAbbreviationTeamIds: number[] = [];
  for (const team of catalog.data) {
    if (!team.abbreviation?.trim()) {
      missingAbbreviationTeamIds.push(team.id);
      continue;
    }
    collisions.set(team.abbreviation, [...(collisions.get(team.abbreviation) ?? []), team.id]);
  }
  const report = { date, asOf, games: rows.length, identitiesVerified: rows.filter(row => row.defects.every(defect =>
    !defect.includes("identity") && !defect.includes("roster") && !defect.includes("prior_stat"))).length,
    exactNamedTargetGames: rows.filter(row => row.targetBook !== null).length,
    exactNamedTargetGamesFullyMapped: rows.filter(row => row.targetBook !== null && row.defects.length === 0).length,
    missingAbbreviationTeamIds,
    globalAbbreviationCollisions: [...collisions].filter(([, ids]) => ids.length > 1)
      .map(([abbreviation, ids]) => ({ abbreviation, teamIds: ids })), rows,
    productionWrites: 0 };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.exactNamedTargetGamesFullyMapped !== report.exactNamedTargetGames) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB identity audit failed"); process.exitCode = 1; });
