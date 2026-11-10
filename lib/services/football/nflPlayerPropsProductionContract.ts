import {digest} from "../../playerPropsAi/evidence";
import {prepareNflLockHandoff,type NflLockHandoff} from "../../playerPropsAi/nflLockAuthority";
import {PROPS_AI_SOURCE_EVENT_RELEASE} from "../../playerPropsAi/sourceEvents";
import {PROPS_AI_NFL_EXACT_RECEIPT_RELEASES} from "../../playerPropsAi/releases";
import {propsTeam} from "../../playerPropsAi/teamIdentity";
import {
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsRuntimeBoard,
  type NflPlayerPropsRuntimeDecision,
} from "./nflPlayerPropsRuntime";
import {
  mergeNflPlayerPropsMarketEvidenceCaptures,
  subsetNflPlayerPropsMarketEvidenceCapture,
  withoutUnretainedNflPlayerPropsEvidenceReference,
  type NflPlayerPropsMarketEvidenceCapture,
} from "./nflPlayerPropsMarketEvidenceCapture";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { selectNflPlayerPropsCanonicalLines } from "./nflPlayerPropsCanonicalLine";
import { withoutUnresolvedNflPlayerAliasDuplicates } from "./nflPlayerPropsMemberAliasIdentity";

export const NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE =
  "nfl_player_props_member_2026_11_10_r60_current_execution_authority" as const;
export const NFL_PLAYER_PROPS_MEMBER_LIFECYCLE_RELEASE =
  "nfl_player_props_member_lifecycle_2026_11_10_r42_current_execution_authority" as const;
const NFL_PLAYER_PROPS_PRECEDING_DECISION_RELEASE =
  "nfl_player_props_decision_2026_10_27_r38_passing_yards_direction" as const;
export const NFL_PLAYER_PROPS_BOARD_ROLLOVER_HOUR_ET = 2 as const;
export const NFL_PLAYER_PROPS_WRITER_LEASE_GROUP = "prediction_pipeline:nfl" as const;

export type NflPlayerPropsProductionSnapshot = {
  release: typeof NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE;
  season: number; week: number; generatedAt: string;
  writerLeaseGroup: typeof NFL_PLAYER_PROPS_WRITER_LEASE_GROUP;
  publicationEligible: true; trackingEligible: true; riskLabel: "forward_monitoring_2025_exact_price_confirmation";
  /** Private append-only construction proof; member DTOs expose no source frames. */
  lockHandoffEvidence?:Record<string,{release:string;at:string;capture:Omit<NflLockHandoff,"nativeRows">}>;
  board: Omit<NflPlayerPropsRuntimeBoard, "publicationEnabled" | "trackingEnabled"> & {
    publicationEnabled: true;
    trackingEnabled: true;
  };
  memberDecisions: NflPlayerPropsRuntimeDecision[];
  lifecycle: {
    recomputedUnlocked: number;
    retainedStillFreshUnlocked: number;
    frozenAtLock: number;
    retainedPreviouslyLocked: number;
    reviewAuthority?:{qualifiedAi:number;nativeBaseline:number;unavailable:number};
  };
};

export type NflPlayerPropsMemberGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type NflPlayerPropsStoredMemberDecision = NflPlayerPropsRuntimeDecision & { grade: NflPlayerPropsMemberGrade };
export type NflPlayerPropsMemberDecision = NflPlayerPropsStoredMemberDecision;
export type NflPlayerPropsMemberSnapshot = {
  lifecycleRelease: typeof NFL_PLAYER_PROPS_MEMBER_LIFECYCLE_RELEASE;
  season: number; week: number; generatedAt: string;
  board: {
    evaluatedAt: string;
    counts: Record<NflPlayerPropsMemberGrade, number> & { actionable: number };
    marketEvidence?: NflPlayerPropsMarketEvidenceCapture;
    diagnostics: Pick<NflPlayerPropsRuntimeBoard["diagnostics"],
      "inputOffers" | "completedEvaluations" | "completeExactOffers" | "incompleteExactOffers"
      | "unavailableNoIndependentBenchmark" | "unavailableStaleQuotes" | "unavailableFeatureContext">;
  };
  memberDecisions: NflPlayerPropsMemberDecision[];
};

