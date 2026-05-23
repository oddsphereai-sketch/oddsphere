/**
 * Verdict Generator — compose customer-facing banner text from an evaluator
 * result + game context.
 *
 * Pure function. No I/O.
 *
 * Brand voice rules (locked):
 *   • Lead with verdict label + market identifier ("STRONG · Houston ML home")
 *   • Quantify everything (book counts, percentages, EV)
 *   • Time-stamp when relevant ("detected 4:15 PM ET")
 *   • Cite Pinnacle as the de-vig reference
 *   • Describe public action factually — "public bets" / "public action" /
 *     "retail action" — NEVER "public square", "squares", "the public is wrong"
 *   • No exclamation points
 *   • No capper words: LOCK, SMASH, FADE, HAMMER, NUKE, BOMB
 *
 * Returns null for neutral verdicts (no banner rendered).
 */

import type { SharpSignalRecord } from "../../providers/interfaces/IBettingProvider";
import type { SignalEvaluation } from "./sharpSignalEvaluator";

export type GameContext = {
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  /** Optional — when provided, weather context can reinforce the verdict text */
  weatherWindMph?: number | null;
  weatherWindDirRelative?: string | null;
};

export function generateVerdictText(
  evaluation: SignalEvaluation,
  signal: SharpSignalRecord,
  context: GameContext
): string | null {
  if (evaluation.verdict === null) return null;
  if (evaluation.verdict === "CAUTION") {
    return composeCaution(evaluation, signal, context);
  }
  return composeStrong(evaluation, signal, context);
}

// ─────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────

function marketLabel(marketType: string): string {
  switch (marketType) {
    case "moneyline":           return "ML";
    case "spread":              return "Spread";
    case "total":               return "Total";
    case "first_inning_total":  return "NRFI/YRFI";
    default:                    return marketType;
  }
}

function sideLabel(
  marketType: string,
  side: string,
  context: GameContext
): string {
  // For ML/spread → use team abbreviation
  if (marketType === "moneyline" || marketType === "spread") {
    if (side === "home") return context.homeTeamAbbr;
    if (side === "away") return context.awayTeamAbbr;
    return side;
  }
  // For totals → "over" / "under"
  return side;
}

function formatPct(value: number | null, decimals = 1): string {
  if (value === null) return "—";
  return value.toFixed(decimals);
}

