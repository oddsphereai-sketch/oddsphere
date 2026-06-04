/**
 * Phase 4.2.C.1.R-1 — pure decision helper for the refresh-slate
 * operator's BDL ↔ SharpAPI cross-provider validation gate.
 *
 * The validation guard inside `refresh-slate.ts` compares BDL's
 * ET-filtered slate to SharpAPI's `/splits` slate and computes an
 * overlap fraction. When that fraction is below the configured
 * threshold the operator's apply path BLOCKS by default (per
 * 4.1.9.C-1c.v: wrong games are worse than missing games).
 *
 * R-1 introduces an explicit, loud override for the manual launch
 * workflow: when BDL and MLB Stats (and the operator's manual
 * canonical schedule check) agree but SharpAPI is the noisy outlier,
 * the operator can opt in via `--allow-validation-mismatch` to
 * proceed past the validation block.
 *
 * The override is intentionally narrow:
 *
 *   • It only releases the *low-overlap* block.
 *   • It does NOT release a SharpAPI fetch error / unavailable
 *     validation. Those represent a different safety class (we never
 *     ran the comparison) and a future flag can cover them if needed.
 *   • The decision carries an `override_source` tag so callers can
 *     emit audit-visible logging.
 *
 * Pure (no I/O). Unit-tested via
 * `scripts/test-slate-validation-decision.ts`.
 */

export type SlateApplyDecision =
  | { kind: "allow" }
  | {
      kind: "allow_with_override";
      reason: string;
      override_source: string;
    }
  | { kind: "block"; reason: string };

export type SlateValidationInputs = {
  /**
   * True when BDL/SharpAPI overlap is at or above the configured
   * threshold. Computed by the caller via `validateOverlap`.
   */
  passed: boolean;
  /**
   * Human-readable reason string when `passed === false` (e.g.
   * "overlap 53.3% < threshold 90%"). Ignored when `passed === true`.
   */
  reason: string | null;
  /**
   * Non-null when SharpAPI could not be reached / its response could
   * not be parsed. Distinct from "validation ran and failed" — we
   * never compared the sets, so the override does NOT apply here.
   */
  sharpApiFetchError: string | null;
  /**
   * `--allow-validation-mismatch` was passed on the CLI. Loud-on-
   * purpose: the operator's banner should print the override state
   * for audit visibility.
   */
  allowMismatch: boolean;
};

/**
 * Decide whether the apply path can proceed given the BDL↔SharpAPI
 * validation result and the operator's override choice.
 *
 * Behavior matrix:
 *
 *   fetchError | passed | allowMismatch | result
 *   ───────────┼────────┼───────────────┼──────────────────────────
 *   non-null   | n/a    | n/a           | block (cannot override)
 *   null       | true   | n/a           | allow
 *   null       | false  | false         | block (default safety)
 *   null       | false  | true          | allow_with_override
 *
 * The override is intentionally narrow: it only unlocks the
 * "validation ran and failed" branch. Fetch errors remain blocking
 * because we have no evidence to override against.
 */
export function decideSlateApply(opts: SlateValidationInputs): SlateApplyDecision {
  if (opts.sharpApiFetchError !== null) {
    return {
      kind: "block",
      reason: `SharpAPI validation could not run: ${opts.sharpApiFetchError}`,
    };
  }
  if (opts.passed) {
    return { kind: "allow" };
  }
  if (opts.allowMismatch) {
    return {
      kind: "allow_with_override",
      reason: opts.reason ?? "validation mismatch",
      override_source: "--allow-validation-mismatch",
    };
  }
  return {
    kind: "block",
    reason: opts.reason ?? "validation failed",
  };
}
