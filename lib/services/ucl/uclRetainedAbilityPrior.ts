import { createHash } from "node:crypto";
import artifact from "./artifacts/ucl-retained-ability-2026-11-04.json";
import { normalizeUclStrengthClub, UCL_CURRENT_STRENGTH_PRIOR_RELEASE, UCL_STRENGTH_SCORE_COEFFICIENT, type UclCurrentStrengthPrior } from "./uclCurrentStrengthPrior";
import { UCL_MODEL_CONFIG } from "./uclModelConfig";

export const UCL_RETAINED_ABILITY_PRIOR_RELEASE = "ucl_retained_ability_prior_2026_11_10_r2_original_2026_11_04" as const;
export const UCL_RETAINED_ABILITY_ARTIFACT_SHA256 = "696226ae1ce5663852f244867140a6ac11b10e330af166fb69de7874e3566d88" as const;

/** This is a versioned statistical model prior, with its actual original
 * observation date. It is not a newly fetched or current ClubElo table. */
export function validateUclRetainedAbilityArtifact(value: unknown): void {
  if (createHash("sha256").update(JSON.stringify(value)).digest("hex") !== UCL_RETAINED_ABILITY_ARTIFACT_SHA256)
    throw Error("UCL retained ability artifact identity mismatch");
}

export type UclRetainedAbilityPrior = {
  release: typeof UCL_RETAINED_ABILITY_PRIOR_RELEASE;
  artifactSha256: typeof UCL_RETAINED_ABILITY_ARTIFACT_SHA256;
  derivedAt: string;
  numericPrior: UclCurrentStrengthPrior;
};

export function loadUclRetainedAbilityPrior(teamNames: ReadonlyMap<number, string>, requiredIds: readonly number[]): UclRetainedAbilityPrior {
  validateUclRetainedAbilityArtifact(artifact);
  if (artifact.schemaVersion !== 1 || artifact.release !== UCL_RETAINED_ABILITY_PRIOR_RELEASE
    || artifact.coefficientPer400 !== UCL_STRENGTH_SCORE_COEFFICIENT
    || !Number.isFinite(Date.parse(artifact.derivedAt)) || Date.parse(artifact.derivedAt) < Date.parse(artifact.sourceObservation.capturedAt))
    throw Error("Invalid UCL retained ability contract");
  const ratings = new Map<number, number>();
  for (const club of artifact.clubs) {
    if (!Number.isSafeInteger(club.teamId) || club.teamId <= 0 || !Number.isFinite(club.rating) || club.rating <= 0 || ratings.has(club.teamId))
      throw Error("Invalid retained UCL club");
    const name = teamNames.get(club.teamId);
    if (name && normalizeUclStrengthClub(name) !== normalizeUclStrengthClub(club.name))
      throw Error(`Conflicting retained UCL club identity ${club.teamId}`);
    // Keep the full frozen reference population. Missing historical/current
    // names cannot silently re-center the model's fixed prior.
    ratings.set(club.teamId, club.rating);
  }
  for (const id of requiredIds) if (!teamNames.has(id) || !ratings.has(id)) throw Error(`Retained UCL prior missing required current club ${id}`);
  return { release: UCL_RETAINED_ABILITY_PRIOR_RELEASE, artifactSha256: UCL_RETAINED_ABILITY_ARTIFACT_SHA256,
    derivedAt: artifact.derivedAt,
    numericPrior: { release: UCL_CURRENT_STRENGTH_PRIOR_RELEASE, coefficientPer400: artifact.coefficientPer400,
      source: { ...artifact.sourceObservation, sourceUrl: "https://clubelo.com/", release: "ucl_official_strength_2026_11_04_r1_dated_original_source" }, ratings } };
}

/** Retained information loses precision on the existing 365-day relevance
 * horizon; its mean and its original source date are never relabeled fresh. */
export function uclRetainedAbilityPrecision(prior: UclRetainedAbilityPrior, kickoff: string, availableAt: string) {
  const sourceFields = ["release", "sourceUrl", "asOfDay", "capturedAt", "sourceHash"] as const;
  if (prior.release !== UCL_RETAINED_ABILITY_PRIOR_RELEASE || prior.artifactSha256 !== UCL_RETAINED_ABILITY_ARTIFACT_SHA256
    || prior.derivedAt !== artifact.derivedAt || prior.numericPrior.release !== UCL_CURRENT_STRENGTH_PRIOR_RELEASE
    || prior.numericPrior.coefficientPer400 !== artifact.coefficientPer400
    || Object.keys(prior.numericPrior.source).length !== sourceFields.length
    || sourceFields.some(key => prior.numericPrior.source[key] !== artifact.sourceObservation[key])
    || prior.numericPrior.ratings.size !== artifact.clubs.length
    || artifact.clubs.some(club => prior.numericPrior.ratings.get(club.teamId) !== club.rating))
    throw Error("Retained UCL runtime prior identity mismatch");
  const date = Date.parse(kickoff), available = Date.parse(availableAt), derived = Date.parse(prior.derivedAt);
  const captured = Date.parse(prior.numericPrior.source.capturedAt), day = Date.parse(`${prior.numericPrior.source.asOfDay}T00:00:00Z`);
  if (![date, available, derived, captured, day].every(Number.isFinite) || day > captured || captured > derived
    || derived > available || available >= date) throw Error("Retained UCL inputs unavailable before fixture");
  const sourceAgeDays = (date - day) / 86_400_000;
  return { sourceAgeDays, precisionScale: 2 ** (-sourceAgeDays / UCL_MODEL_CONFIG.halfLifeDays) };
}
