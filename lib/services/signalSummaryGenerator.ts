/**
 * signalSummaryGenerator — Layer 3 presentation helper.
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Member-Facing
 * Explanation Copy" — brand voice rules + four explicit copy templates.
 *
 * Generates the per-signal description string that appears in the middle
 * column of the signal row in each Pick Breakdown card. Pure function;
 * called at API response time by the /api/lab/daily-edge route per signal.
 *
 * THE K1 ARCHITECTURE (Fix 4.1 — Gap-18 + Gap-19)
 *   Pre-Fix-4.1 a parallel legacy pipeline (sharpSignalEvaluator +
 *   verdictGenerator) wrote signal_summary to the DB at cron time. That
 *   pipeline returned null for EV-only-no-confirmation cases — the
 *   MIL @ CHC empty middle row bug from Session 0. It was also signal-
 *   level (no model awareness) while framework copy is model-aware.
 *
 *   Fix 4.1 deletes the legacy pipeline and derives signal_summary at
 *   API response time from the same evidence + grade the new pipeline
 *   already computes. One source of truth.
 *
 * TEXT DESIGN
 *   The generator's output mirrors framework §"Member-Facing Explanation
 *   Copy" example templates. Each template is anchored to a specific
 *   (grade × evidence) shape:
 *
 *     1. Aligned strong + confirming    → STRONG · ...        (best_signal / sharp_confirmed strong-tier)
 *     2. Aligned EV-only no confirmation→ MODERATE · ...      (Sharp Confirmed bar fails on tier; falls to market_watch)
 *     3. Opposing EV-only no confirmation→ WATCH · ...        (Sharp Conflict bar fails — the MIL @ CHC bug)
 *     4. Opposing confirmed             → STRONG CAUTION · ... (sharp_conflict)
 *
 *   Brand voice rules per framework:
 *     • Plain English first, jargon second
 *     • Cite Pinnacle as the de-vig reference
 *     • Describe public action factually ("public bets" / "public action")
 *     • No exclamation points
 *     • No capper words (LOCK, SMASH, FADE, HAMMER, etc.)
 *     • Quantify (book counts, percentages, EV)
 *     • Lines under 25 words where possible
 *
 *   Non-template shapes (aligned strong steam alone, aligned RLM alone,
 *   model_only, public_smoke aligned, etc.) get extrapolated text within
 *   the brand voice rules. Each extrapolation has a framework-reference
 *   comment so future framework updates are auditable.
 */

import type { Side } from "../types/domain/Lines";
import type { Grade } from "../types/domain/Grade";
import type { SignalEvidence } from "./signalEvidenceClassifier";
import type { MarketSignalSource } from "./marketSignalDerivationService";

export type SignalSummaryContext = {
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  /** Optional — when steam fires aligned, include detected timestamp in
   *  framework template 1 style. */
  steamDetectedAt?: string | null;
};

// ─── Formatting helpers ────────────────────────────────────────────────────