function formatTimeEt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Format HH:MM ET — assumes UTC input, converts to ET (UTC-4 in DST)
  // For brand-voice text, 'ET' suffix is acceptable; precise DST handling
  // is overkill for V1.
  const hours = (d.getUTCHours() + 24 - 4) % 24;
  const mins = d.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, "0")} ${ampm} ET`;
}

// ─────────────────────────────────────────────────────────────────────────
// STRONG composer
// ─────────────────────────────────────────────────────────────────────────

function composeStrong(
  evaluation: SignalEvaluation,
  s: SharpSignalRecord,
  ctx: GameContext
): string {
  const market = marketLabel(s.market_type);
  const side = sideLabel(s.market_type, s.side, ctx);
  const header = `STRONG · ${side} ${market}${market === "Total" ? ` ${s.side}` : ` ${s.side}`}`;

  // Pick the dominant rationale based on what fired
  const reasons = evaluation.reasons;
  const hasSteam = reasons.some((r) => r.startsWith("steam_strong"));
  const hasRlm = reasons.includes("reverse_line_movement");
  const hasDivergence = reasons.some((r) => r.startsWith("sharp_money_divergence_strong"));
  const fromStack = reasons.some((r) => r.startsWith("weak_signal_stack"));

  const evStr = `+EV ${formatPct(s.ev_pct, 1)}% vs Pinnacle fair`;
  const publicStr = (() => {
    const bp = s.public_betting_pct;
    const mp = s.public_money_pct;
    if (bp === null || mp === null) return null;
    return `Sharp money ${formatPct(mp, 0)}% vs public bets ${formatPct(bp, 0)}%`;
  })();

  if (hasSteam) {
    const steamCount = s.steam_books_count ?? 0;
    const detected = formatTimeEt(s.steam_detected_at);
    const detectedClause = detected ? ` (detected ${detected})` : "";
    const sentence1 = `Steam across ${steamCount} books shifted the line${detectedClause}.`;
    const sentence2 = publicStr ? `${publicStr}; ${evStr}.` : `${evStr}.`;
    return `${formatHeader(side, s, ctx)} — ${sentence1} ${sentence2}`;
  }

  if (hasRlm) {
    const otherSide = oppositeSide(s.side);
    const otherLabel = otherSide
      ? sideLabel(s.market_type, otherSide, ctx)
      : "the other side";
    const bp = s.public_betting_pct;
    // "drifted toward X despite Y% of public bets on Z"
    // bp is the percentage of public bets on THIS signal's side.
    // If bp >= 50: public mostly on THIS side, but line moved away → drift toward other.
    // If bp < 50:  public mostly on the OTHER side, but line moved toward this → drift toward this.
    let drift: string;
    if (bp !== null && bp >= 50) {
      drift = `Reverse line movement: market drifted toward ${otherLabel} despite ${formatPct(bp, 0)}% of public bets on ${side}.`;
    } else if (bp !== null) {
      // Show "100 - bp" on the other side, since bp is on THIS side
      drift = `Reverse line movement: market drifted toward ${side} despite ${formatPct(100 - bp, 0)}% of public bets on ${otherLabel}.`;
    } else {
      drift = `Reverse line movement on this market.`;
    }
    const mp = s.public_money_pct;
    const moneyClause =
      mp !== null
        ? ` Sharp money ${formatPct(mp, 0)}% of $ volume; ${evStr}.`
        : ` ${evStr}.`;
    return `${formatHeader(side, s, ctx)} — ${drift}${moneyClause}`;
  }

  if (hasDivergence) {
    const sentence1 = publicStr
      ? `${publicStr} — sharp money diverges from public action.`
      : `Sharp money diverges from public action.`;
    const weatherClause = formatWeatherClause(s, ctx);
    const tail = weatherClause ? ` ${weatherClause}; ${evStr}.` : ` ${evStr}.`;
    return `${formatHeader(side, s, ctx)} — ${sentence1}${tail}`;
  }

  if (fromStack) {
    // Stack of weak signals — describe the converging picture
    const count = (reasons.find((r) => r.startsWith("weak_signal_stack")) ?? "")
      .match(/\((\d+) confirming\)/)?.[1] ?? "3";
    const weatherClause = formatWeatherClause(s, ctx);
    const tail = weatherClause ? ` ${weatherClause}; ${evStr}.` : ` ${evStr}.`;
    return `${formatHeader(side, s, ctx)} — ${count} converging signals favor ${side}.${tail}`;
  }

  // Fallback (primary +EV but no specific confirming signal labeled — shouldn't reach here)
  return `${formatHeader(side, s, ctx)} — Sharp signal alignment; ${evStr}.`;
}

function formatHeader(
  side: string,
  s: SharpSignalRecord,
  _ctx: GameContext
): string {
  const market = marketLabel(s.market_type);
  if (s.market_type === "moneyline") return `STRONG · ${side} ML ${s.side === "home" ? "home" : "away"}`;
  if (s.market_type === "spread") return `STRONG · ${side} spread`;
  return `STRONG · ${market} ${s.side}`;
}

function formatWeatherClause(
  s: SharpSignalRecord,
  ctx: GameContext
): string | null {
  if (s.market_type !== "total") return null;
  const mph = ctx.weatherWindMph;
  const dir = ctx.weatherWindDirRelative;
  if (mph === null || mph === undefined || mph < 12 || !dir) return null;
  if (dir.startsWith("out_")) {
    const target = dir.replace(/^out_to_/, "").toUpperCase();
    return `${mph}mph wind blowing out to ${target} reinforces`;
  }
  if (dir.startsWith("in_")) {
    const target = dir.replace(/^in_from_/, "").toUpperCase();
    return `${mph}mph wind blowing in from ${target} reinforces`;
  }
  return null;
}

function oppositeSide(side: string): string | null {
  if (side === "home") return "away";
  if (side === "away") return "home";
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// CAUTION composer
// ─────────────────────────────────────────────────────────────────────────

function composeCaution(
  evaluation: SignalEvaluation,
  s: SharpSignalRecord,
  ctx: GameContext
): string {
  const market = marketLabel(s.market_type);
  const side = sideLabel(s.market_type, s.side, ctx);
  const reasons = evaluation.reasons;

  if (reasons.some((r) => r.startsWith("negative_ev"))) {
    return `CAUTION · ${side} ${market} ${s.side === "home" || s.side === "away" ? "" : s.side} — Pinnacle fair implies the offered price is ${formatPct(s.ev_pct, 1)}% EV. Market believes this is mispriced.`.replace(/\s+/g, " ").trim();
  }
  if (reasons.some((r) => r.startsWith("public_heavy_no_confirm"))) {
    const bp = formatPct(s.public_betting_pct, 0);
    return `CAUTION · ${bp}% of public bets on ${side} but money split evenly; no steam, no reverse line movement. Public action without sharp confirmation.`;
  }
  if (reasons.includes("conflicting_steam_vs_rlm")) {
    return `CAUTION · ${market} ${s.side} — Steam in one direction but reverse line movement in the other. Signals conflict; reduce conviction.`;
  }
  // Fallback
  return `CAUTION · ${side} ${market} ${s.side}. Signals warrant caution.`.replace(/\s+/g, " ").trim();
}
