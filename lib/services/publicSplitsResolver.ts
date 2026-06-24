/**
 * Resolve dual-provider public splits into one simple product read.
 *
 * This is intentionally pure. It does not fetch providers, write DB rows, or
 * derive EV/steam/RLM. It answers a narrower question:
 *
 *   Given Playbook and/or SharpAPI public bet% / money%, what should the UI
 *   display, and how much should the model trust the public-splits signal?
 *
 * Product contract:
 *   - Prefer fresh, complete Playbook splits for user-facing bars.
 *   - Fall back to SharpAPI when Playbook is missing, stale, or incomplete.
 *   - Never average providers into a made-up consensus percentage.
 *   - Provider disagreement is an internal confidence modifier.
 *
 * Default thresholds mirror the dual-source public-splits architecture:
 *   - stale after 15 minutes;
 *   - aligned when max provider gap <= 10pp;
 *   - major disagreement when max provider gap >= 20pp.
 */

export type PublicSplitsProvider = "playbook" | "sharpapi";

export type PublicSplitObservation = {
  provider: PublicSplitsProvider;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used?: number | null;
  observed_at?: string | null;
};

export type PublicSplitAgreementState =
  | "aligned"
  | "mild_disagreement"
  | "major_disagreement"
  | "single_source"
  | "no_data";

export type PublicSplitModelConfidence = "high" | "medium" | "low" | "none";

export type ResolvedPublicSplit = {
  displaySource: PublicSplitsProvider | null;
  displayBettingPct: number | null;
  displayMoneyPct: number | null;
  displayBooksUsed: number | null;
  agreementState: PublicSplitAgreementState;
  modelConfidence: PublicSplitModelConfidence;
  providerGapPct: {
    betting: number | null;
    money: number | null;
    max: number | null;
  };
};

export type ResolvePublicSplitOptions = {
  playbook?: PublicSplitObservation | null;
  sharpapi?: PublicSplitObservation | null;
  now?: Date;
  staleAfterMinutes?: number;
  alignedMaxGapPct?: number;
  majorDisagreementMinGapPct?: number;
};

function isPct(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

function hasCompletePublicSplit(obs: PublicSplitObservation | null | undefined): obs is PublicSplitObservation {
  return Boolean(obs && isPct(obs.public_betting_pct) && isPct(obs.public_money_pct));
}

function isFresh(
  obs: PublicSplitObservation | null | undefined,
  now: Date,
  staleAfterMinutes: number
): boolean {
  if (!obs) return false;
  if (!obs.observed_at) return true;
  const observedMs = Date.parse(obs.observed_at);
  if (!Number.isFinite(observedMs)) return false;
  const ageMinutes = (now.getTime() - observedMs) / 60000;
  return ageMinutes >= 0 && ageMinutes <= staleAfterMinutes;
}

function gap(a: number | null | undefined, b: number | null | undefined): number | null {
  return isPct(a) && isPct(b) ? Math.abs(a - b) : null;
}

function agreementFromGap(
  maxGap: number | null,
  hasOneSource: boolean,
  alignedMaxGapPct: number,
  majorDisagreementMinGapPct: number
): PublicSplitAgreementState {
  if (maxGap === null) return hasOneSource ? "single_source" : "no_data";
  if (maxGap <= alignedMaxGapPct) return "aligned";
  if (maxGap >= majorDisagreementMinGapPct) return "major_disagreement";
  return "mild_disagreement";
}

function confidenceFromAgreement(state: PublicSplitAgreementState): PublicSplitModelConfidence {
  switch (state) {
    case "aligned":
      return "high";
    case "mild_disagreement":
    case "single_source":
      return "medium";
    case "major_disagreement":
      return "low";
    case "no_data":
      return "none";
  }
}

export function resolvePublicSplit(opts: ResolvePublicSplitOptions): ResolvedPublicSplit {
  const now = opts.now ?? new Date();
  const staleAfterMinutes = opts.staleAfterMinutes ?? 15;
  const alignedMaxGapPct = opts.alignedMaxGapPct ?? 10;
  const majorDisagreementMinGapPct = opts.majorDisagreementMinGapPct ?? 20;

  const playbookFresh = isFresh(opts.playbook, now, staleAfterMinutes);
  const sharpapiFresh = isFresh(opts.sharpapi, now, staleAfterMinutes);
  const playbookUsable = playbookFresh && hasCompletePublicSplit(opts.playbook);
  const sharpapiUsable = sharpapiFresh && hasCompletePublicSplit(opts.sharpapi);

  const display = playbookUsable
    ? opts.playbook!
    : sharpapiUsable
      ? opts.sharpapi!
      : null;

  const bettingGap = playbookUsable && sharpapiUsable
    ? gap(opts.playbook?.public_betting_pct, opts.sharpapi?.public_betting_pct)
    : null;
  const moneyGap = playbookUsable && sharpapiUsable
    ? gap(opts.playbook?.public_money_pct, opts.sharpapi?.public_money_pct)
    : null;
  const maxGap = bettingGap === null && moneyGap === null
    ? null
    : Math.max(bettingGap ?? 0, moneyGap ?? 0);
  const agreementState = agreementFromGap(
    maxGap,
    playbookUsable || sharpapiUsable,
    alignedMaxGapPct,
    majorDisagreementMinGapPct
  );

  return {
    displaySource: display?.provider ?? null,
    displayBettingPct: display?.public_betting_pct ?? null,
    displayMoneyPct: display?.public_money_pct ?? null,
    displayBooksUsed: display?.books_used ?? null,
    agreementState,
    modelConfidence: confidenceFromAgreement(agreementState),
    providerGapPct: {
      betting: bettingGap,
      money: moneyGap,
      max: maxGap,
    },
  };
}