function formatTimeEt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hours = (d.getUTCHours() + 24 - 4) % 24;
  const mins = d.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, "0")} ${ampm} ET`;
}

function formatPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(decimals);
}

/**
 * Member-facing label for the model's pick in this market. Framework
 * template 1 uses "PHI ML" form (team + market). Template 3 uses "Under
 * pick" form. We use the team-only form for ML and side-only form for
 * totals/NRFI, matching the closest framework template for each market.
 */
function pickLabel(
  market_type: string,
  modelSide: Side,
  ctx: SignalSummaryContext
): string {
  if (market_type === "moneyline") {
    return modelSide === "home"
      ? `${ctx.homeTeamAbbr} ML`
      : `${ctx.awayTeamAbbr} ML`;
  }
  if (market_type === "total") {
    return modelSide === "over" ? "Over" : "Under";
  }
  if (market_type === "first_inning_total") {
    return modelSide === "under" ? "NRFI" : "YRFI";
  }
  return "the pick";
}

/**
 * Reference form for the model's pick — used in "the model's {ref} pick"
 * constructions (templates 3 and 4). Subtly different from `pickLabel`:
 * the ML form drops "ML" because the surrounding text already says "pick".
 */
function modelPickRef(
  market_type: string,
  modelSide: Side,
  ctx: SignalSummaryContext
): string {
  if (market_type === "moneyline") {
    return modelSide === "home" ? ctx.homeTeamAbbr : ctx.awayTeamAbbr;
  }
  if (market_type === "total") {
    return modelSide === "over" ? "Over" : "Under";
  }
  if (market_type === "first_inning_total") {
    return modelSide === "under" ? "NRFI" : "YRFI";
  }
  return "pick";
}

/**
 * Label for the side OPPOSITE the model's pick — used in template 3/4
 * forms like "+5.4% EV on Over" when the model picked Under.
 */
function oppositeSideLabel(
  market_type: string,
  modelSide: Side,
  ctx: SignalSummaryContext
): string {
  if (market_type === "moneyline") {
    return modelSide === "home" ? ctx.awayTeamAbbr : ctx.homeTeamAbbr;
  }
  if (market_type === "total") {
    return modelSide === "over" ? "Under" : "Over";
  }
  if (market_type === "first_inning_total") {
    return modelSide === "under" ? "YRFI" : "NRFI";
  }
  return "the other side";
}

/**
 * "Sharp money X% vs public bets Y%" fragment. Returns null when the row
 * has insufficient public-data to compute. Framework brand voice: factual
 * description, no "the public is wrong" framing.
 */
function publicMoneyFragment(signal: MarketSignalSource): string | null {
  if (signal.public_betting_pct === null || signal.public_money_pct === null) {
    return null;
  }
  return `Sharp money ${formatPct(signal.public_money_pct, 0)}% vs public bets ${formatPct(signal.public_betting_pct, 0)}%`;
}

// ─── Per-grade composers ──────────────────────────────────────────────────

/**
 * Compose text for `best_signal` and `sharp_confirmed` grades. The Best
 * Signal / Sharp Confirmed bars guarantee aligned strong-tier signal(s);
 * we lead with whichever strong signal fires (steam > RLM > EV > sharp
 * money divergence priority for the lead sentence; remaining signals
 * become the supporting detail sentence).
 *
 * Framework template 1 (verbatim shape):
 *   "STRONG · Pinnacle EV +3.2% on PHI ML, confirmed by steam across 4
 *    books (detected 11:45 AM ET). Sharp money 65% vs public bets 53%."
 *
 * When only moderate-tier signals fired (e.g., 2× moderate path), use
 * MODERATE header per framework template 2 brand voice extrapolation.
 */
function composeConfirmed(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  evidence: SignalEvidence,
  ctx: SignalSummaryContext
): string {
  const pick = pickLabel(market_type, modelSide, ctx);
  const hasStrongAligned =
    (evidence.steam?.aligned && evidence.steam.tier !== "moderate") ||
    (evidence.rlm?.aligned && evidence.rlm.tier !== "moderate") ||
    (evidence.ev?.aligned && evidence.ev.tier !== "moderate") ||
    (evidence.sharpDivergence?.aligned &&
      evidence.sharpDivergence.tier !== "moderate");
  const header = hasStrongAligned ? "STRONG" : "MODERATE";

  // Lead sentence: prefer steam → RLM → EV → sharp_div as the headline
  // confirmation. Build remaining detail clauses from the other firing
  // signals plus public/money data.
  let lead: string | null = null;
  const details: string[] = [];

  if (evidence.steam?.aligned) {
    const books = signal.steam_books_count ?? 0;
    const detected = formatTimeEt(ctx.steamDetectedAt ?? null);
    const detectedClause = detected ? ` (detected ${detected})` : "";
    lead = `Steam across ${books} books confirms ${pick}${detectedClause}.`;
  } else if (evidence.rlm?.aligned) {
    const pubBets = signal.public_betting_pct;
    const opp = oppositeSideLabel(market_type, modelSide, ctx);
    const pubFragment =
      pubBets !== null && pubBets !== undefined && pubBets < 50
        ? ` despite ${formatPct(100 - pubBets, 0)}% of public bets on ${opp}`
        : pubBets !== null && pubBets !== undefined
        ? ` despite ${formatPct(pubBets, 0)}% public bets`
        : "";
    lead = `Reverse line movement confirms ${pick}${pubFragment}.`;
  } else if (evidence.ev?.aligned) {
    // Phase 2 (Daniel-approved copy guardrail): V1 EV-axis copy when the
    // bar passes on EV alone (Adjustment A best_signal-EV-alone or
    // sharp_confirmed on a strong-tier EV). Cite Pinnacle as the devig
    // reference; do not imply public money, RLM, or steam. Early return
    // suppresses the public_money / EV-detail append below — V1 SharpAPI
    // does not expose public splits, and the EV-axis path should not
    // falsely imply we checked them.
    return `${header} · Pinnacle fair value supports ${pick} at +${formatPct(signal.ev_pct, 1)}% EV — devig reference shows positive expected value.`.trim();
  } else if (evidence.sharpDivergence?.aligned) {
    const pubMoney = publicMoneyFragment(signal);
    lead = pubMoney
      ? `${pubMoney} — sharp money diverges from public action on ${pick}.`
      : `Sharp money divergence supports ${pick}.`;
  } else {
    // Defensive: bar passed but no aligned signal — shouldn't reach here.
    lead = `Sharp signals support ${pick}.`;
  }

  // Detail sentence: include EV if not already the lead.
  if (evidence.ev?.aligned && !lead.includes("EV")) {
    details.push(`Pinnacle EV +${formatPct(signal.ev_pct, 1)}%`);
  }
  // Include public/money divergence detail when not already in the lead.
  const pubMoney = publicMoneyFragment(signal);
  if (pubMoney && !lead.includes("Sharp money")) {
    details.push(pubMoney);
  }

  const detailSentence = details.length > 0 ? ` ${details.join("; ")}.` : "";
  return `${header} · ${lead}${detailSentence}`.trim();
}

/**
 * Compose text for `market_led` grade. The Market-Led bar requires ≥1
 * strong-tier aligned signal; we treat it like Sharp Confirmed but flag
 * the "no model edge" framing per framework §"Market-Led" copy intent.
 */
function composeMarketLed(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  evidence: SignalEvidence,
  ctx: SignalSummaryContext
): string {
  const pick = pickLabel(market_type, modelSide, ctx);
  if (evidence.steam?.aligned) {
    const books = signal.steam_books_count ?? 0;
    const lead = `Steam across ${books} books moves toward ${pick}; model edge is light.`;
    const pubMoney = publicMoneyFragment(signal);
    const detail = pubMoney && !lead.includes("Sharp money") ? ` ${pubMoney}.` : "";
    return `STRONG · ${lead}${detail}`.trim();
  }
  if (evidence.rlm?.aligned) {
    const lead = `Reverse line movement toward ${pick}; model edge is light.`;
    const pubMoney = publicMoneyFragment(signal);
    const detail = pubMoney && !lead.includes("Sharp money") ? ` ${pubMoney}.` : "";
    return `STRONG · ${lead}${detail}`.trim();
  }
  if (evidence.ev?.aligned) {
    // Phase 2 (Daniel-approved Adjustment B copy guardrail):
    // V1 EV-axis-only path. Lead with the literal "Market-led EV signal"
    // phrasing so members never read this as implying public money, RLM,
    // or steam. Early return suppresses the public_money fragment
    // unconditionally — in V1 SharpAPI does not expose public splits,
    // and even when SharpAPI adds them later, the EV-axis-only path
    // should not append that detail and falsely imply we checked it.
    const lead = `Market-led EV signal — Pinnacle fair value favors ${pick} at +${formatPct(signal.ev_pct, 1)}% EV; model edge is light.`;
    return `STRONG · ${lead}`.trim();
  }
  if (evidence.sharpDivergence?.aligned) {
    const lead = `Sharp money divergence favors ${pick}; model edge is light.`;
    const pubMoney = publicMoneyFragment(signal);
    const detail = pubMoney && !lead.includes("Sharp money") ? ` ${pubMoney}.` : "";
    return `STRONG · ${lead}${detail}`.trim();
  }
  const lead = `Market moves toward ${pick}; model edge is light.`;
  const pubMoney = publicMoneyFragment(signal);
  const detail = pubMoney && !lead.includes("Sharp money") ? ` ${pubMoney}.` : "";
  return `STRONG · ${lead}${detail}`.trim();
}

/**
 * Compose text for `sharp_conflict` grade. Framework template 4 (verbatim):
 *   "STRONG CAUTION · Steam across 3 books opposing the model's Under pick.
 *    Pinnacle EV +4.2% on Over confirms. Sharp money 65% on Over vs public
 *    53%."
 *
 * Lead with the strong opposing primary signal (steam / RLM / sharp_div).
 * Append confirming opposing indicator (typically EV at moderate+).
 */
function composeSharpConflict(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  evidence: SignalEvidence,
  ctx: SignalSummaryContext
): string {
  const pickRef = modelPickRef(market_type, modelSide, ctx);
  const oppSide = oppositeSideLabel(market_type, modelSide, ctx);

  let lead: string;
  if (evidence.steam && !evidence.steam.aligned) {
    const books = signal.steam_books_count ?? 0;
    lead = `Steam across ${books} books opposing the model's ${pickRef} pick.`;
  } else if (evidence.rlm && !evidence.rlm.aligned) {
    lead = `Reverse line movement opposing the model's ${pickRef} pick.`;
  } else if (
    evidence.sharpDivergence &&
    !evidence.sharpDivergence.aligned
  ) {
    lead = `Sharp money divergence opposing the model's ${pickRef} pick.`;
  } else {
    // Defensive — bar shouldn't pass without an opposing primary.
    lead = `Sharp signals oppose the model's ${pickRef} pick.`;
  }

  const details: string[] = [];
  if (evidence.ev && !evidence.ev.aligned) {
    details.push(
      `Pinnacle EV +${formatPct(signal.ev_pct, 1)}% on ${oppSide} confirms`
    );
  }
  if (signal.public_betting_pct !== null && signal.public_money_pct !== null) {
    details.push(
      `Sharp money ${formatPct(signal.public_money_pct, 0)}% on ${oppSide} vs public ${formatPct(signal.public_betting_pct, 0)}%`
    );
  }

  const detailSentence =
    details.length > 0 ? ` ${details.join(". ")}.` : "";
  return `STRONG CAUTION · ${lead}${detailSentence}`.trim();
}

