/** Research decoder: byte integrity and identity, not current-board migration.
 * Historical fields stay original, including legacy grades and numerical proofs.
 */
import {decodeCbbContextualEvidence,type CbbContextualEvidenceEnvelope} from "../../../lib/services/cbb/cbbContextualEvidenceCodec";
import type {CbbContextualFeatureInput} from "../../../lib/cbb/contextualForecastFeatures";
import type {CbbOutcomeDecision} from "../../../lib/cbb/contextualOutcomeBoard";

type Board={gameId:number;asOf:string;modelRelease:string;gradeRelease:string;
  marketContext:{contextualOutcomeEvidence:CbbContextualEvidenceEnvelope}};
export function decodeResearchSource(board:Board) {
  const env=board.marketContext.contextualOutcomeEvidence;
  if (env.identity.gameId!==board.gameId || env.identity.asOf!==board.asOf ||
      env.identity.modelRelease!==board.modelRelease || env.identity.gradeRelease!==board.gradeRelease)
    throw Error("Original board/envelope identity differs");
  const e=decodeCbbContextualEvidence(env,env.identity).evidence;
  const input=e.input as CbbContextualFeatureInput;
  const trace=e.trace as {decision:Omit<CbbOutcomeDecision,"interpretation"|"finalScore"|"marketDecisions">};
  const decision={...trace.decision,interpretation:e.interpretation,finalScore:e.finalScore,marketDecisions:e.marketDecisions} as CbbOutcomeDecision;
  if (input.independent.gameId!==board.gameId || input.asOf!==board.asOf || decision.gameId!==board.gameId ||
      decision.asOf!==board.asOf || decision.artifact.objectSha256!==env.identity.artifactObjectSha256)
    throw Error("Research source input/decision identity differs");
  return {input,decision};
}