export function deriveNflPlayerPropsMemberDecisions(
  board: Pick<NflPlayerPropsRuntimeBoard, "decisions">,
): NflPlayerPropsStoredMemberDecision[] {
  return withoutUnresolvedNflPlayerAliasDuplicates(board.decisions).map((row): NflPlayerPropsStoredMemberDecision => {
    if (row.grade === "Held") return { ...row, grade: "No Play" };
    return row as NflPlayerPropsStoredMemberDecision;
  });
}

export type NflPlayerPropsTrackedDecision = {
  trackingKey: string; gameId: string; providerPlayerId: string | null; playerName: string; market: string; line: number;
  side: NflPlayerPropsRuntimeDecision["side"]; sportsbook: string; lockedPrice: number;
  lockedProbability: number; lockedExpectedValue: number; grade: "Best Angle" | "Lean";
  lockedAt: string; result: "pending" | "win" | "loss" | "push";
  closingPrice: number | null; closingImpliedProbability: number | null; clvProbabilityPoints: number | null;
  modelRelease: string; calibrationRelease: string; decisionRelease: string;
};

export function reconcileNflPlayerPropsProductionSnapshot(args: {
  season: number; week: number; evaluatedAt: string;
  nextBoard: NflPlayerPropsRuntimeBoard;
  requireVerifiedInterceptionSource?:boolean;
  previous?: NflPlayerPropsProductionSnapshot | null;
  lockHandoff?:NflLockHandoff;
}): NflPlayerPropsProductionSnapshot {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props production evaluatedAt is invalid.");
  const originalPrevious=args.previous;
  // Stored public locks are protected before optional forward metadata is read.
  const storedLocks=[...(originalPrevious?.board.decisions??[]),...(originalPrevious?.memberDecisions??[])].filter(row=>row.state==="locked");
  const storedScopes=new Set(storedLocks.map(outcomeScopeKey));
  const currentUnlocked=args.nextBoard.decisions.filter(row=>!storedScopes.has(outcomeScopeKey(row)));
  const fullyProtectedGames=new Set(storedLocks.map(row=>row.gameId).filter(game=>!currentUnlocked.some(row=>row.gameId===game)));
  const actorKey=(row:NflPlayerPropsRuntimeDecision)=>JSON.stringify([row.gameId,row.providerPlayerId]);
  const fullyProtectedActors=new Set(storedLocks.filter(row=>row.providerPlayerId!==null).map(actorKey).filter(key=>!currentUnlocked.some(row=>actorKey(row)===key)));
  const irrelevant=(game:string,actorId?:string)=>fullyProtectedGames.has(game)||Boolean(actorId&&fullyProtectedActors.has(JSON.stringify([game,actorId.replace(/^nfl-bdl-player:/,"")])));
  const effective=args.lockHandoff?{...args.lockHandoff,authorities:args.lockHandoff.authorities.filter(a=>!irrelevant(a.gameId,a.actorId)),nativeRows:args.lockHandoff.nativeRows.filter(row=>!storedScopes.has(outcomeScopeKey(row))),nativeProofs:args.lockHandoff.nativeProofs.filter(p=>!irrelevant(p.gameId,p.actorId)),candidateProofs:args.lockHandoff.candidateProofs.filter(p=>!irrelevant(p.gameId,p.actorId)),sourceFrames:(args.lockHandoff.sourceFrames??[]).filter(f=>!fullyProtectedGames.has(f.gameId)),executionAuthorities:(args.lockHandoff.executionAuthorities??[]).filter(f=>!fullyProtectedGames.has(f.gameId))}:undefined;
  const handoff=effective?prepareNflLockHandoff({...effective,nextRows:currentUnlocked,previousRows:originalPrevious?.board.decisions??[],previousGeneratedAt:originalPrevious?.generatedAt,now:args.evaluatedAt}):null;
  const maySuppress=(row:NflPlayerPropsRuntimeDecision)=>!storedScopes.has(outcomeScopeKey(row))&&Boolean(handoff?.suppressPrevious(row));
  const previous=handoff&&originalPrevious?{...originalPrevious,board:{...originalPrevious.board,decisions:originalPrevious.board.decisions.filter(row=>!maySuppress(row))},memberDecisions:originalPrevious.memberDecisions.filter(row=>!maySuppress(row))}:originalPrevious;
  const nextBoard=handoff?{...args.nextBoard,decisions:handoff.nextRows}:args.nextBoard;
  const priorRows=previous?.board.decisions??[];
  const canRetainUnlocked=(row:NflPlayerPropsRuntimeDecision)=>!args.requireVerifiedInterceptionSource||row.market!=="interceptions"||!row.aiReview||row.aiReview.sourceEventRelease===PROPS_AI_SOURCE_EVENT_RELEASE&&row.aiReview.sourceEventStatistic==="interceptions";
  const priorLocked=priorRows.filter(row=>row.state==="locked");
  const protectedScopes=new Set([
    ...priorLocked.map(outcomeScopeKey),
    ...(previous?.memberDecisions??[]).filter(row=>row.state==="locked").map(outcomeScopeKey),
  ]);
  // Exact stored member fields are the public authority, even if their legacy
  // board projection differs. Never reconstruct them from a current model.
  const priorLockedMembers=(previous?.memberDecisions??[])
    .filter(row=>row.state==="locked"||protectedScopes.has(outcomeScopeKey(row)));
  const priorAi=new Map<string,NflPlayerPropsRuntimeDecision[]>();
  for(const row of priorRows)if(row.aiReview&&row.state!=="locked"&&canRetainUnlocked(row)){
    const key=quoteScopeKey(row);const list=priorAi.get(key)??[];list.push(row);priorAi.set(key,list);
  }
  let frozenAtLock = 0;
  const retainedPreviouslyLocked = priorLocked.length;
  let retainedStillFreshUnlocked = 0;
  let recomputedUnlocked = 0;
  // Preserve every legacy locked book and its original field values/order.
  const decisions:NflPlayerPropsRuntimeDecision[]=[...priorLocked];
  for(const next of nextBoard.decisions){
    if(protectedScopes.has(outcomeScopeKey(next))||!canRetainUnlocked(next))continue;
    if(evaluatedAt>=Date.parse(next.lockAt)){
      const candidates=(priorAi.get(quoteScopeKey(next))??[]).filter(row=>
        (row.providerPlayerId!==null&&next.providerPlayerId!==null
          ?row.providerPlayerId===next.providerPlayerId
          :row.playerName.trim().toLowerCase()===next.playerName.trim().toLowerCase())&&isFreshAtLock(row));
      const ids=new Set(candidates.map(row=>row.providerPlayerId).filter(Boolean));
      const prior=ids.size<=1?[...candidates].sort((a,b)=>Date.parse(b.aiReview!.quoteConfirmedAt)-Date.parse(a.aiReview!.quoteConfirmedAt))[0]:undefined;
      // An AI lock may use only its exact book/provider/event, never the last
      // sportsbook encountered for a different quote in the same market.
      decisions.push({...(prior??next),state:"locked"});frozenAtLock++;
    }else{decisions.push(next);recomputedUnlocked++;}
  }
  const nextKeys = new Set(decisions.map(offerKey));
  const nextOutcomeScopes = new Set(nextBoard.decisions.map(outcomeScopeKey));
  for (const prior of priorRows) {
    if(prior.state==="locked"||protectedScopes.has(outcomeScopeKey(prior))||!canRetainUnlocked(prior))continue;
    if (!nextKeys.has(offerKey(prior)) && evaluatedAt >= Date.parse(prior.lockAt)
      && isFreshAtLock(prior)) {
      decisions.push({ ...prior, state: "locked" as const });
      frozenAtLock += 1;
    } else if (!nextKeys.has(offerKey(prior))
      && !nextOutcomeScopes.has(outcomeScopeKey(prior))
      && prior.state === "unlocked"
      && evaluatedAt < Date.parse(prior.lockAt)
      && evaluatedAt < Date.parse(prior.scheduledStart)
      && isFreshAt(prior, evaluatedAt)) {
      // A provider request can succeed with only part of the scheduled slate.
      // Preserve a missing outcome only while its exact quote remains inside
      // the existing production freshness window. A current row in the same
      // game/player/market/side scope always wins, including a changed line.
      const retained = releaseCoherentRetainedUnlockedDecision(prior);
      if (retained) {
        decisions.push(retained);
        retainedStillFreshUnlocked += 1;
      }
    }
  }
  const mergedEvidence = mergeNflPlayerPropsMarketEvidenceCaptures({
    current: nextBoard.marketEvidence,
    previous: previous?.board.marketEvidence,
    decisions,
  });
  const capturedDecisions = mergedEvidence.capture
    ? decisions.map((row) => row.state==="locked"&&priorLocked.includes(row)?row:withoutUnretainedNflPlayerPropsEvidenceReference(row, mergedEvidence.retainedIds))
    : decisions;
  const board = {
    ...nextBoard,
    publicationEnabled: true as const,
    trackingEnabled: true as const,
    decisions: capturedDecisions,
    counts: recount(capturedDecisions),
    diagnostics: recountOperationalDiagnostics(nextBoard.diagnostics, capturedDecisions),
    ...(mergedEvidence.capture ? { marketEvidence: mergedEvidence.capture } : {}),
  };
  const derivedMemberDecisions = deriveNflPlayerPropsMemberDecisions(board);
  const canonicalCurrentDecisions = selectNflPlayerPropsCanonicalLines(
    derivedMemberDecisions.filter(row=>!protectedScopes.has(outcomeScopeKey(row))),
  );
  const selectedMemberKeys=new Set(canonicalCurrentDecisions.map(decisionKey));
  const lockHandoffEvidence={...(originalPrevious?.lockHandoffEvidence??{})};
  if(effective){
    const games=new Set([...capturedDecisions.filter(row=>row.state==="locked"&&!protectedScopes.has(outcomeScopeKey(row))).map(row=>row.gameId),...(effective.sourceFrames??[]).filter(f=>Date.parse(f.lockAt)<=evaluatedAt).map(f=>f.gameId)]);
    const capture:Omit<NflLockHandoff,"nativeRows">={authorities:effective.authorities.filter(a=>games.has(a.gameId)),nativeProofs:effective.nativeProofs.filter(p=>games.has(p.gameId)),candidateProofs:effective.candidateProofs.filter(p=>games.has(p.gameId)),sourceFrames:(effective.sourceFrames??[]).filter(f=>games.has(f.gameId)),executionAuthorities:(effective.executionAuthorities??[]).filter(f=>games.has(f.gameId))};
    if(capture.sourceFrames?.length){const record={release:"nfl_props_lock_authority_2026_11_10_r2_current_execution",at:args.evaluatedAt,capture};lockHandoffEvidence[digest(record)]??=record;}
  }
  return {
    release: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE, season: args.season, week: args.week,
    generatedAt: new Date(evaluatedAt).toISOString(), writerLeaseGroup: NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
    publicationEligible: true, trackingEligible: true, riskLabel: "forward_monitoring_2025_exact_price_confirmation",
    board,
    ...(Object.keys(lockHandoffEvidence).length?{lockHandoffEvidence}:{}),
    // Internal alternate ladders and operational exceptions remain auditable
    // on the stored board. The member DTO selects one main line for every new
    // scope while preserving every previously locked member row exactly.
    memberDecisions: [...priorLockedMembers,...derivedMemberDecisions.filter(row=>!protectedScopes.has(outcomeScopeKey(row))&&selectedMemberKeys.has(decisionKey(row)))],
    lifecycle: { recomputedUnlocked, retainedStillFreshUnlocked, frozenAtLock, retainedPreviouslyLocked,...(handoff?{reviewAuthority:{qualifiedAi:handoff.diagnostics.filter(d=>d.kind==="qualified_ai").length,nativeBaseline:handoff.diagnostics.filter(d=>d.kind==="native_baseline").length,unavailable:handoff.diagnostics.filter(d=>d.kind==="unavailable").length}}:{}) },
  };
}