/**
 * Compose text for `public_smoke` grade. Framework §"Public Smoke":
 * "heavy public action with no supporting sharp signals. Pure recreational
 * action." Member-facing tone: "the crowd loves this, but no smart money is
 * showing up."
 *
 * Brand voice extrapolation — framework doesn't give a verbatim public
 * smoke template; this text follows the brand voice rules (factual
 * description of public action; no "the public is wrong" framing).
 */
function composePublicSmoke(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  ctx: SignalSummaryContext
): string {
  const pick = pickLabel(market_type, modelSide, ctx);
  const pubBets = formatPct(signal.public_betting_pct, 0);
  return `CAUTION · ${pubBets}% of public bets on ${pick}; money tracks tickets and no sharp confirmation. Recreational action without sharp support.`;
}

/**
 * Compose text for `market_watch` grade. Three sub-shapes:
 *   • Opposing EV-only (framework template 3 — the MIL @ CHC case):
 *       "WATCH · Pinnacle fair value opposes the model's Under pick —
 *        +5.4% EV on Over. No confirming steam or sharp money divergence
 *        on the opposing side."
 *   • Aligned EV-only (framework template 2):
 *       "MODERATE · Pinnacle fair value supports PHI ML — +2.1% EV.
 *        No confirming steam or sharp money divergence."
 *   • Genuine no-actionable-signal: framework brand voice extrapolation
 *     ("No actionable sharp signals detected on this pick.")
 */
