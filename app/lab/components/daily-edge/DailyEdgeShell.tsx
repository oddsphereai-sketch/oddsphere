"use client";

/**
 * Phase 4.1.11 — Production Daily Edge UI port.
 *
 * Ports the v13.1 design-preview architecture into production, consuming
 * the new `markets.{moneyline, total, first_inning}` DTO shape from 4.1.10.
 *
 * Layout: locked Selected Edge Reader at the top of the viewport with a
 * scrollable Edge Board below. Full View / Compact toggle collapses the
 * reader to a single-row summary so the slate gets more vertical space.
 *
 * Per-market rules locked from earlier phases:
 *   • First-inning never uses public-split copy. When splits are null
 *     (always the case in V1), MarketPulse shows the honest fallback:
 *     "No first-inning public split data. Model, price, and matchup
 *     factors shown below."
 *   • ML/Total fall back to "No public split data" when both moneyPct
 *     and betsPct are null.
 *   • No banned terms in user-facing copy — all copy comes from the
 *     server-side helpers (perMarketCopyGenerator + decisionLine) which
 *     are banned-terms-linted at generation time.
 *
 * First pass focus: architectural correctness over pixel-perfect polish.
 * Visual review with Daniel after this lands, then iterate on detail.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDailyEdge } from "../../hooks/useDailyEdge";
import { useSportSelection } from "../../hooks/useSportSelection";
import {
  buildEdgeStackRows,
  marketSourceLabel,
} from "../../lib/edgeStackRows";
import { classifyPickRelativeLineMove } from "../../lib/lineMoveTone";
import type {
  DailyEdgeGameDto,
  MarketEdgeDto,
} from "../../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import { isContextOnlyDisplayMarket } from "@/lib/config/officialTrackingMarkets";
import { teamPrimaryColor } from "./teamColors";
import { LockBadge } from "./LockBadge";

// ─── Types ─────────────────────────────────────────────────────────────

type MarketKey = "moneyline" | "total" | "first_inning";
type VerdictKey =
  | "best_angle"
  | "lean"
  | "watchlist"
  | "caution"
  | "no_play";

const MARKET_SHORT_LABEL: Record<MarketKey, string> = {
  moneyline: "ML",
  total: "Total",
  first_inning: "1st",
};

const MARKET_LONG_LABEL: Record<MarketKey, string> = {
  moneyline: "Moneyline",
  total: "Total",
  first_inning: "1st Inning",
};

// Phase 7F (Path A) — sport-aware market labels. NBA reuses the
// `first_inning` DTO slot for Spread; NHL reuses it for Puck Line. MLB
// uses it for 1st-Inning (NRFI/YRFI). One DTO slot, three labels.
//
// 2026-06-10 corrected product direction: NBA Spread and NHL Puck Line
// are CONTEXT-ONLY markets — visible as model context / reader
// guidance, but NOT part of official public tracking. Their short
// labels carry a "*" indicator mapping to the footnote
// "* Model context · Not part of official tracking" rendered below the
// market chips. MLB ML / Total / 1st are officially tracked.
//
// 2026-06-10 P1-1: registry-driven. The shell delegates the
// (sport, market) classification to the central registry at
// lib/config/officialTrackingMarkets.ts so the UI, the auditor, and
// any future writer guards share one source of truth. The
// `first_inning` DTO slot is the UI delivery channel; the registry's
// `CONTEXT_ONLY_DISPLAY_MARKETS` records "spread" for NBA / NHL
// because that is the underlying market_type those slots represent
// (NHL puck-line is stored under market_type="spread" in `lines`).
function isContextOnlyMarket(market: MarketKey, sport: Sport): boolean {
  if (market !== "first_inning") return false;
  // The first_inning DTO slot is a context-only display IF the
  // underlying market for this sport is registered as context-only.
  return isContextOnlyDisplayMarket(sport, "spread");
}
function marketShortLabelFor(market: MarketKey, sport: Sport): string {
  if (market === "first_inning") {
    if (sport === "nhl") return "PL*";
    if (sport === "nba") return "Sprd*";
    if (sport === "soccer") return "BTTS";
  }
  if (sport === "soccer") {
    if (market === "moneyline") return "Match";
  }
  return MARKET_SHORT_LABEL[market];
}
function marketLongLabelFor(market: MarketKey, sport: Sport): string {
  if (market === "first_inning") {
    if (sport === "nhl") return "Puck Line";
    if (sport === "nba") return "Spread";
    if (sport === "soccer") return "Both Teams To Score";
  }
  if (sport === "soccer") {
    if (market === "moneyline") return "Match Result";
  }
  return MARKET_LONG_LABEL[market];
}

/** Footnote shown beneath the per-card market strip whenever any market
 *  on the card is a context-only market (NBA Spread, NHL Puck Line).
 *  The "*" appended to those labels by marketShortLabelFor maps here. */
const CONTEXT_ONLY_FOOTNOTE = "* Model context · Not part of official tracking";
// Sport-aware pick fallback when the market has no pick label. MLB
// shows "Toss-Up" on first_inning (the [0.85, 1.15) FI band); NBA
// and NHL (which never have a held FI concept) show "Held".
function pickFallbackFor(market: MarketKey, sport: Sport): string {
  if (sport === "nba" || sport === "nhl" || sport === "soccer") return "Held";
  return market === "first_inning" ? "Toss-Up" : "Held";
}

/**
 * Sport-aware matchup separator. International football is neutral-venue
 * so " vs " is the convention; MLB/NBA/NHL use the home/away "@".
 */
function matchupSepFor(sport: Sport): string {
  return (sport === "soccer" || sport === "ucl") ? "vs" : "@";
}

/**
 * Customer-facing pick label transform for soccer raw values. Returns
 * the original pick string when the sport doesn't need translation,
 * so MLB/NBA/NHL paths are byte-identical.
 *
 * Soccer market_result pick maps to the team abbreviation when teams
 * are available: pick="home" → homeAbbr, pick="away" → awayAbbr,
 * pick="draw" → "Draw". DC + BTTS + Total transformations also handled.
 */
function soccerPickLabel(
  market: MarketKey,
  pick: string | null,
  line: number | null,
  awayAbbr: string | null,
  homeAbbr: string | null,
): string | null {
  if (pick === null) return null;
  // Match result
  if (market === "moneyline") {
    if (pick === "home") return homeAbbr ?? "Home";
    if (pick === "away") return awayAbbr ?? "Away";
    if (pick === "draw") return "Draw";
  }
  // BTTS (lives on the first_inning slot in the soccer DTO)
  if (market === "first_inning") {
    if (pick === "yes") return "Yes";
    if (pick === "no") return "No";
  }
  // Total
  if (market === "total") {
    const lineStr = line !== null ? ` ${line}` : "";
    if (pick === "over") return `Over${lineStr}`;
    if (pick === "under") return `Under${lineStr}`;
    if (pick.toLowerCase() === "over") return `Over${lineStr}`;
    if (pick.toLowerCase() === "under") return `Under${lineStr}`;
  }
  // Double Chance (not currently surfaced as a market key but kept for
  // forward compatibility if/when the soccer DTO adds it).
  if (pick === "home_or_draw") return `${homeAbbr ?? "Home"} or Draw`;
  if (pick === "away_or_draw") return `${awayAbbr ?? "Away"} or Draw`;
  if (pick === "home_or_away") return `${awayAbbr ?? "Away"} or ${homeAbbr ?? "Home"}`;
  return pick;
}

/**
 * Sport-aware list of markets to RENDER as chips/columns on the slate
 * card + reader. The first_inning slot is repurposed per sport
 * (MLB: NRFI/YRFI, NBA: Spread, NHL: Puck Line).
 *
 * 2026-06-10 corrected product direction:
 * All three slots render. NBA Spread and NHL Puck Line render as
 * CONTEXT-ONLY markets — visible as model context / reader guidance,
 * NOT part of official public tracking. They carry a "*" indicator
 * (marketShortLabelFor) that maps to the footnote rendered below the
 * market chips. They are NOT written to `prediction_records` and do
 * NOT appear in the public tracking page.
 *
 * History:
 * - cba9ea5 (2026-06-10) hid NBA spread because the audit framed it as
 *   "must be persisted OR hidden." That framing conflated public
 *   tracking with internal audit (see
 *   feedback-public-tracking-vs-internal-audit memory + Phase 4 §A.4).
 * - Local commit 859ae3c (dropped before push, 2026-06-10) extended
 *   the same hide to NHL puck-line — also wrong per the corrected
 *   direction.
 * - This commit restores both as context-only. Internal
 *   `displayed_market_snapshot` substrate is a P1 follow-up
 *   (see docs/audit/07-current-site-stabilization-plan.md).
 */
function marketKeysFor(sport: Sport): MarketKey[] {
  return ["moneyline", "total", "first_inning"];
}

// Phase 7F (Path A) — Sport context so deeply-nested inline components
// can read the current sport without prop-drilling. Default "mlb" so
// any consumer that renders outside the provider falls back to MLB
// behavior (zero MLB-side regression).
const ShellSportContext = createContext<Sport>("mlb");
function useShellSport(): Sport {
  return useContext(ShellSportContext);
}

const VERDICT_LABEL: Record<VerdictKey, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

const VERDICT_GLYPH: Record<VerdictKey, string> = {
  best_angle: "★",
  lean: "↗",
  watchlist: "◐",
  caution: "⚠",
  no_play: "○",
};

/**
 * Verdict color system — v4 palette (R-16H — Lean/Watchlist swap).
 *
 * Each tier on its own hue. Per R-16H, Lean and Watchlist colors were
 * swapped so Lean carries the more eye-catching sky tone (Lean is the
 * common verdict users actually act on) and Watchlist carries the
 * quieter indigo (informational, not actionable):
 *
 *   No Play     → dim gray              (off / skip)
 *   Caution     → amber + subtle glow   (warning)
 *   Watchlist   → indigo (periwinkle)   (informational, secondary)
 *   Lean        → sky                   (moderate actionable, common, eye-catching)
 *   Best Angle  → emerald + strong glow (peak actionable, rare)
 *
 * Violet stays reserved exclusively for "selected/active" UI state and
 * never appears as a verdict tone. Indigo-300 is bluer/distinct from
 * violet-400 so the selected-state and Watchlist visual languages don't
 * compete.
 */
const VERDICT_TEXT_COLOR: Record<VerdictKey, string> = {
  best_angle: "text-emerald-300",
  lean: "text-sky-300",
  watchlist: "text-indigo-300",
  caution: "text-amber-300",
  no_play: "text-gray-500",
};

const VERDICT_BAND_TINT: Record<VerdictKey, string> = {
  best_angle: "from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent border-emerald-500/30",
  lean: "from-sky-500/[0.10] via-sky-500/[0.03] to-transparent border-sky-500/25",
  watchlist: "from-white/[0.04] via-white/[0.015] to-transparent border-white/[0.08]",
  caution: "from-amber-500/[0.12] via-amber-500/[0.04] to-transparent border-amber-500/30",
  no_play: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
};

/**
 * Optional text-shadow drop-glow applied to the VerdictChip glyph + label.
 * Only the rare/strong verdicts get a glow so the common ones (Lean,
 * Watchlist) don't visually shout. Empty string = no glow.
 */
const VERDICT_GLOW: Record<VerdictKey, string> = {
  best_angle: "drop-shadow-[0_0_6px_rgba(110,231,183,0.55)]",
  lean: "",
  watchlist: "",
  caution: "drop-shadow-[0_0_5px_rgba(251,191,36,0.50)]",
  no_play: "",
};

/**
 * Per-verdict tint applied to the three market pills inside each slate
 * card (ML / Total / 1st). Each pill wears its OWN market's verdict
 * tone so users can scan vertical slice down the grid and spot which
 * markets carry value, without clicking in.
 *
 * Lean stays neutral (the most common verdict — must not paint cards).
 * Watchlist / Caution / Best Angle get their tones at low saturation
 * so a card with all three markets at different verdicts reads as
 * three quiet tones, not three loud ones.
 */
const VERDICT_PILL_TINT: Record<VerdictKey, string> = {
  best_angle: "bg-emerald-500/[0.12] border-emerald-500/35 hover:bg-emerald-500/[0.18] hover:border-emerald-400/50",
  // R-16H: Lean wears sky (swapped from Watchlist) — the more
  // eye-catching tone for the common "actionable" verdict. Saturation
  // sits between Best Angle (emerald, rare/peak) and Watchlist (indigo,
  // informational) so it reads "actionable but not peak."
  lean: "bg-sky-500/[0.09] border-sky-500/25 hover:bg-sky-500/[0.16] hover:border-sky-400/45",
  // R-16H: Watchlist wears indigo (swapped from Lean) — quieter,
  // periwinkle, signals "informational, secondary attention."
  watchlist: "bg-indigo-500/[0.08] border-indigo-500/25 hover:bg-indigo-500/[0.14] hover:border-indigo-400/45",
  caution: "bg-amber-500/[0.10] border-amber-500/30 hover:bg-amber-500/[0.16] hover:border-amber-400/45",
  no_play: "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/[0.10]",
};

const SHARP_GLYPH: Record<string, string> = {
  confirm: "✓",
  mixed: "○",
  caution: "⚠",
};

const SHARP_TONE: Record<string, string> = {
  confirm: "text-emerald-300",
  mixed: "text-gray-400",
  caution: "text-amber-300",
};

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * ESPN logo slugs by our DB abbreviation. Most teams are just the lowercase
 * abbreviation, but two have post-rebrand differences:
 *   CWS (our DB) → "chw" at ESPN's CDN
 *   ATH (our DB, post-rebrand) → "oak" at ESPN's CDN
 * Anything not in the map falls through to lowercase(abbr).
 */
const ESPN_LOGO_SLUG: Record<string, string> = {
  CWS: "chw",
  ATH: "oak",
};

// ESPN slug overrides for NBA abbreviations that ESPN spells differently.
// (Most NBA abbrevs already match ESPN's URL slug; this map just covers
// the rare cases where ours and ESPN's diverge.)
const ESPN_NBA_SLUG: Record<string, string> = {
  // Most NBA teams use lowercased abbrev as-is — no overrides needed today.
  // Add here if a logo 404s: e.g. NYK: "ny", SAS: "sa".
};

function espnLogoUrl(abbr: string, sport: Sport = "mlb"): string {
  if (sport === "nba") {
    const slug = ESPN_NBA_SLUG[abbr] ?? abbr.toLowerCase();
    return `https://a.espncdn.com/i/teamlogos/nba/500/${slug}.png`;
  }
  if (sport === "nhl") {
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr.toLowerCase()}.png`;
  }
  if (sport === "soccer") {
    // No CDN logos sourced for WC teams yet. UI renders abbreviation
    // as fallback when the <img> 404s; empty URL produces the same
    // visual outcome without firing a 404 request.
    return "";
  }
  const slug = ESPN_LOGO_SLUG[abbr] ?? abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`;
}

function formatAmerican(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : String(price);
}

/**
 * Defensive: return null if the game's markets block is missing or the
 * requested market slot is empty. This protects against stale SWR cache
 * entries returned before the 4.1.10 DTO additives shipped — without it
 * the shell would throw "Cannot read properties of undefined" during a
 * transient cache state. The caller renders an empty-state fallback in
 * that case so the page never blanks.
 */
function pickMarket(game: DailyEdgeGameDto, market: MarketKey): MarketEdgeDto | null {
  if (!game || !game.markets) return null;
  const m = game.markets[market];
  return m ?? null;
}

function asVerdictKey(s: string): VerdictKey {
  if (
    s === "best_angle" ||
    s === "lean" ||
    s === "watchlist" ||
    s === "caution" ||
    s === "no_play"
  ) {
    return s;
  }
  return "no_play";
}

/**
 * Build the single "edge row" surfaced in the Compact reader. Picks the
 * strongest available signal in priority order: value gap → model vs
 * market → bet split → line move. Returns null when none of those have
 * meaningful data (caller decides whether to show a soft fallback).
 *
 * Beginner-friendly language only. No banned terms (Pinnacle, EV, +EV,
 * no-vig, RLM, CLV, etc.) — the route's banned-terms linter doesn't run
 * on UI-side strings, so we follow the same rules manually.
 */
type EdgeRow = { label: string; value: string; tone: "emerald" | "amber" | "sky" | "gray" };

