import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { verifyNbaOriginalRoster, NBA_ORIGINAL_PLAYER_IMPACT_RELEASE, type verifyNbaOriginalPlayerImpact } from "../../../lib/research/nba/nbaOriginalPlayerImpact";
import { nbaHistoricalPrintedTipMatches } from "../../../lib/research/nba/nbaHistoricalPlayerStateSources";
import { createNbaAsOfNativeNameLookup, nbaMedicalNativeNameKey } from "../../../lib/research/nba/nbaAsOfNativeNames";
import { buildNbaArchivedRotation, qualifyNbaArchivedRotation, type NbaArchivedRotationGame, type NbaArchivedMedicalSection } from "../../../lib/research/nba/nbaArchivedRotationLedger";

const name = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const injuryName = nbaMedicalNativeNameKey;
const easternDay = (s: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s));
type Report = { status: string; clock?: { rawSha256: string; sourceAvailableAt: string; fetchedAt: string }; sections?: { gameDate: string; gameTime: string; matchup: string; teamName: string; submitted: boolean; players: { sourceName: string; rawStatus: string }[] }[] };
type Impact = ReturnType<typeof verifyNbaOriginalPlayerImpact> & { qualified: boolean };
async function main() {
  const [root, impactPath, medicalPath, movementPath, destination, targetPath] = process.argv.slice(2);
  if (!root || !impactPath || !medicalPath || !movementPath || !destination || fs.existsSync(destination) || fs.existsSync(destination + ".summary.json")) throw Error("usage: build-archived-rotation-ledger ARCHIVE IMPACT.jsonl.gz MEDICAL.json.gz MOVEMENTS.json.gz NEW_LEDGER.json.gz");
  const manifestBytes = fs.readFileSync(path.join(root, "native-job-manifest.json")), manifest = JSON.parse(manifestBytes.toString()) as { games: { season: number; id: string }[] };
  const impacts = new Map<string, Impact>();
  for (const line of gunzipSync(fs.readFileSync(impactPath)).toString().trim().split("\n")) { const row = JSON.parse(line) as Impact;
    if (row.release === NBA_ORIGINAL_PLAYER_IMPACT_RELEASE && row.players?.length) impacts.set(row.gameId, row);
  }
  const games: NbaArchivedRotationGame[] = [], sourceFailures: Record<string, number> = {};
  const failed = (reason: string) => { sourceFailures[reason] = (sourceFailures[reason] ?? 0) + 1; };
  for (const job of manifest.games) {
    const stem = path.join(root, "native", job.id + "-boxscore"); if (!fs.existsSync(stem + ".json.gz") || !fs.existsSync(stem + ".receipt.json")) continue;
    try { const roster = verifyNbaOriginalRoster({ gameId: job.id, bytes: gunzipSync(fs.readFileSync(stem + ".json.gz")), receipt: JSON.parse(fs.readFileSync(stem + ".receipt.json", "utf8")) });
      games.push({ ...roster, season: job.season, impact: impacts.get(job.id) ?? null });
    } catch (e) { failed(e instanceof Error ? e.message : String(e)); }
  }
  games.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  type Fixture = Pick<NbaArchivedRotationGame, "gameId" | "season" | "startAt"> & { teams: { teamId: number; abbreviation: string }[] };
  const targetFile = targetPath ? JSON.parse(fs.readFileSync(targetPath, "utf8")) as { targets: Fixture[]; receivedAt: string; sourceSha256: string } : null;
  if (targetFile && (!/^[a-f0-9]{64}$/.test(targetFile.sourceSha256) || targetFile.targets.length > 30 || targetFile.targets.some(g => !/^002\d{7}$/.test(g.gameId) || g.teams.length !== 2 || !Number.isFinite(Date.parse(g.startAt)) || !Number.isFinite(Date.parse(targetFile.receivedAt)) || Date.parse(targetFile.receivedAt) >= Date.parse(g.startAt) - 3_600_000 || !g.teams.every(t => Number.isSafeInteger(t.teamId) && /^[A-Z]{2,3}$/.test(t.abbreviation))))) throw Error("invalid_original_forward_fixture");
  const fixtures: Fixture[] = targetFile?.targets ?? games;
  const byMatch = new Map<string, Fixture[]>();
  for (const g of fixtures) { const key = `${easternDay(g.startAt)}:${g.teams[1]!.abbreviation}@${g.teams[0]!.abbreviation}`; byMatch.set(key, [...(byMatch.get(key) ?? []), g]); }
  const medical: NbaArchivedMedicalSection[] = [];
  const lookupNativeName = createNbaAsOfNativeNameLookup(games);
  // Full, fixed NBA team labels. No fuzzy or substring team/player matching.
  const teams: Record<string, string[]> = { ATL: ["Atlanta Hawks"], BOS: ["Boston Celtics"], BKN: ["Brooklyn Nets"], CHA: ["Charlotte Hornets"], CHI: ["Chicago Bulls"], CLE: ["Cleveland Cavaliers"], DAL: ["Dallas Mavericks"], DEN: ["Denver Nuggets"], DET: ["Detroit Pistons"], GSW: ["Golden State Warriors"], HOU: ["Houston Rockets"], IND: ["Indiana Pacers"], LAC: ["LA Clippers", "Los Angeles Clippers"], LAL: ["Los Angeles Lakers"], MEM: ["Memphis Grizzlies"], MIA: ["Miami Heat"], MIL: ["Milwaukee Bucks"], MIN: ["Minnesota Timberwolves"], NOP: ["New Orleans Pelicans"], NYK: ["New York Knicks"], OKC: ["Oklahoma City Thunder"], ORL: ["Orlando Magic"], PHI: ["Philadelphia 76ers"], PHX: ["Phoenix Suns"], POR: ["Portland Trail Blazers"], SAC: ["Sacramento Kings"], SAS: ["San Antonio Spurs"], TOR: ["Toronto Raptors"], UTA: ["Utah Jazz"], WAS: ["Washington Wizards"] };
  for (const report of (JSON.parse(gunzipSync(fs.readFileSync(medicalPath)).toString()) as { results: Report[] }).results) {
    if (report.status !== "normalized" || !report.clock) continue;
    for (const s of report.sections ?? []) {
      const [month, date, year] = s.gameDate.split("/"), matches = byMatch.get(`${year}-${month}-${date}:${s.matchup}`) ?? [];
      if (matches.length !== 1) continue;
      const g = matches[0]!, cutoff = Date.parse(g.startAt) - 3_600_000;
      if (Date.parse(report.clock.sourceAvailableAt) > cutoff) continue;
      if (!nbaHistoricalPrintedTipMatches(s, g.startAt)) { failed("printed_pregame_tip_mismatch"); continue; }
      const team = g.teams.find(t => (teams[t.abbreviation] ?? []).map(name).includes(name(s.teamName))); if (!team) { failed("unmatched_medical_team"); continue; }
      // Only the latest pre-target prior native roster supplies names/IDs.
      const prior = games.filter(p => p.gameId !== g.gameId && Date.parse(p.startAt) < cutoff && Date.parse(p.sourceAvailableAt) <= cutoff && p.teams.some(t => t.teamId === team.teamId)).at(-1);
      if (!prior) continue; const roster = prior.teams.find(t => t.teamId === team.teamId)!.players;
      let valid = true;
      const identitySources = new Map<string, { sha256: string; fetchedAt: string; sourceAvailableAt: string }>();
      const excludedOutPlayers: NonNullable<NbaArchivedMedicalSection["excludedOutPlayers"]>[number][] = [];
      const players = s.players.flatMap(p => {
        const key = injuryName(p.sourceName), direct = roster.filter(r => r.sourceNames.some(n => name(n) === key)).map(r => r.playerId);
        let ids = direct;
        if (direct.length === 0) {
          const known = lookupNativeName({ gameId: g.gameId, cutoff: new Date(cutoff).toISOString() }, p.sourceName); ids = known.map(r => r.playerId);
          if (ids.length === 1) { const source = known.find(r => r.playerId === ids[0])!; identitySources.set(source.sha256, { sha256: source.sha256, fetchedAt: source.fetchedAt, sourceAvailableAt: source.sourceAvailableAt }); }
        }
        if (ids.length !== 1 || !["Out", "Questionable", "Doubtful", "Probable", "Available"].includes(p.rawStatus)) { failed("unmatched_or_ambiguous_exact_medical_player"); valid = false; return []; }
        if (!roster.some(r => r.playerId === ids[0])) {
          // A uniquely identified, explicitly OUT nonmember cannot contribute
          // positive expected minutes. Preserve the exclusion and its native
          // source proof. An uncertain/eligible nonmember still holds the team.
          if (p.rawStatus === "Out") { excludedOutPlayers.push({ playerId: ids[0]!, sourceName: p.sourceName, rawStatus: "Out" }); return []; }
          failed("eligible_medical_player_not_on_prior_roster"); valid = false; return [];
        }
        return [{ playerId: ids[0]!, rawStatus: p.rawStatus as NbaArchivedMedicalSection["players"][number]["rawStatus"] }];
      });
      medical.push({ gameId: g.gameId, teamId: team.teamId, startAt: g.startAt, sourceAvailableAt: report.clock.sourceAvailableAt, fetchedAt: report.clock.fetchedAt, sha256: report.clock.rawSha256, completeSubmitted: s.submitted && valid, players, identitySources: [...identitySources.values()], excludedOutPlayers });
    }
  }
  type Movement = { TRANSACTION_DATE: string; TEAM_ID: number; Additional_Sort: number; Transaction_Type: string; TRANSACTION_DESCRIPTION: string };
  const movements = (JSON.parse(gunzipSync(fs.readFileSync(movementPath)).toString()) as { NBA_Player_Movement: { rows: Movement[] } }).NBA_Player_Movement.rows;
  const membershipUncertainties = movements.flatMap(m => [m.TEAM_ID, ...(m.Additional_Sort > 1_610_000_000 ? [m.Additional_Sort] : [])].map(teamId => ({ day: m.TRANSACTION_DATE.slice(0, 10), teamId, reason: `date_only_${m.Transaction_Type}` })));
  // A ten-day contract lasts ten days or three games, whichever is longer.
  // Signing time is unknown, so same-day participation gives two possible
  // third-game dates. These current date facts only block ambiguous intervals.
  const schedule = manifest.games.flatMap(g => {
    const file = path.join(root, `native-team-games-${g.season}.json.gz`);
    return fs.existsSync(file) ? [g.season] : [];
  }).filter((s, i, a) => a.indexOf(s) === i).flatMap(season => {
    const table = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, `native-team-games-${season}.json.gz`))).toString()).resultSets[0] as { headers: string[]; rowSet: unknown[][] };
    const date = table.headers.indexOf("GAME_DATE"), team = table.headers.indexOf("TEAM_ID");
    return table.rowSet.map(r => ({ day: String(r[date]).slice(0, 10), teamId: Number(r[team]) }));
  });
  for (const m of movements) if (m.Transaction_Type === "Signing" && /10[ -]day/i.test(m.TRANSACTION_DESCRIPTION)) {
    const signed = m.TRANSACTION_DATE.slice(0, 10), ten = new Date(Date.parse(signed + "T12:00:00Z") + 10 * 86_400_000).toISOString().slice(0, 10);
    const dates = schedule.filter(s => s.teamId === m.TEAM_ID && s.day >= signed).map(s => s.day).sort();
    if (dates.length < 4) continue;
    const first = dates[2]! > ten ? dates[2]! : ten, last = dates[3]! > ten ? dates[3]! : ten;
    for (let tick = Date.parse(first + "T12:00:00Z"); tick <= Date.parse(last + "T12:00:00Z"); tick += 86_400_000) membershipUncertainties.push({ day: new Date(tick).toISOString().slice(0, 10), teamId: m.TEAM_ID, reason: "possible_ten_day_expiry" });
  }
  const medicalByGame = new Map<string, NbaArchivedMedicalSection[]>();
  for (const m of medical) { const sections = medicalByGame.get(m.gameId) ?? []; sections.push(m); medicalByGame.set(m.gameId, sections); }
  const rows = [], reasons: Record<string, number> = {}; let mutationCases = 0;
  for (const g of fixtures.filter(g => g.season >= 2022)) {
    const args = { target: { gameId: g.gameId, season: g.season, homeTeamId: g.teams[0]!.teamId, awayTeamId: g.teams[1]!.teamId, startAt: g.startAt, cutoff: new Date(Date.parse(g.startAt) - 3_600_000).toISOString() }, games, medical: medicalByGame.get(g.gameId) ?? [], membershipUncertainties };
    const row = buildNbaArchivedRotation(args);
    if (rows.length % 100 === 0) {
      const poison = (base: NbaArchivedRotationGame) => Object.defineProperties({ ...base }, { teams: { get(): never { throw Error("target_future_roster_read"); } }, impact: { get(): never { throw Error("target_future_impact_read"); } } });
      const example = games[0]!;
      const future = poison({ ...example, gameId: "0029900001", startAt: "2099-01-01T00:00:00Z", sourceAvailableAt: "2099-01-01T04:00:00Z" });
      const late = poison({ ...example, gameId: "0029900002", sourceAvailableAt: "2099-01-01T04:00:00Z" });
      const targetOnly = poison({ ...example, gameId: g.gameId });
      const poisonedMedical: NbaArchivedMedicalSection = { gameId: g.gameId, teamId: g.teams[0]!.teamId, startAt: g.startAt, fetchedAt: "2099-01-01T01:00:00Z", sha256: "f".repeat(64), completeSubmitted: true, sourceAvailableAt: "2099-01-01T00:00:00Z", get players(): never { throw Error("future_medical_read"); } };
      if (buildNbaArchivedRotation({ ...args, games: [...games.filter(s => s.gameId !== g.gameId), targetOnly, future, late], medical: [...args.medical, poisonedMedical], membershipUncertainties: [...membershipUncertainties, { day: "2099-01-01", teamId: g.teams[0]!.teamId, reason: "future" }] }).hash !== row.hash) throw Error("real_archival_future_target_mutation_changed_snapshot");
      mutationCases++;
    }
    for (const t of row.teams) for (const reason of t.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    rows.push(row); if (rows.length % 250 === 0) console.log(JSON.stringify({ completed: rows.length, complete: rows.filter(r => r.status === "complete").length }));
  }
  const qualification = qualifyNbaArchivedRotation(rows);
  const summary = { createdAt: new Date().toISOString(), qualification, mutationProof: { cases: mutationCases, passed: true, sourceSha256: createHash("sha256").update(fs.readFileSync(process.argv[1]!)).digest("hex") }, sourceFailures, reasons, originalGames: games.length, submittedMedicalSections: medical.length,
    inputs: Object.fromEntries([impactPath, medicalPath, movementPath, ...(targetPath ? [targetPath] : [])].map(p => [path.basename(p), createHash("sha256").update(fs.readFileSync(p)).digest("hex")])), productionWrites: 0, fittingPerformed: false };
  fs.writeFileSync(destination, gzipSync(JSON.stringify({ summary, rows })), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(destination + ".summary.json", JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 }); console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
