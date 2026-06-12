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
 * Resolve the auto-publish decision from process env. Returns true when
 * the env var is NOT explicitly the literal string "false" — so the
 * default behavior is AUTO-PUBLISH unless an operator has explicitly
 * disabled it.
 *
 * Rationale (2026-06-12): the original R-19 Phase 1 default was HOLD,
 * intended as a safety opt-in for unattended cron launch. In practice it
 * meant healthy daily slates stayed invisible to members every morning
 * until a human ran the manual publish operator. The slate-safety gates
 * upstream of this decision (G1 game count, G2 starter coverage, G3
 * in-progress, data-layer health, intraday alignment, lock-miss) already
 * block publish on unhealthy slates — those ARE the safety net. The
 * publish-policy gate was a second redundant veto with no benefit and a
 * recurring visibility cost.
 *
 * Set MORNING_SLATE_AUTO_PUBLISH=false on the Vercel environment to
 * restore the pre-2026-06-12 hold-as-draft behavior (any sport, any
 * date).
 */
export type MorningSlatePublishEnv = Record<string, string | undefined>;

export function shouldAutoPublishMorningSlate(
  env: MorningSlatePublishEnv = process.env
): boolean {
  return env.MORNING_SLATE_AUTO_PUBLISH !== "false";
}

/**
 * Human-readable label of the publish decision for cron step-details
 * output. Stable strings — operator-facing log inspectors may grep on
 * them.
 */
export function publishDecisionLabel(autoPublish: boolean): string {
  return autoPublish
    ? "auto-publish enabled (default; safety gates upstream)"
    : "skipped — MORNING_SLATE_AUTO_PUBLISH=false (operator hold-as-draft)";
}
