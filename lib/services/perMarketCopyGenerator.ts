/**
 * perMarketCopyGenerator — produces beginner-friendly copy for the four
 * user-facing per-market fields:
 *   - guidedGuide        (conversational "here's the model's case")
 *   - guidedWatchOut     (conversational "here's the concern")
 *   - whyLine            (technical model driver)
 *   - riskLine           (technical risk factor)
 *
 * Per Daniel's 4.1.10 adjustment #1: V1 keeps this controlled and small.
 * No 120-template matrix. Instead: market-specific stems × verdict-
 * specific shapers × small conditional inserts based on sharpDirection
 * and data availability. Output passes through bannedTermsLinter at
 * generation time.
 *
 * First-inning copy intentionally avoids public-split language. The
 * "No first-inning public split data" line lives in the UI (MarketPulse
 * component), not here — this generator's job is the model/matchup case.
 */

import { assertNoBannedTerms } from "./bannedTermsLinter";
import type { Verdict } from "./verdictDerivation";

export type CopyMarket = "moneyline" | "total" | "first_inning";
export type CopySharpDirection = "support" | "push_against" | "none";

export type CopyInput = {
  market: CopyMarket;
  verdict: Verdict;
  pick: string;            // e.g. "KC" for ML, "Over 8.5" for total, "NRFI" for FI
  confidence: number;      // 0-1
  sharpDirection: CopySharpDirection;
  /** Brief technical phrase (e.g. "starter ERA edge"). Null when no factor dominates. */
  modelDriver: string | null;
  /** Brief opposing factor (e.g. "weak top-of-order"). Null when no factor dominates. */
  riskDriver: string | null;
  /**
   * True when ML/Total has effectively no quantitative market data
   * (no Pinnacle EV, no fair prob, no splits, no opener). For
   * first_inning this is always treated as false — see marketVerdictDerivation rule 9.
   */
  marketDataLimited: boolean;
};

export type CopyOutput = {
  guidedGuide: string;
  guidedWatchOut: string;
  whyLine: string;
  riskLine: string;
};

// ───────────────────────────────────────────────────────────────────
// Vocabulary
// ───────────────────────────────────────────────────────────────────

const MARKET_NOUN: Record<CopyMarket, string> = {
  moneyline: "moneyline",
  total: "total",
  first_inning: "first inning",
};

const VERDICT_FRAMING: Record<Verdict, { open: string; tone: string }> = {
  best_angle: {
    open: "Strong angle here",
    tone: "the model has a clean case",
  },
  lean: {
    open: "Soft lean",
    tone: "the model leans this way but it's not a hammer",
  },
  watchlist: {
    open: "Worth tracking",
    tone: "the read is interesting but not clean enough to act on",
  },
  caution: {
    open: "Caution flagged",
    tone: "the model's pick and the market's posture disagree",
  },
  no_play: {
    open: "No play",
    tone: "the model doesn't have a meaningful edge",
  },
};

// ───────────────────────────────────────────────────────────────────
// Per-field builders
// ───────────────────────────────────────────────────────────────────

function buildGuidedGuide(input: CopyInput): string {
  const noun = MARKET_NOUN[input.market];
  const conf = Math.round(input.confidence * 100);
  const framing = VERDICT_FRAMING[input.verdict];

  // First-inning Toss-Up display fix (Change A). When the route passes
  // pick="Toss-Up" (the model's 5-zone Toss-Up state from Phase 4D.1),
  // every "the model leans X" / "the model likes X" template reads
  // awkwardly because the pick is exactly the "no clean side" state.
  // Use Toss-Up-specific copy that names the zone honestly.
  if (input.market === "first_inning" && input.pick === "Toss-Up") {
    if (input.verdict === "watchlist") {
      return `Worth tracking: the first-inning model lands in the toss-up zone at ${conf}% — too close to call cleanly.`;
    }
    if (input.verdict === "caution") {
      return `The first-inning model lands in the toss-up zone at ${conf}%, and other signals conflict. Pass.`;
    }
    if (input.verdict === "no_play") {
      return `On the first inning, the model lands in the toss-up zone (${conf}%). Skip unless something changes pre-game.`;
    }
    // lean / best_angle shouldn't actually happen for Toss-Up zone rows
    // (Toss-Up confidence is always 52, well below the lean floor), but
    // be defensive with copy in case verdict logic ever changes.
    return `The first-inning model lands in the toss-up zone at ${conf}% — too close to call cleanly.`;
  }

  if (input.verdict === "no_play") {
    return `On the ${noun}, the model doesn't see enough edge tonight (${conf}% confidence). Skip unless something changes pre-game.`;
  }
  if (input.verdict === "caution") {
    if (input.sharpDirection === "push_against") {
      return `The model likes ${input.pick} on the ${noun} at ${conf}%, but market action is pushing the other way. Treat as caution, not a play.`;
    }
    return `The model likes ${input.pick} on the ${noun} at ${conf}%, but our signals conflict. Treat as caution, not a play.`;
  }
  if (input.verdict === "watchlist") {
    return `${framing.open}: the model leans ${input.pick} on the ${noun} at ${conf}%, ${framing.tone}.`;
  }
  if (input.verdict === "lean") {
    if (input.sharpDirection === "support" && input.market !== "first_inning") {
      return `${framing.open} toward ${input.pick} on the ${noun} (${conf}%) — and market support is consistent with the pick.`;
    }
    return `${framing.open} toward ${input.pick} on the ${noun} at ${conf}%. ${capitalize(framing.tone)}.`;
  }
  // best_angle
  if (input.sharpDirection === "support" && input.market !== "first_inning") {
    return `${framing.open}: the model likes ${input.pick} on the ${noun} at ${conf}%, and market support is on the same side.`;
  }
  return `${framing.open}: the model has a clean ${conf}% case for ${input.pick} on the ${noun}.`;
}

