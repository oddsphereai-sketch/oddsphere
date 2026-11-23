import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, createGzip } from "node:zlib";
import { once } from "node:events";
import { verifyNbaOriginalPlayerImpact, verifyNbaOriginalTwoWayImpact } from "../../../lib/research/nba/nbaOriginalPlayerImpact";

/** Offline, bounded by an already frozen native-game manifest. No DB/provider IO. */
async function main() {
  const root = process.argv[2], output = process.argv[3], twoWay = process.argv[4] === "--two-way";
  if (!root || !output || fs.existsSync(output) || fs.existsSync(output + ".summary.json")) throw Error("usage: validate-original-player-impact ARCHIVE_ROOT NEW_OUTPUT.jsonl.gz");
  const manifestBytes = fs.readFileSync(path.join(root, "native-job-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as { games: { season: number; id: string }[] };
  if (manifest.games.length > 10_000 || new Set(manifest.games.map(g => g.id)).size !== manifest.games.length) throw Error("invalid_native_manifest");
  const gzip = createGzip(), file = fs.createWriteStream(output, { flags: "wx", mode: 0o600 }); gzip.pipe(file);
  const failures: Record<string, number> = {}, bySeason: Record<number, { captured: number; qualified: number; unavailable: number; players: number; modernComparable: number; modernExact: number; revisionGames: number }> = {};
  const issue = (value: string) => { const reason = value.replace(/:\d+(?=:|$).*/, ""); failures[reason] = (failures[reason] ?? 0) + 1; };
  const table = (p: string) => { const t = JSON.parse(gunzipSync(fs.readFileSync(p)).toString()).resultSets[0] as { headers: string[]; rowSet: unknown[][] }; return t.rowSet.map(r => Object.fromEntries(t.headers.map((h, i) => [h, r[i]]))); };
  for (const season of [...new Set(manifest.games.map(g => g.season))].sort()) {
    const advanced = new Map<string, Map<number, Record<string, unknown>>>(), traditional = new Map<string, Map<number, Record<string, unknown>>>();
    for (const [kind, dest] of [["advanced", advanced], ["traditional", traditional]] as const) for (const row of table(path.join(root, `native-player-${kind}-${season}.json.gz`))) {
      const gameId = String(row.GAME_ID), playerId = Number(row.PLAYER_ID); if (!dest.has(gameId)) dest.set(gameId, new Map());
      if (dest.get(gameId)!.has(playerId)) throw Error("duplicate_modern_reference"); dest.get(gameId)!.set(playerId, row);
    }
    const cohort = bySeason[season] = { captured: 0, qualified: 0, unavailable: 0, players: 0, modernComparable: 0, modernExact: 0, revisionGames: 0 };
    for (const game of manifest.games.filter(g => g.season === season)) {
      const stem = (kind: string) => path.join(root, "native", `${game.id}-${kind}`);
      if (!["boxscore", "playbyplay"].every(k => fs.existsSync(stem(k) + ".json.gz") && fs.existsSync(stem(k) + ".receipt.json"))) { cohort.unavailable++; continue; }
      cohort.captured++;
      let row: Record<string, unknown>;
      try {
        const result = (twoWay ? verifyNbaOriginalTwoWayImpact : verifyNbaOriginalPlayerImpact)({ gameId: game.id, computedAt: new Date().toISOString(),
          boxBytes: gunzipSync(fs.readFileSync(stem("boxscore") + ".json.gz")), boxReceipt: JSON.parse(fs.readFileSync(stem("boxscore") + ".receipt.json", "utf8")),
          pbpBytes: gunzipSync(fs.readFileSync(stem("playbyplay") + ".json.gz")), pbpReceipt: JSON.parse(fs.readFileSync(stem("playbyplay") + ".receipt.json", "utf8")) });
        const fields = { pts: "PTS", fgm: "FGM", fga: "FGA", fg3m: "FG3M", fg3a: "FG3A", ftm: "FTM", fta: "FTA", oreb: "OREB", dreb: "DREB", ast: "AST", stl: "STL", blk: "BLK", pf: "PF", tov: "TOV" };
        const revisions = result.players.filter(p => p.played).flatMap(p => Object.entries(fields).filter(([k, field]) => (p.counts[k] ?? 0) !== traditional.get(game.id)?.get(p.playerId)?.[field]).map(([k, field]) => ({ playerId: p.playerId, field: k, original: p.counts[k] ?? 0, current: traditional.get(game.id)?.get(p.playerId)?.[field] })));
        const comparison = result.players.filter(p => p.played).map(p => {
          const ref = advanced.get(game.id)?.get(p.playerId);
          const exact = !!ref && p.pie !== null && p.estimatedNet !== null && Math.abs(p.pie - Number(ref.PIE)) <= .00051 && Math.abs(p.estimatedNet - Number(ref.E_NET_RATING)) <= .051 && (!twoWay || p.estimatedOffense != null && p.estimatedDefense != null && Math.abs(p.estimatedOffense - Number(ref.E_OFF_RATING)) <= .051 && Math.abs(p.estimatedDefense - Number(ref.E_DEF_RATING)) <= .051);
          cohort.players++; if (!revisions.length && ref) { cohort.modernComparable++; if (exact) cohort.modernExact++; }
          return { playerId: p.playerId, exact, currentPie: ref?.PIE, currentEstimatedNet: ref?.E_NET_RATING };
        });
        if (revisions.length) cohort.revisionGames++;
        if (!result.issues.length) cohort.qualified++; else result.issues.forEach(issue);
        row = { season, ...result, qualified: result.issues.length === 0, currentReference: { revisions, comparison } };
      } catch (e) { const reason = e instanceof Error ? e.message : String(e); issue(reason); row = { season, gameId: game.id, qualified: false, error: reason }; }
      if (!gzip.write(JSON.stringify(row) + "\n")) await once(gzip, "drain");
    }
    console.log(JSON.stringify({ season, ...cohort }));
  }
  gzip.end(); await once(file, "finish");
  const summary = { createdAt: new Date().toISOString(), manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), outputSha256: createHash("sha256").update(fs.readFileSync(output)).digest("hex"), bySeason, failures, productionWrites: 0, providerRequests: 0 };
  fs.writeFileSync(output + ".summary.json", JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
