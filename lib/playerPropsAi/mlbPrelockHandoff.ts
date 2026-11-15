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
export type MlbPrelockAuthority = Readonly<{knownGameIds: readonly string[];heldGameIds: readonly string[];omittedUnlockedRows: number}>;
type Publisher = (rows: Row[], gameId: string, authority: MlbPrelockAuthority) => Promise<void>;
export type MlbPrelockHandoffOptions = {slateDate: string; games: readonly {gameId: string; start: string}[];
  previousSnapshot: {slateDate: string; snapshotId: string; asOfTimestamp: string; data: {props: readonly Row[]}} | null};
/** Unknown reads are not unknown writes. Both stop unsafe generic fallback,
 * while a later authoritative same-game callback may recover a read hold. */
export class MlbPropsReviewAuthorityUnavailableError extends MlbPropsPublicationUncertainError {
  readonly heldGameCount: number;
  readonly omittedUnlockedRows: number;
  constructor(authority?: MlbPrelockAuthority) {
    super(); this.name = "MlbPropsReviewAuthorityUnavailableError";
    this.message = "MLB review/source authority unavailable; preserve acknowledged sources without native replacement.";
    this.heldGameCount = authority?.heldGameIds.length ?? 0;
    this.omittedUnlockedRows = authority?.omittedUnlockedRows ?? 0;
  }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const actor = (row: Row) => row.providerIds?.mlbStatsPlayerId ?? `bdl:${row.providerIds?.bdlPlayerId}`;
/** Trust boundary: only the existing writer may supply this pair after reading
 * the actual stored lock inventory and exact original display sources. Clocks
 * or a caller-supplied row flag alone cannot construct this authority. */
export type MlbStoredLockAuthority = Readonly<{lockTimes: readonly (readonly [string,string])[]; rows: readonly Row[]; rowDigests: readonly string[]}>;
export function applyMlbStoredLockAuthority(current: readonly Row[], authority: MlbStoredLockAuthority): Row[] {
  const locks = new Map<string,string>();
  for (const [id,at] of authority.lockTimes) {
    assert(typeof id === "string" && id && typeof at === "string" && Number.isFinite(instant(at)), "MLB stored lock identity unavailable");
    assert(!locks.has(id) || instant(locks.get(id)!) === instant(at), "MLB stored lock clocks conflict");
    locks.set(id,at);
  }
  const originals = new Map<string,Row[]>();
  assert(authority.rows.length === authority.rowDigests.length, "MLB original stored lock inventory unavailable");
  for (const [index,row] of authority.rows.entries()) {
    const id = row.providerIds?.gameId;
    // The existing reader preserves an already-locked opaque legacy clock.
    // Bind its exact original row instead of reinterpreting that public field.
    assert(id && locks.has(id) && row.lockStatus?.status === "locked"
      && digest(row) === authority.rowDigests[index], "MLB stored lock row binding unavailable");
    originals.set(id,[...(originals.get(id) ?? []),clone(row)]);
  }
  for (const id of locks.keys()) assert(originals.get(id)?.length, "MLB original stored lock rows unavailable");
  const replacements = new Map<string,Row[]>();
  for (const [id,incoming] of originals) {
    const old = current.filter(row => row.providerIds?.gameId === id && row.lockStatus?.status === "locked");
    const received = new Map<string,number>(); for (const row of incoming) received.set(digest(row),(received.get(digest(row)) ?? 0)+1);
    const kept = new Map<string,number>(); for (const row of old) {const hash=digest(row);assert(received.has(hash),"MLB stored locked payload conflicts");kept.set(hash,(kept.get(hash) ?? 0)+1);}
    const replacement = clone(old);
    for (const row of incoming) {const hash=digest(row),n=kept.get(hash) ?? 0;if(n){kept.set(hash,n-1);}else replacement.push(row);}
    replacements.set(id,replacement);
  }
  const inserted = new Set<string>();
  const result = current.flatMap(row => {const id=row.providerIds?.gameId;if(!id||!replacements.has(id))return[clone(row)];if(inserted.has(id))return[];inserted.add(id);return clone(replacements.get(id)!);});
  for (const [id,rows] of replacements) if(!inserted.has(id))result.push(...clone(rows));
  return result;
}


function create(nativeRows: readonly Row[], publish: Publisher, clock: () => string, options?: MlbPrelockHandoffOptions) {
  const baseline = clone([...nativeRows]);
  const windows = new Map<string,string>();
  for (const game of options?.games ?? baseline.flatMap(row => row.providerIds?.gameId ? [{gameId: row.providerIds.gameId, start: row.gameStartTime}] : [])) {
    assert(typeof game.gameId === "string" && game.gameId && Number.isFinite(instant(game.start)), "MLB expected game authority unavailable");
    const prior = windows.get(game.gameId); assert(!prior || instant(prior) === instant(game.start), "MLB expected game clock conflicts");
    windows.set(game.gameId, game.start);
  }
  const previous = options?.previousSnapshot;
  if (previous) {
    try {
      if (previous.slateDate !== options!.slateDate || !previous.snapshotId || !Array.isArray(previous.data?.props)
        || instant(previous.asOfTimestamp) > instant(clock())) throw new Error("Invalid acknowledged source");
    } catch { throw new MlbPropsReviewAuthorityUnavailableError(); }
  }
  // Previous rows are acknowledged canonical authority, not a newly generated
  // native forecast. New games remain private until their own known callback.
  let rows = previous ? clone([...previous.data.props]) : clone(baseline);
  if (previous) for (const gameId of windows.keys()) {
    if (!rows.some(row => row.providerIds?.gameId === gameId)) rows.push(...clone(baseline.filter(row => row.providerIds?.gameId === gameId)));
  }
  const known = new Set<string>();
  for (const gameId of windows.keys()) {
    const original = rows.filter(row => row.providerIds?.gameId === gameId);
    if (original.length && original.every(row => row.lockStatus?.status === "locked")) known.add(gameId);
  }
  let queue: Promise<void> = Promise.resolve(), published = false;
  let lastPublishedHash: string | null = null;
  // A rejected append/index may have committed remotely. This write fence is
  // sticky; a later successful read callback cannot clear it in this invocation.
  let publicationFailed = false;
  const assertPublicationAvailable = () => { if (publicationFailed) throw new MlbPropsPublicationUncertainError(); };
  const authority = (current = rows, admitted: ReadonlySet<string> = known): MlbPrelockAuthority => ({
    knownGameIds: [...admitted], heldGameIds: [...windows.keys()].filter(id => !admitted.has(id)),
    omittedUnlockedRows: current.filter(row => row.lockStatus?.status !== "locked" && !admitted.has(row.providerIds?.gameId ?? "")).length,
  });
  const publishableRows = (current: Row[], admitted: ReadonlySet<string>) => current.filter(row => row.lockStatus?.status === "locked" || admitted.has(row.providerIds?.gameId ?? ""));
  const signatures = new Map<string, string>();
  return {
    rows: () => { assertPublicationAvailable(); const state = authority(); if (state.heldGameIds.length) throw new MlbPropsReviewAuthorityUnavailableError(state); return clone(publishableRows(rows,known)); },
    authority: () => authority(),
    adoptStoredLocks: (original: MlbStoredLockAuthority) => {
      assertPublicationAvailable();
      const adopted=applyMlbStoredLockAuthority(rows,original);
      rows=adopted;
      for(const [id] of original.lockTimes) if(windows.has(id)) known.add(id);
    },
    holdSources: (gameIds: readonly string[]) => { for (const id of gameIds) if (windows.has(id)) known.delete(id); },
    observe(packet: GamePacket, review: AcceptedGameReview | null, lookupAvailable: boolean): Promise<void> {
      // Own immutable inputs at the callback boundary. Numeric readiness is
      // sampled below, after any earlier same-writer publication has drained.
      const source = clone(packet), accepted = review ? clone(review) : null;
      const work = queue.then(async () => {
        assertPublicationAvailable();
        const readyAt = clock();
        if (instant(readyAt) >= instant(source.lock)) return;
        const gameId = source.sourceGameId ?? source.gameId;
        try {
          validatePacket(source); assert.equal(source.sport, "mlb");
          assert(windows.has(gameId) && instant(windows.get(gameId)!) === instant(source.start), "MLB source fixture clock changed");
          assert(instant(source.cutoff) <= instant(readyAt), "MLB source unavailable at actual readiness");
        } catch (error) { known.delete(gameId); throw error; }
        if (!lookupAvailable) { known.delete(gameId); throw new MlbPropsReviewAuthorityUnavailableError(authority()); }
        const wasKnown = known.has(gameId);
        const current = executionQuotes(source, readyAt);
        const signature = digest({ contexts: criticalContextHashes(source),
          actors: source.players.map(p => ({ id: p.id, markets: p.markets, sourceEvents: p.sourceEventContracts ?? null, participation: playerParticipationEligibility(source, p) })),
          quotes: current, lookupAvailable,
          review: accepted ? { release: accepted.release, inputHash: accepted.inputHash ?? accepted.inputEvidence.digest, issuedAt: accepted.issuedAt, stage: accepted.stage } : null });
        if (wasKnown && signatures.get(gameId) === signature) return;
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
        const oldLocked = rows.filter(row => row.providerIds?.gameId === gameId && row.lockStatus?.status === "locked");
        const replacement = gameRows.filter(row => !oldLocked.some(old => old.id === row.id));
        let inserted = false;
        const next = rows.flatMap(row => {
          if (row.providerIds?.gameId !== gameId || row.lockStatus?.status === "locked") return [row];
          if (inserted) return [];
          inserted = true; return replacement;
        });
        if (!inserted) next.push(...replacement);
        const admitted = new Set(known); admitted.add(gameId);
        // Only same-invocation known sources and original already locked rows
        // enter a new asOf/index. Held old unlocked games remain privately
        // retained, never impersonated as fresh cutoff/first-lock authority.
        const publishRows = publishableRows(next,admitted), state = authority(next,admitted), hash = digest(publishRows);
        if (published && lastPublishedHash === hash) {
          rows = next; known.add(gameId); signatures.set(gameId,signature); return;
        }
        // Clone the full actual materialization. The publisher must sample its
        // own real publication time and run all ordinary publication gates.
        try {
          await publish(clone(publishRows), gameId, state);
        } catch {
          publicationFailed = true;
          throw new MlbPropsPublicationUncertainError();
        }
        rows = next; known.add(gameId); published = true; lastPublishedHash = hash; signatures.set(gameId, signature);
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
}
export function createMlbPrelockHandoff(nativeRows: readonly Row[], publish: Publisher, options?: MlbPrelockHandoffOptions) {
  assert(arguments.length <= 3 && (options === undefined || options !== null && typeof options === "object" && !Array.isArray(options)), "Production MLB handoff rejects supplied clocks");
  return create(nativeRows, publish, () => new Date().toISOString(), options);
}
export function testMlbPrelockHandoff(nativeRows: readonly Row[], publish: Publisher, clock: () => string, options?: MlbPrelockHandoffOptions) {
  assert.equal(process.env.NODE_ENV, "test", "Injected MLB clocks are offline-test only");
  return create(nativeRows, publish, clock, options);
}
