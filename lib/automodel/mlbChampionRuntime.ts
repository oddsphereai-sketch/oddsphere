import { resolveAutomodelVersion } from "./modelVersion";
import type { AutomodelVersion } from "./modelVersion";
import {
  resolveFirstInningModelVersion,
  type FirstInningModelVersion,
} from "./firstInningModelVersion";

export const EXPECTED_MLB_AUTOMODEL_VERSION = "v2_2" as const;
export const EXPECTED_MLB_FIRST_INNING_MODEL_VERSION = "fi_v2" as const;

export function assertMlbChampionVersions(versions: {
  automodel: AutomodelVersion;
  firstInning: FirstInningModelVersion;
}): void {
  if (
    versions.automodel !== EXPECTED_MLB_AUTOMODEL_VERSION ||
    versions.firstInning !== EXPECTED_MLB_FIRST_INNING_MODEL_VERSION
  ) {
    throw new Error(
      `MLB champion runtime mismatch: expected ${EXPECTED_MLB_AUTOMODEL_VERSION}/${EXPECTED_MLB_FIRST_INNING_MODEL_VERSION}, ` +
        `resolved ${versions.automodel}/${versions.firstInning}. Writer refused to run.`,
    );
  }
}

/**
 * Production MLB writer routes fail closed when a deploy points at an older or
 * shadow model. Missing env values resolve to the champion defaults, but an
 * explicit conflicting value is never allowed to write, track, or lock.
 */
export function assertMlbChampionRuntime(
  env: Record<string, string | undefined> = process.env,
): void {
  assertMlbChampionVersions({
    automodel: resolveAutomodelVersion(env),
    firstInning: resolveFirstInningModelVersion(env),
  });
}
