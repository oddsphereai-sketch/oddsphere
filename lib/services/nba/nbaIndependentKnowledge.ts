import { createHash } from "node:crypto";
import type { NbaPriceCoordinateLaw } from "./nbaPricedMarketMovement";

/** Detect changes in the independent forecast datum. This identifier is NOT
 * information-consumption authority and cannot itself retire market history. Source metadata
 * belongs in its existing audit, not this key: an unmodeled player's status
 * must not retire useful market evidence when the forecast did not change.
 * Coordinate-specific retirement requires an explicit consumed-information receipt.
 */
export function nbaIndependentInputFingerprint(input: {
  modelRelease: string; artifactRelease: string; featureRelease: string; rosterRelease: string;
  features: Record<string, number | null | undefined>;
  independentMargin: number; independentTotal: number;
  residualLaw: NbaPriceCoordinateLaw;
  injuriesKnown: [boolean, boolean];
  homeInjuries: readonly { name: string; status: string }[];
  awayInjuries: readonly { name: string; status: string }[];
  rosterStatus: string; homeRetained: number | null; awayRetained: number | null;
}): string {
  const canonical = { modelRelease: input.modelRelease, artifactRelease: input.artifactRelease, featureRelease: input.featureRelease,
    rosterRelease: input.rosterRelease, independentMargin: input.independentMargin, independentTotal: input.independentTotal,
    marginSigma: input.residualLaw.marginSigma, totalSigma: input.residualLaw.totalSigma,
    marginMixture: input.residualLaw.marginMixture ?? null };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
