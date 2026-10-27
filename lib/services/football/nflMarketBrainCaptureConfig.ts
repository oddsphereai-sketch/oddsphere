export type NflMarketBrainCaptureAttemptWindow = {
  attemptId: string;
  windowOpensAt: string;
  windowClosesAt: string;
};

export type NflMarketBrainCaptureConfiguration = {
  requested: boolean;
  enabled: boolean;
  maximumGames: number;
  attemptSchedule: Record<string, NflMarketBrainCaptureAttemptWindow[]> | undefined;
  error: string | null;
};

export function resolveNflMarketBrainCaptureConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): NflMarketBrainCaptureConfiguration {
  const requested = env.NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED === "true" &&
    env.NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED === "true";
  if (!requested) {
    return { requested, enabled: false, maximumGames: 0, attemptSchedule: undefined, error: null };
  }
  try {
    const maximumGames = Number.parseInt(env.NFL_MARKET_BRAIN_SHADOW_CANARY_MAX_GAMES ?? "2", 10);
    if (!Number.isInteger(maximumGames) || maximumGames < 1 || maximumGames > 4) {
      throw new Error("NFL_MARKET_BRAIN_SHADOW_CANARY_MAX_GAMES must be an integer from 1 through 4.");
    }
    const rawSchedule = env.NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON;
    if (!rawSchedule?.trim()) {
      throw new Error("NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON is required for Market Brain capture.");
    }
    return {
      requested,
      enabled: true,
      maximumGames,
      attemptSchedule: parseNflMarketBrainCaptureAttemptSchedule(rawSchedule),
      error: null,
    };
  } catch (error) {
    return {
      requested,
      enabled: false,
      maximumGames: 0,
      attemptSchedule: undefined,
      error: `nfl_market_brain_configuration_disabled:${
        error instanceof Error ? error.message : String(error)}`.slice(0, 512),
    };
  }
}

export function parseNflMarketBrainCaptureAttemptSchedule(
  raw: string,
): Record<string, NflMarketBrainCaptureAttemptWindow[]> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    throw new Error("NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON must be an event:stage attempt-window object.");
  }
  const entries = Object.entries(value);
  const validAttempt = (attempt: unknown): attempt is NflMarketBrainCaptureAttemptWindow => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
    const row = attempt as Record<string, unknown>;
    return typeof row.attemptId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.attemptId) &&
      typeof row.windowOpensAt === "string" && typeof row.windowClosesAt === "string" &&
      Number.isFinite(Date.parse(row.windowOpensAt)) && Number.isFinite(Date.parse(row.windowClosesAt)) &&
      Date.parse(row.windowOpensAt) <= Date.parse(row.windowClosesAt);
  };
  if (entries.length < 1 || entries.length > 12 || entries.some(([key, attempts]) =>
    !/^[^:]+:(opening|unlocked|t60)$/.test(key) || !Array.isArray(attempts) ||
    attempts.length < 1 || attempts.length > 32 || attempts.some((attempt) => !validAttempt(attempt)))) {
    throw new Error("NFL Market Brain capture schedule must contain 1-12 event:stage keys with valid UUID windows.");
  }
  return Object.fromEntries(entries) as Record<string, NflMarketBrainCaptureAttemptWindow[]>;
}
