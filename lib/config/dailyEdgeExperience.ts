export const DAILY_EDGE_EXPERIENCE_PREVIEW_FLAG =
  "DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED";
export const DAILY_EDGE_EXPERIENCE_CANDIDATE_FLAG =
  "DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED";

export function isDailyEdgeExperienceCandidateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[DAILY_EDGE_EXPERIENCE_CANDIDATE_FLAG] === "true";
}

/**
 * The redesigned Daily Edge surface is available automatically in local
 * development. Any production-mode build (including a Vercel preview build)
 * must opt in explicitly with a server-only environment flag.
 */
export function isDailyEdgeExperiencePreviewAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return (
    env[DAILY_EDGE_EXPERIENCE_PREVIEW_FLAG] === "true" ||
    isDailyEdgeExperienceCandidateEnabled(env)
  );
}