function composeMarketWatch(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  evidence: SignalEvidence,
  ctx: SignalSummaryContext
): string {
  const pickRef = modelPickRef(market_type, modelSide, ctx);
  const pick = pickLabel(market_type, modelSide, ctx);
  const oppSide = oppositeSideLabel(market_type, modelSide, ctx);

  // Opposing EV-only path — framework template 3 shape.
  // Phase 2 (Daniel-approved copy guardrail): replaced the older
  // "No confirming steam or sharp money divergence on the opposing
  // side" wording, which implied we LOOKED for those signals and
  // didn't find them. In V1 SharpAPI does not expose steam / sharp
  // divergence at all, so the previous wording was misleading. New
  // wording cites the framework bar directly without implying we
  // checked V1-absent data sources.
  if (evidence.ev && !evidence.ev.aligned) {
    return (
      `WATCH · Pinnacle fair value opposes the model's ${pickRef} pick — ` +
      `+${formatPct(signal.ev_pct, 1)}% EV on ${oppSide}. Below the bar for sharp conflict.`
    );
  }

  // Aligned EV-only path — framework template 2 shape, same V1 rewording.
  if (evidence.ev?.aligned) {
    return (
      `MODERATE · Pinnacle fair value supports ${pick} — ` +
      `+${formatPct(signal.ev_pct, 1)}% EV. Conviction below the bar for sharp confirmed.`
    );
  }

  // Genuine "no actionable signal" — fall back to honest neutral text.
  return "No actionable sharp signals detected on this pick.";
}

