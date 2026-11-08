/** Public decision evidence only. Never expose the private compressed source packet. */
import type {AcceptedGameReview} from "./reviewer";
type Area=AcceptedGameReview["players"][number]["coverage"][string];
export type PublicAiCoverage=Record<string,Omit<Area,"facts">&{facts:Pick<Area["facts"][number],"id"|"hash"|"label"|"availableAt"|"sourceIds">[]}>;
export type PropsAiMemberEvidence={
  release:string;lawRelease:string;gradeRelease:string;publicationRelease:string;reviewId:string;lawHash:string;inputHash:string;
  reviewedAt:string;stage:"early"|"final";model:string;confidence:0|1|2;confidenceMeaning:"AI-estimated evidence strength; not empirical calibration";
  quoteConfirmedAt:string;
  selectedSide:"over"|"under"|"yes";
  assessment:string;coverage:PublicAiCoverage;exception:string|null;
};

export const PROPS_AI_FAMILIAR_READER_RELEASE="player_props_ai_site_2026_11_08_r4_familiar_readers" as const;
export function needsLegacyLockedAiReader(evidence:PropsAiMemberEvidence|undefined,locked:boolean){
  return Boolean(evidence&&locked&&evidence.publicationRelease!==PROPS_AI_FAMILIAR_READER_RELEASE);
}
