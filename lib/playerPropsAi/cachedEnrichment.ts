import {PROPS_AI_NFL_SOURCE_RELEASE} from "./nflPlayerIdentity";
/** Pure joins over cached/public research. Never backdate a newly fetched record. */
import type { NflPlayerPropsCurrentSeasonState } from "../services/football/nflPlayerPropsCurrentSeasonState";
import type { MlbPropsBoardSnapshot, MlbPropsGameLockPointer } from "../mlb/props/boardSnapshotStore";
import type { MlbPropsMarketEvidenceRow } from "../mlb/props/marketEvidenceCapture";
import type { CachedExport } from "./cachedAdapters";
import { PRODUCT_RELEASE, type Evidence, type GamePacket, type Json, type Quote } from "./evidenceContract";
import { digest, instant, slots } from "./evidence";
import {attachGameReaderContext,type ReaderGameContext} from "./gameContext";
import {nbaReaderBenchmark} from "./nbaBenchmarks";
import {NBA_READER_UNIT_CONTRACT} from "./readerUnitContract";
import {capturedReviewSlots,type CapturedReviewWindow} from "./liveWindow";

type NbaContextGame = { awayTeam: string; homeTeam: string; gameStartAt: string; generatedAt: string; nbaAvailability?: Json };
export type NflPublicHistory = { source: string; availableAt: string; rows: { player_id: string; player_display_name: string; position: string; team: string; opponent_team: string; game: { gameId: string; start: string; home: string; away: string }; stats: Record<string, number | null> }[] };
export type EnrichedSource = CachedExport & {
  nflHistory?: NflPlayerPropsCurrentSeasonState | null; nflVerse?: NflPublicHistory;
  nflContext?: ReaderGameContext[];
  nbaContext?: { generated_at: string; payload: { games: NbaContextGame[] } }[];
  mlbLocked?: { date: string; snapshot: MlbPropsBoardSnapshot; lock: MlbPropsGameLockPointer }[];
};
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v));
const nameKey = (name: string) => name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, "").replace(/[^a-z0-9]/g, "");
const teamKey = (team: string) => ({ JAC: "JAX", LA: "LAR", WSH: "WAS", GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA" }[team] ?? team);
function latestTime(value: unknown, initial: string): string {
  let latest = instant(initial);
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [key, entry] of Object.entries(v)) {
      if (["asOfTimestamp", "availableAt", "reportedAt", "capturedAt", "reportUpdatedAt", "featureAsOf"].includes(key) && typeof entry === "string" && Number.isFinite(Date.parse(entry))) latest = Math.max(latest, instant(entry));
      if (entry && typeof entry === "object") walk(entry);
    }
  }; walk(value); return new Date(latest).toISOString();
}
export function enrichCachedPacket(packet: GamePacket, source: EnrichedSource): GamePacket {
  const cutoff = instant(packet.cutoff);
  const benchmark=packet.sport==="nba"?nbaReaderBenchmark(packet,[source.priorNba,source.currentNba]):null;
  const enriched = { ...packet, players: packet.players.map(player => {
    let evidence = [...player.evidence]; const missing = [...player.missing];
    if (packet.sport === "nba") {
      if(benchmark)evidence.push({...benchmark,id:`${player.id}:${benchmark.id}`,value:{...(benchmark.value as Record<string,Json>),readerUnitContract:NBA_READER_UNIT_CONTRACT}});
      const prior = source.priorNba as typeof source.priorNba & { updatedAt?: string }, current = source.currentNba as typeof source.currentNba & { updatedAt?: string };
      let historicalRejected = false;
      evidence = evidence.flatMap(e => {
        if (e.kind !== "recent_games" && e.kind !== "matchup_history") return [e];
        if (e.source === "cached NBA stat state; actual cache availability timestamp retained") return [e];
        const game = (e.value as { game?: { season?: number } })?.game;
        const captured = (game?.season === 2025 ? prior : current).updatedAt;
        if (!captured || instant(captured) > cutoff) { historicalRejected = true; return []; }
        return [{ ...e, availableAt: captured, source: "cached NBA stat state; actual cache availability timestamp retained" }];
      });
      const assumed = missing.indexOf("historical stat availability timestamps assumed, not proved"); if (assumed >= 0) missing.splice(assumed, 1);
      if (historicalRejected) missing.push("historical stat cache unavailable at this cutoff; later fetch cannot be backdated");
      const context = source.nbaContext?.flatMap(row => row.payload.games.map(game => ({ game, captured: row.generated_at })))
        .filter(({ game, captured }) => Math.abs(instant(game.gameStartAt) - instant(packet.start)) < 60_000 && instant(captured) <= cutoff && instant(game.generatedAt) <= cutoff && [player.team, player.opponent].every(team => [game.awayTeam, game.homeTeam].some(t => teamKey(t) === teamKey(team))))
        .sort((a, b) => instant(b.captured) - instant(a.captured))[0];
      if (context?.game.nbaAvailability) {
        const availableAt = latestTime(context.game.nbaAvailability, context.captured);
        if (instant(availableAt) <= cutoff) {
          evidence.push({ id: `${player.id}:availability`, kind: "availability", availableAt, source: "cached NBA exact-game availability; original source preserved", value: { context: context.game.nbaAvailability,
            interpretation: "Unlisted players are not confirmed healthy; starting lineups are not confirmed by this injury report." } });
          const availability = context.game.nbaAvailability as { away?: { known?: boolean }; home?: { known?: boolean } };
          if (availability.away?.known === true && availability.home?.known === true) {
            const index = missing.indexOf("separate timestamped injury/lineup feed missing"); if (index >= 0) missing.splice(index, 1);
          } else missing.push("NBA availability report has incomplete team coverage; absent/unlisted players are not confirmed healthy");
          missing.push("confirmed NBA starting lineup unavailable in this source before lock");
        } else missing.push("future-dated NBA availability rejected at this cutoff");
      }
    }
    if (packet.sport === "nfl") {
      const original = source.nfl.flatMap(w => w.snapshot?.memberDecisions ?? []).find(r => r.gameId === packet.gameId && teamKey(r.team) === teamKey(player.team) && nameKey(r.playerName) === nameKey(player.name));
      const verifiedId=packet.sourceInputRelease===PROPS_AI_NFL_SOURCE_RELEASE&&player.id.startsWith("nfl-bdl-player:")?player.id.slice("nfl-bdl-player:".length):original?.providerPlayerId;
      const state = source.nflHistory;
      const games = new Map(state?.games.map(g => [g.gameId, g]) ?? []);
      const eligible = (state?.stats ?? []).filter(row => (verifiedId ? row.playerId === verifiedId : nameKey(row.playerName) === nameKey(player.name) && teamKey(row.team) === teamKey(player.team)) && games.has(row.gameId) && instant(row.scheduledStart) + 6 * 3600_000 < cutoff && instant(state!.updatedAt) <= cutoff)
        .sort((a, b) => instant(b.scheduledStart) - instant(a.scheduledStart));
      const recent = eligible.slice(0, 10), opponent = eligible.filter(row => {
        const g = games.get(row.gameId)!; return teamKey(g.homeTeam === row.team ? g.awayTeam : g.homeTeam) === teamKey(player.opponent);
      }).slice(0, 5);
      for (const [kind, rows] of [["recent_games", recent], ["matchup_history", opponent]] as const) for (const row of rows) {
        evidence.push({ id: `${player.id}:${kind}:${row.gameId}`, kind, availableAt: state!.updatedAt, source: state!.release,
          value: json({ game: { ...games.get(row.gameId)!, teamStats: state!.teamStats.filter(g => g.gameId === row.gameId), playMetrics: state!.playMetrics.filter(g => g.gameId === row.gameId) }, box: row, advanced: null }) });
      }
      if (recent.length) { const i = missing.indexOf("individual historical game logs missing"); if (i >= 0) missing.splice(i, 1); }
      if (opponent.length) { const i = missing.indexOf("individual matchup history missing"); if (i >= 0) missing.splice(i, 1); }
      const publicSource = source.nflVerse;
      if (publicSource && instant(publicSource.availableAt) <= cutoff) {
        const matches = publicSource.rows.filter(row => nameKey(row.player_display_name) === nameKey(player.name) && teamKey(row.team) === teamKey(player.team));
        const ids = new Set(matches.map(row => row.player_id));
        if (ids.size === 1) {
          const history = publicSource.rows.filter(row => ids.has(row.player_id) && instant(row.game.start) + 6 * 3600_000 < cutoff).sort((a, b) => instant(b.game.start) - instant(a.game.start));
          const h2h = history.filter(row => teamKey(row.opponent_team) === teamKey(player.opponent)).slice(0, 5);
          for (const [kind, rows] of [["recent_games", history.slice(0, 10)], ["matchup_history", h2h]] as const) for (const row of rows) {
            evidence.push({ id: `${player.id}:nflverse:${kind}:${row.game.gameId}`, kind, availableAt: publicSource.availableAt, source: publicSource.source,
              value: json({ game: row.game, box: { ...row.stats, team: row.team, opponent: row.opponent_team, position: row.position }, advanced: null }) });
          }
          if (history.length) for (const gap of ["individual historical game logs missing", "individual matchup history missing"]) {
            if (gap.includes("matchup") && !h2h.length) continue;
            const i = missing.indexOf(gap); if (i >= 0) missing.splice(i, 1);
          }
          if (matches.some(row => row.position === "QB") && history.length) {
            const logs = history.slice(0, 10), attempts = logs.reduce((n, r) => n + (r.stats.attempts ?? 0), 0);
            for (const [market, key] of [["passing_tds", "passing_tds"], ["interceptions", "passing_interceptions"]] as const) {
              if (!player.markets.includes(market)) player = { ...player, markets: [...player.markets, market].sort() };
              evidence.push({ id: `${player.id}:research:${market}`, kind: "independent_model", availableAt: publicSource.availableAt,
                source: "offline NFL count-head diagnostic r1; NOT calibrated/production-qualified",
                value: { market, line: null, observedGames: logs.length, observedAttempts: attempts,
                  observedEvents: logs.reduce((n, r) => n + (r.stats[key] ?? 0), 0), historicalEventsPerGame: logs.reduce((n, r) => n + (r.stats[key] ?? 0), 0) / logs.length,
                  projection: null, probability: null, qualified: false } });
            }
            missing.push("passing-TD/interception forecasts unqualified and executable quotes absent from stored member export");
          }
        } else if (ids.size > 1) missing.push("public NFL history player identity ambiguous; public join rejected");
      }
    }
    const seen = new Set<string>();
    evidence = evidence.filter(e => { const key = digest({ kind: e.kind, availableAt: e.availableAt, source: e.source, value: e.value }); if (seen.has(key)) return false; seen.add(key); return true; });
    return { ...player, evidence, missing: [...new Set(missing)] };
  }) };
  return packet.sport==="nfl"?attachGameReaderContext(enriched,source.nflContext??[]):enriched;
}

