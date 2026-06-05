/**
 * Phase 4.2.C.1.R-17 Step 2C — provider mode safety guard.
 *
 * `lib/providers/factory.ts:readMode` silently defaults to `"mock"` when
 * the per-provider env var is unset or carries a typo. That default is
 * a sensible safety net for local dev (prevents accidental paid-API hits
 * from a misconfigured shell), but it becomes a liability for apply /
 * cron paths: an operator who forgets to set `SLATE_PROVIDER=real_api`
 * gets MockSlateProvider and a "successful" dry-run that resembles a
 * real run but writes mock data when the write gates are also flipped.
 *
 * Step 2C closes that gap. This module audits the four core provider
 * mode env vars and returns a structured report the orchestrator (and
 * any future cron entry point) uses to hard-block write phases when
 * ANY provider is not `real_api`. There is intentionally NO override
 * flag in this commit — safety-first.
 *
 * Required core providers (all must be `real_api` for apply eligibility):
 *   • SLATE_PROVIDER         → BallDontLieSlateProvider
 *   • ODDS_PROVIDER          → SharpAPIOddsProvider
 *   • SHARP_SIGNAL_PROVIDER  → SharpAPISignalProvider
 *   • PLAYER_STATS_PROVIDER  → BallDontLieProvider (season stats / splits)
 *
 * Excluded by design:
 *   • WEATHER_PROVIDER and any future read-only / non-write-path provider
 *     don't gate apply eligibility yet. Add them here when their data
 *     starts driving writes.
 *
 * Pure helper — no I/O, no DB, no env mutation. Reads `process.env`
 * (or the caller-supplied environment) and returns a report.
 */

export type ProviderModeStatus =
  | "real_api"
  | "mock"
  | "manual"
  | "unset"
  | "unknown";

/** The four required-for-apply provider env keys. Order is the order
 *  they appear in the orchestrator banner. */
export const REQUIRED_PROVIDER_KEYS = [
  { name: "Slate", envKey: "SLATE_PROVIDER" },
  { name: "Odds", envKey: "ODDS_PROVIDER" },
  { name: "Sharp Signal", envKey: "SHARP_SIGNAL_PROVIDER" },
  { name: "Player Stats", envKey: "PLAYER_STATS_PROVIDER" },
] as const;

export type RequiredProviderKey = (typeof REQUIRED_PROVIDER_KEYS)[number];

export type BlockingProvider = {
  name: string;
  envKey: string;
  status: ProviderModeStatus;
};

export type ProviderModeReport = {
  /** Per-provider mode status, in the same order as REQUIRED_PROVIDER_KEYS. */
  modes: Array<{ name: string; envKey: string; status: ProviderModeStatus }>;
  /** True iff every required provider is `real_api`. */
  eligibleForApply: boolean;
  /** Providers preventing apply eligibility. Empty when eligibleForApply. */
  blockingProviders: BlockingProvider[];
  /** Single human-readable summary line for banners + reason fields. */
  reason: string;
};

/**
 * Classify a raw env-var string into one of the known modes.
 *
 *   undefined / empty → "unset"
 *   "real_api"        → "real_api"
 *   "mock"            → "mock"
 *   "manual"          → "manual"
 *   anything else     → "unknown" (typo / future mode)
 *
 * Whitespace is trimmed before classification; case is preserved (the
 * factory uses exact-string equality so case matters).
 */
export function classifyProviderMode(raw: string | undefined): ProviderModeStatus {
  if (raw === undefined) return "unset";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "unset";
  if (trimmed === "real_api") return "real_api";
  if (trimmed === "mock") return "mock";
  if (trimmed === "manual") return "manual";
  return "unknown";
}

/**
 * Build the audit report for the four required providers.
 *
 * `env` defaults to `process.env` but the test suite injects a stub so
 * tests don't depend on the shell environment. No side effects.
 */
export function assessProviderModes(
  env: Record<string, string | undefined> = process.env
): ProviderModeReport {
  const modes = REQUIRED_PROVIDER_KEYS.map((p) => ({
    name: p.name,
    envKey: p.envKey,
    status: classifyProviderMode(env[p.envKey]),
  }));
  const blockingProviders = modes
    .filter((m) => m.status !== "real_api")
    .map<BlockingProvider>((m) => ({
      name: m.name,
      envKey: m.envKey,
      status: m.status,
    }));
  const eligibleForApply = blockingProviders.length === 0;
  const reason = buildReason(modes, eligibleForApply, blockingProviders);
  return {
    modes,
    eligibleForApply,
    blockingProviders,
    reason,
  };
}

function buildReason(
  modes: ProviderModeReport["modes"],
  eligible: boolean,
  blocking: BlockingProvider[]
): string {
  if (eligible) {
    return `All ${modes.length} required providers set to real_api — apply eligible.`;
  }
  const list = blocking
    .map((b) => `${b.envKey}=${b.status}`)
    .join(", ");
  return `Apply blocked — ${blocking.length} required provider(s) not real_api: ${list}. Set every required provider to real_api before --apply or cron.`;
}

/**
 * Convenience predicate used by orchestrator + cron entry points.
 * Equivalent to `assessProviderModes(env).eligibleForApply` but cheaper
 * if the caller only needs the boolean.
 */
export function providersEligibleForApply(
  env: Record<string, string | undefined> = process.env
): boolean {
  for (const p of REQUIRED_PROVIDER_KEYS) {
    if (classifyProviderMode(env[p.envKey]) !== "real_api") return false;
  }
  return true;
}
