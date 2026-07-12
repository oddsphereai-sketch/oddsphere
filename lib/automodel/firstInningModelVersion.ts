/**
 * Phase 6B.1.7 — First-Inning Model Version resolver.
 *
 * Independent control of the first-inning writer, separate from
 * AUTOMODEL_VERSION (which governs ML/OU/score). Pure module — no DB,
 * no service imports.
 *
 * Env: FIRST_INNING_MODEL_VERSION
 *   absent / ""                → fi_v2 champion FI writer
 *   "legacy" / "v1"           → legacy FI writer (V1 NRFI passthrough)
 *   "fi_v2"                  → FI V2 overrides member-facing FI fields
 *
 * Invalid values → "fi_v2" with a console.warn so misconfigured
 * deploys are visible without throwing. Same posture as
 * AUTOMODEL_VERSION.
 */

export type FirstInningModelVersion = "legacy" | "fi_v2";

export const FIRST_INNING_MODEL_VERSION_ENV = "FIRST_INNING_MODEL_VERSION";
export const DEFAULT_FIRST_INNING_MODEL_VERSION: FirstInningModelVersion = "fi_v2";

const VALID_FI_VERSIONS: ReadonlySet<string> = new Set(["legacy", "v1", "fi_v2"]);

export function resolveFirstInningModelVersion(
  env: Record<string, string | undefined> = process.env,
): FirstInningModelVersion {
  const raw = env[FIRST_INNING_MODEL_VERSION_ENV];
  if (raw === undefined || raw === "") return DEFAULT_FIRST_INNING_MODEL_VERSION;
  const v = raw.trim().toLowerCase();
  if (v === "fi_v2") return "fi_v2";
  if (v === "legacy" || v === "v1") return "legacy";
  // eslint-disable-next-line no-console
  console.warn(
    `[firstInningModelVersion] FIRST_INNING_MODEL_VERSION="${raw}" is invalid; ` +
    `defaulting to "${DEFAULT_FIRST_INNING_MODEL_VERSION}". Valid values: legacy, v1, fi_v2.`,
  );
  void VALID_FI_VERSIONS;
  return DEFAULT_FIRST_INNING_MODEL_VERSION;
}