function buildEdgeRow(market: MarketKey, m: MarketEdgeDto, sport: Sport = "mlb"): EdgeRow | null {
  // 1. Value gap — strongest signal when present and material.
  if (m.pinnacleEvPct !== null && Math.abs(m.pinnacleEvPct) >= 0.3) {
    const sign = m.pinnacleEvPct >= 0 ? "+" : "";
    const priceTail =
      m.priceAmerican !== null ? ` at ${formatAmerican(m.priceAmerican)}` : "";
    return {
      label: "Value edge",
      value: `${sign}${m.pinnacleEvPct.toFixed(1)}%${priceTail}`,
      tone: m.pinnacleEvPct >= 0 ? "emerald" : "amber",
    };
  }

  // 2. Model vs market gap — clean side-by-side read of the model's
  //    probability vs the market's fair probability for the pick.
  if (m.modelProb !== null && m.marketFairProb !== null) {
    const modelPct = Math.round(m.modelProb * 100);
    const marketPct = Math.round(m.marketFairProb * 100);
    const gap = modelPct - marketPct;
    if (market === "total" && m.modelTotal !== null && m.marketTotal !== null) {
      // For totals, the absolute unit-difference is more intuitive than a
      // probability gap. Unit name is sport-aware: MLB → runs, NHL → goals,
      // NBA → points.
      const diff = m.modelTotal - m.marketTotal;
      const sign = diff >= 0 ? "+" : "";
      const unit = sport === "nhl" || sport === "soccer" ? "goals" : sport === "nba" ? "points" : "runs";
      return {
        label: "Model read",
        value: `${m.modelTotal.toFixed(1)} ${unit} vs market ${m.marketTotal.toFixed(1)} (${sign}${diff.toFixed(1)})`,
        tone: Math.abs(diff) >= 0.2 ? "sky" : "gray",
      };
    }
    return {
      label: "Model read",
      value: `${modelPct}% vs market ${marketPct}%`,
      tone: gap >= 1 ? "sky" : gap <= -1 ? "amber" : "gray",
    };
  }

  // 3. Bet split — only when both halves are present.
  if (m.moneyPct !== null && m.betsPct !== null) {
    return {
      label: "Bet split",
      value: `${m.moneyPct}% money / ${m.betsPct}% bets`,
      tone: m.moneyPct - m.betsPct >= 3 ? "emerald" : m.moneyPct - m.betsPct <= -3 ? "amber" : "gray",
    };
  }

  // 4. Line move — only when we have both endpoints.
  //
  // Phase 6B.13 — shared pick-relative tone helper. Both this compact
  // reader and the expanded Edge Stack now route through
  // classifyPickRelativeLineMove so they cannot disagree. A 1pp+
  // implied-prob shift toward the picked side is emerald (supportive),
  // away is amber (caution), smaller deltas stay neutral (normal vig).
  if (m.lineOpenAmerican !== null && m.priceAmerican !== null) {
    const dir = classifyPickRelativeLineMove(m.lineOpenAmerican, m.priceAmerican);
    if (dir !== "flat") {
      const tone: EdgeRow["tone"] =
        dir === "toward" ? "emerald" : "amber";
      return {
        label: "Price move",
        value: `${formatAmerican(m.lineOpenAmerican)} → ${formatAmerican(m.priceAmerican)}`,
        tone,
      };
    }
  }

  return null;
}

const EDGE_TONE_TEXT: Record<EdgeRow["tone"], string> = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  sky: "text-sky-300",
  gray: "text-gray-400",
};

/**
 * Best edge tag for a single market — used as the small chip on
 * SlateCards. Compact form (label only, no numbers) so the card stays
 * readable. Returns null when no meaningful signal exists.
 */
function buildCardEdgeChip(m: MarketEdgeDto): { label: string; tone: EdgeRow["tone"] } | null {
  if (m.pinnacleEvPct !== null && m.pinnacleEvPct >= 0.5) {
    return { label: `+${m.pinnacleEvPct.toFixed(1)}% value`, tone: "emerald" };
  }
  if (m.modelProb !== null && m.marketFairProb !== null) {
    const gap = (m.modelProb - m.marketFairProb) * 100;
    if (gap >= 1.5) return { label: "Model edge", tone: "sky" };
  }
  if (m.moneyPct !== null && m.betsPct !== null && m.moneyPct - m.betsPct >= 5) {
    return { label: "Market support", tone: "emerald" };
  }
  return null;
}

function headlineMarketFor(game: DailyEdgeGameDto): MarketKey {
  // Pick the market with the strongest verdict, ML > Total > 1st on ties.
  const rank: Record<VerdictKey, number> = {
    best_angle: 4,
    lean: 3,
    watchlist: 2,
    caution: 1,
    no_play: 0,
  };
  const candidates: Array<{ key: MarketKey; r: number }> = [
    { key: "moneyline", r: rank[asVerdictKey(game.markets.moneyline.verdict.key)] },
    { key: "total", r: rank[asVerdictKey(game.markets.total.verdict.key)] },
    { key: "first_inning", r: rank[asVerdictKey(game.markets.first_inning.verdict.key)] },
  ];
  candidates.sort((a, b) => b.r - a.r);
  return candidates[0]!.key;
}

// ─── Parts ─────────────────────────────────────────────────────────────

/**
 * R-16H: per-team CSS filter overrides for logos that read too dark or
 * low-contrast against the dark UI background.
 *
 * SD (Padres) — ESPN's primary mark is brown-on-brown (#2F241D Padres
 * Brown on a similar dark backdrop). The R-9 backing container helped
 * but the asset itself is the contrast issue. `brightness(1.45)` lifts
 * the brown toward a readable warm tone; `saturate(0.95)` keeps it
 * looking like Padres brown rather than skewing orange.
 *
 * Only add teams here if their primary ESPN logo is genuinely hard to
 * see on the dark UI. Most teams render fine and need no override.
 */
const LOGO_FILTER: Record<string, string> = {
  SD: "brightness(1.45) saturate(0.95)",
};

function TeamBadge({ abbr, logo, size }: { abbr: string; logo: string | null; size: number }) {
  // For MLB/NBA/NHL the DB's `teams.logo_url` column is unreliable, so
  // ESPN is the primary CDN. For soccer/ucl, ESPN has no country logos
  // — the `logo` prop carries the FlagCDN URL written by the soccer
  // adapter, so trust it. Both branches share the abbr-disc fallback
  // on image error so a broken request never leaves an empty circle.
  const shellSport = useShellSport();
  const [errored, setErrored] = useState(false);
  const isSoccer = shellSport === "soccer" || shellSport === "ucl";
  const src = isSoccer ? (logo ?? "") : espnLogoUrl(abbr, shellSport);
  const filter = LOGO_FILTER[abbr];

  if (isSoccer && !logo) {
    return (
      <div
        className="inline-flex items-center justify-center rounded-full bg-violet-500/[0.12] border border-violet-400/30 text-violet-100 font-bold tracking-tight shrink-0 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.10)]"
        style={{ width: size, height: size, fontSize: Math.max(9, Math.floor(size * 0.38)) }}
        aria-label={abbr}
      >
        {abbr}
      </div>
    );
  }

  if (errored) {
    // Brighter, intentional-looking disc so it doesn't read as a broken
    // logo. Violet-tinted with a soft glow — clearly a deliberate
    // placeholder, not a missing image.
    return (
      <div
        className="inline-flex items-center justify-center rounded-full bg-violet-500/[0.12] border border-violet-400/30 text-violet-100 font-bold tracking-tight shrink-0 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.10)]"
        style={{ width: size, height: size, fontSize: Math.max(9, Math.floor(size * 0.38)) }}
        aria-label={abbr}
      >
        {abbr}
      </div>
    );
  }
  // Subtle backing container (R-9): some MLB logos (notably SD, OAK/ATH)
  // use near-black or dark-navy palettes that vanish against the page's
  // dark background. A faint white wash + 1px ring gives every logo a
  // consistent silhouette without overwhelming high-contrast logos.
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 bg-white/[0.04] ring-1 ring-white/10"
      style={{ width: size, height: size }}
      aria-label={abbr}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={abbr}
        width={Math.max(1, size - 4)}
        height={Math.max(1, size - 4)}
        className="rounded-full"
        style={{
          width: Math.max(1, size - 4),
          height: Math.max(1, size - 4),
          objectFit: "contain",
          // R-16H: per-team CSS filter for dark/low-contrast assets.
          ...(filter !== undefined ? { filter } : {}),
        }}
        onError={() => setErrored(true)}
      />
    </span>
  );
}

function VerdictChip({
  verdict,
  selected = false,
  showActionPrefix = false,
}: {
  verdict: VerdictKey;
  selected?: boolean;
  /**
   * When true, prefix the chip with a small muted "Action" label so the
   * user can tell the chip is the action/verdict — NOT the pick (e.g.
   * "Watchlist" vs "NRFI"). Used in the reader header where the pick
   * and the verdict sit side-by-side.
   */
  showActionPrefix?: boolean;
}) {
  const glow = VERDICT_GLOW[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.14em] font-bold whitespace-nowrap ${
        selected ? "bg-violet-500/[0.16]" : "bg-white/[0.04]"
      }`}
    >
      {showActionPrefix && (
        <span className="text-gray-500 font-bold pr-1 border-r border-white/[0.10] mr-0.5">
          Action
        </span>
      )}
      <span
        aria-hidden="true"
        className={`${VERDICT_TEXT_COLOR[verdict]} text-[12px] leading-none ${glow}`}
      >
        {VERDICT_GLYPH[verdict]}
      </span>
      <span className={`${VERDICT_TEXT_COLOR[verdict]} ${glow}`}>{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}

function MarketPill({
  market,
  pick,
  confidence,
  verdict,
  selected,
  onClick,
}: {
  market: MarketKey;
  pick: string | null;
  /** Phase 4.2.C.2 — nullable; held markets render "—". */
  confidence: number | null;
  verdict: VerdictKey;
  selected: boolean;
  onClick: () => void;
}) {
  const shellSport = useShellSport();
  const isContext = isContextOnlyMarket(market, shellSport);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-2.5 py-1 min-h-[30px] rounded-md text-left transition-all ${
        selected
          ? "bg-violet-500/[0.18] text-white border border-violet-400/45"
          : "bg-white/[0.03] text-gray-300 border border-transparent hover:bg-white/[0.06]"
      } ${isContext && !selected ? "opacity-80" : ""}`}
    >
      <span className={`text-[10px] uppercase tracking-[0.14em] font-bold shrink-0 ${selected ? "text-violet-100" : "text-gray-500"}`}>
        {marketShortLabelFor(market, shellSport)}
      </span>
      <span className={`text-[12px] font-bold tabular-nums shrink-0 ${pick === null ? "text-gray-500" : ""}`}>{pick === null ? pickFallbackFor(market, shellSport) : formatPickWithLine(market, pick, null, shellSport)}</span>
      <span className={`text-[10.5px] tabular-nums shrink-0 ${selected ? "text-gray-300" : "text-gray-500"}`}>
        {confidence === null ? "—" : `${Math.round(confidence * 100)}%`}
      </span>
      <span
        aria-hidden="true"
        className={`ml-auto text-[12px] leading-none shrink-0 ${VERDICT_TEXT_COLOR[verdict]} ${VERDICT_GLOW[verdict]}`}
      >
        {VERDICT_GLYPH[verdict]}
      </span>
    </button>
  );
}

/**
 * Render the headline pick line for the reader's market selector, with
 * the totals line stitched on when applicable.
 *   moneyline   → "PHI" or "Held"
 *   total       → "Over 8.5" / "Under 8.5" / "Over" / "Held"
 *   first_inning→ "NRFI" / "YRFI" / "Toss-Up"
 *
 * Phase 6B.30C++ — FI null is operationally a Toss-Up / no-edge state;
 * "Toss-Up" is already a first-class model-emitted FI pick (R-16H Fix 2,
 * R-16J 47-53% threshold) with its own neutral visual treatment. ML and
 * OU have no equivalent neutral middle band, so they stay as "Held"
 * for the genuinely held / unsafe cases. DB / tracking truth is
 * unchanged — `predicted_nrfi=null` + `hold_picks=["nrfi"]` still grade
 * as no_bet exactly like a real Toss-Up call would. Only the
 * customer-facing string changes.
 *
 * Phase 6B.30C+ (prior commit b8f7a7d) replaced em-dashes with "Held"
 * everywhere; this commit specializes FI to "Toss-Up" while keeping the
 * regression guard that bare em-dashes never leak through.
 */
export function formatPickWithLine(
  market: MarketKey,
  pick: string | null,
  line: number | null,
  sport: Sport = "mlb",
  awayAbbr: string | null = null,
  homeAbbr: string | null = null,
): string {
  if (pick === null) {
    return pickFallbackFor(market, sport);
  }
  // Soccer: translate raw model picks (home/away/draw/yes/no/over/under)
  // to customer-facing strings, using team abbreviations when provided.
  if (sport === "soccer" || sport === "ucl") {
    const transformed = soccerPickLabel(market, pick, line, awayAbbr, homeAbbr);
    if (transformed !== null) return transformed;
  }
  if (market === "total" && line !== null) {
    // NBA pick_label already encodes the line (e.g. "OVER 215.5"). MLB
    // pick is bare ("Over" / "Under") and needs the line appended.
    // Append only when the line isn't already part of the pick string —
    // sport-agnostic so neither league shows the line twice.
    if (pick.includes(String(line))) return pick;
    return `${pick} ${line}`;
  }
  return pick;
}

/**
 * Larger segmented market selector for the reader header. One segment
 * per market (Moneyline / Total / 1st Inning), each showing the long
 * label + headline pick + confidence. The selected segment has full
 * violet treatment so the user can tell at a glance which market the
 * body is reading.
 */
