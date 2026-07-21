import { resolveAutomodelVersion } from "./modelVersion";
import { resolveFirstInningModelVersion } from "./firstInningModelVersion";

export const EXPECTED_MLB_AUTOMODEL_VERSION = "v2_2" as const;
export const EXPECTED_MLB_FIRST_INNING_MODEL_VERSION = "fi_v2" as const;

/**
 * Production MLB writer routes fail closed when a deploy points at an older or
 * shadow model. Missing env values resolve to the champion defaults, but an
 * explicit conflicting value is never allowed to write, track, or lock.
 */
export function assertMlbChampionRuntime(
  env: Record<string, string | undefined> = process.env,
): void {
  const automodel = resolveAutomodelVersion(env);
  const firstInning = resolveFirstInningModelVersion(env);
  if (
    automodel !== EXPECTED_MLB_AUTOMODEL_VERSION ||
    firstInning !== EXPECTED_MLB_FIRST_INNING_MODEL_VERSION
  ) {
    throw new Error(
      `MLB champion runtime mismatch: expected ${EXPECTED_MLB_AUTOMODEL_VERSION}/${EXPECTED_MLB_FIRST_INNING_MODEL_VERSION}, ` +
        `resolved ${automodel}/${firstInning}. Writer refused to run.`,
    );
  }
}