function buildGuidedWatchOut(input: CopyInput): string {
  const noun = MARKET_NOUN[input.market];

  if (input.verdict === "no_play" || input.verdict === "caution") {
    if (input.riskDriver !== null) {
      return `Main concern: ${input.riskDriver}.`;
    }
    if (input.market === "first_inning") {
      return `First-inning markets swing fast on lineup and starter scratches — confirm both before posting.`;
    }
    return `Wait for a clearer setup or fresh data before posting this one.`;
  }
  if (input.market === "first_inning") {
    return input.riskDriver !== null
      ? `Where it gets less clean: ${input.riskDriver}. First-inning markets also swing fast on lineup or starter changes.`
      : `Where it gets less clean: first-inning markets swing fast on lineup or starter changes — confirm pregame.`;
  }
  if (input.sharpDirection === "push_against") {
    return input.riskDriver !== null
      ? `Where it gets less clean: ${input.riskDriver}, and the market is leaning against the pick.`
      : `Where it gets less clean: the market is leaning against the pick.`;
  }
  if (input.marketDataLimited) {
    return input.riskDriver !== null
      ? `Where it gets less clean: ${input.riskDriver}, and we have limited market signal to cross-check.`
      : `Where it gets less clean: we have limited market signal to cross-check the model read.`;
  }
  return input.riskDriver !== null
    ? `Where it gets less clean: ${input.riskDriver}.`
    : `Where it gets less clean: nothing major, but tighter pricing post-lineup can change the math.`;
}

function buildWhyLine(input: CopyInput): string {
  // Push 3B-7 follow-up (Phase 6B.1.6i): Toss-Up needs neutral copy
  // regardless of any modelDriver value sneaking through from V1
  // auto_factors. Held also handled here for symmetry.
  if (input.market === "first_inning" && input.pick === "Toss-Up") {
    return `Driver: FI V2 posterior sits near the coin-flip range — market and model are close.`;
  }
  if (input.market === "first_inning" && input.pick === null) {
    return `Driver: FI model is held — not enough confirmed pitcher/lineup data to commit to a side.`;
  }
  if (input.modelDriver !== null) {
    return `Primary driver: ${input.modelDriver}.`;
  }
  if (input.market === "first_inning") {
    return `Driver: projected first-inning runs vs the market line, weighted by starter strength and top-of-order matchup.`;
  }
  if (input.market === "total") {
    return `Driver: projected total runs vs the market line, weighted by park, weather, and starter/bullpen mix.`;
  }
  return `Driver: model's win-probability edge vs the market price.`;
}

function buildRiskLine(input: CopyInput): string {
  if (input.riskDriver !== null) {
    return `Risk: ${input.riskDriver}.`;
  }
  if (input.market === "first_inning") {
    return `Risk: first-inning markets shift quickly on lineup or starter changes.`;
  }
  if (input.marketDataLimited) {
    return `Risk: limited market data to corroborate the model read — confirm pregame.`;
  }
  return `Risk: late line moves or lineup changes can tighten the edge.`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ───────────────────────────────────────────────────────────────────
// Main entry
// ───────────────────────────────────────────────────────────────────

export function generatePerMarketCopy(input: CopyInput): CopyOutput {
  const out: CopyOutput = {
    guidedGuide: buildGuidedGuide(input),
    guidedWatchOut: buildGuidedWatchOut(input),
    whyLine: buildWhyLine(input),
    riskLine: buildRiskLine(input),
  };
  // Defense in depth: every user-facing copy field must pass the linter.
  // Throws BannedTermError if a banned token slips in (e.g., a future
  // edit accidentally introduces "EV" or "Pinnacle").
  assertNoBannedTerms(out.guidedGuide, "guidedGuide");
  assertNoBannedTerms(out.guidedWatchOut, "guidedWatchOut");
  assertNoBannedTerms(out.whyLine, "whyLine");
  assertNoBannedTerms(out.riskLine, "riskLine");
  return out;
}
