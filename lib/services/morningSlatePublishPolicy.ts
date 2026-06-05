/**
 * Phase 4.2.C.1.R-19 Phase 1 (C4) — Morning-slate publish-policy gate.
 *
 * Pre-R-19: `app/api/cron/morning-slate/route.ts` always called
 * `publishSlate(sport, date)` as step 11. Successful cron IS the
 * admin promotion — there is no review gate. For unattended cron
 * launch readiness, this is unsafe: a bad model run or bad copy
 * generation reaches members without any human inspection.
 *
 * R-19 Phase 1 introduces a single env-flag opt-in. Default behavior is
 * HOLD: morning-slate completes through grade derivation and leaves the
 * slate at `draft`. An operator runs `scripts/operator/publish-slate.ts`
 * to promote.
 *
 * Auto-publish remains available — flip `MORNING_SLATE_AUTO_PUBLISH=true`
 * on the cron environment to restore prior behavior. Phase 7.5's manual
 * review UI will eventually replace the env flag, but the gate is the
 * minimum safety surface for V1 launch.
 *
 * Pure helper — testable without any environment / route plumbing.
 */

/**
 * Resolve the auto-publish decision from process env. Returns true ONLY
 * when the env var is the literal string "true" (case-sensitive, no
 * other truthy values accepted). Any other input — including unset,
 * empty string, "TRUE", "1", "yes" — returns false so the safe default
 * holds.
 */
export type MorningSlatePublishEnv = Record<string, string | undefined>;

export function shouldAutoPublishMorningSlate(
  env: MorningSlatePublishEnv = process.env
): boolean {
  return env.MORNING_SLATE_AUTO_PUBLISH === "true";
}

/**
 * Human-readable label of the publish decision for cron step-details
 * output. Stable strings — operator-facing log inspectors may grep on
 * them.
 */
export function publishDecisionLabel(autoPublish: boolean): string {
  return autoPublish
    ? "auto-publish enabled (MORNING_SLATE_AUTO_PUBLISH=true)"
    : "skipped — MORNING_SLATE_AUTO_PUBLISH not enabled (hold-as-draft)";
}