/**
 * Compose text for `model_only` grade. Framework §"Model Only":
 * "Pure model-driven plays. Honest framing matters — members should know
 * the market hasn't confirmed."
 *
 * Brand voice extrapolation — no verbatim template. Stays honest about
 * the lack of market activity.
 */
function composeModelOnly(
  modelSide: Side,
  market_type: string,
  ctx: SignalSummaryContext
): string {
  const pick = pickLabel(market_type, modelSide, ctx);
  return `Model identifies ${pick} with no major market activity yet — pure model-driven read.`;
}

// ─── Top-level generator ──────────────────────────────────────────────────

/**
 * Generate framework-aligned text for one signal row.
 *
 * Returns the description string to render in the signal row's middle
 * column. Fallback for true no-signal-detected case is "No actionable
 * sharp signals detected on this pick." per Flag B1.
 */
export function generateSignalSummary(
  modelSide: Side,
  market_type: string,
  signal: MarketSignalSource,
  evidence: SignalEvidence,
  grade: Grade | null,
  ctx: SignalSummaryContext
): string {
  switch (grade) {
    case "best_signal":
    case "sharp_confirmed":
      return composeConfirmed(modelSide, market_type, signal, evidence, ctx);

    case "market_led":
      return composeMarketLed(modelSide, market_type, signal, evidence, ctx);

    case "sharp_conflict":
      return composeSharpConflict(
        modelSide,
        market_type,
        signal,
        evidence,
        ctx
      );

    case "public_smoke":
      return composePublicSmoke(modelSide, market_type, signal, ctx);

    case "model_only":
      return composeModelOnly(modelSide, market_type, ctx);

    case "market_watch":
      return composeMarketWatch(modelSide, market_type, signal, evidence, ctx);

    case null:
    default:
      // No grade derived — model didn't pick this market, or grade not
      // computed. Honest fallback.
      return "No actionable sharp signals detected on this pick.";
  }
}