function ReaderMarketSegment({
  market,
  pick,
  line,
  confidence,
  verdict,
  selected,
  onClick,
  awayTeam = null,
  homeTeam = null,
}: {
  market: MarketKey;
  pick: string | null;
  line: number | null;
  /** Phase 4.2.C.2 — nullable; held markets render "—" for confidence. */
  confidence: number | null;
  verdict: VerdictKey;
  selected: boolean;
  onClick: () => void;
  /** Team abbreviations for soccer pick-label translation (home → KOR etc). */
  awayTeam?: string | null;
  homeTeam?: string | null;
}) {
  const shellSport = useShellSport();
  const pickText = formatPickWithLine(market, pick, line, shellSport, awayTeam, homeTeam);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex-1 min-w-0 px-3 py-2.5 rounded-lg text-left transition-colors border ${
        selected
          ? "bg-violet-500/[0.18] border-violet-400/55 text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.12),0_0_20px_-10px_rgba(139,92,246,0.55)]"
          : "bg-white/[0.025] border-white/[0.06] text-gray-300 hover:bg-white/[0.05] hover:border-white/[0.10]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${
            selected ? "text-violet-200" : "text-gray-500"
          }`}
        >
          {marketLongLabelFor(market, shellSport)}
        </span>
        <span
          aria-hidden="true"
          className={`text-[13px] leading-none ${VERDICT_TEXT_COLOR[verdict]} ${VERDICT_GLOW[verdict]}`}
        >
          {VERDICT_GLYPH[verdict]}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          className={`text-[15px] font-bold tabular-nums truncate ${
            selected ? "text-white" : "text-gray-100"
          }`}
          style={{ letterSpacing: "-0.01em" }}
        >
          {pickText}
        </span>
        <span
          className={`text-[12px] tabular-nums ml-auto shrink-0 ${
            selected ? "text-violet-100/85" : "text-gray-500"
          }`}
        >
          {confidence === null ? "—" : `${Math.round(confidence * 100)}%`}
        </span>
      </div>
    </button>
  );
}

function ConfidenceRing({ value, size = 48, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / 100));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgba(167,139,250,0.75)"
        strokeWidth={stroke}
        strokeDasharray={`${c * pct} ${c}`}
        strokeLinecap="round"
        fill="none"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-gray-100" style={{ fontSize: size * 0.28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(value)}
      </text>
    </svg>
  );
}

/**
 * One-sentence beginner-friendly explanation of each play grade. Read by
 * the PlayGradeMeter so the user doesn't have to interpret the meter
 * alone — the grade and what it means are stated plainly.
 */
const PLAY_GRADE_EXPLANATION: Record<VerdictKey, string> = {
  best_angle: "Strongest read tonight — clear value and aligned signals.",
  lean: "Moderate model edge. Not a top-tier Best Angle.",
  watchlist: "Interesting read, but not clean enough to act on yet.",
  caution: "Signals conflict — pass unless you have a strong external read.",
  no_play: "No actionable angle on this market.",
};

/**
 * Fill color used for the SINGLE cell that marks the current verdict's
 * position on the 5-cell meter. The other 4 cells stay neutral so the
 * meter reads as "you are here on the scale" rather than "all five
 * tiers at once."
 */
const PLAY_GRADE_TINT: Record<VerdictKey, string> = {
  no_play: "bg-gray-600/80",
  caution: "bg-amber-400/85",
  // R-16H: Watchlist now wears indigo (swapped from Lean).
  watchlist: "bg-indigo-400/80",
  // R-16H: Lean now wears sky (swapped from Watchlist) — the more
  // eye-catching tone for the common "actionable" tier on the meter.
  lean: "bg-sky-400/85",
  best_angle: "bg-emerald-400/95",
};

function PlayGradeMeter({ verdict }: { verdict: VerdictKey }) {
  // Order is strict actionability: No Play (lowest) → Best Angle (highest).
  // Only the current tier is highlighted on the meter + in the text
  // scale. The other tiers stay neutral so the meter reads as a "you
  // are here" indicator, not a rainbow legend.
  const order: VerdictKey[] = ["no_play", "caution", "watchlist", "lean", "best_angle"];
  const idx = order.indexOf(verdict);
  return (
    <div className="space-y-1.5">
      <p className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">Play Grade</p>
      <p
        className={`text-[15px] font-black leading-none ${VERDICT_TEXT_COLOR[verdict]} ${VERDICT_GLOW[verdict]}`}
        style={{ letterSpacing: "-0.01em" }}
      >
        <span aria-hidden="true" className="mr-1.5">{VERDICT_GLYPH[verdict]}</span>
        {VERDICT_LABEL[verdict]}
      </p>
      <p className="text-[11.5px] text-gray-400 leading-snug">
        {PLAY_GRADE_EXPLANATION[verdict]}
      </p>
      {/* 5-cell position bar — only the cell at the current verdict's
          index is tinted. The other four cells render as a faint
          neutral track. Communicates POSITION on a 5-tier scale, not
          all tier colors at once. */}
      <div className="grid grid-cols-5 gap-0.5 pt-1">
        {order.map((v, i) => (
          <div
            key={v}
            className={`h-1.5 rounded-sm ${i === idx ? PLAY_GRADE_TINT[v] : "bg-white/[0.06]"}`}
          />
        ))}
      </div>
      {/* Plain-text scale aligned conceptually with the bar above. Only
          the current tier is tinted; the rest stay muted. Word "Best
          Angle" sits at the right so the ladder direction is clear. */}
      <div className="flex items-center flex-wrap gap-x-1 text-[9px] uppercase tracking-[0.10em] font-bold">
        {order.map((v, i) => {
          const isCurrent = v === verdict;
          return (
            <span key={v} className="inline-flex items-center">
              {i > 0 && <span aria-hidden="true" className="text-gray-700 mr-1">·</span>}
              <span
                className={
                  isCurrent
                    ? `${VERDICT_TEXT_COLOR[v]} ${VERDICT_GLOW[v]}`
                    : "text-gray-700"
                }
              >
                {VERDICT_LABEL[v]}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top-of-shell: sport rail + slate strip ────────────────────────────

/**
 * Filled sport-glyph SVG with natural sport coloring. Inline so we never
 * load a remote logo asset and never run into the licensing question for
 * league marks. These are generic sport silhouettes (baseball,
 * basketball, football, puck) — NOT league logos.
 *
 * `active` controls visual energy: active sports render at full
 * saturation; inactive ones render at reduced opacity but keep their
 * shape and color so the rail stays premium-feeling rather than dead-gray.
 */
function SportIcon({ sport, size = 18, active }: { sport: Sport; size?: number; active: boolean }) {
  const wrapperOpacity = active ? 1 : 0.55;
  if (sport === "mlb") {
    // Baseball — cream disc with red stitch arcs
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
        <defs>
          <radialGradient id="mlb-disc" cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fafaf9" />
            <stop offset="100%" stopColor="#d6d3d1" />
          </radialGradient>
        </defs>
        <circle cx="10" cy="10" r="8.5" fill="url(#mlb-disc)" />
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4" />
        <path d="M4.5 6.5 Q10 10 15.5 6.5" stroke="#dc2626" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M4.5 13.5 Q10 10 15.5 13.5" stroke="#dc2626" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (sport === "nba" || sport === "cbb") {
    // Basketball — orange disc with darker seams
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
        <defs>
          <radialGradient id="nba-disc" cx="38%" cy="35%" r="72%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#c2410c" />
          </radialGradient>
        </defs>
        <circle cx="10" cy="10" r="8.5" fill="url(#nba-disc)" />
        <line x1="10" y1="1.5" x2="10" y2="18.5" stroke="#1c1917" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="1.5" y1="10" x2="18.5" y2="10" stroke="#1c1917" strokeWidth="0.8" strokeLinecap="round" />
        <path d="M2.5 10 Q10 4 17.5 10" stroke="#1c1917" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <path d="M2.5 10 Q10 16 17.5 10" stroke="#1c1917" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (sport === "nfl" || sport === "cfb") {
    // Football — brown pointed ellipse with white laces
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
        <defs>
          <radialGradient id="nfl-disc" cx="35%" cy="35%" r="78%">
            <stop offset="0%" stopColor="#a16207" />
            <stop offset="100%" stopColor="#7c2d12" />
          </radialGradient>
        </defs>
        <path d="M2.5 10 Q10 1.5 17.5 10 Q10 18.5 2.5 10 Z" fill="url(#nfl-disc)" stroke="rgba(0,0,0,0.18)" strokeWidth="0.3" />
        <line x1="10" y1="6.5" x2="10" y2="13.5" stroke="#fafaf9" strokeWidth="0.9" strokeLinecap="round" />
        <line x1="8.4" y1="7.8" x2="8.4" y2="12.2" stroke="#fafaf9" strokeWidth="0.6" strokeLinecap="round" />
        <line x1="11.6" y1="7.8" x2="11.6" y2="12.2" stroke="#fafaf9" strokeWidth="0.6" strokeLinecap="round" />
        <line x1="7" y1="8.8" x2="7" y2="11.2" stroke="#fafaf9" strokeWidth="0.55" strokeLinecap="round" />
        <line x1="13" y1="8.8" x2="13" y2="11.2" stroke="#fafaf9" strokeWidth="0.55" strokeLinecap="round" />
      </svg>
    );
  }
  if (sport === "nhl") {
    // Hockey puck — dark flat ellipse with subtle highlight
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
        <defs>
          <linearGradient id="nhl-side" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <ellipse cx="10" cy="11.5" rx="8" ry="3.2" fill="url(#nhl-side)" />
        <ellipse cx="10" cy="8.5" rx="8" ry="3.2" fill="#1e293b" stroke="#475569" strokeWidth="0.4" />
      </svg>
    );
  }
  if (sport === "soccer") {
    // Soccer ball — white disc with a simple black pentagonal accent so
    // the WC tab reads as soccer at a glance without a licensed mark.
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
        <defs>
          <radialGradient id="soccer-disc" cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fafaf9" />
            <stop offset="100%" stopColor="#d4d4d8" />
          </radialGradient>
        </defs>
        <circle cx="10" cy="10" r="8.5" fill="url(#soccer-disc)" />
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.4" />
        <polygon points="10,5.5 13,7.7 11.9,11.2 8.1,11.2 7,7.7" fill="#111827" />
      </svg>
    );
  }
  // Default fallback — small disc
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity: wrapperOpacity }}>
      <circle cx="10" cy="10" r="8.5" fill="#52525b" />
    </svg>
  );
}

/**
 * Top-of-page sports rail. Full-width inside the standard max-w-7xl
 * gutter so the page reads as a multi-sport platform — MLB is the only
 * live model right now but the other leagues are visible as "Coming
 * <Month>" placeholders. League glyphs are inline SVGs (no licensing
 * concerns + no remote asset fetches).
 */
export function SportRail({ sport }: { sport: Sport }) {
  // WC-4 — soccer renders here as "World Cup" (live). UCL is a separate
  // sport entry, intentionally distinct so future UCL rows never collide
  // with WC on the same tab. Internal sport key for soccer stays
  // `soccer` (matches the WC-3 TrackedSport contract); the
  // member-facing label is "World Cup".
  const ROW: Array<{ key: Sport; label: string; live: boolean }> = [
    { key: "mlb", label: "MLB", live: true },
    { key: "nba", label: "NBA", live: true },
    { key: "nhl", label: "NHL", live: true },
    { key: "soccer", label: "World Cup", live: true },
    { key: "nfl", label: "NFL", live: false },
    { key: "cfb", label: "CFB", live: false },
    { key: "cbb", label: "CBB", live: false },
    { key: "ucl", label: "UCL", live: false },
  ];
  // Clickable nav: use useSportSelection so live tabs swap the URL's
  // ?sport= param and the parent page re-renders with the new sport.
  const { setSport } = useSportSelection();
  return (
    <div className="border-b border-white/[0.05] bg-gradient-to-b from-white/[0.015] to-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto -mx-1 px-1">
          {ROW.map((s) => {
            const isActive = s.key === sport && s.live;
            const isClickable = s.live;
            const Tag = isClickable ? "button" : "div";
            const clickHandler = isClickable && !isActive ? () => setSport(s.key) : undefined;
            return (
              <Tag
                key={s.key}
                onClick={clickHandler}
                type={isClickable ? "button" : undefined}
                className={`group flex-1 min-w-[120px] sm:min-w-0 inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-violet-400/55 bg-violet-500/[0.14] text-violet-50 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.10),0_0_18px_-8px_rgba(139,92,246,0.45)]"
                    : isClickable
                      ? "border-white/[0.06] bg-white/[0.02] text-gray-400 hover:border-violet-400/30 hover:bg-violet-500/[0.06] cursor-pointer"
                      : "border-white/[0.06] bg-white/[0.02] text-gray-400"
                }`}
                aria-label={`${s.label} — ${isActive ? "active model" : isClickable ? "switch to this sport" : "coming soon"}`}
              >
                {/* Circular icon container — tinted violet for active,
                    neutral for inactive. The container itself, not just
                    the icon, carries the "active" cue. */}
                <span
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${
                    isActive
                      ? "bg-violet-500/[0.22] ring-1 ring-violet-400/40 shadow-[0_0_10px_-2px_rgba(167,139,250,0.45)]"
                      : "bg-white/[0.04] ring-1 ring-white/[0.06]"
                  }`}
                >
                  <SportIcon sport={s.key} size={18} active={isActive} />
                </span>
                <div className="flex flex-col leading-tight min-w-0">
                  <span
                    className={`text-[11px] uppercase tracking-[0.16em] font-bold ${
                      isActive ? "text-white" : "text-gray-300"
                    }`}
                  >
                    {s.label}
                  </span>
                  <span
                    className={`text-[9.5px] tracking-[0.06em] truncate ${
                      isActive ? "text-emerald-300" : "text-gray-500"
                    }`}
                  >
                    {isActive ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(110,231,183,0.6)]" />
                        Active
                      </span>
                    ) : s.live ? (
                      "Live"
                    ) : (
                      "Coming Soon"
                    )}
                  </span>
                </div>
              </Tag>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SlateControlStrip({
  date,
  gameCount,
  updatedAt,
  fallbackUsed,
}: {
  date: string;
  gameCount: number;
  updatedAt: string;
  fallbackUsed: boolean;
}) {
  // Locale-dependent time format produces different output on server vs
  // client which trips React's hydration check. Defer formatting until
  // after mount so server and initial client HTML agree (empty string).
  const [updatedTime, setUpdatedTime] = useState<string>("");
  useEffect(() => {
    try {
      const d = new Date(updatedAt);
      setUpdatedTime(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
    } catch {
      setUpdatedTime("");
    }
  }, [updatedAt]);

  // Format the slate date as a short, friendly month-day (no year — the
  // year never reads as actionable info for users).
  const slateDateLabel = useMemo(() => {
    try {
      const [y, m, d] = date.split("-").map(Number) as [number, number, number];
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    } catch {
      return date;
    }
  }, [date]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2">
      {/* Two-group layout: left = slate metadata text, right = fallback
          badge when applicable. The badge is visually grouped with the
          metadata (same flex row) but has its own pill styling so it
          doesn't get lost in the dot-separated string. Dots tinted
          gray-700 to recede behind the gray-400/500 text. */}
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-2">
          <span className="uppercase tracking-[0.14em] font-bold text-gray-400">MLB slate</span>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <span className="tabular-nums text-gray-400">{gameCount} games</span>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <span className="tabular-nums">{slateDateLabel}</span>
          {updatedTime && (
            <>
              <span aria-hidden="true" className="text-gray-700">·</span>
              <span>Updated {updatedTime}</span>
            </>
          )}
        </span>
        {fallbackUsed && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/[0.10] text-[10px] uppercase tracking-[0.12em] font-bold text-amber-200">
            <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/85" />
            Showing latest available slate
          </span>
        )}
      </div>
    </div>
  );
}

// ─── How this works (popover) ──────────────────────────────────────────

function HowThisWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-400/35 bg-violet-500/[0.10] text-[10px] uppercase tracking-[0.14em] font-bold text-violet-100 hover:bg-violet-500/[0.18] hover:border-violet-400/55 transition-colors"
      >
        How this works
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[320px] bg-[#0F0F1A] border border-white/[0.10] rounded-lg shadow-xl p-4 text-[12px] text-gray-300 leading-relaxed">
          <p className="font-bold text-gray-100 mb-2">How to use this page</p>
          <ol className="space-y-1.5 list-decimal list-inside">
            <li>Browse tonight&apos;s slate in the Edge Board below.</li>
            <li>Click any game card to focus the reader on it.</li>
            <li>Click a market pill (ML / Total / 1st) to focus that read.</li>
            <li>Quick Read on the left shows the takeaway.</li>
            <li>Supporting Evidence in the middle shows price + market data.</li>
            <li>Market Notes on the right show why and the risk.</li>
          </ol>
          <p className="mt-3 font-bold text-gray-100 mb-1">Signals</p>
          <ul className="space-y-0.5 list-disc list-inside text-[11.5px]">
            <li><span className="text-emerald-300 drop-shadow-[0_0_4px_rgba(110,231,183,0.45)]">★ Best Angle</span> — strongest read</li>
            <li><span className="text-sky-300">↗ Lean</span> — moderate read</li>
            <li><span className="text-indigo-300">◐ Watchlist</span> — interesting, not clean</li>
            <li><span className="text-amber-300">⚠ Caution</span> — signals conflict</li>
            <li><span className="text-gray-500">○ No Play</span> — skip</li>
          </ul>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500 hover:text-gray-300"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Expanded reader sub-renderers (used by SlateCard expansion + MobileDetailSheet) ──

/**
 * Phase R-10 — starter line for the reader's QuickRead panel.
 *
 * Renders "Away starter (L/R) · Home starter (L/R)" using the new
 * `homeStarter` / `awayStarter` DTO fields. When MLB hasn't posted
 * a probable yet (e.g., TOR @ ATL on 2026-06-04 with TOR's slot
 * empty), the missing side reads "TBD" so members can tell it's a
 * provider-pending state rather than a system glitch.
 */
function StartersLine({ game }: { game: DailyEdgeGameDto }) {
  // Phase 7F (Path A) — NBA has no probable pitchers; the adapter
  // sets both starters to null. Early return for any non-MLB sport so
  // the row never even attempts to render (MLB behavior unchanged).
  if (game.sport !== "mlb") return null;
  // Skip entirely when BOTH sides are null — no useful info to show
  // and we don't want an empty "TBD · TBD" row screaming "missing data."
  if (game.homeStarter === null && game.awayStarter === null) return null;

  const renderSide = (starter: typeof game.homeStarter, fallback: string) => {
    if (starter === null) {
      return (
        <span className="text-[11px] text-gray-500 italic">
          {fallback} starter TBD
        </span>
      );
    }
    return (
      <span className="text-[11.5px] text-gray-300 truncate">
        <span className="font-semibold">{starter.name}</span>
        {starter.throws !== null && (
          <span className="text-gray-500 ml-1">({starter.throws}HP)</span>
        )}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11.5px] leading-snug">
      {renderSide(game.awayStarter, game.awayTeam)}
      <span className="text-gray-700 text-[10px]">vs</span>
      {renderSide(game.homeStarter, game.homeTeam)}
    </div>
  );
}

/**
 * Phase R-10 — model take section for the reader. Renders
 * `game.breakdown.modelBreakdown` (the member-facing one-sentence
 * summary generated by `pickBreakdownGenerator`). Operator-only
 * fields (`operator_detail`, `breakdown_version`, etc.) are NOT
 * surfaced — the route's `buildBreakdownDto` already excludes them
 * at the DTO boundary.
 *
 * Returns null when the breakdown is missing — keeps the reader
 * tight when no model copy was generated for this row.
 */
function ModelTake({ game }: { game: DailyEdgeGameDto }) {
  const text = game.breakdown.modelBreakdown;
  if (text === null || text.trim().length === 0) return null;
  return (
    <div className="bg-white/[0.015] border border-white/[0.04] rounded-xl px-3.5 py-2.5 space-y-2 min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85 shadow-[0_0_8px_rgba(167,139,250,0.35)]" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/90">Model Take</p>
      </div>
      <p className="text-[12.5px] text-gray-300 leading-relaxed">{text}</p>
    </div>
  );
}

function QuickRead({ game, market, marketData }: { game: DailyEdgeGameDto; market: MarketKey; marketData: MarketEdgeDto }) {
  const verdict = asVerdictKey(marketData.verdict.key);
  const shellSport = useShellSport();
  return (
    <div className="bg-white/[0.015] border border-white/[0.04] rounded-xl px-3.5 py-2.5 space-y-2 min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85 shadow-[0_0_8px_rgba(167,139,250,0.35)]" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/90">Quick Read</p>
      </div>

      {/* Matchup */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TeamBadge abbr={game.awayTeam} logo={game.awayTeamLogo} size={32} />
          <span className="text-[14px] font-bold text-gray-100" style={{ letterSpacing: "-0.02em" }}>{game.awayTeam}</span>
          <span className="text-gray-700 text-[12px]">@</span>
          <span className="text-[14px] font-bold text-gray-100" style={{ letterSpacing: "-0.02em" }}>{game.homeTeam}</span>
          <TeamBadge abbr={game.homeTeam} logo={game.homeTeamLogo} size={32} />
        </div>
      </div>

      {/* Starters (R-10) — surfaced only in the reader, never on the
          slate card. Renders "TBD" when MLB hasn't posted a probable
          starter (e.g., TOR @ ATL on a day where TOR hasn't named one). */}
      <StartersLine game={game} />

      {/* Projected */}
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-1.5">
        <p className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold mb-0.5">Projected</p>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-bold">{game.awayTeam}</span>
            <span className="text-[18px] font-black tabular-nums text-gray-100 leading-none">{game.projected.away.toFixed(1)}</span>
          </div>
          <span className="text-gray-700">—</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-black tabular-nums text-gray-100 leading-none">{game.projected.home.toFixed(1)}</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-bold">{game.homeTeam}</span>
          </div>
        </div>
      </div>

      {/* Selected pick */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-[24px] font-black tabular-nums text-white leading-none" style={{ letterSpacing: "-0.04em" }}>
            {marketData.pick ?? "—"}
          </h2>
          <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
            {/* Phase 6B.1.6L — pivot from a single "confidence" number to
                "Win Prob NN%" + a separate Edge readout. Win Prob is
                the model's probability for the picked side. Edge is
                model_prob − market_no_vig in percentage points and is
                rendered separately so members don't read win prob as a
                betting edge. */}
            <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">
              {market === "moneyline" ? "Win Prob" : market === "total" ? "Model Prob" : "Model Prob"}
            </span>
            <span className="text-[12.5px] tabular-nums font-bold text-gray-300">
              {marketData.confidence === null
                ? "—"
                : `${Math.round(marketData.confidence * 100)}%`}
            </span>
            {marketData.modelMarketGapPct !== null && marketData.confidence !== null && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">Edge</span>
                <span
                  className={`text-[12.5px] tabular-nums font-bold ${
                    marketData.modelMarketGapPct >= 2
                      ? "text-emerald-300"
                      : marketData.modelMarketGapPct <= -1
                        ? "text-amber-300"
                        : "text-gray-400"
                  }`}
                >
                  {Math.abs(marketData.modelMarketGapPct) < 0.5
                    ? "No edge"
                    : `${marketData.modelMarketGapPct > 0 ? "+" : ""}${marketData.modelMarketGapPct.toFixed(1)}%`}
                </span>
              </>
            )}
            {/* Phase 6B.1.6m — Recommendation Confidence: how actionable
                the pick is relative to the book. Distinct from Model
                Prob (direction) and Edge (raw pp). Suppressed for
                Toss-Up / Held / null-pick (helper returns null). */}
            {marketData.recommendationConfidence !== null && marketData.recommendationConfidence !== undefined && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">Rec</span>
                <span
                  className={`text-[12.5px] tabular-nums font-bold ${
                    marketData.recommendationConfidence >= 65
                      ? "text-emerald-300"
                      : marketData.recommendationConfidence >= 45
                        ? "text-gray-300"
                        : "text-amber-300"
                  }`}
                >
                  {Math.round(marketData.recommendationConfidence)}
                </span>
              </>
            )}
            {marketData.priceAmerican !== null ? (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[12.5px] tabular-nums font-semibold text-gray-300">
                  {formatAmerican(marketData.priceAmerican)}
                </span>
              </>
            ) : marketData.priceUnavailableAtLock ? (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500">
                  no price recorded at lock
                </span>
              </>
            ) : (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500">not priced</span>
              </>
            )}
            <span className="text-gray-700">·</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold">
              {marketLongLabelFor(market, shellSport)}
            </span>
          </div>
        </div>
        <ConfidenceRing value={(marketData.confidence ?? 0) * 100} size={48} stroke={4} />
      </div>

      {/* Guided read */}
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2 space-y-1.5">
        <p className="text-[13px] text-gray-200 leading-snug">{marketData.guidedGuide}</p>
        {marketData.guidedWatchOut && (
          <p className="text-[12px] text-amber-200/80 leading-snug">
            <span aria-hidden="true" className="text-amber-400/70 mr-1">⚠</span>
            {marketData.guidedWatchOut}
          </p>
        )}
      </div>

      <PlayGradeMeter verdict={verdict} />
    </div>
  );
}

function EdgeStack({ market, marketData }: { market: MarketKey; marketData: MarketEdgeDto }) {
  const shellSport = useShellSport();
  // R-16F-B — row construction lives in app/lab/lib/edgeStackRows.ts so
  // the data shape can be unit-tested without a React renderer. This
  // component only handles JSX layout + tone coloring.
  const edgeMarket: "moneyline" | "total" | "first_inning" = market;
  const rows = buildEdgeStackRows(edgeMarket, marketData);
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80 mb-1.5">
        Edge Stack · {marketLongLabelFor(market, shellSport)}
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[88px_1fr_auto] items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-gray-500">{r.label}</span>
            <span className="text-[12px] text-gray-300 tabular-nums leading-snug">{r.evidence}</span>
            <span
              className={`text-[12px] font-black tabular-nums leading-snug whitespace-nowrap ${
                r.tone === "emerald" ? "text-emerald-300" : r.tone === "amber" ? "text-amber-300" : "text-gray-500"
              }`}
            >
              {r.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Phase 6B.13 — Confidence vs Market strip.
 *
 * Reader-only component (does NOT appear on slate cards per the
 * "do not clutter the card" guidance). Shows the FINAL CALIBRATED
 * play confidence next to the no-vig market-implied probability so
 * members can read "how confident are we, and how does that compare to
 * what the market is pricing" — without conflating raw model output
 * with the final actionable play.
 *
 *   • Confidence — recommendationConfidence (Push 3C-2 / 6B.1.6m).
 *     Capped by data-quality tier; null when no actionable play exists
 *     (Toss-Up / Held / no-pick) → strip hides entirely.
 *   • Market — no-vig market-implied % when a two-sided book exists;
 *              "Market: unavailable" honest-empty otherwise.
 *   • Edge — Confidence − Market in percentage points; rendered with
 *            sign; suppressed when Market is unavailable (no fake gap).
 *   • Reviewer caution badge + flag list when reviewActionSummary ≠ "keep"
 *
 * Why this changed from "Model vs Market":
 *   The prior block displayed `modelTrustPct` (which is sometimes the
 *   raw model probability from sport_specific.v2_2_audit.ml_model_prob
 *   when the override fires) and called it "Model 70% reviewed trust".
 *   Members read that as the headline play confidence and were
 *   confused when the same game's "Rec" pill showed 55. The two
 *   numbers are distinct concepts and should not share a "Model"
 *   label. Now the comparison block uses the same final
 *   recommendationConfidence the play grade and Rec pill use.
 *
 * Raw model probability stays available on the pick line ("Win Prob
 * NN%" / "Model Prob NN%") for audit/intuition — it's just not the
 * primary user-facing comparison.
 *
 * FI markets: render when the FI V2 audit populates modelTrustPct
 * AND recommendationConfidence is non-null; otherwise honest-empty.
 */
function ConfidenceVsMarketStrip({
  market,
  marketData,
}: {
  market: MarketKey;
  marketData: MarketEdgeDto;
}) {
  if (marketData.held) return null;

  // Phase 6B.29 — use model probability (matches Quick Read "Model Prob
  // NN%") as the user-facing number. Pre-6B.29 this read
  // recommendationConfidence, which is a 0-75 actionability INDEX
  // (capped by data tier + play grade), not a probability. For OU
  // markets that index is derived from run-delta — small deltas
  // produced rec_conf=25 even when the model genuinely liked the
  // pick (e.g. CIN@SD Under: model prob 56%, no-vig 50%, but the
  // strip displayed "25 play confidence" vs "50% market" and Edge
  // "-25.0pp" — meaningless because the operands were on different
  // scales). modelTrustPct (= model_prob × 100) is a probability,
  // directly comparable to the no-vig marketImpliedPct.
  //
  // recommendationConfidence still drives the separate "Rec" pill
  // and the Top Available Angles sort — unchanged. This is a
  // display-only correction to the Confidence vs Market comparison
  // panel. No tracking / model / calibration / grading impact.
  //
  // When modelTrustPct is null (rare: model probability not surfaced
  // for the market) the strip hides entirely rather than fall back
  // to recommendationConfidence — keeps the comparison honest.
  const confidencePct =
    marketData.modelTrustPct ?? null;
  if (confidencePct === null) return null;

  const marketPct = marketData.marketImpliedPct;
  const source = marketData.marketSource;
  const quality = marketData.marketDataQuality;
  const flags = marketData.reviewFlags;
  const action = marketData.reviewActionSummary;
  const cautionFiring = action !== "keep" || flags.includes("review_recommends_caution");

  if (market === "first_inning" && marketPct === null) return null;

  const marketLabel =
    marketPct !== null
      ? `${Math.round(marketPct)}%`
      : "unavailable";
  // R-16E + R-16F-B — honest labeling for splits-consensus reads.
  // Shares the marketSourceLabel helper with EdgeStack so both
  // sections always render the same human-facing source string.
  const sourceLabel = marketSourceLabel(quality, source);

  // Edge is now Confidence − Market (NOT modelTrustPct − Market). When
  // market is unavailable we hide the Edge row entirely; we never
  // invent a gap from one number.
  const edge =
    marketPct !== null ? confidencePct - marketPct : null;
  const showGap = edge !== null;
  const gapTone: "neutral" | "positive" | "negative" =
    edge === null
      ? "neutral"
      : edge >= 5
        ? "positive"
        : edge <= -5
          ? "negative"
          : "neutral";
  const gapColor =
    gapTone === "positive"
      ? "text-emerald-300"
      : gapTone === "negative"
        ? "text-rose-300"
        : "text-gray-300";

  // Friendly flag → label map (only the ones members benefit from seeing).
  const friendlyFlag = (f: string): string | null => {
    switch (f) {
      case "small_sample_starter_driver":
        return "small-sample starter";
      case "extreme_run_diff_with_coinflip_market":
        return "extreme run gap vs coinflip market";
      case "huge_model_market_gap":
        return "large model vs market gap";
      case "raw_conf_extreme_fragile":
        return "fragile model input";
      case "public_smoke_aligned_with_pick":
        return "model agrees with heavy public";
      case "ou_sharp_conflict":
        return "sharp +EV opposes total side";
      case "bullpen_fallback":
        return "bullpen data fallback";
      case "missing_starter":
        return "missing starter";
      case "starter_stats_fallback":
        // P1A 2026-06-12 — non-blocking marker for "starter player-row link
        // absent but stats usable via fallback/proxy". The model produced
        // a valid prediction; no scary card badge needed. Internal audit
        // trail still carries the flag.
        return null;
      case "missing_market_line":
        return "missing market line";
      case "review_recommends_caution":
        return null; // already conveyed by the badge
      default:
        return null;
    }
  };
  const memberFlags = flags
    .map(friendlyFlag)
    .filter((s): s is string => s !== null);

  return (
    <div className="space-y-1.5">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80">
        Confidence vs Market
      </p>
      <div className="grid grid-cols-[88px_1fr] gap-y-1 gap-x-2 items-baseline">
        <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">Confidence</span>
        <span className="text-[12.5px] tabular-nums text-gray-200 font-bold">
          {Math.round(confidencePct)}%
          <span className="ml-2 text-[9.5px] font-normal text-gray-500 normal-case tracking-normal">
            model prob
          </span>
        </span>

        <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">Market</span>
        <span className={`text-[12.5px] tabular-nums font-bold ${marketPct === null ? "text-gray-500 italic" : "text-gray-200"}`}>
          {marketLabel}
          {sourceLabel !== null && marketPct !== null && (
            <span className="ml-2 text-[9.5px] font-normal text-gray-500 normal-case tracking-normal">
              {sourceLabel}
            </span>
          )}
        </span>

        {showGap && (
          <>
            <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-500">Edge</span>
            <span className={`text-[12.5px] tabular-nums font-bold ${gapColor}`}>
              {Math.abs(edge!) < 0.5
                ? "No edge"
                : `${edge! > 0 ? "+" : ""}${edge!.toFixed(1)} pp`}
              <span className="ml-2 text-[9.5px] font-normal text-gray-500 normal-case tracking-normal">
                model prob vs no-vig market
              </span>
            </span>
          </>
        )}
      </div>

      {cautionFiring && (
        <div className="mt-1.5 p-1.5 rounded border border-amber-500/30 bg-amber-500/[0.06] space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-amber-400/90">
            ⚠ Reviewer caution
            {action === "cap_confidence" && (
              <span className="ml-1.5 text-[9px] font-normal text-amber-300/70 normal-case tracking-normal">
                · confidence capped
              </span>
            )}
            {action === "hold" && (
              <span className="ml-1.5 text-[9px] font-normal text-amber-300/70 normal-case tracking-normal">
                · market held
              </span>
            )}
            {action === "adjust_score_toward_market" && (
              <span className="ml-1.5 text-[9px] font-normal text-amber-300/70 normal-case tracking-normal">
                · projection dampened
              </span>
            )}
          </p>
          {memberFlags.length > 0 && (
            <ul className="text-[10.5px] text-amber-200/80 leading-tight pl-2.5 list-disc">
              {memberFlags.slice(0, 4).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MarketPulse({ market, marketData }: { market: MarketKey; marketData: MarketEdgeDto }) {
  // NBA reuses the `first_inning` slot for Spread; NHL reuses it for
  // Puck Line. Both DO have meaningful split / market data flow and
  // should take the normal renderer below. The MLB-specific
  // "first-inning splits aren't offered" branch only fires for MLB.
  const shellSport = useShellSport();
  // First-inning never uses split copy — V1 SharpAPI tier does not cover
  // first-inning public splits. Phrase as provider-coverage, not failure.
  // When the FI market is held (V1 NRFI threshold not met), surface a
  // subdued "angle unavailable" line instead of the generic splits note —
  // makes it clear the full-game pick is unaffected.
  if (market === "first_inning" && shellSport !== "nba" && shellSport !== "nhl" && shellSport !== "soccer") {
    if (marketData.held) {
      return (
        <div className="space-y-1.5">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80">First Inning</p>
          <p className="text-[11.5px] text-gray-500 leading-snug">
            First-inning angle unavailable for this game — full-game ML and Total picks above are unaffected.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80">Market Pulse</p>
        <p className="text-[11.5px] text-gray-400 leading-snug">
          Public splits aren&rsquo;t offered for first-inning markets — model, price, and matchup factors below.
        </p>
      </div>
    );
  }

  // R-13C — two-sided render path. Use the new publicSplits array when
  // present (covers both ML/spread teams or Over/Under), falling back
  // to the legacy single-side scalars if it isn't populated (e.g.,
  // older cached DTOs).
  const splits = marketData.publicSplits;
  if (splits.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80">Market Pulse</p>
        <p className="text-[11.5px] text-gray-500 leading-snug">
          Public split data unavailable for this game today.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80">Market Pulse · Public Splits</p>
      <div className="space-y-2.5">
        {splits.map((s) => (
          <SideSplitsBlock
            key={s.side}
            label={s.label}
            moneyPct={s.moneyPct}
            betsPct={s.betsPct}
            observedAt={s.observedAt ?? null}
            isStale={s.isStale ?? false}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * R-13C — one side's money + bets bars stacked with a side label.
 * Handles partial-null cases by labeling missing fields "not reported"
 * rather than dropping the row.
 */
/**
 * Phase 7I — render a subtle "Last updated H:MM PM" line under stale-
 * but-valid values. Only shown when isStale=true AND there's an observed
 * timestamp — i.e. the value was hydrated from history because the
 * latest provider refresh dropped it. Fresh data has no annotation.
 */
function formatStaleStamp(observedAt: string | null): string | null {
  if (observedAt === null) return null;
  try {
    const d = new Date(observedAt);
    if (!Number.isFinite(d.getTime())) return null;
    const t = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    return `Last updated ${t}`;
  } catch {
    return null;
  }
}

function SideSplitsBlock({
  label,
  moneyPct,
  betsPct,
  observedAt,
  isStale,
}: {
  label: string;
  moneyPct: number | null;
  betsPct: number | null;
  /** Phase 7I — ISO timestamp when the split was last observed. */
  observedAt?: string | null;
  /** Phase 7I — true when observedAt is older than 15 min. */
  isStale?: boolean;
}) {
  const stamp = isStale === true ? formatStaleStamp(observedAt ?? null) : null;
  return (
    <div className="space-y-1">
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-300">{label}</p>
      {moneyPct !== null ? (
        <SplitBar label="Money" pct={moneyPct} />
      ) : (
        <div className="grid grid-cols-[40px_1fr_36px] items-center gap-2">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">Money</span>
          <span className="text-[10px] text-gray-600 italic">not reported</span>
          <span />
        </div>
      )}
      {betsPct !== null ? (
        <SplitBar label="Bets" pct={betsPct} />
      ) : (
        <div className="grid grid-cols-[40px_1fr_36px] items-center gap-2">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">Bets</span>
          <span className="text-[10px] text-gray-600 italic">not reported</span>
          <span />
        </div>
      )}
      {stamp !== null && (
        <p className="text-[9px] tracking-[0.06em] text-gray-500/85 italic pl-[42px]">
          {stamp}
        </p>
      )}
    </div>
  );
}

function SplitBar({ label, pct }: { label: string; pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[40px_1fr_36px] items-center gap-2">
      <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">{label}</span>
      <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
        <div className="h-full bg-violet-400/70 rounded-full" style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10.5px] tabular-nums text-gray-400 font-bold text-right">{Math.round(v)}%</span>
    </div>
  );
}

// ─── Key Stats helpers ─────────────────────────────────────────────────
//
// The DTO's KeyStatRow shape is awayValue/homeValue strings — already
// beginner-formatted by lib/services/keyStatsFormatter.ts. The UI's job
// here is to render them as TEAM-LABELED rows with a plain-English edge
// interpretation chip ("PHI slight edge" / "Even") so a beginner can
// immediately tell which team owns which number and who has the
// advantage. All interpretation is derived from the existing label +
// value strings — no DTO change required.
//
// Pitcher names are NOT shown yet — those require a DTO/API follow-up
// (DB has games.home_pitcher_id / away_pitcher_id → players(first_name,
// last_name) but the daily-edge route doesn't currently SELECT them).

type KeyStatTone = "emerald" | "amber" | "sky" | "gray";

type KeyStatInterpretation = {
  /** Short chip text: "PHI slight edge", "Even", "Hitter-friendly", or null when no interpretation. */
  edgeLine: string | null;
  tone: KeyStatTone;
  /** Which side to highlight in the team rows. Null = neither. */
  winner: "away" | "home" | null;
  /** True iff both away and home values are meaningful (drives the two-row vs one-row layout). */
  twoSided: boolean;
};

function parsePctBetterWorse(v: string | null): number | null {
  if (v === null) return null;
  if (v === "league average") return 0;
  const better = v.match(/(\d+)% better/);
  if (better) return parseInt(better[1], 10);
  const worse = v.match(/(\d+)% worse/);
  if (worse) return -parseInt(worse[1], 10);
  return null;
}

function parsePctStrongerWeaker(v: string | null): number | null {
  if (v === null) return null;
  if (v === "league average") return 0;
  const stronger = v.match(/(\d+)% stronger/);
  if (stronger) return parseInt(stronger[1], 10);
  const weaker = v.match(/(\d+)% weaker/);
  if (weaker) return -parseInt(weaker[1], 10);
  return null;
}

function compareEdge(
  diff: number,
  slightThreshold: number,
  clearThreshold: number,
  awayBetterWhen: "positive" | "negative",
  awayAbbr: string,
  homeAbbr: string
): { winner: "away" | "home" | null; line: string; tone: KeyStatTone } {
  const abs = Math.abs(diff);
  if (abs < slightThreshold) {
    return { winner: null, line: "Even", tone: "gray" };
  }
  const isAway = awayBetterWhen === "positive" ? diff > 0 : diff < 0;
  const winner: "away" | "home" = isAway ? "away" : "home";
  const magnitude = abs >= clearThreshold ? "clear" : "slight";
  return {
    winner,
    line: `${winner === "away" ? awayAbbr : homeAbbr} ${magnitude} edge`,
    tone: "emerald",
  };
}

/**
 * For directional totals/FI stats, return a "supports / risk to / neutral"
 * chip relative to the side the model picked. This prevents the UI from
 * announcing "Leans YRFI" while the pick is NRFI — which is what the old
 * pick-agnostic interpretation did. The numeric thresholds stay the same;
 * what changes is the framing.
 *
 * `confirms` is true when the stat's natural direction agrees with the
 * pick (e.g. high projected first-inning runs + YRFI pick), false when
 * it contradicts (e.g. high projected first-inning runs + NRFI pick).
 */
function pickRelativeChip(
  confirms: boolean,
  pickLabel: string,
  neutralLabel: string | null
): { edgeLine: string; tone: KeyStatTone } | null {
  if (neutralLabel !== null && !confirms) {
    // Caller indicated we should suppress the conflict framing and just
    // show the neutral label (used when the projection is on the fence).
    return { edgeLine: neutralLabel, tone: "gray" };
  }
  if (confirms) return { edgeLine: `Supports ${pickLabel}`, tone: "emerald" };
  return { edgeLine: `Risk to ${pickLabel}`, tone: "amber" };
}

function interpretKeyStat(
  label: string,
  awayValue: string | null,
  homeValue: string | null,
  awayAbbr: string,
  homeAbbr: string,
  market: MarketKey,
  pick: string | null
): KeyStatInterpretation {
  // Phase 6B.1.6j — first-inning starter rows render as TWO-SIDED so
  // each value is paired with its team abbreviation in the breakdown.
  // When only one starter has FI data, the formatter writes a "no FI
  // sample" / "no season ERA" / "no OPS sample" sentinel on the
  // missing side so the user can still see WHICH side is missing.
  if (
    (label === "Starter 1st-inning ERA" ||
      label === "Starter 1st-inning WHIP" ||
      label === "Top-of-order OPS" ||
      label === "Starter ERA (season)") &&
    (awayValue !== null || homeValue !== null)
  ) {
    const a = parseFloat(awayValue ?? "");
    const h = parseFloat(homeValue ?? "");
    if (Number.isFinite(a) && Number.isFinite(h)) {
      // For ERA / WHIP, LOWER is better (favors NRFI); for OPS, HIGHER
      // is better (favors YRFI). edgeLine label uses the same orientation
      // as the ML "Starter ERA" path above.
      const negativeIsBetter = label !== "Top-of-order OPS";
      const minDelta = label === "Top-of-order OPS" ? 0.030 : 0.20;
      const bigDelta = label === "Top-of-order OPS" ? 0.075 : 0.50;
      const cmp = compareEdge(
        a - h,
        minDelta,
        bigDelta,
        negativeIsBetter ? "negative" : "positive",
        awayAbbr,
        homeAbbr,
      );
      return { edgeLine: cmp.line, tone: cmp.tone, winner: cmp.winner, twoSided: true };
    }
    // One side missing or non-numeric — still render two-sided (team
    // labels visible). No edge chip when we can't compute one.
    return { edgeLine: null, tone: "gray", winner: null, twoSided: true };
  }
  // Two-sided ML stats ────────────────────────────────────────────────
  if (label === "Starter ERA" && awayValue !== null && homeValue !== null) {
    const a = parseFloat(awayValue);
    const h = parseFloat(homeValue);
    if (!Number.isFinite(a) || !Number.isFinite(h)) {
      return { edgeLine: null, tone: "gray", winner: null, twoSided: true };
    }
    // Lower ERA is better → away wins when (a - h) is NEGATIVE.
    const cmp = compareEdge(a - h, 0.20, 0.50, "negative", awayAbbr, homeAbbr);
    return { edgeLine: cmp.line, tone: cmp.tone, winner: cmp.winner, twoSided: true };
  }

  if (label === "Lineup OPS (weighted)" && awayValue !== null && homeValue !== null) {
    const a = parseFloat(awayValue);
    const h = parseFloat(homeValue);
    if (!Number.isFinite(a) || !Number.isFinite(h)) {
      return { edgeLine: null, tone: "gray", winner: null, twoSided: true };
    }
    // Higher OPS is better → away wins when (a - h) is POSITIVE.
    const cmp = compareEdge(a - h, 0.020, 0.050, "positive", awayAbbr, homeAbbr);
    return { edgeLine: cmp.line, tone: cmp.tone, winner: cmp.winner, twoSided: true };
  }

  if (label === "Bullpen quality" && awayValue !== null && homeValue !== null) {
    const a = parsePctBetterWorse(awayValue);
    const h = parsePctBetterWorse(homeValue);
    if (a === null || h === null) {
      return { edgeLine: null, tone: "gray", winner: null, twoSided: true };
    }
    // Higher score (= more "better-than-league") is better.
    const cmp = compareEdge(a - h, 3, 7, "positive", awayAbbr, homeAbbr);
    return { edgeLine: cmp.line, tone: cmp.tone, winner: cmp.winner, twoSided: true };
  }

  if (label === "Lineup vs starter" && awayValue !== null && homeValue !== null) {
    const a = parsePctStrongerWeaker(awayValue);
    const h = parsePctStrongerWeaker(homeValue);
    if (a === null || h === null) {
      return { edgeLine: null, tone: "gray", winner: null, twoSided: true };
    }
    // Higher score (= stronger matchup) is better.
    const cmp = compareEdge(a - h, 3, 7, "positive", awayAbbr, homeAbbr);
    return { edgeLine: cmp.line, tone: cmp.tone, winner: cmp.winner, twoSided: true };
  }

  // Single-value totals stats ─────────────────────────────────────────
  // Park factor + Weather adjust have natural directions: positive →
  // more runs (favors Over), negative → fewer runs (favors Under). We
  // frame the chip relative to the model's Over/Under pick so the UI
  // never tells the user the stat "leans" the opposite side from the
  // pick. When the pick is missing, fall back to the older neutral
  // copy.
  const pickOverUnder: "over" | "under" | null =
    market === "total" && pick !== null
      ? (pick.toLowerCase().startsWith("over") ? "over" : pick.toLowerCase().startsWith("under") ? "under" : null)
      : null;

  if (label === "Park factor" && homeValue !== null) {
    if (homeValue === "neutral") {
      return { edgeLine: "Neutral park", tone: "gray", winner: null, twoSided: false };
    }
    const m = homeValue.match(/([+-]?\d+)% runs/);
    if (m) {
      const pct = parseInt(m[1], 10);
      // Magnitude has to clear ±3% to count as directional.
      if (Math.abs(pct) < 3) {
        return { edgeLine: "Neutral park", tone: "gray", winner: null, twoSided: false };
      }
      // Pick-agnostic fallback when we don't have a clear Over/Under context.
      if (pickOverUnder === null) {
        return {
          edgeLine: pct >= 3 ? "Hitter-friendly" : "Pitcher-friendly",
          tone: pct >= 3 ? "emerald" : "sky",
          winner: null,
          twoSided: false,
        };
      }
      const favorsOver = pct >= 3;
      const confirms = (pickOverUnder === "over") === favorsOver;
      const chip = pickRelativeChip(confirms, pickOverUnder === "over" ? "Over" : "Under", null);
      return { edgeLine: chip?.edgeLine ?? null, tone: chip?.tone ?? "gray", winner: null, twoSided: false };
    }
    return { edgeLine: null, tone: "gray", winner: null, twoSided: false };
  }

  if (label === "Weather adjust" && homeValue !== null) {
    if (homeValue === "neutral") {
      return { edgeLine: "Neutral", tone: "gray", winner: null, twoSided: false };
    }
    const m = homeValue.match(/([+-]?\d*\.?\d+) runs/);
    if (m) {
      const v = parseFloat(m[1]);
      if (Math.abs(v) < 0.3) {
        return { edgeLine: "Neutral", tone: "gray", winner: null, twoSided: false };
      }
      if (pickOverUnder === null) {
        return {
          edgeLine: v >= 0.3 ? "Boosts runs" : "Suppresses runs",
          tone: v >= 0.3 ? "emerald" : "amber",
          winner: null,
          twoSided: false,
        };
      }
      const favorsOver = v >= 0.3;
      const confirms = (pickOverUnder === "over") === favorsOver;
      const chip = pickRelativeChip(confirms, pickOverUnder === "over" ? "Over" : "Under", null);
      return { edgeLine: chip?.edgeLine ?? null, tone: chip?.tone ?? "gray", winner: null, twoSided: false };
    }
    return { edgeLine: null, tone: "gray", winner: null, twoSided: false };
  }

  // Single-value first-inning stats ───────────────────────────────────
  // Projected first-inning runs is the model's actual NRFI/YRFI driver.
  // The zone boundaries here MIRROR the model's published thresholds in
  // lib/automodel/types.ts (NRFI_THRESHOLD_LEAN = 0.85, YRFI_THRESHOLD_LEAN
  // = 1.15) so the displayed chip stays consistent with the pick label
  // ("Toss-Up" for the [0.85, 1.15) Toss-Up band).
  if (label === "Projected 1st-inning runs" && homeValue !== null) {
    const v = parseFloat(homeValue);
    if (!Number.isFinite(v)) {
      return { edgeLine: null, tone: "gray", winner: null, twoSided: false };
    }
    // Toss-Up band — model is neutral here. Pick-agnostic chip in gray
    // matches the "Toss-Up" pick label rendered by the route.
    if (v >= 0.85 && v < 1.15) {
      return { edgeLine: "Toss-up", tone: "gray", winner: null, twoSided: false };
    }
    const favorsYrfi = v >= 1.15;
    const fiPickLabel: "NRFI" | "YRFI" | null =
      market === "first_inning" && pick !== null
        ? (pick.toUpperCase().startsWith("YRFI") ? "YRFI" : pick.toUpperCase().startsWith("NRFI") ? "NRFI" : null)
        : null;
    if (fiPickLabel === null) {
      // R-19 Phase 5i Fix B — pick is null (held FI) OR pick is Toss-Up.
      // Pre-5i this branch emitted "Leans NRFI" / "Leans YRFI" based on
      // the projection direction, which made every held FI game look like
      // a directional NRFI play even though the model deliberately
      // declined to pick. Suppress the directional chip so the row
      // surfaces only the projection value; the user sees the number
      // without a contradictory "Leans NRFI" overlay when the pick was
      // held.
      return {
        edgeLine: null,
        tone: "gray",
        winner: null,
        twoSided: false,
      };
    }
    const confirms = (fiPickLabel === "YRFI") === favorsYrfi;
    const chip = pickRelativeChip(confirms, fiPickLabel, null);
    return { edgeLine: chip?.edgeLine ?? null, tone: chip?.tone ?? "gray", winner: null, twoSided: false };
  }

  if (label === "Top-of-order data" && homeValue !== null) {
    // The value already says "Available" / "Unavailable" — no extra chip needed.
    return { edgeLine: null, tone: "gray", winner: null, twoSided: false };
  }

  // Fallback: unknown stat — show as one or two rows depending on what's present.
  const twoSided = awayValue !== null && homeValue !== null;
  return { edgeLine: null, tone: "gray", winner: null, twoSided };
}

function TeamStatRow({
  abbr,
  value,
  highlight,
}: {
  abbr: string;
  value: string;
  highlight: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span
        className={`text-[10.5px] uppercase tracking-[0.10em] font-bold ${
          highlight ? "text-emerald-300" : "text-gray-400"
        }`}
      >
        {abbr}
      </span>
      <span
        className={`text-[11.5px] tabular-nums ${
          highlight ? "text-emerald-200 font-semibold" : "text-gray-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function KEY_STAT_TONE_TEXT(tone: KeyStatTone): string {
  if (tone === "emerald") return "text-emerald-300";
  if (tone === "amber") return "text-amber-300";
  if (tone === "sky") return "text-sky-300";
  return "text-gray-500";
}

function MarketNotes({
  marketData,
  awayAbbr,
  homeAbbr,
  market,
}: {
  marketData: MarketEdgeDto;
  awayAbbr: string;
  homeAbbr: string;
  market: MarketKey;
}) {
  return (
    <div className="space-y-2.5">
      {/* Key Stats — team-labeled with plain-English edge interpretation */}
      {marketData.keyStats.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/70">Key Stats</p>
          <div className="space-y-2.5">
            {marketData.keyStats.map((s) => {
              const interp = interpretKeyStat(
                s.label,
                s.awayValue,
                s.homeValue,
                awayAbbr,
                homeAbbr,
                market,
                marketData.pick,
              );
              return (
                <div key={s.label} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10.5px] uppercase tracking-[0.12em] text-gray-400 font-semibold">{s.label}</p>
                    {interp.edgeLine !== null && (
                      <span className={`text-[10px] font-semibold tracking-tight ${KEY_STAT_TONE_TEXT(interp.tone)}`}>
                        {interp.edgeLine}
                      </span>
                    )}
                  </div>
                  {interp.twoSided ? (
                    <div className="space-y-0">
                      <TeamStatRow
                        abbr={awayAbbr}
                        value={s.awayValue ?? "—"}
                        highlight={interp.winner === "away"}
                      />
                      <TeamStatRow
                        abbr={homeAbbr}
                        value={s.homeValue ?? "—"}
                        highlight={interp.winner === "home"}
                      />
                    </div>
                  ) : (
                    // R-16H: "Projected 1st-inning runs" is the model's
                    // headline NRFI/YRFI driver — render with prominence
                    // (bigger, bolder, higher contrast) so it doesn't
                    // disappear among the smaller key-stat values. All
                    // other single-value key stats keep their quieter
                    // baseline treatment.
                    <p
                      className={
                        s.label === "Projected 1st-inning runs"
                          ? "text-[15px] tabular-nums font-extrabold text-gray-100 leading-tight"
                          : "text-[11.5px] tabular-nums text-gray-300"
                      }
                    >
                      {s.homeValue ?? s.awayValue ?? "—"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="border-t border-white/[0.04]" />
      <section className="space-y-1">
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/70">Market Notes</p>
        <div className="space-y-1.5">
          <ReadLine label="Why" body={marketData.whyLine} />
          <ReadLine label="Risk" body={marketData.riskLine} tone="amber" />
        </div>
      </section>
    </div>
  );
}

function ReadLine({ label, body, tone = "default" }: { label: string; body: string; tone?: "default" | "amber" }) {
  return (
    <div className="grid grid-cols-[42px_1fr] gap-2 items-start">
      <span
        className={`text-[9.5px] uppercase tracking-[0.14em] font-bold ${
          tone === "amber" ? "text-amber-300" : "text-gray-500"
        }`}
      >
        {label}
      </span>
      <p className="text-[12px] text-gray-300 leading-snug">{body}</p>
    </div>
  );
}

// ─── Verdict-aware card chrome ─────────────────────────────────────────

/**
 * Verdict treatment on the slate card — visual weight only, never a sort
 * key. Top-edge accent + border tone + headline-market chip tint do the
 * hierarchy work. No container gradients (kept solid `bg-[#0D0D14]`) —
 * gradients muddied the look in the previous pass.
 */
/**
 * Verdict treatment — consistent system across all 5 states. Only
 * best_angle gets the subtle glow (it's the premium pop). All others
 * use a 3px solid top-edge accent of the verdict tone + matched border
 * tone. Headline-market chip tint stays soft so it whispers rather
 * than shouts. The five cards should read as one product, not five.
 */
const CARD_TREATMENT: Record<VerdictKey, {
  topAccent: string;        // top-edge color strip (3px, same height for all)
  ring: string;             // border / hover when not active
  headlineMarketBg: string; // tint behind the headline market chip
}> = {
  best_angle: {
    topAccent: "bg-emerald-400/80 shadow-[0_0_10px_-2px_rgba(52,211,153,0.40)]",
    ring: "border-emerald-500/25 hover:border-emerald-400/45",
    headlineMarketBg: "bg-emerald-500/[0.07] border-emerald-500/25",
  },
  // R-16H: Lean → SKY (swapped from Watchlist). The more eye-catching
  // tone for the common "actionable" verdict, distinct from emerald
  // (Best Angle) and violet (selected). Best Angle still outshines via
  // glow + brighter pill tint + ★ glyph.
  // NOTE: the top-edge accent isn't applied to cards anymore
  // (team-color gradient replaced it), so topAccent here is dead —
  // kept for type completeness.
  lean: {
    topAccent: "bg-sky-400/65",
    ring: "border-sky-500/20 hover:border-sky-400/40",
    headlineMarketBg: "bg-sky-500/[0.06] border-sky-500/25",
  },
  // R-16H: Watchlist → INDIGO (swapped from Lean). Quieter periwinkle
  // tone for the informational/secondary subset of games.
  watchlist: {
    topAccent: "bg-indigo-400/40",
    ring: "border-indigo-500/15 hover:border-indigo-400/35",
    headlineMarketBg: "bg-indigo-500/[0.05] border-indigo-500/20",
  },
  caution: {
    topAccent: "bg-amber-400/70",
    ring: "border-amber-500/20 hover:border-amber-400/40",
    headlineMarketBg: "bg-amber-500/[0.06] border-amber-500/25",
  },
  no_play: {
    topAccent: "bg-gray-700/45",
    ring: "border-white/[0.04] hover:border-white/[0.08]",
    headlineMarketBg: "bg-white/[0.025] border-white/[0.07]",
  },
};

const ACTIVE_RING =
  "border-violet-400/55 shadow-[0_0_0_1px_rgba(167,139,250,0.30),0_8px_28px_-8px_rgba(167,139,250,0.40),inset_0_1px_0_0_rgba(167,139,250,0.18)]";

/**
 * Shared base depth treatment applied to every slate card regardless of
 * verdict. This is what makes the cards feel like premium clickable
 * panels — a faint top-to-bottom gradient, a 1px inset highlight, and a
 * soft drop shadow. Verdict-specific styling (top accent strip, ring
 * tone) layers on top of this baseline.
 */
const CARD_BASE_DEPTH =
  "bg-gradient-to-b from-white/[0.03] via-white/[0.005] to-black/[0.10] " +
  "shadow-[0_4px_16px_-6px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.05)] " +
  "hover:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.08)]";

// ─── SlateCard ─────────────────────────────────────────────────────────

/**
 * Premium slate card. Renders matchup + time + decision line + 3 market
 * pills + sharp glyphs + a "View breakdown" affordance.
 *
 * Verdict treatment lives in CARD_TREATMENT — visual weight only, never
 * a sort key. Game-time order is preserved.
 *
 * Card is the click target (the entire surface) on both desktop and
 * mobile. On desktop/tablet the shell renders an inline ExpandedReader
 * underneath this card when expanded; on mobile the shell opens a
 * MobileDetailSheet portal instead.
 */
function SlateCard({
  game,
  active,
  activeMarket,
  onSelectGame,
  onSelectMarket,
}: {
  game: DailyEdgeGameDto;
  /** True when this card is the one currently shown in the reader. */
  active: boolean;
  /** Which market the reader is currently showing for this game (only meaningful when `active`). */
  activeMarket: MarketKey | null;
  /** Card body click — selects game with its headline market. */
  onSelectGame: () => void;
  /** Market chip click — selects game with the chip's market. */
  onSelectMarket: (m: MarketKey) => void;
}) {
  const headlineMarket = headlineMarketFor(game);
  const headlineMarketData = game.markets[headlineMarket];
  const headlineVerdict = asVerdictKey(headlineMarketData.verdict.key);
  const t = CARD_TREATMENT[headlineVerdict];
  const shellSport = useShellSport();

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelectGame}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectGame();
        }
      }}
      className={`group relative rounded-xl overflow-hidden border cursor-pointer transition-all bg-[#0D0D14] ${CARD_BASE_DEPTH} ${
        active ? ACTIVE_RING : t.ring
      }`}
    >
      {/* Top-edge accent — team-color gradient (away → home). Carries
          team identity at the very top of the card. The 3px strip stays
          the same geometry as before; verdict signal is now carried by
          the per-market pill tints below + the top-right verdict chip +
          the per-market verdict strip. */}
      <div
        className="h-[3px] w-full"
        aria-hidden="true"
        style={{
          background: `linear-gradient(to right, ${teamPrimaryColor(game.awayTeam, shellSport)} 0%, ${teamPrimaryColor(game.awayTeam, shellSport)} 28%, rgba(255,255,255,0.06) 50%, ${teamPrimaryColor(game.homeTeam, shellSport)} 72%, ${teamPrimaryColor(game.homeTeam, shellSport)} 100%)`,
        }}
      />

      <div className="p-5">
        {/* Team row + verdict + time. Cleaner: logos and abbrs only, no
            Away/Home micro-labels. The order conveys it.

            R-16H: previously the row could visually crowd on narrow
            viewports — fixed-size TeamBadges + abbreviation spans on
            the left + VerdictChip / time / lock on the right couldn't
            shrink past their minimums and ended up touching or
            overlapping. `flex-wrap` lets the right group drop to its
            own line when horizontal room runs out; `gap-y-2` gives
            vertical breathing room when wrapping happens. Desktop
            layout is unchanged when there's room to fit on one line. */}
        <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 mb-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <TeamBadge abbr={game.awayTeam} logo={game.awayTeamLogo} size={36} />
            <span className="text-[16px] font-bold text-gray-100 tabular-nums" style={{ letterSpacing: "-0.01em" }}>
              {game.awayTeam}
            </span>
            <span className="text-gray-700 text-[13px]">@</span>
            <span className="text-[16px] font-bold text-gray-100 tabular-nums" style={{ letterSpacing: "-0.01em" }}>
              {game.homeTeam}
            </span>
            <TeamBadge abbr={game.homeTeam} logo={game.homeTeamLogo} size={36} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <VerdictChip verdict={headlineVerdict} />
            <span className="text-[11px] text-gray-500 tabular-nums">{game.gameTime}</span>
            <LockBadge
              lockState={game.lockState}
              lockedAt={game.lockedAt}
              scheduledLockAt={game.scheduledLockAt}
            />
          </div>
        </div>

        {/* Phase 4.2.C.2 — held-state banner.
            When ALL three markets are held (sport_specific.held=true AND
            hold_picks contains ml+ou+nrfi), surface a single quiet line
            explaining why instead of cluttering the headline area with
            "—". The headline area below still renders "—" for the pick;
            this banner gives context for why. Mixed-hold cases (some
            held, some playable) skip the banner — per-market verdict
            chips already speak for themselves. */}
        {game.holdReason !== null &&
        game.markets.moneyline.held &&
        game.markets.total.held &&
        game.markets.first_inning.held ? (
          <div className="mb-2.5 text-[11px] uppercase tracking-[0.14em] font-semibold text-gray-500">
            Held —{" "}
            {game.holdReason === "missing_or_scratched_starter"
              ? "starter data pending"
              : game.holdReason.replace(/_/g, " ")}
          </div>
        ) : null}

        {/* Headline pick — the visual focal point. Edge chip surfaces a
            single quiet badge when the pick has meaningful value/edge
            data ("+2.6% value", "Model edge", "Market support"). */}
        <div className="flex items-baseline gap-2 mb-2.5 flex-wrap">
          <span
            className="text-[28px] font-black tabular-nums leading-none text-white"
            style={{ letterSpacing: "-0.03em" }}
          >
            {headlineMarketData.pick ?? "—"}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-bold">
            {marketShortLabelFor(headlineMarket, shellSport)}
          </span>
          <span className="text-[13px] tabular-nums font-bold text-gray-300">
            {headlineMarketData.confidence === null
              ? "—"
              : `${Math.round(headlineMarketData.confidence * 100)}%`}
          </span>
          {headlineMarketData.priceAmerican !== null ? (
            <span className="text-[12px] tabular-nums font-medium text-gray-500 ml-1">
              {formatAmerican(headlineMarketData.priceAmerican)}
            </span>
          ) : headlineMarketData.priceUnavailableAtLock ? (
            <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500 ml-1">
              no price at lock
            </span>
          ) : null}
          {(() => {
            const chip = buildCardEdgeChip(headlineMarketData);
            if (chip === null) return null;
            const tone =
              chip.tone === "emerald"
                ? "bg-emerald-500/[0.10] text-emerald-200 border-emerald-500/25"
                : chip.tone === "sky"
                ? "bg-sky-500/[0.10] text-sky-200 border-sky-500/25"
                : chip.tone === "amber"
                ? "bg-amber-500/[0.10] text-amber-200 border-amber-500/25"
                : "bg-white/[0.04] text-gray-300 border-white/[0.08]";
            return (
              <span
                className={`ml-auto inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.12em] font-bold whitespace-nowrap border ${tone}`}
              >
                {chip.label}
              </span>
            );
          })()}
        </div>

        {/* Decision line — softer color, single tight line */}
        <p className="text-[12.5px] text-gray-500 leading-snug mb-2 line-clamp-2">{game.decisionLine}</p>

        {/* Projection — model's per-team run estimate, scannable from
            the grid without opening the reader. Compact one-liner: small
            "PROJ" eyebrow + team-labeled run values. No chip, no border.
            Numbers brightened to text-white + font-black for stronger
            contrast against the muted PROJ + abbr labels — same line
            height, no card-height growth. */}
        <div className="flex items-baseline gap-2 mb-2.5">
          <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-500/85 shrink-0">
            Proj
          </span>
          <span className="text-[11px] tabular-nums">
            <span className="text-gray-500 mr-1">{game.awayTeam}</span>
            <span className="text-white font-black">{game.projected.away.toFixed(1)}</span>
            <span aria-hidden="true" className="text-gray-700 mx-1.5">·</span>
            <span className="text-gray-500 mr-1">{game.homeTeam}</span>
            <span className="text-white font-black">{game.projected.home.toFixed(1)}</span>
          </span>
        </div>

        {/* Per-market verdict strip — quietly communicates the spread
            across ML / Total / 1st so the eye registers that the
            headline chip is one market of three. The market label is
            muted; the verdict glyph + label carries the tone. Subtle
            saturation keeps three different tones from feeling busy. */}
        <div className="flex items-center justify-between gap-1 mb-3 px-0.5 text-[10px] uppercase tracking-[0.10em] font-bold whitespace-nowrap overflow-hidden">
          {marketKeysFor(shellSport).map((m, i) => {
            const v = asVerdictKey(game.markets[m].verdict.key);
            const isContext = isContextOnlyMarket(m, shellSport);
            return (
              <span
                key={m}
                className={`inline-flex items-center gap-1 min-w-0 ${
                  isContext ? "opacity-80" : ""
                }`}
              >
                {i > 0 && <span aria-hidden="true" className="text-gray-700 mr-1">·</span>}
                <span className="text-gray-500">{marketShortLabelFor(m, shellSport)}</span>
                <span className={VERDICT_TEXT_COLOR[v]}>
                  <span aria-hidden="true" className="mr-0.5">{VERDICT_GLYPH[v]}</span>
                  <span>{VERDICT_LABEL[v]}</span>
                </span>
              </span>
            );
          })}
        </div>

        {/* Market chips. Cleaner: drop the verdict glyph inside each chip
            (the top-edge accent + headline tint already carry verdict).
            Less visual noise. Confidence stays on the headline pick only.
            stopPropagation so chip click doesn't fire the card-body handler. */}
        {/* Market pills — each one now tinted by ITS OWN market's verdict
            so the user can scan ML / Total / 1st verdicts at a glance.
            Active state (violet) overrides the verdict tint when the
            reader is showing this market. Total pill includes the line. */}
        <div
          className="grid gap-1.5 mb-3.5"
          style={{ gridTemplateColumns: `repeat(${marketKeysFor(shellSport).length}, minmax(0, 1fr))` }}
        >
          {marketKeysFor(shellSport).map((m) => {
            const md = game.markets[m];
            const mv = asVerdictKey(md.verdict.key);
            const isActiveMarket = active && activeMarket === m;
            const isContext = isContextOnlyMarket(m, shellSport);
            return (
              <button
                key={m}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectMarket(m);
                }}
                className={`text-left px-2.5 py-1.5 rounded-md border transition-colors ${
                  isActiveMarket
                    ? "bg-violet-500/[0.16] border-violet-400/50"
                    : VERDICT_PILL_TINT[mv]
                } ${isContext && !isActiveMarket ? "opacity-80" : ""}`}
              >
                <span
                  className={`block text-[9.5px] uppercase tracking-[0.14em] font-bold mb-0.5 ${
                    isActiveMarket ? "text-violet-200/85" : VERDICT_TEXT_COLOR[mv]
                  }`}
                >
                  {marketShortLabelFor(m, shellSport)}
                </span>
                <span className="block text-[12.5px] font-bold tabular-nums text-gray-100 truncate">
                  {formatPickWithLine(m, md.pick, md.line, shellSport, game.awayTeam, game.homeTeam)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Context-only footnote — appears only when the card has at
            least one context-only market (NBA Spread or NHL Puck Line)
            in the strip above. The "*" appended to those market labels
            maps here. Officially tracked markets (ML / Total / 1st) do
            NOT carry the asterisk. */}
        {marketKeysFor(shellSport).some((m) => isContextOnlyMarket(m, shellSport)) && (
          <p className="text-[9.5px] text-gray-500 italic mb-2 leading-tight">
            {CONTEXT_ONLY_FOOTNOTE}
          </p>
        )}

        {/* Action affordance — slimmer, link-style. The whole card is a
            click target anyway; this is just the eye-cue. */}
        <div className="flex items-center justify-end">
          <span
            className={`inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.16em] font-bold transition-colors ${
              active ? "text-violet-200" : "text-violet-200/70 group-hover:text-violet-200"
            }`}
          >
            {active ? "In the reader" : "View breakdown"}
            <span aria-hidden="true" className="text-[11px]">↑</span>
          </span>
        </div>
      </div>
    </article>
  );
}

// ─── SelectedEdgeReader (top-of-page, compact-default) ─────────────────

/**
 * Selected Edge reader. Lives at the top of the slate page (NOT sticky —
 * scrolls away naturally as the user browses the board). Compact mode is
 * the resting state — ~110px tall identity row + helper + market tabs +
 * one-line guide + Expand affordance. Full mode opt-in shows the same
 * three-column body the locked v1 reader used.
 *
 * Reader state lives in the parent shell so card clicks update what's
 * shown here. The reader itself only owns the compact/full toggle.
 */
function SelectedEdgeReader({
  game,
  market,
  marketData,
  mode,
  onMarketChange,
  onExpand,
  onCollapse,
}: {
  game: DailyEdgeGameDto;
  market: MarketKey;
  marketData: MarketEdgeDto;
  mode: "compact" | "full";
  onMarketChange: (m: MarketKey) => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const verdict = asVerdictKey(marketData.verdict.key);
  const shellSport = useShellSport();

  return (
    <section
      aria-label="Selected Edge"
      className={
        "relative bg-[#0D0D14] " +
        // Subtle vertical depth gradient + bottom darken so the panel
        // feels like a contained surface, not flat dark space.
        "bg-gradient-to-b from-violet-500/[0.045] via-white/[0.005] to-black/[0.18] " +
        // Stronger violet border than the prior 0.22 — reads as an
        // intentional premium container without becoming loud.
        "border border-violet-400/40 rounded-xl overflow-hidden " +
        // Stronger drop shadow + inset violet ring + inset top
        // highlight: the combo makes it visibly hover above the slate
        // grid below without adding height.
        "shadow-[0_12px_36px_-12px_rgba(167,139,250,0.32),0_0_0_1px_rgba(167,139,250,0.10),inset_0_1px_0_0_rgba(167,139,250,0.10)]"
      }
    >
      {/* Header — two clear rows: title row + meta row. Less inline-dot noise. */}
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.05] bg-gradient-to-r from-violet-500/[0.07] via-violet-500/[0.015] to-transparent">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85 shadow-[0_0_6px_rgba(167,139,250,0.35)]" />
            <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/95 whitespace-nowrap">
              Selected Edge
            </h2>
            <span className="hidden sm:inline text-[11px] text-gray-500 ml-2">
              Click any game below to update this read.
            </span>
          </div>
          {mode === "full" ? (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse reader"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-violet-400/60 bg-violet-500/[0.22] text-[10.5px] uppercase tracking-[0.14em] font-bold text-violet-50 hover:bg-violet-500/[0.32] hover:border-violet-300/75 shadow-[0_0_0_1px_rgba(167,139,250,0.10),0_4px_12px_-6px_rgba(139,92,246,0.35)] transition-colors whitespace-nowrap"
            >
              Collapse read <span aria-hidden="true">↑</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onExpand}
              aria-label="Expand full read"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-violet-400/60 bg-violet-500/[0.18] text-[10.5px] uppercase tracking-[0.14em] font-bold text-violet-50 hover:bg-violet-500/[0.28] hover:border-violet-300/75 shadow-[0_0_0_1px_rgba(167,139,250,0.10),0_4px_12px_-6px_rgba(139,92,246,0.35)] transition-colors whitespace-nowrap"
            >
              Expand full read <span aria-hidden="true">↓</span>
            </button>
          )}
        </div>

        {/* Matchup + verdict + time row. The verdict chip carries an
            "Action" prefix here so the user reads it as the
            actionability rating ("Watchlist", "Lean"), not as another
            pick label. The actual pick lives in the segmented selector
            below + the compact "Pick" block. */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[16px] font-bold text-gray-100 whitespace-nowrap" style={{ letterSpacing: "-0.01em" }}>
            {game.awayTeam} <span className="text-gray-700 font-normal mx-0.5">{matchupSepFor(shellSport)}</span> {game.homeTeam}
          </span>
          <VerdictChip verdict={verdict} showActionPrefix />
          <span className="text-[11px] text-gray-500 tabular-nums">{game.gameTime}</span>
        </div>

        {/* Market selector — segmented buttons. One per market with pick +
            confidence + verdict glyph. Replaces the older tiny-chip row. */}
        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${marketKeysFor(shellSport).length}, minmax(0, 1fr))` }}
        >
          {marketKeysFor(shellSport).map((m) => (
            <ReaderMarketSegment
              key={m}
              market={m}
              pick={game.markets[m].pick}
              line={game.markets[m].line}
              confidence={game.markets[m].confidence}
              verdict={asVerdictKey(game.markets[m].verdict.key)}
              selected={market === m}
              onClick={() => onMarketChange(m)}
              awayTeam={game.awayTeam}
              homeTeam={game.homeTeam}
            />
          ))}
        </div>
      </div>

      {mode === "compact" ? (
        /* Compact body — structured 3-panel quick summary. Each panel
           sits in its own slot so the eye lands cleanly on each piece
           instead of skimming over loose text. Bottom row is the
           beginner-friendly guide sentence spanning the full width.
           Total height stays compact (no taller than the previous
           layout); the difference is hierarchy, not size. */
        <div className="px-5 py-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-stretch divide-y sm:divide-y-0 sm:divide-x divide-white/[0.05]">
            {/* ── Left: Pick block ────────────────────────────────────── */}
            <div className="pb-2 sm:pb-0 sm:pr-3 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">Pick</p>
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1 shrink-0">
                  <TeamBadge abbr={game.awayTeam} logo={game.awayTeamLogo} size={28} />
                  <TeamBadge abbr={game.homeTeam} logo={game.homeTeamLogo} size={28} />
                </div>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-[18px] font-black tabular-nums text-white truncate" style={{ letterSpacing: "-0.02em" }}>
                    {marketData.pick ?? "—"}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[9.5px] uppercase tracking-[0.14em] text-violet-200/75 font-bold">
                      {marketShortLabelFor(market, shellSport)}
                    </span>
                    <span aria-hidden="true" className="text-gray-700 text-[10px]">·</span>
                    <span className="text-[11px] tabular-nums font-bold text-gray-200">
                      {marketData.confidence === null
                        ? "—"
                        : `${Math.round(marketData.confidence * 100)}%`}
                    </span>
                    {marketData.priceAmerican !== null ? (
                      <>
                        <span aria-hidden="true" className="text-gray-700 text-[10px]">·</span>
                        <span className="text-[11px] tabular-nums font-medium text-gray-400">
                          {formatAmerican(marketData.priceAmerican)}
                        </span>
                      </>
                    ) : marketData.priceUnavailableAtLock ? (
                      <>
                        <span aria-hidden="true" className="text-gray-700 text-[10px]">·</span>
                        <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-500">
                          no price at lock
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Middle: Edge block ──────────────────────────────────── */}
            <div className="py-2 sm:py-0 sm:px-3 min-w-0">
              {(() => {
                const edge = buildEdgeRow(market, marketData, shellSport);
                if (edge === null) {
                  return (
                    <>
                      <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">Edge</p>
                      <p className="text-[12.5px] text-gray-500 italic leading-snug">
                        Awaiting market signal
                      </p>
                    </>
                  );
                }
                return (
                  <>
                    <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">
                      {edge.label}
                    </p>
                    <p className={`text-[13.5px] tabular-nums font-bold leading-snug ${EDGE_TONE_TEXT[edge.tone]}`}>
                      {edge.value}
                    </p>
                  </>
                );
              })()}
            </div>

            {/* ── Right: Projection block ─────────────────────────────── */}
            <div className="pt-2 sm:pt-0 sm:pl-3 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">Projection</p>
              <p
                className="text-[16px] tabular-nums font-black text-white leading-snug"
                style={{ letterSpacing: "-0.01em" }}
              >
                <span className="text-[11px] text-gray-500 font-bold mr-1">{game.awayTeam}</span>
                {game.projected.away.toFixed(1)}
                <span aria-hidden="true" className="text-gray-700 mx-1.5">·</span>
                <span className="text-[11px] text-gray-500 font-bold mr-1">{game.homeTeam}</span>
                {game.projected.home.toFixed(1)}
              </p>
            </div>
          </div>

          {/* Bottom row — plain-English guide sentence, spans full width */}
          <p className="mt-3 pt-2.5 border-t border-white/[0.05] text-[12.5px] text-gray-400 leading-snug line-clamp-2">
            {marketData.guidedGuide}
          </p>
        </div>
      ) : (
        /* Full body — 3-column expanded read */
        <div className="px-4 sm:px-5 py-3">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-5">
            <QuickRead game={game} market={market} marketData={marketData} />
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
                <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/60 shadow-[0_0_6px_rgba(167,139,250,0.22)]" />
                <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/75">Supporting Evidence</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] gap-5">
                <div className="space-y-2.5">
                  <EdgeStack market={market} marketData={marketData} />
                  <div className="border-t border-white/[0.04]" />
                  <ConfidenceVsMarketStrip market={market} marketData={marketData} />
                  <div className="border-t border-white/[0.04]" />
                  <MarketPulse market={market} marketData={marketData} />
                </div>
                <MarketNotes
                  marketData={marketData}
                  awayAbbr={game.awayTeam}
                  homeAbbr={game.homeTeam}
                  market={market}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── MobileDetailSheet (full-screen portal) ────────────────────────────

/**
 * Full-screen bottom-sheet detail for mobile. Locks body scroll while open
 * and closes on scrim tap / × tap. Same content surface as ExpandedReader.
 */
function MobileDetailSheet({
  game,
  onClose,
  selectedMarket,
  onMarketChange,
  onPrev,
  onNext,
  index,
  total,
}: {
  game: DailyEdgeGameDto;
  onClose: () => void;
  selectedMarket: MarketKey;
  onMarketChange: (m: MarketKey) => void;
  /** Called when user taps the prev chevron. Null = at first game, disable button. */
  onPrev: (() => void) | null;
  /** Called when user taps the next chevron. Null = at last game, disable button. */
  onNext: (() => void) | null;
  /** 1-indexed position for the "3 of 12" caption. */
  index: number;
  total: number;
}) {
  const marketData = pickMarket(game, selectedMarket);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div className="absolute inset-x-0 bottom-0 top-12 bg-[#0A0A0F] border-t border-violet-400/30 rounded-t-xl overflow-hidden flex flex-col">
        {/* Header — top row: matchup + close. Second row: prev/next nav. */}
        <div className="px-4 pt-3 pb-2 border-b border-white/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <TeamBadge abbr={game.awayTeam} logo={game.awayTeamLogo} size={26} />
              <span className="text-[15px] font-bold text-gray-100">{game.awayTeam}</span>
              <span className="text-gray-700 text-[12px]">@</span>
              <span className="text-[15px] font-bold text-gray-100">{game.homeTeam}</span>
              <TeamBadge abbr={game.homeTeam} logo={game.homeTeamLogo} size={26} />
              <span className="text-gray-700 ml-1">·</span>
              <span className="text-[12px] text-gray-400 tabular-nums">{game.gameTime}</span>
              <LockBadge
                lockState={game.lockState}
                lockedAt={game.lockedAt}
                scheduledLockAt={game.scheduledLockAt}
                withSeparator
                className="text-[12px] text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <span aria-hidden="true" className="text-[20px] leading-none">×</span>
            </button>
          </div>
          {/* Prev/Next strip — lets the user browse the slate without
              closing the sheet. Selected market is preserved across the
              switch (state lives in the parent shell). */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onPrev ?? undefined}
              disabled={onPrev === null}
              aria-label="Previous game"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.12em] font-bold transition-colors ${
                onPrev === null
                  ? "border-white/[0.05] bg-white/[0.02] text-gray-700 cursor-not-allowed"
                  : "border-violet-400/40 bg-violet-500/[0.10] text-violet-100 hover:bg-violet-500/[0.18]"
              }`}
            >
              <span aria-hidden="true">←</span>
              Prev
            </button>
            <span className="text-[10.5px] tabular-nums uppercase tracking-[0.14em] font-bold text-gray-500">
              Game {index} of {total}
            </span>
            <button
              type="button"
              onClick={onNext ?? undefined}
              disabled={onNext === null}
              aria-label="Next game"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.12em] font-bold transition-colors ${
                onNext === null
                  ? "border-white/[0.05] bg-white/[0.02] text-gray-700 cursor-not-allowed"
                  : "border-violet-400/40 bg-violet-500/[0.10] text-violet-100 hover:bg-violet-500/[0.18]"
              }`}
            >
              Next
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        {/* Market tabs */}
        <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-1.5 overflow-x-auto">
          {marketKeysFor(game.sport).map((m) => (
            <MarketPill
              key={m}
              market={m}
              pick={game.markets[m].pick}
              confidence={game.markets[m].confidence}
              verdict={asVerdictKey(game.markets[m].verdict.key)}
              selected={selectedMarket === m}
              onClick={() => onMarketChange(m)}
            />
          ))}
        </div>
        {marketKeysFor(game.sport).some((m) => isContextOnlyMarket(m, game.sport)) && (
          <p className="px-4 py-1 text-[10px] text-gray-500 italic border-b border-white/[0.04] leading-tight">
            {CONTEXT_ONLY_FOOTNOTE}
          </p>
        )}
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {marketData === null ? (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading enriched market data…</p>
          ) : (
            <>
              <QuickRead game={game} market={selectedMarket} marketData={marketData} />
              <EdgeStack market={selectedMarket} marketData={marketData} />
              <ConfidenceVsMarketStrip market={selectedMarket} marketData={marketData} />
              <MarketPulse market={selectedMarket} marketData={marketData} />
              <MarketNotes
                marketData={marketData}
                awayAbbr={game.awayTeam}
                homeAbbr={game.homeTeam}
                market={selectedMarket}
              />
              {/* R-10 — game-level model breakdown, rendered once below
                  per-market sections. Returns null when the row has no
                  breakdown_v2.model_breakdown (e.g., pre-R-7 writes). */}
              <ModelTake game={game} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty / loading / error states ────────────────────────────────────

/**
 * Phase 7J — in-shell EmptyState. Previously this component was the
 * full-page output (replaced the SportRail header + nav), which made
 * clicking a sport with no games look like the page broke. Now the
 * caller wraps this inside the shell so SportRail stays mounted and
 * the user can still navigate between sports.
 */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-16 text-center">
      <p className="text-[14px] text-gray-400">{message}</p>
    </div>
  );
}

function LoadingState() {
  return <EmptyState message="Loading tonight's slate…" />;
}

/**
 * Phase 6B.4 — translate the API's slateState into a member-friendly
 * empty-state message. Honest about pending/draft slates so a quiet
 * morning before publication doesn't look like a broken product.
 *
 * Phase 7J — sport-aware: NBA "no_data" is the common case (most
 * calendar days have no NBA games), so the copy avoids implying
 * ingestion is in progress when the system simply has nothing to ingest.
 */
function emptyStateMessageFor(
  slateState: string | null | undefined,
  sport: Sport,
): string {
  switch (slateState) {
    case "today_draft_only":
      return "Tonight's slate is being finalized. Picks will appear here once the model run finishes.";
    case "today_pending_ingest":
      return "Tonight's slate is being ingested. Picks will appear here in a few minutes.";
    case "today_hidden_only":
      return "Tonight's slate isn't visible yet.";
    case "stale_fallback":
      return "Live slate isn't published yet. Showing the most recent available slate.";
    case "no_data":
      // Sport-specific copy. NBA's offseason / non-game days are common;
      // the honest line is "no games today", not "being ingested".
      if (sport === "nba") return "No NBA games scheduled today.";
      if (sport === "nhl") return "No NHL games scheduled today.";
      if (sport === "soccer") return "No World Cup matches scheduled today.";
      return "No games on tonight's slate.";
    default:
      if (sport === "nba") return "No NBA games scheduled today.";
      if (sport === "soccer") return "No World Cup matches scheduled today.";
      return "No games on tonight's slate.";
  }
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-16 text-center">
      <p className="text-[14px] text-amber-200">Something went wrong loading the slate.</p>
      <p className="text-[12px] text-gray-500 mt-2">{error}</p>
    </div>
  );
}

/**
 * Phase 7J — minimal shell chrome wrapper. Renders just the SportRail
 * (tabs) + dark page background so Loading / Error / Empty states keep
 * navigation visible. Used by the early-return paths in DailyEdgeShell.
 */
function ShellChrome({ sport, children }: { sport: Sport; children: ReactNode }) {
  return (
    <ShellSportContext.Provider value={sport}>
      <div className="bg-[#0A0A0F] text-gray-200 min-h-screen">
        <SportRail sport={sport} />
        {children}
      </div>
    </ShellSportContext.Provider>
  );
}

// ─── Slate Board header + verdict filter ───────────────────────────────

/**
 * Filter applied to the slate grid. "all" = unfiltered (default). Any
 * verdict key = show only games where AT LEAST ONE market (ML, Total,
 * or 1st) carries that verdict. Filtering NEVER changes:
 *   • the card headline (still picked by `headlineMarketFor`)
 *   • the per-market verdict strip
 *   • verdict logic / thresholds / model
 * It only changes which cards are visible.
 */
type SlateFilter = "all" | VerdictKey;

/**
 * Count of games that have AT LEAST ONE market matching each verdict.
 * Used for the filter chip counts so users see e.g. "Watchlist 8" — i.e.
 * eight games have a Watchlist on Total OR 1st OR ML even when the
 * headline (ML) is Lean. This surfaces non-headline opportunity.
 */
function computeVerdictCounts(games: DailyEdgeGameDto[]): Record<SlateFilter, number> {
  const counts: Record<SlateFilter, number> = {
    all: games.length,
    best_angle: 0,
    lean: 0,
    watchlist: 0,
    caution: 0,
    no_play: 0,
  };
  for (const g of games) {
    const seen = new Set<VerdictKey>();
    for (const mk of ["moneyline", "total", "first_inning"] as MarketKey[]) {
      seen.add(asVerdictKey(g.markets[mk].verdict.key));
    }
    for (const v of seen) counts[v]++;
  }
  return counts;
}

function gameMatchesFilter(game: DailyEdgeGameDto, filter: SlateFilter): boolean {
  if (filter === "all") return true;
  for (const mk of ["moneyline", "total", "first_inning"] as MarketKey[]) {
    if (asVerdictKey(game.markets[mk].verdict.key) === filter) return true;
  }
  return false;
}

const SLATE_FILTERS: Array<{ key: SlateFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "best_angle", label: "Best Angle" },
  { key: "lean", label: "Lean" },
  { key: "watchlist", label: "Watchlist" },
  { key: "caution", label: "Caution" },
];

function SlateBoardHeader({
  totalGames,
  counts,
  active,
  onFilterChange,
}: {
  totalGames: number;
  counts: Record<SlateFilter, number>;
  active: SlateFilter;
  onFilterChange: (f: SlateFilter) => void;
}) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-3 border-b border-white/[0.06]">
        {/* Eyebrow + total game count. Mirrors the SportRail label style
            so the section reads as an intentional surface break between
            the Selected Edge reader above and the browseable grid below. */}
        <div className="flex items-baseline gap-2">
          <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/65" />
          <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/85 whitespace-nowrap">
            Slate Board
          </h2>
          <span aria-hidden="true" className="text-gray-700 text-[11px]">·</span>
          <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
            {totalGames} {totalGames === 1 ? "game" : "games"}
          </span>
        </div>
        {/* Filter chips. Active uses violet (UI state, distinct from any
            verdict tone). Disabled when count = 0 so users can't enter
            an empty filter state. */}
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
          {SLATE_FILTERS.map((f) => {
            const count = counts[f.key];
            const isActive = active === f.key;
            const isDisabled = f.key !== "all" && count === 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => !isDisabled && onFilterChange(f.key)}
                disabled={isDisabled}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] uppercase tracking-[0.12em] font-bold whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-violet-500/[0.18] border-violet-400/55 text-white shadow-[0_0_0_1px_rgba(167,139,250,0.15)]"
                    : isDisabled
                    ? "bg-white/[0.015] border-white/[0.04] text-gray-700 cursor-not-allowed"
                    : "bg-white/[0.03] border-white/[0.08] text-gray-300 hover:bg-white/[0.07] hover:border-white/[0.16]"
                }`}
              >
                {f.label}
                <span
                  className={`tabular-nums ${
                    isActive
                      ? "text-violet-100/85"
                      : isDisabled
                      ? "text-gray-700"
                      : "text-gray-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Shell ──────────────────────────────────────────────────────────────

export default function DailyEdgeShell({ sport }: { sport: Sport }): ReactNode {
  const { data, error, isLoading } = useDailyEdge({ sport });

  // Reader state. Preselected to the first game (game-time-ASC from the
  // route) once data lands. Compact is the resting state.
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<MarketKey>("moneyline");
  const [readerMode, setReaderMode] = useState<"compact" | "full">("compact");
  // Mobile: tapping a card also opens the bottom sheet; on desktop the
  // top reader updates instead. Separate state so Esc behavior is sane.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // Slate Board filter. Filtering only changes which cards are visible
  // in the grid — never touches the reader, headlines, or model state.
  const [slateFilter, setSlateFilter] = useState<SlateFilter>("all");

  const games = data?.games ?? [];
  const verdictCounts = useMemo(() => computeVerdictCounts(games), [games]);
  const filteredGames = useMemo(
    () =>
      slateFilter === "all"
        ? games
        : games.filter((g) => gameMatchesFilter(g, slateFilter)),
    [games, slateFilter]
  );

  // If the slate's data shape changes and the active filter becomes
  // empty (e.g. fresh slate has 0 of the previously-selected verdict),
  // gracefully fall back to "all" so the user isn't stuck on an empty
  // grid with a disabled chip they can't see.
  useEffect(() => {
    if (slateFilter !== "all" && verdictCounts[slateFilter] === 0) {
      setSlateFilter("all");
    }
  }, [slateFilter, verdictCounts]);

  // Preselect the first game once data arrives, and whenever the slate
  // changes shape (different date). Never null after the first paint.
  useEffect(() => {
    if (games.length === 0) return;
    if (selectedGameId !== null && games.some((g) => g.id === selectedGameId)) return;
    const first = games[0]!;
    setSelectedGameId(first.id);
    setSelectedMarket(headlineMarketFor(first));
  }, [games, selectedGameId]);

  // Esc → collapse Full to Compact (if open) OR close mobile sheet.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (mobileSheetOpen) {
        setMobileSheetOpen(false);
        return;
      }
      if (readerMode === "full") {
        setReaderMode("compact");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [readerMode, mobileSheetOpen]);

  // Phase 7J — wrap Loading / Error / Empty states in ShellChrome so
  // SportRail (tabs) + page background stay mounted. Pre-7J, hitting an
  // empty NBA slate replaced the whole page including navigation; users
  // couldn't tab back to MLB without using the URL bar.
  //
  // Phase 7J.1 — stale-sport guard. useDailyEdge uses SWR's
  // keepPreviousData=true, so on sport switch `data` briefly holds the
  // PREVIOUS sport's response (e.g. NBA's empty no_data) before the new
  // fetch resolves. Without the guard we'd render the previous sport's
  // empty state under the new sport's tab, making it look like the
  // click failed (e.g. clicking MLB on the empty NBA page would keep
  // showing an empty state). When data.sport ≠ requested sport, treat
  // it as still loading.
  const dataMatchesSport = !data || data.sport === sport;
  if (isLoading || !dataMatchesSport) {
    return <ShellChrome sport={sport}><LoadingState /></ShellChrome>;
  }
  if (error) {
    return <ShellChrome sport={sport}><ErrorState error={error.message} /></ShellChrome>;
  }
  if (!data || games.length === 0) {
    // Phase 6B.4 — honest empty state by slateState. The API tells us
    // WHY there are no games (draft / hidden / pending / stale fallback
    // failed / no_data). Phase 7J adds sport-aware copy so NBA's
    // common "no games today" case doesn't imply ingestion is in
    // progress.
    const message = emptyStateMessageFor(data?.slateState, sport);
    return <ShellChrome sport={sport}><EmptyState message={message} /></ShellChrome>;
  }

  const selectedGame = selectedGameId
    ? games.find((g) => g.id === selectedGameId) ?? games[0]!
    : games[0]!;
  const selectedMarketData = pickMarket(selectedGame, selectedMarket);

  /**
   * Click a card body — select the game with its headline market. Reader
   * mode (compact/full) is intentionally preserved across game switches:
   * the mode is a "viewing preference" independent of which game is
   * selected. Esc / the Collapse button are the only paths back to
   * compact.
   */
  function handleSelectGame(g: DailyEdgeGameDto) {
    setSelectedGameId(g.id);
    setSelectedMarket(headlineMarketFor(g));
    // Mobile: also open the sheet so the user sees the read on the small screen.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
      setMobileSheetOpen(true);
    }
  }

  /** Click a market chip inside a card — select that game + that market. */
  function handleSelectMarket(g: DailyEdgeGameDto, m: MarketKey) {
    setSelectedGameId(g.id);
    setSelectedMarket(m);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
      setMobileSheetOpen(true);
    }
  }

  /**
   * Click a verdict filter chip — narrows the grid AND jumps the reader
   * to the first game in the filtered set, focused on the first market
   * on that game that matches the verdict. Makes filter + reader feel
   * connected instead of independent.
   *
   * "All" preserves the current game/market selection (no force-reset).
   * Disabled chips (count === 0) never get here because the button is
   * disabled at the SlateBoardHeader level.
   */
  function handleFilterChange(next: SlateFilter) {
    setSlateFilter(next);
    if (next === "all") return;
    const matching = games.filter((g) => gameMatchesFilter(g, next));
    if (matching.length === 0) return; // belt-and-suspenders; chip should be disabled
    const firstGame = matching[0]!;
    const firstMarket = (["moneyline", "total", "first_inning"] as MarketKey[]).find(
      (mk) => asVerdictKey(firstGame.markets[mk].verdict.key) === next
    );
    setSelectedGameId(firstGame.id);
    setSelectedMarket(firstMarket ?? headlineMarketFor(firstGame));
  }

  return (
    <ShellSportContext.Provider value={sport}>
    <div className="bg-[#0A0A0F] text-gray-200 min-h-screen">
      <SportRail sport={sport} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-1 flex items-center justify-between gap-3">
        <SlateControlStrip
          date={data.date}
          gameCount={games.length}
          updatedAt={data.as_of}
          fallbackUsed={data.fallback_used === true}
        />
        <div className="hidden sm:block">
          <HowThisWorks />
        </div>
      </div>

      {/* Selected Edge reader — top of page, NOT sticky. Scrolls out of
          view as the user browses the board below. Desktop/tablet only;
          mobile uses the bottom sheet instead. */}
      <div className="hidden sm:block max-w-7xl mx-auto px-4 sm:px-6 mt-3 mb-9">
        {selectedMarketData === null ? (
          <div className="bg-[#0D0D14] border border-violet-400/22 rounded-xl p-4 text-[13px] text-gray-400 text-center">
            Loading enriched market data…
          </div>
        ) : (
          <SelectedEdgeReader
            game={selectedGame}
            market={selectedMarket}
            marketData={selectedMarketData}
            mode={readerMode}
            onMarketChange={setSelectedMarket}
            onExpand={() => setReaderMode("full")}
            onCollapse={() => setReaderMode("compact")}
          />
        )}
      </div>

      {/* Slate Board header — quiet section break + filter chips. Filter
          click also jumps the reader to the first matching game/market
          via handleFilterChange so the two surfaces stay connected. */}
      <SlateBoardHeader
        totalGames={games.length}
        counts={verdictCounts}
        active={slateFilter}
        onFilterChange={handleFilterChange}
      />

      {/* Slate board — game-time ordered (route returns ASC). Always 3 cols
          on lg, 2 on sm/md, 1 on mobile. No grid collapse based on reader
          state — board geometry stays stable so the eye doesn't reflow on
          every click. Filter only changes the visible card set; nothing
          else about the rendering logic changes. */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-6">
        {filteredGames.length === 0 ? (
          <div className="text-center py-14 text-[13px] text-gray-500">
            No {slateFilter === "all" ? "games" : VERDICT_LABEL[slateFilter as VerdictKey]} on tonight&apos;s slate.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGames.map((g) => (
              <SlateCard
                key={g.id}
                game={g}
                active={g.id === selectedGameId}
                activeMarket={g.id === selectedGameId ? selectedMarket : null}
                onSelectGame={() => handleSelectGame(g)}
                onSelectMarket={(m) => handleSelectMarket(g, m)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Mobile bottom sheet — opens on card tap; closes via × / scrim / Esc.
          Prev/Next buttons walk the FILTERED games list (same as the
          visible grid behind the sheet) so navigation respects the
          active filter. When filter is "all", filteredGames === games so
          prev/next walks the whole slate as before. Selected market is
          preserved across game switches. */}
      {mobileSheetOpen && selectedMarketData !== null && (() => {
        const navList = filteredGames;
        const idx = navList.findIndex((g) => g.id === selectedGame.id);
        // Defensive: if the selected game isn't in the current nav list
        // (e.g. filter changed externally and the auto-jump didn't apply
        // to the sheet) just disable prev/next rather than walking to a
        // surprising game.
        const canPrev = idx > 0;
        const canNext = idx >= 0 && idx < navList.length - 1;
        return (
          <div className="sm:hidden">
            <MobileDetailSheet
              game={selectedGame}
              onClose={() => setMobileSheetOpen(false)}
              selectedMarket={selectedMarket}
              onMarketChange={setSelectedMarket}
              onPrev={canPrev ? () => setSelectedGameId(navList[idx - 1]!.id) : null}
              onNext={canNext ? () => setSelectedGameId(navList[idx + 1]!.id) : null}
              index={Math.max(1, idx + 1)}
              total={navList.length}
            />
          </div>
        );
      })()}

      <footer className="text-center pb-10">
        <p className="text-[11px] uppercase tracking-[0.16em] text-gray-600 font-medium">
          OddSphere · Daily Edge · {sport.toUpperCase()}
        </p>
      </footer>
    </div>
    </ShellSportContext.Provider>
  );
}