function releaseCoherentRetainedUnlockedDecision(
  prior: NflPlayerPropsRuntimeDecision,
): NflPlayerPropsRuntimeDecision | null {
  if (prior.decisionRelease === NFL_PLAYER_PROPS_DECISION_RELEASE) return prior;
  if (prior.decisionRelease !== NFL_PLAYER_PROPS_PRECEDING_DECISION_RELEASE) return null;
  // The Owls source release advances the ordinary forecast family.
  // Only the behavior-identical Anytime TD market may bridge one
  // still-fresh partial provider cycle. Ordinary rows must be freshly
  // recomputed rather than relabeled under a release that did not score them.
  if (prior.market !== "anytime_td") return null;
  return {
    ...prior,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
  };
}

export function buildNflPlayerPropsTrackingRows(snapshot: NflPlayerPropsProductionSnapshot): NflPlayerPropsTrackedDecision[] {
  return buildNflPlayerPropsTrackingEntries(snapshot).map(entry => entry.row);
}

/** Retain the exact source quote beside each derived tracking row. A player/line
 * key deliberately spans books and cannot bind a locked price to its evidence. */
export function buildNflPlayerPropsTrackingEntries(snapshot: NflPlayerPropsProductionSnapshot): Array<{
  decision: NflPlayerPropsRuntimeDecision;
  row: NflPlayerPropsTrackedDecision;
}> {
  return snapshot.board.decisions.filter((row): row is NflPlayerPropsRuntimeDecision & { grade: "Best Angle" | "Lean" } =>
    row.state === "locked" && (row.grade === "Best Angle" || row.grade === "Lean"))
    .map((row) => ({ decision: row, row: {
      trackingKey: decisionKey(row), gameId: row.gameId, providerPlayerId: row.providerPlayerId, playerName: row.playerName, market: row.market,
      line: row.line, side: row.side, sportsbook: row.sportsbook, lockedPrice: row.americanPrice,
      lockedProbability: row.finalProbability, lockedExpectedValue: row.expectedValue, grade: row.grade,
      lockedAt: row.lockAt, result: "pending", closingPrice: null, closingImpliedProbability: null,
      clvProbabilityPoints: null, modelRelease: row.modelRelease, calibrationRelease: row.calibrationRelease,
      decisionRelease: row.decisionRelease,
    } }));
}

