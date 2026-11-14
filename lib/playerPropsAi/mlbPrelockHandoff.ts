/** Materialize and durably publish the actual ready MLB game before waiting on
 * unrelated games. The existing leased writer supplies the sole publisher.
 * No review, quote, clock or stored lock is reconstructed here. */
import assert from "node:assert/strict";
import type { PlayerPropPreviewRow as Row } from "../../app/mlb/props/components/PlayerPropsDashboard";
import type { GamePacket } from "./evidenceContract";
import type { AcceptedGameReview } from "./reviewer";
import { digest, instant, validatePacket } from "./evidence";
import { criticalContextHashes } from "./criticalContext";
import { executionQuotes, quoteBook, quoteContract } from "./executionQuotes";
import { playerParticipationEligibility } from "./participationEligibility";
import { siteAiDecisions } from "./publication";
import { applyMlbSiteAi } from "./siteBindings";
import { propsTeam } from "./teamIdentity";
import { MlbPropsPublicationUncertainError } from "../mlb/props/aiPublicationPolicy";
export { MLB_PROPS_AI_HANDOFF_RELEASE, MlbPropsPublicationUncertainError } from "../mlb/props/aiPublicationPolicy";
type Publisher = (rows: Row[], gameId: string) => Promise<void>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const actor = (row: Row) => row.providerIds?.mlbStatsPlayerId ?? `bdl:${row.providerIds?.bdlPlayerId}`;

function create(nativeRows: readonly Row[], publish: Publisher, clock: () => string) {
  const baseline = clone([...nativeRows]);
  let rows = clone([...nativeRows]), queue: Promise<void> = Promise.resolve();
  let published = false;
  // A rejection may follow a committed canonical row or publication index.
  // Do not let any later callback or final whole-board write reuse stale rows.
  // This boolean also fences null/undefined rejection reasons.
  let publicationFailed = false;
  const assertPublicationAvailable = () => {
    if (publicationFailed) throw new MlbPropsPublicationUncertainError();
  };
  const signatures = new Map<string, string>();
  return {
    rows: () => { assertPublicationAvailable(); return clone(rows); },
    observe(packet: GamePacket, review: AcceptedGameReview | null, lookupAvailable: boolean): Promise<void> {
      // Own immutable inputs at the callback boundary. Numeric readiness is
      // sampled below, after any earlier same-writer publication has drained.
      const source = clone(packet), accepted = review ? clone(review) : null;
      const work = queue.then(async () => {
        assertPublicationAvailable();
        const readyAt = clock();
        if (instant(readyAt) >= instant(source.lock)) return;
        validatePacket(source); assert.equal(source.sport, "mlb");
        const gameId = source.sourceGameId ?? source.gameId;
        assert(instant(source.cutoff) <= instant(readyAt), "MLB source unavailable at actual readiness");
        const current = executionQuotes(source, readyAt);
        const signature = digest({ contexts: criticalContextHashes(source),
          actors: source.players.map(p => ({ id: p.id, markets: p.markets, sourceEvents: p.sourceEventContracts ?? null, participation: playerParticipationEligibility(source, p) })),
          quotes: current, lookupAvailable,
          review: accepted ? { release: accepted.release, inputHash: accepted.inputHash ?? accepted.inputEvidence.digest, issuedAt: accepted.issuedAt, stage: accepted.stage } : null });
        if (signatures.get(gameId) === signature) return;
        const native = baseline.filter(row => row.providerIds?.gameId === gameId).map(row => {
          if (row.lockStatus?.status === "locked") return row;
          assert(instant(row.gameStartTime) === instant(source.start), "MLB handoff fixture clock changed");
          // An omitted/withdrawn current offer cannot revive a native actionable
          // price from this invocation's earlier construction. Recovery uses
          // exactly the same native/AI qualification once the offer returns.
          const executable = current.some(q => q.playerId === actor(row) && q.market === row.market && q.line === row.line
            && quoteBook(q.book) === quoteBook(row.book) && q.american === row.odds
            && (q.side === "yes" ? "over" : q.side) === row.side && quoteContract(q) === (row.offerContract ?? "two_way"));
          const player=source.players.find(p=>p.id===actor(row)&&p.markets.includes(row.market)&&propsTeam(p.team)===propsTeam(row.team)&&propsTeam(p.opponent)===propsTeam(row.opponent));
          const blocked=player&&playerParticipationEligibility(source,player).blocked;
          return executable&&!blocked ? row : { ...row, playGrade: "NO_PLAY" as const, units: 0,
            reasonCodes: [...new Set([...(row.reasonCodes ?? []), ...(blocked?["SOURCE_PARTICIPATION_UNAVAILABLE_NATIVE_FALLBACK"]:[]), ...(!executable?["CURRENT_EXECUTION_UNAVAILABLE_NATIVE_FALLBACK"]:[])])] };
        });
        const choices = lookupAvailable && accepted ? siteAiDecisions(source, accepted, readyAt) : [];
        const gameRows = applyMlbSiteAi(native, source, choices, readyAt);
        // The first full native materialization already includes every game.
        // Identical later source callbacks do not need another whole-board DB
        // publication; actual scope/context fallback changes still publish.
        if (published && digest(rows.filter(row => row.providerIds?.gameId === gameId)) === digest(gameRows)) {
          signatures.set(gameId, signature); return;
        }
        const next = rows.map(row => row.providerIds?.gameId === gameId && row.lockStatus?.status !== "locked"
          ? gameRows.find(candidate => candidate.id === row.id || actor(candidate) === actor(row) && candidate.market === row.market
            && candidate.line === row.line && quoteBook(candidate.book) === quoteBook(row.book) && candidate.side === row.side
            && (candidate.offerContract ?? "two_way") === (row.offerContract ?? "two_way")) ?? row : row);
        // Clone the full actual materialization. The publisher must sample its
        // own real publication time and run all ordinary publication gates.
        try {
          await publish(clone(next), gameId);
        } catch {
          publicationFailed = true;
          throw new MlbPropsPublicationUncertainError();
        }
        rows = next; published = true; signatures.set(gameId, signature);
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
}
export function createMlbPrelockHandoff(nativeRows: readonly Row[], publish: Publisher) {
  assert.equal(arguments.length, 2, "Production MLB handoff rejects supplied clocks");
  return create(nativeRows, publish, () => new Date().toISOString());
}
export function testMlbPrelockHandoff(nativeRows: readonly Row[], publish: Publisher, clock: () => string) {
  assert.equal(process.env.NODE_ENV, "test", "Injected MLB clocks are offline-test only");
  return create(nativeRows, publish, clock);
}
