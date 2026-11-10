/** Public decision evidence only. Never expose the private compressed source packet. */
import type {AcceptedGameReview} from "./reviewer";
import type {Quote} from "./evidenceContract";
import type {PlayerParticipationEligibility} from "./participationEligibility";
export const NFL_NATIVE_QUALIFICATION_RELEASE='player_props_ai_nfl_native_qualification_2026_11_10_r1_original_baseline' as const;
export const NFL_NATIVE_TEMPLATE_UNAVAILABLE='Action qualification unavailable. This conditional estimate remains No Play.';
export type NflNativeQualification={release:typeof NFL_NATIVE_QUALIFICATION_RELEASE;reason:'native_player_context_unavailable';detail:typeof NFL_NATIVE_TEMPLATE_UNAVAILABLE;
 gameId:string;playerId:string;scheduledStart:string;lockAt:string;sourcePacketHash:string;nativeBaselineHash:string};
export const PROPS_AI_EXECUTION_EVIDENCE_RELEASE="player_props_ai_execution_evidence_2026_11_10_r1_exact_contract" as const;
/** Backend provenance for the exact decision-pricing call, not verified book terms. */
export type PropsAiExecutionEvidence={
  release:typeof PROPS_AI_EXECUTION_EVIDENCE_RELEASE;pricedAt:string;operation:'decision'|'member_row';
  selectedQuote:Quote;
  /** Decision: exact group supplied to priceAiLaw. Member row: current exact
   * contract group available to row repricing/grade; pair checks still apply. */
  pricingQuotes:Quote[];
};
type Area=AcceptedGameReview["players"][number]["coverage"][string];
export type PublicAiCoverage=Record<string,Omit<Area,"facts">&{facts:Pick<Area["facts"][number],"id"|"hash"|"label"|"availableAt"|"sourceIds">[]}>;
export type PropsAiMemberEvidence={
  /** Future NFL operational hold bound to the actual original native baseline. */
  nativeQualification?:NflNativeQualification;
  /** Current source qualification, separate from the conditional outcome law. */
  sourceEligibility?:PlayerParticipationEligibility;
  /** Future decision-pricing provenance; never reconstructed onto an existing lock. */
  executionEvidence?:PropsAiExecutionEvidence;
  /** Prospective source-event verification, never retrofitted onto a legacy lock. */
  sourceEventRelease?:string;sourceEventStatistic?:string;
  release:string;lawRelease:string;gradeRelease:string;publicationRelease:string;reviewId:string;lawHash:string;inputHash:string;
  /** Future unlocked selection policy; absent on immutable legacy records. */
  selectionRelease?:string;
  reviewedAt:string;stage:"early"|"final";model:string;confidence:0|1|2;confidenceMeaning:"AI-estimated evidence strength; not empirical calibration";
  quoteConfirmedAt:string;
  selectedSide:"over"|"under"|"yes";
  assessment:string;coverage:PublicAiCoverage;exception:string|null;
};

export const PROPS_AI_FAMILIAR_READER_RELEASE="player_props_ai_site_2026_11_09_r5_current_execution" as const;
/** Stored medical/forecast exceptions retain precedence. Only the explicit new
 * operational payload supplies a previously absent reason; legacy text is exact. */
export function propsAiOperationalException(evidence:PropsAiMemberEvidence){
 const qualification=evidence.nativeQualification;
 return evidence.exception??(qualification?.release===NFL_NATIVE_QUALIFICATION_RELEASE&&qualification.reason==='native_player_context_unavailable'?qualification.detail:null);
}
export function needsLegacyLockedAiReader(evidence:PropsAiMemberEvidence|undefined,locked:boolean){
  return Boolean(evidence&&locked&&![PROPS_AI_FAMILIAR_READER_RELEASE,"player_props_ai_site_2026_11_08_r4_familiar_readers"].includes(evidence.publicationRelease));
}
