/**
 * Phase 4.1.8.C — composeTakeaway: decision-led card lead sentence.
 *
 * Pure UI-side helper. Maps the server-derived breakdown DTO fields
 * (verdict, sharpRead, modelBreakdown) plus the headline market into a
 * single member-facing "what does this mean for my bet" sentence.
 *
 * Why client-side composition (not a server generator change):
 *   • No DTO change required — the 4.1.8.B surface already exposes
 *     verdict.key, sharpRead.key, modelBreakdown, and per-pick fields.
 *   • Fast to iterate on copy without re-running the regen smoke.
 *   • Centralizes lead-sentence phrasing in one auditable place.
 *
 * Output shape:
 *   • lead    — single hero sentence connecting verdict + market + sharp
 *               posture into a decision-framed read. ~80–150 chars.
 *   • why     — supporting model-observation sentence (extracted from
 *               modelBreakdown, with any "though X" caveat stripped).
 *               Null when modelBreakdown is null.
 *   • caveat  — extracted "though X" clause from modelBreakdown, capitalized
 *               and re-punctuated as a standalone warning sentence. Null
 *               when the modelBreakdown has no "though" clause.
 *
 * Copy direction (locked Phase 4.1.8.C v2 spec):
 *   Avoid leads that read like a fact ("Senga has struggled early") or a
 *   pure category label ("Sharp signals support this pick.").
 *   Prefer leads that frame the bet decision:
 *     "The cleanest read here is PHI moneyline, with sharp support…"
 *     "A mild lean toward NRFI, with sharp signals split."
 *     "Use caution here — the model has a side, but sharper signals…"
 *     "This is more of a watchlist spot than a clean play."
 *     "No clean play here yet; model and sharps don't create enough
 *      separation."
 */

import type { DailyEdgeGameDto } from "./labTypes";
import type { Verdict } from "@/lib/services/verdictDerivation";
import type { SharpReadKey } from "@/lib/services/sharpReadSelector";
import { headlinePrimaryMarket } from "./perPickHeadline";

export type ComposedTakeaway = {
  /** Hero decision-led sentence shown as the card's primary callout. */
  lead: string;
  /** Supporting model observation, e.g. "Cole has been sharp early."
   *  Null when no modelBreakdown is persisted for the row. */
  why: string | null;
  /** Conditional warning extracted from modelBreakdown's "though X" tail.
   *  Null when no caveat clause exists. Rendered with a ⚠ icon by the
   *  TakeawayBand component. */
  caveat: string | null;
};

// ─── Pick-phrase formatting ──────────────────────────────────────────

/**
 * Render the headline market + pick as a natural-English noun phrase
 * embeddable inside the lead sentence:
 *   moneyline → "NYY moneyline"
 *   total     → "the over 8.5" / "the over" (when no line available)
 *   nrfi      → "NRFI" / "YRFI" (acronym preserved)
 * Returns null when no headline can be resolved.
 */
export function formatPickPhrase(game: DailyEdgeGameDto): string | null {
  const market = headlinePrimaryMarket(game);
  if (market === null) return null;
  if (market === "moneyline") {
    const pick = game.predictions.ml.pick;
    if (!pick || pick === "—") return null;
    return `${pick} moneyline`;
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (!t.pick) return null;
    const side = t.pick.toLowerCase();
    return t.line !== null ? `the ${side} ${t.line}` : `the ${side}`;
  }
  // first_inning_total — NRFI / YRFI acronyms stay capitalized
  const nrfiPick = game.predictions.nrfi.pick;
  if (!nrfiPick || nrfiPick === "—") return null;
  return nrfiPick;
}

// ─── Lead sentence composition ───────────────────────────────────────

/**
 * Per-(verdict × sharpRead) lead-sentence builders. Functions receive the
 * pick phrase (already nullable-checked at the boundary) and return the
 * final lead string.
 *
 * Verdict-level frames:
 *   best_angle → "The cleanest read here is <pickPhrase>"
 *   lean       → "A mild lean toward <pickPhrase>"
 *   watchlist  → "This is more of a watchlist spot than a clean play"
 *   caution    → "Use caution here" (model side implicit, sharp tail
 *                 carries the "why caution")
 *   no_play    → "No clean play here yet" (sharp tail ignored — verdict
 *                 is decisive)
 *
 * Sharp-read tails attach to the frame and complete the decision read.
 * Tail copy is intentionally varied by frame to avoid template echo.
 */
type LeadBuilder = (pickPhrase: string) => string;

const BEST_ANGLE_LEADS: Record<SharpReadKey, LeadBuilder> = {
  support: (p) => `The cleanest read here is ${p}, with sharp support behind the same side.`,
  push_against: (p) => `The model likes ${p}, but sharper signals are pushing the other way — read carefully.`,
  mixed: (p) => `The cleanest read here is ${p}, though sharp signals are split.`,
  not_enough: (p) => `The cleanest read here is ${p}. Sharp coverage on this matchup is light.`,
  no_data: (p) => `The cleanest read here is ${p}. No clear sharp lean either way yet.`,
  light_movement: (p) => `The cleanest read here is ${p}. Sharp movement is light so far.`,
};

const LEAN_LEADS: Record<SharpReadKey, LeadBuilder> = {
  support: (p) => `A mild lean toward ${p}, with some sharp support behind the same side.`,
  push_against: (p) => `The model has a lean toward ${p}, but sharper signals are pushing the other way.`,
  mixed: (p) => `A mild lean toward ${p}, with sharp signals still split.`,
  not_enough: (p) => `A mild lean toward ${p} — not enough sharp support yet to call it a clean play.`,
  no_data: (p) => `A mild lean toward ${p}, with no clear sharp read yet either way.`,
  light_movement: (p) => `A mild lean toward ${p}. Sharp movement is light so far.`,
};

