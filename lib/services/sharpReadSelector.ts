/**
 * Phase 4.1.8.A — Sharp Read sentence selector.
 *
 * Pure function picking ONE pre-approved sentence from a fixed 6-template
 * pool based on the row's headline grade + the sharp signals attached to
 * the headline market.
 *
 * Architecture: same as verdictDerivation — derived client-side at render
 * time, NOT persisted by pickBreakdownGenerator. Sharp signals are stored
 * in a separate table and surfaced through the Daily Edge DTO; the
 * generator does not see them at write time. Client-side derivation keeps
 * Sharp Read aligned with the freshest sharp-signal state across
 * morning_draft → t60_locked re-runs.
 *
 * Copy guardrails (locked Phase 4.1.8 spec):
 *   • 6 sentences only — never fabricate new wording at runtime.
 *   • Always exactly 1 sentence. Always ≤ SHARP_READ_CAP characters.
 *   • Subject is "sharp signals" / "sharp support" / "sharp movement".
 *     Never "sharp money", "the market", "the books", named books, or
 *     percentages.
 *   • Never name a specific signal category (steam, handle, Pinnacle,
 *     line move) — those belong in the Full Breakdown.
 *   • Honest "no data" framing when sharp_signals[] is empty for the
 *     game. Selector never fabricates sharp activity that doesn't exist.
 */

import type { Grade } from "../types/domain/Grade";

/** Max character length for any Sharp Read sentence. All 6 templates
 *  must fit under this cap; enforced by tests. */
export const SHARP_READ_CAP = 110;

/**
 * The 6 approved Sharp Read sentences. Locked Phase 4.1.8 spec wording.
 * Daniel's four canonical phrasings (support/mixed/push_against/not_enough)
 * are verbatim; no_data + light_movement cover the two edge cases his
 * four phrasings don't address (sharp_signals[] empty; movement exists
 * but isn't decisive yet).
 *
 * Keys are stable identifiers used by the selector + tests + UI styling.
 */
export const SHARP_READ_SENTENCES = {
  support: "Sharp signals support this pick.",
  mixed: "Sharp signals are mixed, so this is more of a lean.",
  push_against: "Sharp signals push against the model, so use caution.",
  not_enough: "There is not enough sharp support to call this a clean play.",
  no_data: "No clear sharp read on this matchup yet.",
  light_movement: "Light sharp movement, nothing decisive yet.",
} as const;

export type SharpReadKey = keyof typeof SHARP_READ_SENTENCES;

/** Market identifier matching DailyEdgePredictionDto market keys. The DTO
 *  uses "total" while the sharp_signals table uses "OU"; callers project
 *  before passing in. */
export type SharpReadMarket = "ml" | "total" | "nrfi";

/**
 * Minimal projection of a sharp_signals row. The selector only needs the
 * market + direction. Richer fields (description, source, signal_strength,
 * timestamp) stay on the full DTO for the Full Breakdown surface.
 */
export type SharpSignalProjection = {
  market: SharpReadMarket;
  direction: "positive" | "negative" | "neutral";
};

export type SharpReadInput = {
  /** Headline grade for the row (matches verdictDerivation input). */
  headlineGrade: Grade | null;
  /** Headline market for the row. Null when no model pick exists. */
  headlineMarket: SharpReadMarket | null;
  /** All sharp signals attached to this game. Selector filters internally
   *  to the headline market when evaluating directional signals. */
  sharpSignals: SharpSignalProjection[];
};

/** Returns the resolved Sharp Read sentence ready for display. */
export function selectSharpRead(input: SharpReadInput): string {
  return SHARP_READ_SENTENCES[selectSharpReadKey(input)];
}

/** Returns the key (useful for tests + UI to apply per-state styling). */
export function selectSharpReadKey(input: SharpReadInput): SharpReadKey {
  const { headlineGrade, headlineMarket, sharpSignals } = input;

  // No model pick on any market → no anchor to lean on. Honest "no data"
  // framing rather than fabricating a sharp narrative.
  if (headlineGrade === null || headlineMarket === null) {
    return "no_data";
  }

  // No sharp signals across the entire game → honest "no data" framing.
  if (sharpSignals.length === 0) {
    return "no_data";
  }

  // Project signals on the headline market for direction-aware branches.
  const onHeadline = sharpSignals.filter((s) => s.market === headlineMarket);
  const headlineHasNegative = onHeadline.some((s) => s.direction === "negative");
  const headlineHasPositive = onHeadline.some((s) => s.direction === "positive");

  // sharp_conflict at the grade level → push against. Pairs with the
  // Caution verdict. Single source of truth for "the model picked X,
  // sharps point the other way."
  if (headlineGrade === "sharp_conflict") {
    return "push_against";
  }

  // Any negative signal on the headline market → push against, regardless
  // of grade. Catches sharp flags even when grade derivation hasn't
  // resolved them into a sharp_conflict label.
  if (headlineHasNegative) {
    return "push_against";
  }

  // Grade-driven branches for the remaining 6 grades.
  switch (headlineGrade) {
    case "best_signal":
    case "sharp_confirmed":
      // Top-tier grade implies sharps align with the model. Members see
      // confident "support" framing — the grade carries the meaning even
      // when no explicit positive signal row exists.
      return "support";

    case "market_led":
      // Market is leading and the model concurs. Support when a positive
      // signal confirms the headline; mixed when signals exist on this
      // market but aren't directional.
      return headlineHasPositive ? "support" : "mixed";

    case "model_only":
      // Model has the edge but no market read backing it. Honest framing:
      // not enough sharp support to call it a clean play.
      return "not_enough";

    case "market_watch":
      // Movement exists but hasn't resolved into a clean direction.
      // Mixed when at least one signal sits on the headline market;
      // light_movement when signals are elsewhere on the game only.
      if (onHeadline.length === 0) return "light_movement";
      return "mixed";

    case "public_smoke":
      // Heavy public action without sharp confirmation. Members should
      // know the action is loud but the sharps haven't joined in.
      return "mixed";

    // sharp_conflict handled above.
  }
}