export function buildNflPlayerPropsMemberSnapshot(
  snapshot: NflPlayerPropsProductionSnapshot,
  asOf = snapshot.generatedAt,
): NflPlayerPropsMemberSnapshot {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error("NFL props member snapshot asOf is invalid.");
  const boardDate = currentNflPlayerPropsBoardDate(new Date(asOfMs));
  const eligibleMemberDecisions = withoutUnresolvedNflPlayerAliasDuplicates(snapshot.memberDecisions)
    .filter(isMemberDecision)
    .filter((row) => {
      try {
        return computeSlateDate("nfl", row.scheduledStart) >= boardDate;
      } catch {
        return false;
      }
    });
  const memberEvidence = subsetNflPlayerPropsMarketEvidenceCapture({
    capture: snapshot.board.marketEvidence,
    decisions: eligibleMemberDecisions,
  });
  const memberDecisions = memberEvidence.capture
    ? eligibleMemberDecisions.map((row) => row.state==="locked"?row:withoutUnretainedNflPlayerPropsEvidenceReference(row, memberEvidence.retainedIds))
    : eligibleMemberDecisions;
  const count = (grade: NflPlayerPropsMemberGrade) => memberDecisions.filter((row) => row.grade === grade).length;
  const diagnostics = snapshot.board.diagnostics;
  return {
    lifecycleRelease: NFL_PLAYER_PROPS_MEMBER_LIFECYCLE_RELEASE,
    season: snapshot.season,
    week: snapshot.week,
    generatedAt: snapshot.generatedAt,
    board: {
      evaluatedAt: snapshot.board.evaluatedAt,
      counts: {
        "Best Angle": count("Best Angle"),
        Lean: count("Lean"),
        Watchlist: count("Watchlist"),
        "No Play": count("No Play"),
        actionable: count("Best Angle") + count("Lean"),
      },
      ...(memberEvidence.capture ? { marketEvidence: memberEvidence.capture } : {}),
      diagnostics: {
        inputOffers: diagnostics.inputOffers,
        completedEvaluations: memberDecisions.length,
        completeExactOffers: diagnostics.completeExactOffers,
        incompleteExactOffers: diagnostics.incompleteExactOffers,
        unavailableNoIndependentBenchmark: diagnostics.unavailableNoIndependentBenchmark,
        unavailableStaleQuotes: diagnostics.unavailableStaleQuotes,
        unavailableFeatureContext: diagnostics.unavailableFeatureContext,
      },
    },
    memberDecisions,
  };
}