export function mlbPackets(source: EnrichedSource,window?:CapturedReviewWindow,liveSnapshots:readonly MlbPropsBoardSnapshot[]=[]): GamePacket[] {
  const items = [...(source.mlbLocked ?? []),...liveSnapshots.map(snapshot=>({date:snapshot.slateDate,snapshot}))], games = new Map(items.flatMap(item => item.snapshot.data.props.flatMap(row => row.providerIds?.gameId ? [[row.providerIds.gameId, row.gameStartTime] as const] : [])));
  const packets: GamePacket[] = [];
  for (const [gameId, start] of games) {
    const lock = window?.gameId===gameId?window.lock:new Date(instant(start) - 3600_000).toISOString();
    for (const slot of capturedReviewSlots({gameId,start,lock},window,()=>slots({ sport: "mlb", gameId, start, lock }))) {
      const eligible = items.filter(item => instant(item.snapshot.asOfTimestamp) <= instant(slot.at) && item.snapshot.data.props.some(row => row.providerIds?.gameId === gameId))
        .sort((a, b) => instant(b.snapshot.asOfTimestamp) - instant(a.snapshot.asOfTimestamp));
      const item = eligible[0];
      // No manufactured early snapshot. Cost projections may conservatively reuse the final packet's size.
      if (!item) continue;
      const snapshot = item.snapshot, rows = snapshot.data.props.filter(r => r.providerIds?.gameId === gameId), quotes = new Map<string, Quote>();
      const identity = (row: typeof rows[number]) => row.providerIds?.mlbStatsPlayerId ?? `bdl:${row.providerIds?.bdlPlayerId ?? row.player}`;
      const players = [...new Set(rows.map(identity))].map(id => {
        const playerRows = rows.filter(r => identity(r) === id), first = playerRows[0], evidence: Evidence[] = [], missing: string[] = [];
        const unqualifiedQuotes: Json[] = [];
        const bookKey = (book: string) => book.toLowerCase().replace(/[^a-z0-9]/g, "");
        const explicitContract = (value: unknown): NonNullable<Quote["offerContract"]> | null => value === "two_way" || value === "milestone" ? value : null;
        const uniqueContract = (values: unknown[]): NonNullable<Quote["offerContract"]> | null => {
          const contracts = values.map(explicitContract);
          return contracts.length && contracts.every(Boolean) && new Set(contracts).size === 1 ? contracts[0] : null;
        };
        const representatives = new Map<string, typeof first>();
        for (const row of [...playerRows].sort((a, b) => Number(a.offerContract === "milestone") - Number(b.offerContract === "milestone") || Number(b.finalProbability !== null) - Number(a.finalProbability !== null))) if (!representatives.has(row.market)) representatives.set(row.market, row);
        for (const row of representatives.values()) {
          const captured = snapshot.marketEvidence?.i.find(i => i[0] === (row as MlbPropsMarketEvidenceRow).marketEvidenceId);
          // The old bounded identity joins by statistic/line, not contract. A
          // mixed ordinary/milestone capture cannot declare either event's
          // probabilities; preserve its raw numbers without relabeling them.
          const probabilityContract = uniqueContract(playerRows.filter(r => r.market === row.market && r.line === row.line).map(r => r.offerContract));
          evidence.push({ id: `${id}:model:${row.market}`, kind: "independent_model", availableAt: snapshot.asOfTimestamp,
            source: snapshot.modelContext?.modelReleaseId ?? "unversioned MLB source", value: json({ market: row.market, line: row.line,
              independentProjection: captured?.[5][0] ?? null, independentOver: probabilityContract ? captured?.[5][3] ?? null : null, independentUnder: probabilityContract ? captured?.[5][4] ?? null : null,
              ...(probabilityContract ? { offerContract: probabilityContract } : { independentEventStatus: "unresolved_legacy_capture_contract", unqualifiedCapturedIndependentOver: captured?.[5][3] ?? null, unqualifiedCapturedIndependentUnder: captured?.[5][4] ?? null }),
              sourceRowOfferContract: row.offerContract ?? null,
              storedPublishedProjection: row.projection, storedPublishedProbability: row.finalProbability, selectedSide: probabilityContract === "milestone" ? "yes" : row.side,
              storedGrade: row.playGrade, lockedPayloadDigest: digest(row), inputWarnings: row.modelInputWarnings ?? [], missingFeatures: row.missingFeatures }) });
          if(row.oddsMovement)evidence.push({id:`${id}:stored-movement:${row.market}`,kind:"market",availableAt:latestTime(row.oddsMovement,snapshot.asOfTimestamp),source:"stored MLB same-book movement; derived quote context, not an independent source",
            value:json({market:row.market,side:row.side,sportsbook:row.book,movement:row.oddsMovement,limitation:"Opening may be nearest-line provider opening or first tracked snapshot, as labeled. This does not establish an unambiguous main-line path or independent money signal."})});
          const research = row.researchKey ? snapshot.data.research?.[row.researchKey] : undefined;
          const modules = { recentForm: research?.recentForm ?? row.recentForm, opponentProfile: research?.opponentProfile ?? row.opponentProfile,
            pitchArsenal: research?.pitchArsenal ?? row.pitchArsenal, pitchMatchup: research?.pitchMatchup ?? row.pitchMatchup,
            matchupHistory: research?.matchupHistory ?? row.matchupHistory, environment: research?.environment ?? row.environment, lineup: row.lineupStatus };
          for (const [key, value] of Object.entries(modules)) {
            if (!value) continue;
            const availableAt = latestTime(value, snapshot.asOfTimestamp); if (instant(availableAt) > instant(slot.at)) { missing.push(`future-dated ${key} rejected`); continue; }
            evidence.push({ id: `${id}:${row.market}:${key}`, kind: key === "recentForm" ? "recent_games" : key === "matchupHistory" ? "matchup_history" : key === "lineup" ? "availability" : "matchup", availableAt, source: `stored MLB ${key}`, value: json(value) });
          }
          if (!captured) missing.push(`independent ${row.market} inputs absent from bounded market-evidence capture`);
          if (captured) {
            evidence.push({ id: `${id}:${row.market}:market-breadth`, kind: "market", availableAt: snapshot.asOfTimestamp, source: snapshot.marketEvidence!.r,
              value: json({ market: row.market, breadth: captured[3], bookSplitSchema: "[side,sourceClass,sourceTimestamp,tickets,money]", verifiedBookSplits: captured[2].filter(b => b[12].length).map(b => ({ book: b[0], provider: b[1], sourceClass: b[2], splits: b[12] })) }) });
            for (const b of captured[2]) for (const [side, current, opening] of [["over", b[8], b[10]], ["under", b[9], b[11]]] as const) {
              for (const state of [{ line: row.line, price: current, at: b[3], opening: false }, ...(b[6] && b[7] !== null ? [{ line: b[7], price: opening, at: b[6], opening: true }] : [])]) {
                if (state.price === null || !Number.isFinite(state.price) || Math.abs(state.price) < 100 || instant(state.at) > instant(slot.at)) continue;
                // mlbpme1 has no per-leg event declaration. Bind current legs
                // only to exact supplied native records. Opening contracts
                // require the original opening record, never a nearest line or
                // a declaration borrowed from a later current offer.
                const declarations = state.opening
                  ? (snapshot.modelContext?.openingPropOdds ?? []).filter(q => q.marketKey === row.market && q.line === state.line && q.side === side
                    && bookKey(q.sportsbook) === bookKey(b[0]) && q.americanOdds === state.price && instant(q.asOfTimestamp) === instant(state.at)
                    && q.gameId.replace(/^balldontlie-game-/, "") === String(row.providerIds?.bdlGameId)
                    && q.playerId.replace(/^balldontlie-player-/, "") === String(row.providerIds?.bdlPlayerId)).map(q => {
                      const raw = q.rawPayload && typeof q.rawPayload === "object" && !Array.isArray(q.rawPayload) ? q.rawPayload as Record<string, unknown> : {};
                      return raw.market_kind === "over_under" ? "two_way" : raw.market_kind;
                    })
                  : playerRows.filter(r => r.market === row.market && r.line === state.line && r.side === side && bookKey(r.book) === bookKey(b[0])
                    && r.odds === state.price && instant(r.lastUpdated) === instant(state.at)).map(r => r.offerContract);
                const contract = uniqueContract(declarations);
                const raw = { playerId: id, market: row.market, provider: b[1], book: b[0], line: state.line, side, american: state.price, observedAt: state.at, receivedAt: snapshot.asOfTimestamp, receivedAtProvenance: "snapshot_availability" as const, opening: state.opening, live: false };
                if (!contract || contract === "milestone" && side !== "over") {
                  unqualifiedQuotes.push(json({ ...raw, contractStatus: "unresolved_legacy_contract", meaning: "The bounded source did not store this leg's exact ordinary/milestone declaration. Retained as raw context only; do not pair it or infer an event from current/nearest-line offers." }));
                  continue;
                }
                const q = { ...raw, offerContract: contract, side: contract === "milestone" ? "yes" as const : side };
                if (instant(q.observedAt) > instant(q.receivedAt)) continue;
                const key = digest(q); quotes.set(key, { ...q, id: key });
              }
            }
          }
        }
        for (const row of playerRows) {
          if (!Number.isFinite(row.odds) || Math.abs(row.odds) < 100 || instant(row.lastUpdated) > instant(snapshot.asOfTimestamp)) continue;
          const contract = explicitContract(row.offerContract);
          const raw = { playerId: id, market: row.market, provider: "stored_member_quote", book: bookKey(row.book), line: row.line, side: row.side, american: row.odds, observedAt: row.lastUpdated, receivedAt: snapshot.asOfTimestamp, receivedAtProvenance: "snapshot_availability" as const, live: false };
          if (!contract || contract === "milestone" && row.side !== "over") {
            unqualifiedQuotes.push(json({ ...raw, contractStatus: "unresolved_legacy_contract", meaning: "The original member row did not declare a usable exact contract. Retained unchanged as raw context; do not assume an ordinary event or pair it." }));
            continue;
          }
          const q = { ...raw, offerContract: contract, side: contract === "milestone" ? "yes" as const : row.side };
          const key = digest(q); quotes.set(key, { ...q, id: key });
        }
        if (unqualifiedQuotes.length) evidence.push({ id: `${id}:unqualified-legacy-quotes`, kind: "market", availableAt: snapshot.asOfTimestamp,
          source: "original MLB quote values with unresolved legacy event contracts; raw context only", value: { contractStatus: "unresolved_legacy_contract", quotes: unqualifiedQuotes, meaning: "These source values and clocks are retained, but no ordinary/milestone event or paired-price comparison is established. Existing stored source and lock payloads are unchanged." } });
        missing.push("qualified joint outcome law not attached");
        const seen = new Set<string>(), uniqueEvidence = evidence.filter(e => { const key = digest({ kind: e.kind, availableAt: e.availableAt, source: e.source, value: e.value }); if (seen.has(key)) return false; seen.add(key); return true; });
        return { id, name: first.player, team: first.team, opponent: first.opponent, markets: [...new Set(playerRows.map(r => r.market))].sort(), evidence: uniqueEvidence, missing: [...new Set(missing)] };
      });
      packets.push({ release: PRODUCT_RELEASE, sport: "mlb", gameId, start, lock, stage: slot.stage, cutoff: slot.at, players,
        quotes: [...quotes.values()].map((q, i) => ({ ...q, id: `q${i}` })), sourceLimitations: ["immutable historical pre-lock snapshot; offline cost/research only", "opening/current bounded named-book evidence, not every market tick", "retrospective AI accuracy may be contaminated by outcome knowledge; prospective validation required", "source model release retained; releases must not be blended in accuracy reports"] });
    }
  }
  return packets;
}