const WATCHLIST_LEADS: Record<SharpReadKey, () => string> = {
  support: () => "This is more of a watchlist spot than a clean play, even with some sharp support.",
  push_against: () => "This is more of a watchlist spot than a clean play, with sharper signals leaning the other way.",
  mixed: () => "This is more of a watchlist spot than a clean play — sharp signals are split.",
  not_enough: () => "This is more of a watchlist spot than a clean play, without enough sharp support to lean on.",
  no_data: () => "This is more of a watchlist spot than a clean play, and there's no clear sharp read yet either.",
  light_movement: () => "This is more of a watchlist spot than a clean play, with only light sharp movement so far.",
};

const CAUTION_LEADS: Record<SharpReadKey, () => string> = {
  support: () => "Use caution here — the model has a side, but the sharp picture is mixed enough to slow you down.",
  push_against: () => "Use caution here — the model has a read, but sharper signals are pushing the other way.",
  mixed: () => "Use caution here — model and sharp signals aren't lining up cleanly.",
  not_enough: () => "Use caution here — not enough sharp confirmation to lean on the model alone.",
  no_data: () => "Use caution here — the model has a side, but the sharp picture isn't clear yet.",
  light_movement: () => "Use caution here — the model has a read, but sharp signals are still light.",
};

const NO_PLAY_LEAD =
  "No clean play here yet; the model and sharp picture don't create enough separation.";

function composeLead(
  verdictKey: Verdict,
  sharpReadKey: SharpReadKey,
  pickPhrase: string | null
): string {
  if (verdictKey === "no_play") return NO_PLAY_LEAD;
  // Watchlist + Caution don't reference the pick — the verdict word is the
  // answer and the pick is secondary. Mirrors Daniel's example phrasings.
  if (verdictKey === "watchlist") return WATCHLIST_LEADS[sharpReadKey]();
  if (verdictKey === "caution") return CAUTION_LEADS[sharpReadKey]();
  // Best Angle / Lean lean on the pick phrase. Fall back to a generic
  // verdict statement if the pick phrase is unexpectedly null (defensive
  // — shouldn't happen given the DTO's atomicity invariants).
  if (pickPhrase === null) {
    if (verdictKey === "best_angle") {
      return "The cleanest read here points to a clear angle, even if the pick label isn't available.";
    }
    return "A mild lean is on the board, even if the pick label isn't available.";
  }
  if (verdictKey === "best_angle") return BEST_ANGLE_LEADS[sharpReadKey](pickPhrase);
  return LEAN_LEADS[sharpReadKey](pickPhrase);
}

// ─── modelBreakdown split: main "Why" + extracted caveat ─────────────

const THOUGH_RE = /^(.+?),\s+though\s+(.+?)\s*\.?\s*$/i;

/**
 * Split a modelBreakdown sentence into the main observation + an optional
 * caveat clause. The generator emits "though X" patterns for data-quality
 * caveats — those are the only patterns we extract. "but X" / "with X"
 * patterns stay whole because they're integral to the lead's meaning, not
 * separable warnings.
 */
export function splitModelBreakdown(
  modelBreakdown: string | null
): { why: string | null; caveat: string | null } {
  if (!modelBreakdown) return { why: null, caveat: null };
  const match = modelBreakdown.match(THOUGH_RE);
  if (!match) return { why: modelBreakdown, caveat: null };
  const main = match[1]!.trim() + ".";
  const rawCaveat = match[2]!.trim();
  const capitalized =
    rawCaveat.charAt(0).toUpperCase() + rawCaveat.slice(1);
  return { why: main, caveat: capitalized + "." };
}

// ─── Sub-D11 duplication guard ───────────────────────────────────────

/**
 * Returns true when the supporting Why line would substantially duplicate
 * the takeaway lead. Per Sub-D11 — if the lead already contains the model
 * observation, hide the Why line. Crude substring overlap heuristic; we
 * compare normalized lowercase substrings and trigger if a 30+ character
 * window of the why appears in the lead. Conservative — false positives
 * would hide useful context, so the threshold is intentionally high.
 */
function whyDuplicatesLead(lead: string, why: string): boolean {
  if (why.length < 30) return false;
  const leadLower = lead.toLowerCase();
  const whyLower = why.toLowerCase();
  // Probe with the first 30 chars of the why sentence after stripping
  // leading non-alpha (e.g. periods, spaces).
  const probe = whyLower.replace(/^[^a-z]+/, "").slice(0, 30);
  if (probe.length < 30) return false;
  return leadLower.includes(probe);
}

// ─── Public entry point ──────────────────────────────────────────────

export function composeTakeaway(game: DailyEdgeGameDto): ComposedTakeaway {
  const verdictKey = game.breakdown.verdict.key;
  const sharpReadKey = game.breakdown.sharpRead.key;
  const pickPhrase = formatPickPhrase(game);
  const lead = composeLead(verdictKey, sharpReadKey, pickPhrase);
  const { why, caveat } = splitModelBreakdown(game.breakdown.modelBreakdown);
  // Sub-D11: drop why when it would duplicate the lead.
  const finalWhy = why && whyDuplicatesLead(lead, why) ? null : why;
  return { lead, why: finalWhy, caveat };
}

// Internal exports for the test suite.
export const __TEST__ = {
  composeLead,
  whyDuplicatesLead,
  BEST_ANGLE_LEADS,
  LEAN_LEADS,
  WATCHLIST_LEADS,
  CAUTION_LEADS,
  NO_PLAY_LEAD,
};