export function currentNflPlayerPropsBoardDate(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("NFL props member board date is invalid.");
  const hourEt = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  const todayEt = computeSlateDate("nfl", now);
  return hourEt < NFL_PLAYER_PROPS_BOARD_ROLLOVER_HOUR_ET ? addDaysToSlate(todayEt, -1) : todayEt;
}

export function attachNflPlayerPropsClosingPrice(
  tracked: NflPlayerPropsTrackedDecision,
  closingPrice: number,
): NflPlayerPropsTrackedDecision {
  if (!Number.isInteger(closingPrice) || closingPrice === 0) throw new Error("NFL props closing price is invalid.");
  const closingImpliedProbability = implied(closingPrice);
  return {
    ...tracked, closingPrice, closingImpliedProbability,
    clvProbabilityPoints: 100 * (closingImpliedProbability - implied(tracked.lockedPrice)),
  };
}

function recount(rows: NflPlayerPropsRuntimeDecision[]): NflPlayerPropsRuntimeBoard["counts"] {
  const count = (grade: NflPlayerPropsRuntimeDecision["grade"]) => rows.filter((row) => row.grade === grade).length;
  return { "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"), "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean") };
}
function recountOperationalDiagnostics(
  diagnostics: NflPlayerPropsRuntimeBoard["diagnostics"],
  rows: NflPlayerPropsRuntimeDecision[],
): NflPlayerPropsRuntimeBoard["diagnostics"] {
  const operationalExceptions = rows.filter((row) => row.grade === "Held");
  return {
    ...diagnostics,
    completedEvaluations: rows.length - operationalExceptions.length,
    operationalExceptions: operationalExceptions.length,
    recoveryEligibleOperationalExceptions: operationalExceptions.filter((row) => row.state === "unlocked").length,
    roleOrIdentityHeld: operationalExceptions.length,
  };
}
function isMemberDecision(row: NflPlayerPropsRuntimeDecision): row is NflPlayerPropsMemberDecision {
  return row.grade === "Best Angle" || row.grade === "Lean" || row.grade === "Watchlist" || row.grade === "No Play";
}
function offerKey(row:NflPlayerPropsRuntimeDecision):string{
  return JSON.stringify([decisionKey(row),row.sportsbook.toLowerCase().replace(/[^a-z0-9]/g,""),row.provider]);
}
function quoteScopeKey(row:NflPlayerPropsRuntimeDecision):string{
  return JSON.stringify([row.gameId,propsTeam(row.team),propsTeam(row.opponent),Date.parse(row.scheduledStart),Date.parse(row.lockAt),
    row.market,row.line,row.side,row.sportsbook.toLowerCase().replace(/[^a-z0-9]/g,""),row.provider]);
}
function decisionKey(row: NflPlayerPropsRuntimeDecision): string {
  return [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.line, row.side].join("|");
}
function outcomeScopeKey(row: NflPlayerPropsRuntimeDecision): string {
  return [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.side].join("|");
}
function isFreshAt(row: NflPlayerPropsRuntimeDecision, evaluatedAt: number): boolean {
  const age = evaluatedAt - Date.parse(row.observedAt);
  return Number.isFinite(age) && age >= 0
    && age <= nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours * 3_600_000;
}
function isFreshAtLock(row: NflPlayerPropsRuntimeDecision): boolean {
  const age = Date.parse(row.lockAt) - Date.parse(row.aiReview&&(row.aiReview.selectedSide===row.side||PROPS_AI_NFL_EXACT_RECEIPT_RELEASES.includes(row.decisionRelease))?row.aiReview.quoteConfirmedAt:row.observedAt);
  return Number.isFinite(age) && age >= 0
    && age <= nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours * 3_600_000;
}
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
