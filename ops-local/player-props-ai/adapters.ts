/** Pure adapters for a LOCAL read-only export. No provider, database, writer or cron imports. */
import type { NbaPlayerPropsCurrentState } from "../../lib/services/nba/nbaPlayerPropsCurrentState";
import type { NbaPlayerPropsMarketHistory } from "../../lib/services/nba/nbaPlayerPropsPrivateStore";
import type { NbaPlayerPropsMemberSnapshot } from "../../lib/services/nba/nbaPlayerPropsProductContract";
import type { NflPlayerPropsProductionSnapshot } from "../../lib/services/football/nflPlayerPropsProductionContract";
import { CATALOG, PRODUCT_RELEASE, type Evidence, type GamePacket, type Json, type Player, type Quote } from "./catalog";
import { digest, instant, slots } from "./core";

export type CachedExport = {
  readOnly: true; generatedAt: string;
  priorNba: NbaPlayerPropsCurrentState; currentNba: NbaPlayerPropsCurrentState;
  nba: { date: string; snapshot: NbaPlayerPropsMemberSnapshot | null; market: NbaPlayerPropsMarketHistory | null }[];
  nfl: { week: number; snapshot: NflPlayerPropsProductionSnapshot | null }[];
};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value));
const evidence = (id: string, kind: Evidence["kind"], availableAt: string, source: string, value: unknown): Evidence => ({ id, kind, availableAt, source, value: json(value) });
// Same name/team join used for cost identity; provider-ID coverage must be established before runtime use.
const nflIdentity = (team: string, name: string) => `${team}:${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

export function fromCachedExport(source: CachedExport) {
  if (source.readOnly !== true) throw new Error("Expected read-only local source export");
  const packets: GamePacket[] = [];
  const skipped: { sport: string; gameId: string; reason: string }[] = [];
  const games = new Map([...source.priorNba.games, ...source.currentNba.games].map(g => [g.gameId, g]));
  const boxes = [...new Map([...source.priorNba.boxes, ...source.currentNba.boxes].map(b => [`${b.gameId}:${b.playerId}`, b])).values()];
  const advanced = new Map([...source.priorNba.advanced, ...source.currentNba.advanced].filter(a => a.period === 0).map(a => [`${a.gameId}:${a.playerId}`, a]));
  for (const day of source.nba) {
    if (!day.snapshot) { skipped.push({ sport: "nba", gameId: day.date, reason: "No published source snapshot; pending is not zero workload" }); continue; }
    const snapshot = day.snapshot;
    for (const game of snapshot.games) {
      const decisions = snapshot.decisions.filter(d => d.gameId === game.gameId);
      const observations = (day.market?.observations ?? []).filter(q => q.canonicalGameId === game.gameId && (CATALOG.nba.required as readonly string[]).includes(q.market));
      const ids = [...new Set([...decisions.map(d => d.playerId), ...observations.flatMap(q => q.canonicalPlayerId ? [q.canonicalPlayerId] : [])])];
      const locks = [...new Set(decisions.flatMap(d => d.lockedAt ? [d.lockedAt] : []))];
      const lock = locks.length === 1 ? locks[0] : new Date(instant(game.scheduledStart) - 3600_000).toISOString();
      for (const slot of slots({ sport: "nba", gameId: game.gameId, start: game.scheduledStart, lock })) {
        const cutoff = instant(slot.at);
        const players: Player[] = ids.map(id => {
          const rows = decisions.filter(d => d.playerId === id), first = rows[0];
          const raw = observations.find(q => q.canonicalPlayerId === id);
          const team = first?.team ?? raw?.playerTeam ?? "unknown", opponent = first?.opponent ?? "unknown";
          const numericId = Number(id.replace(/^.*:/, ""));
          const history = boxes.filter(b => b.playerId === numericId && games.has(b.gameId) && instant(games.get(b.gameId)!.startTime) + 6 * 3600_000 <= cutoff)
            .sort((a, b) => instant(games.get(b.gameId)!.startTime) - instant(games.get(a.gameId)!.startTime));
          const opponentHistory = history.filter(b => {
            const g = games.get(b.gameId)!;
            return (g.homeTeamId === b.teamId ? g.awayTeam : g.homeTeam) === opponent;
          });
          const values: Evidence[] = [];
          for (const [label, kind, subset] of [["recent", "recent_games", history.slice(0, 10)], ["opponent", "matchup_history", opponentHistory.slice(0, 5)]] as const) {
            for (const b of subset) {
              const g = games.get(b.gameId)!;
              values.push(evidence(`${id}:${label}:${b.gameId}`, kind, new Date(instant(g.startTime) + 6 * 3600_000).toISOString(), "cached NBA boxes; availability time ASSUMED game start + 6h", { game: g, box: b, advanced: advanced.get(`${b.gameId}:${b.playerId}`) ?? null }));
            }
          }
          const valid = rows.filter(r => instant(r.evaluatedAt) <= cutoff);
          for (const row of valid) {
            values.push(evidence(`${id}:model:${row.market}`, "independent_model", row.evaluatedAt, row.modelRelease ?? "unversioned-source",
              { market: row.market, line: row.line, selectedSide: row.side, independentProjection: row.independentProjection, independentSelectedSideProbability: row.independentProbability, calibrationRelease: row.calibrationRelease, role: row.role, production: row.production, matchup: row.matchup }));
          }
          const missing = ["separate timestamped injury/lineup feed missing", "qualified joint outcome law not attached", "historical stat availability timestamps assumed, not proved"];
          if (!history.length) missing.push("no recent game logs in cached seasons");
          if (!opponentHistory.length) missing.push("no opponent history in cached seasons");
          if (valid.length !== rows.length || !rows.length) missing.push("independent baseline missing at this review cutoff for some offered markets");
          if (valid.some(r => !r.modelRelease)) missing.push("model release absent for some independent baselines");
          return { id, name: first?.playerName ?? raw?.playerName ?? id, team, opponent,
            markets: [...new Set([...rows.map(r => r.market), ...observations.filter(q => q.canonicalPlayerId === id).map(q => q.market)])].sort(), evidence: values, missing };
        });
        const quotes = new Map<string, Quote>();
        let rejected = 0;
        for (const q of observations) {
          if (!q.canonicalPlayerId || q.isLive || !["over", "under", "yes"].includes(q.side) || instant(q.observedAt) > instant(q.fetchedAt) || instant(q.fetchedAt) > cutoff || Math.abs(q.americanPrice) < 100) { rejected++; continue; }
          const value = { playerId: q.canonicalPlayerId, market: q.market, provider: q.provider, book: q.sportsbook, line: q.line,
            side: q.side as Quote["side"], american: q.americanPrice, observedAt: q.observedAt, receivedAt: q.fetchedAt, live: false };
          const id = digest(value); quotes.set(id, { id, ...value });
        }
        packets.push({ release: PRODUCT_RELEASE, sport: "nba", gameId: game.gameId, start: game.scheduledStart, lock,
          stage: slot.stage, cutoff: slot.at, players, quotes: [...quotes.values()].map((q, i) => ({ ...q, id: `q${i}` })),
          sourceLimitations: ["local archive, not complete early/final historical evidence", "source retains opening plus bounded later quote states, not every tick", `source quotes excluded for cutoff/identity/validity: ${rejected}`, ...(locks.length !== 1 ? ["lock assumed start minus 60 minutes; live contract not verified"] : []), ...(cutoff > instant(source.generatedAt) ? ["planned future slot: latest day-of changes unavailable"] : [])] });
      }
    }
  }
  for (const item of source.nfl) {
    const snapshot = item.snapshot; if (!snapshot) continue;
    for (const gameId of new Set(snapshot.memberDecisions.map(r => r.gameId))) {
      const rows = snapshot.memberDecisions.filter(r => r.gameId === gameId), first = rows[0];
      const lock = first.lockAt;
      if (!lock) { skipped.push({ sport: "nfl", gameId, reason: "Missing verified lock" }); continue; }
      for (const slot of slots({ sport: "nfl", gameId, start: first.scheduledStart, lock })) {
        const cutoff = instant(slot.at), players: Player[] = [];
        const quotes = new Map<string, Quote>();
        for (const id of new Set(rows.map(r => nflIdentity(r.team, r.playerName)))) {
          const playerRows = rows.filter(r => nflIdentity(r.team, r.playerName) === id), row = playerRows[0];
          const heads = [...new Map(playerRows.map(r => [r.market, r])).values()];
          const values: Evidence[] = [];
          for (const h of heads) {
            // A current source export cannot be backdated into the already-locked Thursday game.
            const availableAt = new Date(Math.max(instant(snapshot.generatedAt), instant(h.forecastContext.featureAsOf))).toISOString();
            if (instant(availableAt) <= cutoff) values.push(evidence(`${id}:model:${h.market}`, "independent_model", availableAt, h.modelRelease,
              { market: h.market, line: h.line, selectedSide: h.side, independentProjection: h.decisionSupport?.projection.independent ?? null,
                independentSelectedSideProbability: h.decisionSupport?.probability.independentSelectedSide ?? null,
                context: h.forecastContext, participationProbability: h.participationProbability, healthHolds: h.healthHolds }));
          }
          players.push({ id, name: row.playerName, team: row.team, opponent: row.opponent,
            markets: heads.map(h => h.market).sort(), evidence: values,
            missing: ["individual historical game logs missing", "individual matchup history missing", "qualified joint outcome law not attached", "identity joined by normalized name/team; provider-ID reconciliation unverified", ...(values.length !== heads.length ? ["independent model/context unavailable at this cutoff"] : [])] });
          for (const h of playerRows) for (const book of h.bookEvidence) {
            if (instant(snapshot.generatedAt) > cutoff || instant(book.observedAt) > cutoff) continue;
            for (const state of [
              { line: h.line, american: book.americanPrice, at: book.observedAt },
              ...(book.openingObservedAt && book.openingLine !== null && book.openingAmericanPrice !== null ? [{ line: book.openingLine!, american: book.openingAmericanPrice!, at: book.openingObservedAt }] : []),
            ]) {
              if (state.line === undefined || state.american === undefined || Math.abs(state.american) < 100 || instant(state.at) > instant(snapshot.generatedAt)) continue;
              const value = { playerId: id, market: h.market, provider: book.provider, book: book.sportsbook, line: state.line, side: h.side as Quote["side"], american: state.american, observedAt: state.at,
                // Original receipt missing: use export availability conservatively; do not invent historical receipt.
                receivedAt: snapshot.generatedAt, live: false };
              const qid = digest(value); quotes.set(qid, { id: qid, ...value });
            }
          }
        }
        packets.push({ release: PRODUCT_RELEASE, sport: "nfl", gameId, start: first.scheduledStart, lock, stage: slot.stage, cutoff: slot.at,
          players, quotes: [...quotes.values()].map((q, i) => ({ ...q, id: `q${i}` })), sourceLimitations: ["local current export, not complete early/final historical evidence", "opening/current quotes only; original receipt time unavailable", "passing TD and interception heads not supplied by active export", ...(cutoff > instant(source.generatedAt) ? ["planned future slot: day-of availability changes unavailable"] : [])] });
      }
    }
  }
  return { packets, skipped, absentSportSources: ["mlb"] };
}
