export const PRODUCT_EXPERIENCE_PREVIEW_FLAG =
  "PRODUCT_EXPERIENCE_PREVIEW_ENABLED";
export const PLAYER_PROPS_EXPERIENCE_CANDIDATE_FLAG =
  "PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED";
export const TRACKING_EXPERIENCE_CANDIDATE_FLAG =
  "TRACKING_EXPERIENCE_CANDIDATE_ENABLED";
export const HOMEPAGE_EXPERIENCE_CANDIDATE_FLAG =
  "HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED";
export const LOGIN_EXPERIENCE_CANDIDATE_FLAG =
  "LOGIN_EXPERIENCE_CANDIDATE_ENABLED";

function enabled(name: string, env: NodeJS.ProcessEnv): boolean {
  return env[name] === "true";
}

export function isProductExperiencePreviewAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return (
    enabled(PRODUCT_EXPERIENCE_PREVIEW_FLAG, env) ||
    isPlayerPropsExperienceCandidateEnabled(env) ||
    isTrackingExperienceCandidateEnabled(env) ||
    isHomepageExperienceCandidateEnabled(env) ||
    isLoginExperienceCandidateEnabled(env)
  );
}

export function isPlayerPropsExperienceCandidateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(PLAYER_PROPS_EXPERIENCE_CANDIDATE_FLAG, env);
}

export function isTrackingExperienceCandidateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(TRACKING_EXPERIENCE_CANDIDATE_FLAG, env);
}

export function isHomepageExperienceCandidateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(HOMEPAGE_EXPERIENCE_CANDIDATE_FLAG, env);
}

export function isLoginExperienceCandidateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(LOGIN_EXPERIENCE_CANDIDATE_FLAG, env);
}
