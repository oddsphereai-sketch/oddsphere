/**
 * Phase 6B.1 — Auto-model version resolver.
 *
 * Pure module. No DB, no service imports. Single export reads
 * `AUTOMODEL_VERSION` from env (or a passed-in record) and returns a
 * narrowed AutomodelVersion. Defaults to the MLB champion model (`v2_2`).
 *
 * Modes:
 *   "v1"     — V1 writes predictions to game_predictions. V2 never runs.
 *   "v2"     — V2 writes predictions to game_predictions. V1 still
 *              executes first to produce the residual signal V2 anchors
 *              on; V2 errors fall back to V1 with a logged warning.
 *   "v2_1"   — V2.1 layered model writes predictions. V1 still runs as
 *              the independent baseline (Layer 2 bridge); V2.1 errors
 *              fall back to V1 with a logged warning.
 *   "shadow" — V1 writes predictions to game_predictions (production
 *              unchanged); V2 also runs and its audit is attached under
 *              sport_specific.v2_audit for side-by-side comparison
 *              without behavioral risk.
 *
 * Invalid / missing env value → "v2_2" with a console.warn so misconfigured
 * deploys are visible without throwing.
 */

export type AutomodelVersion = "v1" | "v2" | "v2_1" | "v2_2" | "shadow";

export const AUTOMODEL_VERSION_ENV = "AUTOMODEL_VERSION";
export const DEFAULT_AUTOMODEL_VERSION: AutomodelVersion = "v2_2";

const VALID_VERSIONS: ReadonlySet<AutomodelVersion> = new Set(["v1", "v2", "v2_1", "v2_2", "shadow"]);

/**
 * Read AUTOMODEL_VERSION from the supplied env record (or process.env
 * when omitted) and return a validated AutomodelVersion.
 *
 * Pure: no side effects beyond a console.warn on invalid values.
 */
export function resolveAutomodelVersion(
  env: Record<string, string | undefined> = process.env,
): AutomodelVersion {
  const raw = env[AUTOMODEL_VERSION_ENV];
  if (raw === undefined || raw === "") return DEFAULT_AUTOMODEL_VERSION;
  const v = raw.trim().toLowerCase();
  if (VALID_VERSIONS.has(v as AutomodelVersion)) {
    return v as AutomodelVersion;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[automodelVersion] AUTOMODEL_VERSION="${raw}" is invalid; defaulting to "${DEFAULT_AUTOMODEL_VERSION}". Valid values: v1, v2, v2_1, v2_2, shadow.`,
  );
  return DEFAULT_AUTOMODEL_VERSION;
}

/** Resolve precedence: explicit opt-override > env > champion default. */
export function resolveEffectiveVersion(
  override: AutomodelVersion | undefined,
  env: Record<string, string | undefined> = process.env,
): AutomodelVersion {
  if (override !== undefined) return override;
  return resolveAutomodelVersion(env);
}
