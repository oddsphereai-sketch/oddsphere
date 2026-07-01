"use client";

/**
 * Phase 4.1.8.C — Static design sandbox prototype v11.4.
 *
 * OddSphere Edge Console.   Decision → Evidence → Details.
 *
 *   • v11.3 architecture preserved unchanged.
 *
 *   • v11.4 — compact multi-sport SportRail under PageHeader.
 *
 *   • v13.1 — Final polish on the v13 lock candidate:
 *       - "How to read the signals" → "How this works" (less technical).
 *       - Toggle "Full Read | Compact" → "Full View | Compact".
 *       - Toggle active segment bumped to bg-violet-500/[0.22] +
 *         text-white + inset violet ring — Compact mode is now
 *         unmistakable.
 *       - Compact-mode Expand button promoted to a violet pill
 *         matching the Legend trigger styling.
 *       - Selected EdgeCard treatment strengthened: violet ring +
 *         soft outer glow (`shadow-[0_0_0_1px...,0_0_24px-8px...]`).
 *         The connection between the selected card and the reader is
 *         now visually unmissable. Same treatment on mobile.
 *       - Selected MarketPill alpha bumped: bg-violet-500/[0.18],
 *         border-violet-400/55, inset violet ring.
 *
 *   • v13 — Locked reader + Full/Compact toggle. The locked-reader
 *     direction returns from v11.12 (reader pinned at top, board scrolls
 *     below in `lg:flex-1 lg:min-h-0 lg:overflow-y-auto`), but the user
 *     can now flip the reader to Compact mode via a segmented toggle
 *     in the identity strip. Compact mode collapses the reader to a
 *     single horizontal readout (~90-130px tall) so the Edge Board
 *     gets ~200-250px more room.
 *       - `readerMode: "full" | "compact"` state in DesignPreviewPage.
 *       - `ReaderModeToggle` component in the identity strip near the
 *         Legend trigger.
 *       - `CompactReaderBody` shows: matchup logos · pick + price +
 *         projected · guided action + one-line guide · Expand button.
 *       - Compact mode subsumes the verdict band (moves verdict +
 *         market + time inline in the identity strip).
 *       - Selected-market verdict fix preserved in both modes.
 *       - Mobile untouched (sticky summary architecture).
 *
 *   • v12 — Slate-first concept test (replaced by v13 toggle approach).
 *     Desktop layout flips to: SportRail → SlateControlStrip → Edge
 *     Board (contained ~50vh scroll preview) → Selected Edge Reader.
 *     Page scrolls naturally; no fixed-height app shell. Mobile keeps
 *     its summary-first sticky architecture — it was already working.
 *       - Board container `lg:max-h-[50vh] lg:overflow-y-auto` with
 *         "Selected read below ↓" violet pill in header.
 *       - Reader microcopy updated: "Full read for the game and
 *         market selected above."
 *       - Legend trigger upgraded to a violet pill so newer users
 *         actually notice "How to read the signals."
 *       - Legend popover step copy adjusted for slate-first flow.
 *     Selected-market verdict fix preserved.
 *
 *   • v11.12 — Locked-reader app console, taller slate. The natural-scroll
 *     experiment from v11.11 fell out — reader scrolled off-screen during
 *     board browsing. v11.12 restores the locked-reader app shell but
 *     reallocates height so the board gets real room:
 *       - Shell back to `lg:h-[calc(100vh-9rem)] lg:overflow-hidden
 *         lg:flex lg:flex-col lg:min-h-0`.
 *       - Board container uses `lg:flex-1 lg:min-h-0 lg:overflow-y-auto`
 *         (critical: `min-h-0` lets the flex child actually shrink to
 *         receive scrollable height, instead of overflowing).
 *       - Reader chrome bumped slightly (border 0.10, glow 0.22, inset
 *         top highlight) so the panel reads unmistakably as the reader.
 *       - Reader internals tightened further: pick 27px → 24px, ring
 *         56 → 48, Quick Read column py-3 → py-2.5 space-y-3 → space-y-2,
 *         body py-3 → py-2.5, identity strip py-2 → py-1.5, verdict band
 *         py-1.5 → py-1, Edge Stack row gaps 2 → 1.5, Right column 3 → 2.5.
 *       - Reader microcopy reduced to one line: "Click any game or
 *         market below to update this read." (no second sentence).
 *       - Sticky bottom fade restored on the scroll container.
 *
 *   • v11.11 (rolled back) — natural page scroll:
 *       - Outer shell no longer uses `lg:h-screen` / `flex-col` /
 *         `overflow-hidden`. The page scrolls naturally; Edge Board
 *         is no longer trapped in a tiny internal viewport.
 *       - 3-step pill row dropped in favor of a single clean
 *         microcopy line in the identity strip: "Click a game or
 *         market below to update this read. Quick Read is the
 *         takeaway; Supporting Evidence is the proof."
 *       - LegendPopover rewritten as practical "How to use this page"
 *         (6 numbered steps) + Signal meanings (5 entries including
 *         Watchlist).
 *       - Edge Board header simplified: removed "Scrollable slate ↓"
 *         pill + "Selected read stays above." microcopy. Just a clean
 *         "Browse the slate. Click any game or market to update the
 *         reader." subheader.
 *       - Sticky bottom fade removed (no internal scroll to indicate).
 *       - Slim scrollbar styling removed (natural document scroll).
 *
 *   • v11.10 polish:
 *       - Selected Edge Reader panel TIGHTENED (~80px shorter) so the
 *         Edge Board has real room below it. Padding shaved across
 *         identity strip, verdict band, body, Quick Read column, and
 *         right-column module gaps.
 *       - Prototype's own PageHeader dropped — LabAppNav (the lab
 *         shell) now carries the real OddSphere logo + Daily Edge
 *         active state via path aliasing.
 *       - Shell height changed from `lg:h-screen` to
 *         `lg:h-[calc(100vh-9rem)]` to account for LabAppNav (h-16)
 *         + main py-10 wrapping the prototype.
 *       - Identity strip header renamed "Selected Edge Reader" with a
 *         visible 3-step guide (Choose market → Read Quick Read →
 *         Check Evidence) rendered as inline step pills.
 *       - LegendPopover content moved to action-oriented "How this
 *         page works" + Signals reference.
 *       - Scrollbar styling on the board container + slightly stronger
 *         bottom fade.
 *
 *   • v11.9 polish:
 *       - Top reader becomes a contained "Selected Edge Panel" with
 *         its own surface, border, rounded corners, and subtle violet
 *         glow — visually separated from the scrollable Edge Board.
 *       - Workflow microcopy in the panel identity strip:
 *         "This panel updates when you click a game or market below.
 *          Quick Read is the takeaway. Supporting Evidence is the proof."
 *       - Legend rewritten as action-oriented "How this page works"
 *         plus the existing Signals reference.
 *       - "Scrollable slate ↓" pill added to Edge Board header so the
 *         scroll affordance is unmistakable.
 *       - Logo bumped to h-10 on desktop (40px wordmark) for clearer
 *         brand presence; mobile icon stays h-8.
 *
 *   • v11.8 fixes the selected-market verdict bug + identity polish:
 *       - When the user clicks a non-headline market pill (e.g. PHI
 *         Total on a Best Angle game where PHI ML is the angle), the
 *         top band, Quick Read state, PlayGrade, GuidedRead action,
 *         and "Selected" chip all switch to the SELECTED market's
 *         verdict — not the game-level headline. Hardcoded per-game
 *         marketVerdict matrix in the prototype; production would
 *         derive from per-market confidence + market support.
 *       - New "Selected Edge" identity strip above the verdict band,
 *         with microcopy ("Click any game or market below to update
 *         this read.") and the Legend trigger surfaced near the top.
 *       - Legend expanded to cover Page Sections (Quick Read /
 *         Supporting Evidence / Market Notes) AND Symbols. Trigger
 *         renamed "How to read the signals."
 *       - Desktop scroll cue strengthened: "Scroll this slate — the
 *         selected read stays above ↓" + existing bottom fade.
 *       - Logo bumped from h-7 to h-8 for cleaner header presence.
 *
 *   • v11.7 polish:
 *       - "Supporting Evidence" gets the same section-heading treatment
 *         as Quick Read (violet bar + glow, brighter label) — slightly
 *         quieter than Quick Read so the entry-point still leads.
 *       - Legend trigger renamed "How to read this" → "How to read
 *         the signals" — describes what the legend covers.
 *       - Desktop Edge Board: "Scroll slate ↓" hint in the header +
 *         subtle bottom fade pinned to the visible scroll edge.
 *       - Market pills bumped to `min-h-[34px]` for cleaner mobile
 *         tap targets without changing the desktop look.
 *
 *   • v11.6 clarity polish:
 *       - Quick Read header slightly brighter (violet-tinted label +
 *         small glow on the accent bar) so newer users notice the
 *         entry point without making it bigger.
 *       - Honest "Market data unavailable" framing where data is
 *         truly missing (DET @ TOR + MarketPulse module fallback +
 *         row tag). "Market support not confirmed" reserved for
 *         games where partial data exists but isn't strong enough.
 *       - Tiny collapsed "How to read this" legend in both Edge Board
 *         headers (desktop + mobile). 4 archetypes, no tutorial wall.
 *
 *   • v11.5 polish:
 *       - SportRail spans full width on lg+ (grid-cols-6 with chips
 *         stretching tab-style); mobile keeps horizontal scroll.
 *       - Left Decision column gets a "Quick Read" header so newer
 *         users know where to start.
 *       - PageHeader uses the real OddSphere logo lockup (matches
 *         production Navbar pattern: icon-logo.png on mobile,
 *         logo-transparent.png on sm+, inverted with violet glow).
 *       - User-facing prose drops "Pinnacle" — Edge Board decision
 *         lines and Market Notes use broader "market value / market
 *         support" language. Edge Stack keeps "Sharper price check"
 *         in the evidence column where the experienced bettor reads.
 *       - Edge Board signal chips cap at 3 (scan layer); full Edge
 *         Stack stays in the top Edge Console.
 *
 * NOT WIRED TO BACKEND. Hardcoded representative 5/22-style data.
 */

import { useState, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────

type VerdictKey = "best_angle" | "lean" | "watchlist" | "caution" | "no_play";
type SharpStatus = "confirm" | "mixed" | "caution";
type MarketKey = "ml" | "total" | "first_inning_total";
type Tone = "emerald" | "amber" | "gray" | "sky" | "violet";

type KeyStat = {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "gray" | "default";
};

type MarketData = {
  pick: string;
  confidence: number;
  priceAmerican: number | null;
  lineOpenAmerican: number | null;
  modelProb: number;
  marketFairProb: number | null;
  pinnacleEvPct: number | null;
  moneyPct: number | null;
  betsPct: number | null;
  sharp: SharpStatus;
  keyStats: KeyStat[];
  modelTotal?: number;
  marketTotal?: number;
  whyLine: string;
  riskLine: string;
  // v11.1 — beginner-facing copy (no jargon, see banned-terms list)
  guidedGuide: string;
  guidedWatchOut: string;
};

type Game = {
  away: string; home: string;
  awayName: string; homeName: string;
  awayProjected: number; homeProjected: number;
  gameTime: string;
  verdict: VerdictKey;
  headlinePick: string;
  headlineMarket: MarketKey;
  decisionLine: string;
  markets: {
    ml: MarketData;
    total: MarketData;
    first_inning_total: MarketData | null;
  };
  lineupConfirmed: boolean;
  linesLocked: boolean;
  sharpSignalPending: boolean;
  marketDataLimited: boolean;
};

// ─── Team colors (jersey-patch fallback) ────────────────────────────

const TEAM_COLORS: Record<string, string> = {
  NYY: "#0C2340", BOS: "#BD3039", TOR: "#134A8E", BAL: "#DF4601",
  TB: "#092C5C", DET: "#0C2340", NYM: "#002D72", PHI: "#E81828",
  HOU: "#002D62", SEA: "#0C2C56", WSH: "#AB0003", ATL: "#CE1141",
  CHC: "#0E3386", MIL: "#12284B", STL: "#C41E3A", KC: "#004687",
  LAD: "#005A9C", SF: "#FD5A1E", MIN: "#002B5C", CLE: "#00385D",
};

function espnLogoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`;
}

// ─── Hardcoded slate ────────────────────────────────────────────────

const GAMES: Game[] = [
  // 1. NYM @ PHI — best_angle (default selected); promoted ML
  {
    away: "NYM", home: "PHI", awayName: "Mets", homeName: "Phillies",
    awayProjected: 4.4, homeProjected: 4.6, gameTime: "7:05 PM",
    verdict: "best_angle", headlinePick: "PHI ML", headlineMarket: "ml",
    decisionLine: "Market support backs this pick. Price still playable.",
    markets: {
      ml: {
        pick: "PHI", confidence: 0.60, priceAmerican: 110, lineOpenAmerican: 118,
        modelProb: 0.60, marketFairProb: 0.54, pinnacleEvPct: 2.6,
        moneyPct: 68, betsPct: 42, sharp: "confirm",
        keyStats: [
          { label: "Model win prob", value: "60.0%" },
          { label: "Market implied prob", value: "54.0%" },
          { label: "Starter edge", value: "+0.35 xFIP", tone: "emerald" },
        ],
        whyLine: "Model edge and market value agree; money supports PHI.",
        riskLine: "Back off above +130.",
        guidedGuide: "The model likes PHI, the market isn't pushing back, and the price is still reasonable.",
        guidedWatchOut: "Don't chase if the odds drift higher.",
      },
      total: {
        pick: "Over 8.5", confidence: 0.55, priceAmerican: -110, lineOpenAmerican: -105,
        modelProb: 0.55, marketFairProb: 0.52, pinnacleEvPct: 0.8,
        moneyPct: 53, betsPct: 49, sharp: "mixed",
        modelTotal: 9.0, marketTotal: 8.5,
        keyStats: [
          { label: "Model total", value: "9.0" },
          { label: "Market total", value: "8.5" },
          { label: "Park · weather", value: "Neutral · Wind 4 in" },
        ],
        whyLine: "Both lineups stack; mild over edge.",
        riskLine: "Lighter sharp support than the ML.",
        guidedGuide: "The model leans Over here, but the edge is lighter than the moneyline.",
        guidedWatchOut: "Treat it as a smaller secondary play.",
      },
      first_inning_total: {
        pick: "YRFI", confidence: 0.54, priceAmerican: -120, lineOpenAmerican: -115,
        modelProb: 0.54, marketFairProb: 0.52, pinnacleEvPct: 0.3,
        moneyPct: 51, betsPct: 50, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.51 vs 0.52" },
          { label: "Starter FI ERA", value: "NYM 4.0 · PHI 3.6" },
        ],
        whyLine: "Top-order quality leans YRFI, but edge is thin.",
        riskLine: "Worse value than the ML.",
        guidedGuide: "Slight first-inning lean toward YRFI, but it's the weakest of the three reads.",
        guidedWatchOut: "Better value lives in the moneyline.",
      },
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 2. SEA @ HOU — best_angle; promoted ML; no FI prediction
  {
    away: "SEA", home: "HOU", awayName: "Mariners", homeName: "Astros",
    awayProjected: 4.1, homeProjected: 5.2, gameTime: "7:10 PM",
    verdict: "best_angle", headlinePick: "HOU ML", headlineMarket: "ml",
    decisionLine: "Market support backs HOU. Price still in the playable range.",
    markets: {
      ml: {
        pick: "HOU", confidence: 0.60, priceAmerican: -135, lineOpenAmerican: -125,
        modelProb: 0.60, marketFairProb: 0.56, pinnacleEvPct: 1.8,
        moneyPct: 64, betsPct: 48, sharp: "confirm",
        keyStats: [
          { label: "Model win prob", value: "60.0%" },
          { label: "Market implied prob", value: "56.0%" },
          { label: "Starter edge", value: "+0.42 xFIP", tone: "emerald" },
        ],
        whyLine: "Matchup edge + line moving with market support.",
        riskLine: "Avoid forcing the 1st-inning.",
        guidedGuide: "The model likes HOU and the market is moving the same way.",
        guidedWatchOut: "Avoid stretching this into related side bets.",
      },
      total: {
        pick: "Over 8.5", confidence: 0.55, priceAmerican: -110, lineOpenAmerican: -110,
        modelProb: 0.55, marketFairProb: 0.52, pinnacleEvPct: 0.6,
        moneyPct: 52, betsPct: 50, sharp: "mixed",
        modelTotal: 9.3, marketTotal: 8.5,
        keyStats: [
          { label: "Model total", value: "9.3" },
          { label: "Market total", value: "8.5" },
          { label: "Park · weather", value: "+0.2 · Wind 5 out" },
        ],
        whyLine: "HOU offense favored, over leans support.",
        riskLine: "Smaller edge than the ML.",
        guidedGuide: "The model leans Over, but the edge is smaller than the moneyline.",
        guidedWatchOut: "Treat it as a secondary thought.",
      },
      first_inning_total: null,
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 3. WSH @ ATL — best_angle; promoted Total; no FI
  {
    away: "WSH", home: "ATL", awayName: "Nationals", homeName: "Braves",
    awayProjected: 4.0, homeProjected: 5.0, gameTime: "7:20 PM",
    verdict: "best_angle", headlinePick: "OVER 9", headlineMarket: "total",
    decisionLine: "Market support backs the over. Cleaner than the moneyline.",
    markets: {
      ml: {
        pick: "ATL", confidence: 0.57, priceAmerican: -140, lineOpenAmerican: -135,
        modelProb: 0.57, marketFairProb: 0.56, pinnacleEvPct: 0.3,
        moneyPct: 50, betsPct: 51, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "57.0%" },
          { label: "Market implied prob", value: "56.0%" },
          { label: "Starter edge", value: "+0.10 xFIP" },
        ],
        whyLine: "ATL is favored but the edge is thin.",
        riskLine: "Total is the cleaner play.",
        guidedGuide: "ATL is favored, but the matchup is too close to feature as a top play.",
        guidedWatchOut: "The total has a cleaner read.",
      },
      total: {
        pick: "Over 9", confidence: 0.60, priceAmerican: -105, lineOpenAmerican: -100,
        modelProb: 0.60, marketFairProb: 0.52, pinnacleEvPct: 2.1,
        moneyPct: 62, betsPct: 47, sharp: "confirm",
        modelTotal: 9.6, marketTotal: 9.0,
        keyStats: [
          { label: "Model total", value: "9.6" },
          { label: "Market total", value: "9.0" },
          { label: "Park · weather", value: "Neutral · Wind 6 out" },
        ],
        whyLine: "Two contact-prone starters; line + money on the over.",
        riskLine: "Watch for late wind shift.",
        guidedGuide: "The model likes the Over, and the market is moving the same way.",
        guidedWatchOut: "Better than the moneyline here.",
      },
      first_inning_total: null,
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 4. LAD @ SF — lean; promoted Total
  {
    away: "LAD", home: "SF", awayName: "Dodgers", homeName: "Giants",
    awayProjected: 4.3, homeProjected: 3.8, gameTime: "9:45 PM",
    verdict: "lean", headlinePick: "UNDER 7.5", headlineMarket: "total",
    decisionLine: "The model has a lighter edge on the under. Price matters.",
    markets: {
      ml: {
        pick: "LAD", confidence: 0.55, priceAmerican: -125, lineOpenAmerican: -120,
        modelProb: 0.55, marketFairProb: 0.55, pinnacleEvPct: 0.0,
        moneyPct: 49, betsPct: 51, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "55.0%" },
          { label: "Market implied prob", value: "55.0%" },
          { label: "Starter edge", value: "+0.08 xFIP" },
        ],
        whyLine: "Closely matched ML; no clear edge.",
        riskLine: "Stick with the total.",
        guidedGuide: "The teams are closely matched on the moneyline tonight.",
        guidedWatchOut: "Stick with the total here.",
      },
      total: {
        pick: "Under 7.5", confidence: 0.58, priceAmerican: -110, lineOpenAmerican: -105,
        modelProb: 0.58, marketFairProb: 0.53, pinnacleEvPct: 1.2,
        moneyPct: 55, betsPct: 47, sharp: "confirm",
        modelTotal: 7.1, marketTotal: 7.5,
        keyStats: [
          { label: "Model total", value: "7.1" },
          { label: "Market total", value: "7.5" },
          { label: "Park · weather", value: "−0.3 · Wind 9 in" },
        ],
        whyLine: "Pitcher-friendly park + sharp starter pair.",
        riskLine: "Edge is modest.",
        guidedGuide: "The model leans Under, but the edge is lighter than the top plays.",
        guidedWatchOut: "Only consider it if the price stays fair.",
      },
      first_inning_total: {
        pick: "NRFI", confidence: 0.59, priceAmerican: -115, lineOpenAmerican: -110,
        modelProb: 0.59, marketFairProb: 0.55, pinnacleEvPct: 0.7,
        moneyPct: 54, betsPct: 51, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.36 vs 0.32" },
          { label: "Starter FI ERA", value: "LAD 2.5 · SF 2.4" },
        ],
        whyLine: "Both starters dominant in FI.",
        riskLine: "Limited recent sample for SF starter.",
        guidedGuide: "Both starters are dominant in the first inning; a NRFI lean is reasonable.",
        guidedWatchOut: "Edge is smaller than the total.",
      },
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 5. BAL @ TB — watchlist; promoted 1st (NRFI)
  {
    away: "BAL", home: "TB", awayName: "Orioles", homeName: "Rays",
    awayProjected: 4.4, homeProjected: 4.6, gameTime: "7:10 PM",
    verdict: "watchlist", headlinePick: "NRFI", headlineMarket: "first_inning_total",
    decisionLine: "The model sees a lean, but market support is not confirmed yet.",
    markets: {
      ml: {
        pick: "TB", confidence: 0.56, priceAmerican: -130, lineOpenAmerican: -135,
        modelProb: 0.56, marketFairProb: 0.55, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "56.0%" },
          { label: "Market implied prob", value: "55.0%" },
        ],
        whyLine: "TB ML edge is small.",
        riskLine: "Sharp confirmation is missing.",
        guidedGuide: "The model gives TB a small moneyline edge, but the market is unclear.",
        guidedWatchOut: "Not a featured angle tonight.",
      },
      total: {
        pick: "Under 8", confidence: 0.55, priceAmerican: -105, lineOpenAmerican: -110,
        modelProb: 0.55, marketFairProb: 0.52, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        modelTotal: 7.6, marketTotal: 8.0,
        keyStats: [
          { label: "Model total", value: "7.6" },
          { label: "Market total", value: "8.0" },
        ],
        whyLine: "Modest under edge; market unsure.",
        riskLine: "No sharp anchor.",
        guidedGuide: "A light under lean; the market isn't supporting it strongly.",
        guidedWatchOut: "Better candidates exist on the slate.",
      },
      first_inning_total: {
        pick: "NRFI", confidence: 0.58, priceAmerican: -115, lineOpenAmerican: -110,
        modelProb: 0.58, marketFairProb: 0.55, pinnacleEvPct: null,
        moneyPct: 51, betsPct: 49, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.42 vs 0.43" },
          { label: "Starter FI ERA", value: "BAL 2.9 · TB 3.5" },
        ],
        whyLine: "Light NRFI lean from starter quality.",
        riskLine: "No clean sharp push behind this.",
        guidedGuide: "The model sees a quiet NRFI lean, but the betting market hasn't confirmed it.",
        guidedWatchOut: "Wait for a cleaner signal before forcing it.",
      },
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 6. DET @ TOR — watchlist; market data limited
  {
    away: "DET", home: "TOR", awayName: "Tigers", homeName: "Blue Jays",
    awayProjected: 4.1, homeProjected: 4.2, gameTime: "7:07 PM",
    verdict: "watchlist", headlinePick: "DET ML", headlineMarket: "ml",
    decisionLine: "Market data unavailable here. Model-side lean only.",
    markets: {
      ml: {
        pick: "DET", confidence: 0.57, priceAmerican: 105, lineOpenAmerican: null,
        modelProb: 0.57, marketFairProb: null, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "57.0%" },
          { label: "Market implied prob", value: "48.8%" },
        ],
        whyLine: "Model gives DET a small edge, but sharp data is too thin to confirm.",
        riskLine: "If the market doesn't move into close, this stays a pass.",
        guidedGuide: "The model gives DET a small edge, but there isn't enough market data to confirm it.",
        guidedWatchOut: "Treat this as a model-only read for now.",
      },
      total: {
        pick: "Under 8", confidence: 0.56, priceAmerican: -110, lineOpenAmerican: null,
        modelProb: 0.56, marketFairProb: null, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        modelTotal: 7.4, marketTotal: 8.0,
        keyStats: [
          { label: "Model total", value: "7.4" },
          { label: "Market total", value: "8.0" },
        ],
        whyLine: "Slight under lean from starter pair.",
        riskLine: "Market data unavailable.",
        guidedGuide: "A slight under lean from the starter pair.",
        guidedWatchOut: "Market data unavailable — not a featured play.",
      },
      first_inning_total: null,
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: true,
  },
  // 7. BOS @ NYY — watchlist; lineup pending; near-zero edge
  {
    away: "BOS", home: "NYY", awayName: "Red Sox", homeName: "Yankees",
    awayProjected: 4.5, homeProjected: 5.0, gameTime: "7:05 PM",
    verdict: "watchlist", headlinePick: "NYY ML", headlineMarket: "ml",
    decisionLine: "The model likes NYY, but market support is not confirmed yet.",
    markets: {
      ml: {
        pick: "NYY", confidence: 0.60, priceAmerican: -145, lineOpenAmerican: -140,
        modelProb: 0.60, marketFairProb: 0.59, pinnacleEvPct: 0.4,
        moneyPct: 54, betsPct: 51, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "60.0%" },
          { label: "Market implied prob", value: "59.0%" },
          { label: "Starter edge", value: "+0.18 xFIP" },
        ],
        whyLine: "Model likes NYY but market value already agrees nearly fully.",
        riskLine: "Edge is near-zero — wait for clearer market support.",
        guidedGuide: "The model likes NYY, but the market price is already in line with the model.",
        guidedWatchOut: "There's very little edge left to chase.",
      },
      total: {
        pick: "Over 8.5", confidence: 0.55, priceAmerican: -115, lineOpenAmerican: -110,
        modelProb: 0.55, marketFairProb: 0.53, pinnacleEvPct: null,
        moneyPct: 50, betsPct: 52, sharp: "mixed",
        modelTotal: 9.5, marketTotal: 8.5,
        keyStats: [
          { label: "Model total", value: "9.5" },
          { label: "Market total", value: "8.5" },
          { label: "Park · weather", value: "Neutral · Wind 4 out" },
        ],
        whyLine: "Light over lean.",
        riskLine: "Sharp not confirming.",
        guidedGuide: "A light over lean; the market hasn't moved either way.",
        guidedWatchOut: "Not enough confirmation for a top play.",
      },
      first_inning_total: {
        pick: "NRFI", confidence: 0.58, priceAmerican: -115, lineOpenAmerican: -110,
        modelProb: 0.58, marketFairProb: 0.55, pinnacleEvPct: null,
        moneyPct: 52, betsPct: 50, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.49 vs 0.51" },
          { label: "Starter FI ERA", value: "BOS 3.5 · NYY 3.1" },
        ],
        whyLine: "Mild NRFI tilt.",
        riskLine: "Limited support.",
        guidedGuide: "A mild NRFI tilt from the starter matchups.",
        guidedWatchOut: "Edge is small.",
      },
    },
    lineupConfirmed: false, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 8. MIN @ CLE — watchlist; sharp signal pending
  {
    away: "MIN", home: "CLE", awayName: "Twins", homeName: "Guardians",
    awayProjected: 4.0, homeProjected: 4.1, gameTime: "7:10 PM",
    verdict: "watchlist", headlinePick: "UNDER 8", headlineMarket: "total",
    decisionLine: "The model has a small under edge. Market read still pending.",
    markets: {
      ml: {
        pick: "CLE", confidence: 0.55, priceAmerican: -110, lineOpenAmerican: null,
        modelProb: 0.55, marketFairProb: 0.54, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "55.0%" },
          { label: "Market implied prob", value: "52.0%" },
        ],
        whyLine: "Slight CLE lean.",
        riskLine: "Lines not yet locked.",
        guidedGuide: "A slight CLE edge; lines aren't fully open yet.",
        guidedWatchOut: "Hold for the lock before deciding.",
      },
      total: {
        pick: "Under 8", confidence: 0.56, priceAmerican: -110, lineOpenAmerican: null,
        modelProb: 0.56, marketFairProb: 0.52, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        modelTotal: 7.6, marketTotal: 8.0,
        keyStats: [
          { label: "Model total", value: "7.6" },
          { label: "Market total", value: "8.0" },
        ],
        whyLine: "Small under edge from starter pair.",
        riskLine: "Sharp signal pending — refresh in next cycle.",
        guidedGuide: "The model leans Under, but tonight's market read isn't finalized.",
        guidedWatchOut: "Wait for the next refresh.",
      },
      first_inning_total: null,
    },
    lineupConfirmed: true, linesLocked: false, sharpSignalPending: true, marketDataLimited: false,
  },
  // 9. CHC @ MIL — caution; promoted Total with conflict signature
  {
    away: "CHC", home: "MIL", awayName: "Cubs", homeName: "Brewers",
    awayProjected: 4.6, homeProjected: 4.0, gameTime: "7:40 PM",
    verdict: "caution", headlinePick: "OVER 8", headlineMarket: "total",
    decisionLine: "The model likes the over, but the market is pushing back.",
    markets: {
      ml: {
        pick: "CHC", confidence: 0.56, priceAmerican: 105, lineOpenAmerican: 110,
        modelProb: 0.56, marketFairProb: 0.55, pinnacleEvPct: 0.2,
        moneyPct: 48, betsPct: 52, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "56.0%" },
          { label: "Market implied prob", value: "49.0%" },
          { label: "Starter edge", value: "+0.15 xFIP" },
        ],
        whyLine: "Mild CHC lean.",
        riskLine: "Total is the conflict market here.",
        guidedGuide: "Mild CHC moneyline lean, but the total is where the conflict shows up.",
        guidedWatchOut: "The model and market disagree on the total.",
      },
      total: {
        pick: "Over 8", confidence: 0.55, priceAmerican: -105, lineOpenAmerican: -120,
        modelProb: 0.55, marketFairProb: 0.53, pinnacleEvPct: -1.8,
        moneyPct: 47, betsPct: 53, sharp: "caution",
        modelTotal: 8.6, marketTotal: 8.0,
        keyStats: [
          { label: "Model total", value: "8.6" },
          { label: "Market total", value: "8.0" },
          { label: "Park · weather", value: "+0.2 · Wind 12 out" },
        ],
        whyLine: "Model finds an over edge from offensive matchups.",
        riskLine: "Market value and line movement push against — sit out.",
        guidedGuide: "The model likes the Over, but the betting market is pushing the other way.",
        guidedWatchOut: "This is not a clean angle yet.",
      },
      first_inning_total: {
        pick: "YRFI", confidence: 0.54, priceAmerican: -115, lineOpenAmerican: -110,
        modelProb: 0.54, marketFairProb: 0.52, pinnacleEvPct: -0.2,
        moneyPct: 49, betsPct: 50, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.55 vs 0.46" },
          { label: "Starter FI ERA", value: "CHC 4.0 · MIL 3.8" },
        ],
        whyLine: "Slight YRFI tilt from CHC offense.",
        riskLine: "Total caution colors the whole game.",
        guidedGuide: "Slight first-inning tilt, but the total caution colors the whole game.",
        guidedWatchOut: "Better to sit this game out.",
      },
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
  // 10. STL @ KC — model_only; minimal data
  {
    away: "STL", home: "KC", awayName: "Cardinals", homeName: "Royals",
    awayProjected: 3.9, homeProjected: 4.1, gameTime: "8:10 PM",
    verdict: "no_play", headlinePick: "NRFI", headlineMarket: "first_inning_total",
    decisionLine: "Model read only. Use as context, not a top play.",
    markets: {
      ml: {
        pick: "KC", confidence: 0.53, priceAmerican: null, lineOpenAmerican: null,
        modelProb: 0.53, marketFairProb: 0.52, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        keyStats: [
          { label: "Model win prob", value: "53.0%" },
          { label: "Market implied prob", value: "52.0%" },
        ],
        whyLine: "Faint KC lean.",
        riskLine: "No value to promote.",
        guidedGuide: "A faint KC moneyline lean.",
        guidedWatchOut: "Not promoted tonight.",
      },
      total: {
        pick: "Under 7", confidence: 0.54, priceAmerican: null, lineOpenAmerican: null,
        modelProb: 0.54, marketFairProb: 0.52, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        modelTotal: 6.7, marketTotal: 7.0,
        keyStats: [
          { label: "Model total", value: "6.7" },
          { label: "Market total", value: "7.0" },
        ],
        whyLine: "Light under tilt.",
        riskLine: "Not priced for promotion.",
        guidedGuide: "A light under tilt; nothing strong to feature.",
        guidedWatchOut: "Use as informational only.",
      },
      first_inning_total: {
        pick: "NRFI", confidence: 0.56, priceAmerican: null, lineOpenAmerican: null,
        modelProb: 0.56, marketFairProb: 0.53, pinnacleEvPct: null,
        moneyPct: null, betsPct: null, sharp: "mixed",
        keyStats: [
          { label: "Projected FI runs", value: "0.42 vs 0.49" },
          { label: "Starter FI ERA", value: "STL 3.4 · KC 3.6" },
        ],
        whyLine: "Mild NRFI lean from starter quality.",
        riskLine: "Not promoted: no sharp push, no value to feature tonight.",
        guidedGuide: "The model has a slight NRFI lean, but there isn't enough support to feature it.",
        guidedWatchOut: "Use this as context, not as a top play.",
      },
    },
    lineupConfirmed: true, linesLocked: true, sharpSignalPending: false, marketDataLimited: false,
  },
];

// ─── Pure helpers ───────────────────────────────────────────────────

function isPlayablePrice(market: MarketKey, priceAmerican: number | null): boolean {
  if (priceAmerican === null) return false;
  if (market === "ml") return priceAmerican >= -200 && priceAmerican <= 200;
  if (market === "total") return priceAmerican >= -130 && priceAmerican <= 115;
  return priceAmerican >= -150 && priceAmerican <= 120;
}

function formatAmericanPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

function americanToImpliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

type MoveDirection = "toward" | "against" | "stable";
function moveDirection(open: number, current: number): MoveDirection {
  const openProb = americanToImpliedProb(open);
  const currentProb = americanToImpliedProb(current);
  const delta = currentProb - openProb;
  if (Math.abs(delta) < 0.01) return "stable";
  return delta > 0 ? "toward" : "against";
}

function isPromoted(v: VerdictKey): boolean {
  return v === "best_angle" || v === "lean";
}

function countByVerdict(games: Game[], v: VerdictKey | "playable"): number {
  if (v === "playable") return games.filter((g) => isPromoted(g.verdict)).length;
  return games.filter((g) => g.verdict === v).length;
}

function guardrailStats(games: Game[]): { playable: number; total: number; ok: boolean } {
  const promoted = games.filter((g) => isPromoted(g.verdict));
  const total = promoted.length;
  const playable = promoted.filter((g) => {
    const md = g.markets[g.headlineMarket];
    if (!md) return false;
    return isPlayablePrice(g.headlineMarket, md.priceAmerican);
  }).length;
  return { playable, total, ok: total === 0 ? true : playable === total };
}

function marketLabel(m: MarketKey): string {
  if (m === "ml") return "ML";
  if (m === "total") return "Total";
  return "1st";
}

function marketLongLabel(m: MarketKey): string {
  if (m === "ml") return "Moneyline";
  if (m === "total") return "Total";
  return "1st Inning";
}

function pickSideLabel(market: MarketKey, pick: string): string {
  if (market === "ml") return pick;
  if (market === "total") return pick.split(/\s+/)[0];
  return pick;
}

function getMarketData(game: Game, market: MarketKey): MarketData | null {
  if (market === "first_inning_total") return game.markets.first_inning_total;
  return game.markets[market];
}

function isCautionedMarket(game: Game, market: MarketKey): boolean {
  return game.verdict === "caution" && game.headlineMarket === market;
}

// v11.8 — Per-market verdicts. The product model is Game → Market → Edge,
// so when the user clicks a non-headline pill on a game, the Console must
// reflect that market's actual edge profile (not the game-level verdict).
// Hardcoded for the prototype; production should derive from per-market
// confidence + market support + caution conditions.
const MARKET_VERDICT: Record<string, Partial<Record<MarketKey, VerdictKey>>> = {
  "NYM-PHI":  { ml: "best_angle", total: "watchlist",  first_inning_total: "no_play"   },
  "SEA-HOU":  { ml: "best_angle", total: "watchlist"                                   },
  "WSH-ATL":  { ml: "watchlist",  total: "best_angle"                                  },
  "LAD-SF":   { ml: "no_play",    total: "lean",       first_inning_total: "watchlist" },
  "BAL-TB":   { ml: "no_play",    total: "no_play",    first_inning_total: "watchlist" },
  "DET-TOR":  { ml: "watchlist",  total: "no_play"                                     },
  "BOS-NYY":  { ml: "watchlist",  total: "no_play",    first_inning_total: "no_play"   },
  "MIN-CLE":  { ml: "no_play",    total: "watchlist"                                   },
  "CHC-MIL":  { ml: "watchlist",  total: "caution",    first_inning_total: "no_play"   },
  "STL-KC":   { ml: "no_play",    total: "no_play",    first_inning_total: "no_play"   },
};

function marketVerdictFor(game: Game, market: MarketKey): VerdictKey {
  const entry = MARKET_VERDICT[`${game.away}-${game.home}`];
  return entry?.[market] ?? game.verdict;
}

// v11.1 — Guided Read action labels (derived from verdict)
type GuidedAction = { label: string; tone: Tone; glyph: string };
function guidedAction(verdict: VerdictKey): GuidedAction {
  switch (verdict) {
    case "best_angle": return { label: "Worth considering", tone: "emerald", glyph: "●" };
    case "lean":       return { label: "Small edge",        tone: "sky",     glyph: "↗" };
    case "watchlist":  return { label: "Monitor",           tone: "gray",    glyph: "·" };
    case "caution":    return { label: "Be careful",        tone: "amber",   glyph: "⚠" };
    case "no_play":    return { label: "Informational",     tone: "gray",    glyph: "○" };
  }
}

// ─── Visual constants ───────────────────────────────────────────────

const VERDICT_LABEL: Record<VerdictKey, string> = {
  best_angle: "Best Angle", lean: "Lean", watchlist: "Watchlist", caution: "Caution", no_play: "Model Only",
};
const VERDICT_GLYPH: Record<VerdictKey, string> = {
  best_angle: "★", lean: "↗", watchlist: "·", caution: "⚠", no_play: "○",
};
const VERDICT_TEXT_COLOR: Record<VerdictKey, string> = {
  best_angle: "text-emerald-300",
  lean: "text-sky-300",
  watchlist: "text-gray-400",
  caution: "text-amber-300",
  no_play: "text-gray-400",
};
const SHARP_GLYPH: Record<SharpStatus, string> = { confirm: "✓", mixed: "○", caution: "⚠" };
const SHARP_COLOR: Record<SharpStatus, string> = {
  confirm: "text-emerald-400", mixed: "text-gray-500", caution: "text-amber-400",
};

// ─── TeamBadge + TeamIdentity ───────────────────────────────────────

function TeamBadge({ abbr, size }: { abbr: string; size: number }) {
  const color = TEAM_COLORS[abbr] ?? "#4B5563";
  const fontPx =
    size <= 20 ? 8 :
    size <= 24 ? 9 :
    size <= 32 ? 11 :
    size <= 40 ? 13 :
    size <= 56 ? 16 : 20;
  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0 rounded-md overflow-hidden"
      style={{
        width: size, height: size,
        backgroundColor: color,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.40)",
      }}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[55%] pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.12), transparent)" }} />
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[45%] pointer-events-none"
        style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.30))" }} />
      <span
        className="relative font-black tracking-tight text-white leading-none uppercase"
        style={{ fontSize: fontPx, letterSpacing: "-0.04em", textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
      >
        {abbr}
      </span>
    </div>
  );
}

function TeamIdentity({
  abbr, logoUrl, size,
}: { abbr: string; logoUrl?: string | null; size: number }) {
  const url = logoUrl === undefined ? espnLogoUrl(abbr) : logoUrl;
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <TeamBadge abbr={abbr} size={size} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={abbr}
      width={size}
      height={size}
      loading="lazy"
      className="object-contain shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

// ─── ConfidenceRing + PlayGradeMeter ────────────────────────────────

function ConfidenceRing({
  value, size = 56, strokeWidth = 4,
}: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="#34D399" strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-black tabular-nums text-white leading-none" style={{ letterSpacing: "-0.04em" }}>
          {Math.round(value)}
        </span>
        <span className="text-[7.5px] uppercase tracking-[0.16em] text-gray-500 font-bold mt-0.5">Model</span>
      </div>
    </div>
  );
}

function PlayGradeMeter({ verdict }: { verdict: VerdictKey }) {
  const POSITION: Record<VerdictKey, number> = {
    no_play: 0.075, watchlist: 0.30, lean: 0.60, caution: 0.45, best_angle: 0.92,
  };
  const MARKER_COLOR: Record<VerdictKey, string> = {
    no_play: "#6B7280", watchlist: "#9CA3AF", lean: "#7DD3FC",
    caution: "#FBBF24", best_angle: "#34D399",
  };
  const positionFrac = POSITION[verdict];
  const markerColor = MARKER_COLOR[verdict];
  const markerSize = 10;
  return (
    <div className="w-full">
      <div className="relative" style={{ paddingTop: markerSize / 2 + 4, paddingBottom: markerSize / 2 + 4 }}>
        <div
          className="relative w-full rounded-full"
          style={{
            height: 2,
            background: "linear-gradient(to right, #374151 0%, #4B5563 25%, #6B7280 50%, #38BDF8 75%, #10B981 100%)",
            boxShadow: "inset 0 1px 0 rgba(0,0,0,0.40)",
          }}
        >
          {[0.25, 0.5, 0.75].map((frac) => (
            <span key={frac} aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 w-px bg-gray-700"
              style={{ left: `${frac * 100}%`, height: 6 }} />
          ))}
          <span
            aria-hidden="true"
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${positionFrac * 100}%`,
              width: markerSize, height: markerSize,
              backgroundColor: markerColor,
              boxShadow: `0 0 0 2px rgba(15,15,15,0.7), 0 0 ${markerSize * 1.4}px ${markerColor}, 0 0 ${markerSize * 0.6}px ${markerColor}`,
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[8.5px] font-semibold tracking-tight mt-1.5">
        {(["no_play", "watchlist", "lean", "best_angle"] as VerdictKey[]).map((k) => {
          const isActive = verdict === k || (verdict === "caution" && k === "watchlist");
          const color = isActive ? VERDICT_TEXT_COLOR[verdict] : "text-gray-600";
          return <span key={k} className={`${color} uppercase`}>{VERDICT_LABEL[k]}</span>;
        })}
      </div>
    </div>
  );
}

// ─── GuidedRead (v11.2: "What this means" interpretation card) ──────

const ACTION_TONE_CLASS: Record<Tone, string> = {
  emerald: "text-emerald-300",
  sky: "text-sky-300",
  amber: "text-amber-300",
  gray: "text-gray-300",
  violet: "text-violet-300",
};

// Verdict-tinted card chrome — soft bg + 3px left edge, no heavy box.
const GUIDED_TINT: Record<VerdictKey, string> = {
  best_angle: "bg-emerald-500/[0.05] border-l-emerald-500/50",
  lean: "bg-sky-500/[0.05] border-l-sky-500/50",
  watchlist: "bg-white/[0.03] border-l-gray-500/40",
  caution: "bg-amber-500/[0.06] border-l-amber-500/55",
  no_play: "bg-white/[0.025] border-l-gray-600/40",
};

type GuidedReadMode = "full" | "sticky" | "watchOutOnly";

function GuidedRead({
  game, marketData, market, mode,
}: { game: Game; marketData: MarketData; market: MarketKey; mode: GuidedReadMode }) {
  // v11.8 — verdict matches the SELECTED market, not the game-level headline.
  const verdict = marketVerdictFor(game, market);
  const action = guidedAction(verdict);
  const actionColor = ACTION_TONE_CLASS[action.tone];
  const tint = GUIDED_TINT[verdict];

  if (mode === "watchOutOnly") {
    return (
      <div className={`${tint} border-l-[3px] rounded-lg px-3.5 py-2`}>
        <p className="text-[9.5px] uppercase tracking-[0.18em] font-bold text-gray-500 mb-1.5">
          What to watch
        </p>
        <p className="text-[12.5px] leading-snug text-amber-100/90">
          <span aria-hidden="true" className="text-amber-400/80 mr-1.5">⚠</span>
          {marketData.guidedWatchOut}
        </p>
      </div>
    );
  }

  // full (desktop console) or sticky (mobile summary)
  return (
    <div className={`${tint} border-l-[3px] rounded-lg px-3.5 py-2 space-y-1.5`}>
      <p className="text-[9.5px] uppercase tracking-[0.18em] font-bold text-gray-500">
        What this means
      </p>
      <div className={`inline-flex items-center gap-1.5 ${actionColor}`}>
        <span aria-hidden="true" className="text-[14px] leading-none">{action.glyph}</span>
        <span className="text-[13.5px] font-bold tracking-tight" style={{ letterSpacing: "-0.01em" }}>
          {action.label}
        </span>
      </div>
      <p className="text-[12.5px] leading-snug text-gray-100">
        {marketData.guidedGuide}
      </p>
      {mode === "full" && (
        <div className="pt-1.5 mt-1.5 border-t border-white/[0.05]">
          <p className="text-[11.5px] leading-snug text-amber-100/80">
            <span aria-hidden="true" className="text-amber-400/70 mr-1.5">⚠</span>
            {marketData.guidedWatchOut}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── SportRail (v11.4: multi-sport navigation) ──────────────────────

// Navigation chips only — sport names, no roadmap labels. The selected
// chip uses violet styling to signal "currently loaded." Disabled chips
// in the static prototype are routes that aren't wired yet; any
// "coming soon" framing belongs on the destination page, not the rail.
type Sport = {
  abbr: "MLB" | "NBA" | "NFL" | "CBB" | "CFB" | "NHL";
  icon: string;
};

const SPORTS: Sport[] = [
  { abbr: "MLB", icon: "⚾" },
  { abbr: "NBA", icon: "🏀" },
  { abbr: "NHL", icon: "🏒" },
  { abbr: "NFL", icon: "🏈" },
  { abbr: "CBB", icon: "🏀" },
  { abbr: "CFB", icon: "🏈" },
];

const SELECTED_SPORT: Sport["abbr"] = "MLB";

function SportRail() {
  return (
    <section className="border-b border-white/[0.06] bg-[#0C0C12] shrink-0">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-1.5 overflow-x-auto lg:grid lg:grid-cols-6 lg:gap-2 lg:overflow-visible">
        {SPORTS.map((sport) => (
          <SportChip
            key={sport.abbr}
            sport={sport}
            selected={sport.abbr === SELECTED_SPORT}
          />
        ))}
      </div>
    </section>
  );
}

function SportChip({ sport, selected }: { sport: Sport; selected: boolean }) {
  // Below lg: inline-flex with intrinsic width (horizontal scroll row).
  // lg+: stretch to fill grid cell so the rail reads as full-width nav.
  if (selected) {
    return (
      <button
        type="button"
        aria-pressed="true"
        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-md border border-violet-400/35 border-l-[2px] border-l-violet-400 bg-violet-500/[0.10] text-violet-100 whitespace-nowrap shrink-0 lg:flex lg:w-full"
      >
        <span aria-hidden="true" className="text-[13px] leading-none">{sport.icon}</span>
        <span className="text-[11.5px] font-bold tracking-tight">{sport.abbr}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-md border border-white/[0.06] bg-white/[0.025] text-gray-500 whitespace-nowrap shrink-0 cursor-not-allowed opacity-85 lg:flex lg:w-full"
    >
      <span aria-hidden="true" className="text-[13px] leading-none">{sport.icon}</span>
      <span className="text-[11.5px] font-bold tracking-tight">{sport.abbr}</span>
    </button>
  );
}

// ─── SlateControlStrip ──────────────────────────────────────────────

function SlateControlStrip({ games }: { games: Game[] }) {
  const playable = countByVerdict(games, "playable");
  const watchlist = countByVerdict(games, "watchlist");
  const caution = countByVerdict(games, "caution");
  const modelOnly = countByVerdict(games, "no_play");
  const linesLocked = games.filter((g) => g.linesLocked).length;
  const totalGames = games.length;
  const guard = guardrailStats(games);

  return (
    <section className="border-b border-white/[0.06] bg-[#0E0E14] shrink-0">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 py-3 flex items-center justify-between gap-x-6 gap-y-3 flex-wrap">
        <div className="flex items-center gap-2.5 text-[12px] text-gray-400 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.18em] text-violet-300/90 font-bold">
            Tonight&rsquo;s MLB Edge
          </span>
          <span className="text-gray-700">·</span>
          <span className="tabular-nums">Wed · May 22</span>
          <span className="text-gray-700">·</span>
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <span aria-hidden="true" className="w-1 h-1 rounded-full bg-emerald-400/80" />
            <span className="tabular-nums">Updated 4 min ago</span>
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CountChip label="Playable" value={playable} tone="emerald" />
          <CountChip label="Watchlist" value={watchlist} tone="gray" />
          <CountChip label="Caution" value={caution} tone="amber" />
          <CountChip label="Model Only" value={modelOnly} tone="gray-soft" />
        </div>

        <div className="flex items-center gap-3 text-[11.5px] text-gray-500 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 font-medium ${guard.ok ? "text-emerald-300/90" : "text-amber-300/90"}`}>
            <span aria-hidden="true">{guard.ok ? "✓" : "⚠"}</span>
            <span className="tabular-nums">Guardrail {guard.playable}/{guard.total}</span>
          </span>
          <span className="text-gray-700">·</span>
          <span className="tabular-nums">Lines {linesLocked}/{totalGames}</span>
          <span className="text-gray-700">·</span>
          <span>Sharp signals fresh</span>
        </div>
      </div>
    </section>
  );
}

function CountChip({
  label, value, tone,
}: { label: string; value: number; tone: "emerald" | "gray" | "amber" | "gray-soft" }) {
  const styles = {
    emerald: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
    gray: "bg-white/[0.04] text-gray-200 border-white/[0.08]",
    amber: "bg-amber-500/10 text-amber-200 border-amber-500/25",
    "gray-soft": "bg-white/[0.03] text-gray-400 border-white/[0.06]",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${styles}`}>
      <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold opacity-80">{label}</span>
      <span className="text-[12.5px] font-black tabular-nums leading-none" style={{ letterSpacing: "-0.03em" }}>
        {value}
      </span>
    </span>
  );
}

// ─── Edge Console (desktop top, 3-column) ───────────────────────────

const BAND_TINT: Record<VerdictKey, string> = {
  best_angle: "from-emerald-500/[0.14] via-emerald-500/[0.04] to-transparent border-emerald-500/25",
  lean: "from-sky-500/[0.10] via-sky-500/[0.03] to-transparent border-sky-500/20",
  watchlist: "from-gray-700/30 via-gray-700/10 to-transparent border-gray-700/40",
  caution: "from-amber-500/[0.12] via-amber-500/[0.04] to-transparent border-amber-500/25",
  no_play: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
};

type ReaderMode = "full" | "compact";

function EdgeConsole({
  game, market, marketData, mode, onModeChange,
}: {
  game: Game;
  market: MarketKey;
  marketData: MarketData;
  mode: ReaderMode;
  onModeChange: (m: ReaderMode) => void;
}) {
  // v11.8 — verdict reflects the SELECTED market, not the game-level headline.
  const consoleVerdict = marketVerdictFor(game, market);
  return (
    <section className="bg-[#0A0A0F] shrink-0">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-1.5 pb-1.5">
        <div className="bg-[#0D0D14] border border-white/[0.10] rounded-xl overflow-hidden shadow-[0_4px_28px_-10px_rgba(167,139,250,0.22),inset_0_1px_0_rgba(167,139,250,0.06)]">
          {/* Identity strip — header + mode-aware microcopy + Toggle + Legend */}
          <div className="border-b border-white/[0.06] bg-gradient-to-r from-violet-500/[0.09] via-violet-500/[0.03] to-transparent px-5 py-1.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
                <h2 className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/90 whitespace-nowrap">
                  <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/90 shadow-[0_0_8px_rgba(167,139,250,0.4)]" />
                  Selected Edge Reader
                </h2>
                {mode === "full" ? (
                  <p className="hidden md:block text-[11.5px] text-gray-400 leading-snug">
                    Click any game or market below to update this read.
                  </p>
                ) : (
                  /* In compact mode, surface verdict + market + time inline since
                     there's no separate verdict band below. */
                  <div className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-bold whitespace-nowrap">
                    <span aria-hidden="true" className="text-gray-700">·</span>
                    <span aria-hidden="true" className={VERDICT_TEXT_COLOR[consoleVerdict]}>{VERDICT_GLYPH[consoleVerdict]}</span>
                    <span className={VERDICT_TEXT_COLOR[consoleVerdict]}>{VERDICT_LABEL[consoleVerdict]}</span>
                    <span aria-hidden="true" className="text-gray-700">·</span>
                    <span className="text-gray-400">{marketLongLabel(market)}</span>
                    <span aria-hidden="true" className="text-gray-700">·</span>
                    <span className="text-gray-400 tabular-nums normal-case tracking-normal">{game.gameTime}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ReaderModeToggle mode={mode} onChange={onModeChange} />
                <LegendPopover />
              </div>
            </div>
          </div>

          {mode === "full" ? (
            <>
              {/* Verdict band */}
              <div className={`relative bg-gradient-to-r ${BAND_TINT[consoleVerdict]} border-b border-white/[0.04] px-5 py-1`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-bold whitespace-nowrap">
                    <span className="text-violet-300">Selected</span>
                    <span aria-hidden="true" className="text-gray-700">·</span>
                    <span aria-hidden="true" className={VERDICT_TEXT_COLOR[consoleVerdict]}>{VERDICT_GLYPH[consoleVerdict]}</span>
                    <span className={VERDICT_TEXT_COLOR[consoleVerdict]}>{VERDICT_LABEL[consoleVerdict]}</span>
                    <span aria-hidden="true" className="text-gray-700 mx-1">·</span>
                    <span className="text-gray-400">{marketLongLabel(market)}</span>
                  </span>
                  <span className="text-[11px] text-gray-400 tabular-nums">{game.gameTime}</span>
                </div>
              </div>

              {/* Full body */}
              <div className="px-5 py-2.5">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-5">
                  <EdgeConsoleLeft game={game} market={market} marketData={marketData} />
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
                      <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/60 shadow-[0_0_6px_rgba(167,139,250,0.22)]" />
                      <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/75">
                        Supporting Evidence
                      </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] gap-5">
                      <EdgeConsoleCenter game={game} market={market} marketData={marketData} />
                      <EdgeConsoleRight game={game} market={market} marketData={marketData} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <CompactReaderBody
              game={game}
              market={market}
              marketData={marketData}
              consoleVerdict={consoleVerdict}
              onExpand={() => onModeChange("full")}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ReaderModeToggle({
  mode, onChange,
}: { mode: ReaderMode; onChange: (m: ReaderMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Reader mode"
      className="inline-flex items-stretch rounded-md border border-white/[0.10] bg-white/[0.02] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onChange("full")}
        aria-pressed={mode === "full"}
        className={`px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] font-bold transition-colors ${
          mode === "full"
            ? "bg-violet-500/[0.22] text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        Full View
      </button>
      <span aria-hidden="true" className="w-px bg-white/[0.08]" />
      <button
        type="button"
        onClick={() => onChange("compact")}
        aria-pressed={mode === "compact"}
        className={`px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] font-bold transition-colors ${
          mode === "compact"
            ? "bg-violet-500/[0.22] text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        Compact
      </button>
    </div>
  );
}

function CompactReaderBody({
  game, market, marketData, consoleVerdict, onExpand,
}: {
  game: Game;
  market: MarketKey;
  marketData: MarketData;
  consoleVerdict: VerdictKey;
  onExpand: () => void;
}) {
  const action = guidedAction(consoleVerdict);
  const actionColor = ACTION_TONE_CLASS[action.tone];
  const promoted = isPromoted(consoleVerdict);
  const guardOk = marketData.priceAmerican !== null && isPlayablePrice(market, marketData.priceAmerican);

  return (
    <div className="px-5 py-3">
      <div className="grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-x-4 gap-y-2 items-center">
        {/* Matchup */}
        <div className="flex items-center gap-2 min-w-0">
          <TeamIdentity abbr={game.away} size={28} />
          <span className="text-[14px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.away}
          </span>
          <span className="text-gray-700 text-[12px]">@</span>
          <span className="text-[14px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.home}
          </span>
          <TeamIdentity abbr={game.home} size={28} />
        </div>

        {/* Pick + price + projected */}
        <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
          <span className="text-[22px] font-black tabular-nums text-white leading-none" style={{ letterSpacing: "-0.04em" }}>
            {marketData.pick}
          </span>
          <span className="text-[12.5px] tabular-nums font-bold text-gray-300">
            · {Math.round(marketData.confidence * 100)}%
          </span>
          {marketData.priceAmerican !== null && (
            <>
              <span className="text-gray-700">·</span>
              <span className="text-[12.5px] tabular-nums font-semibold text-gray-300">
                {formatAmericanPrice(marketData.priceAmerican)}
              </span>
              {promoted && (
                <span
                  aria-label={guardOk ? "Playable" : "Outside playable rule"}
                  className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] uppercase tracking-[0.12em] font-bold ${
                    guardOk
                      ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                  }`}
                >
                  <span aria-hidden="true">{guardOk ? "✓" : "⚠"}</span>
                </span>
              )}
            </>
          )}
          <span className="text-gray-700">·</span>
          <span className="text-[11px] tabular-nums text-gray-400">
            Proj {game.awayProjected.toFixed(1)} — {game.homeProjected.toFixed(1)}
          </span>
        </div>

        {/* Guided action + one-line guide */}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`inline-flex items-center gap-1 ${actionColor} shrink-0`}>
            <span aria-hidden="true" className="text-[13px] leading-none">{action.glyph}</span>
            <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold">{action.label}</span>
          </span>
          <span className="text-[12px] text-gray-300 leading-snug min-w-0 truncate" title={marketData.guidedGuide}>
            — {marketData.guidedGuide}
          </span>
        </div>

        {/* Expand */}
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-400/35 bg-violet-500/[0.10] text-[10.5px] uppercase tracking-[0.14em] font-bold text-violet-100 hover:bg-violet-500/[0.18] hover:border-violet-400/55 transition-colors whitespace-nowrap shrink-0"
        >
          Expand full read <span aria-hidden="true">↓</span>
        </button>
      </div>
    </div>
  );
}


function EdgeConsoleLeft({
  game, market, marketData,
}: { game: Game; market: MarketKey; marketData: MarketData }) {
  // v11.8 — derive Quick Read state from the SELECTED market, not the
  // game-level headline. Total on a Best Angle game is not itself a Best
  // Angle, so the Playable badge + Play Grade + GuidedRead all key off
  // the market-level verdict here.
  const consoleVerdict = marketVerdictFor(game, market);
  const promoted = isPromoted(consoleVerdict);
  const guardOk = marketData.priceAmerican !== null && isPlayablePrice(market, marketData.priceAmerican);
  return (
    <div className="bg-white/[0.015] border border-white/[0.04] rounded-xl px-3.5 py-2.5 space-y-2 min-w-0">
      {/* Quick Read header — beginner-friendly entry point label */}
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85 shadow-[0_0_8px_rgba(167,139,250,0.35)]" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/90">
          Quick Read
        </p>
      </div>

      {/* Matchup */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TeamIdentity abbr={game.away} size={32} />
          <span className="text-[14px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.away}
          </span>
          <span className="text-gray-700 text-[12px]">@</span>
          <span className="text-[14px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.home}
          </span>
          <TeamIdentity abbr={game.home} size={32} />
        </div>
      </div>

      {/* Projected */}
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-1.5">
        <p className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold mb-0.5">Projected</p>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-bold">{game.away}</span>
            <span className="text-[18px] font-black tabular-nums text-gray-100 leading-none" style={{ letterSpacing: "-0.04em" }}>
              {game.awayProjected.toFixed(1)}
            </span>
          </div>
          <span className="text-gray-700">—</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-black tabular-nums text-gray-100 leading-none" style={{ letterSpacing: "-0.04em" }}>
              {game.homeProjected.toFixed(1)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-bold">{game.home}</span>
          </div>
        </div>
      </div>

      {/* Selected pick */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-[24px] font-black tabular-nums text-white leading-none" style={{ letterSpacing: "-0.04em" }}>
            {marketData.pick}
          </h2>
          <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[12.5px] tabular-nums font-bold text-gray-300">
              {Math.round(marketData.confidence * 100)}%
            </span>
            {marketData.priceAmerican !== null ? (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[12.5px] tabular-nums font-semibold text-gray-300">
                  {formatAmericanPrice(marketData.priceAmerican)}
                </span>
                {promoted && (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] uppercase tracking-[0.12em] font-bold ${
                    guardOk
                      ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                  }`}>
                    <span aria-hidden="true">{guardOk ? "✓" : "⚠"}</span>
                    {guardOk ? "Playable" : "Outside rule"}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500">
                  not priced
                </span>
              </>
            )}
          </div>
        </div>
        <ConfidenceRing value={marketData.confidence * 100} size={48} strokeWidth={4} />
      </div>

      {/* v11.2 What this means card — sits between pick and Play Grade */}
      <GuidedRead game={game} marketData={marketData} market={market} mode="full" />

      {/* Play Grade meter — reflects the selected market's position */}
      <PlayGradeMeter verdict={consoleVerdict} />
    </div>
  );
}

function EdgeConsoleCenter({
  game, market, marketData,
}: { game: Game; market: MarketKey; marketData: MarketData }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80 mb-1.5">
        Edge Stack · {marketLongLabel(market)}
      </p>
      <div className="space-y-1.5">
        {buildEdgeStackRows(game, market, marketData).map((r) => (
          <EdgeStackRow key={r.label} {...r} />
        ))}
      </div>
    </div>
  );
}

function EdgeConsoleRight({
  game, market, marketData,
}: { game: Game; market: MarketKey; marketData: MarketData }) {
  return (
    <div className="min-w-0 space-y-2.5">
      <MarketPulse market={market} marketData={marketData} compact />
      <div className="border-t border-white/[0.04]" />
      <KeyStats stats={marketData.keyStats} compact />
      <div className="border-t border-white/[0.04]" />
      {/* Market Notes — Why/Risk reframed as smaller advanced notes */}
      <section className="space-y-1">
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/70">
          Market Notes
        </p>
        <div className="space-y-1">
          <ReadLine label="Why" body={marketData.whyLine} tone="default" compact />
          <ReadLine label="Risk" body={marketData.riskLine} tone="amber" compact />
        </div>
      </section>
    </div>
  );
}

// ─── EdgeStack module (v11.1: renamed labels) ───────────────────────

type EdgeStackRowData = {
  label: string;
  evidence: string;
  delta: string;
  deltaTone: "emerald" | "amber" | "gray";
};

function EdgeStackRow({ label, evidence, delta, deltaTone }: EdgeStackRowData) {
  const toneClass = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    gray: "text-gray-500",
  }[deltaTone];
  return (
    <div className="grid grid-cols-[88px_1fr_auto] items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-gray-500">
        {label}
      </span>
      <span className="text-[12.5px] text-gray-300 tabular-nums leading-snug">
        {evidence}
      </span>
      <span className={`text-[12.5px] font-black tabular-nums leading-snug whitespace-nowrap ${toneClass}`}>
        {delta}
      </span>
    </div>
  );
}

function buildEdgeStackRows(game: Game, market: MarketKey, md: MarketData): EdgeStackRowData[] {
  const side = pickSideLabel(market, md.pick);
  return [
    modelEdgeRow(market, md, side),
    marketValueRow(md),
    moneyVsBetsRow(md, side),
    lineMoveRow(md, side),
    playablePriceRow(market, md),
  ];
}

function modelEdgeRow(market: MarketKey, md: MarketData, side: string): EdgeStackRowData {
  if (market === "total" && md.modelTotal !== undefined && md.marketTotal !== undefined) {
    const naturalDelta = md.modelTotal - md.marketTotal;
    const isOver = md.pick.toUpperCase().startsWith("OVER");
    const supports = (isOver && naturalDelta > 0) || (!isOver && naturalDelta < 0);
    const magnitude = Math.abs(naturalDelta);
    const tone: "emerald" | "amber" | "gray" =
      magnitude < 0.2 ? "gray" : supports ? "emerald" : "amber";
    return {
      label: "Model Edge",
      evidence: `Model ${md.modelTotal.toFixed(1)} vs market ${md.marketTotal.toFixed(1)}`,
      delta: `${naturalDelta >= 0 ? "+" : ""}${naturalDelta.toFixed(1)} runs`,
      deltaTone: tone,
    };
  }
  if (md.marketFairProb === null) {
    return {
      label: "Model Edge",
      evidence: `${side} ${(md.modelProb * 100).toFixed(0)}% · market unavailable`,
      delta: "—",
      deltaTone: "gray",
    };
  }
  const gap = (md.modelProb - md.marketFairProb) * 100;
  return {
    label: "Model Edge",
    evidence: `${side} ${(md.modelProb * 100).toFixed(0)}% vs market ${(md.marketFairProb * 100).toFixed(0)}%`,
    delta: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`,
    deltaTone: gap >= 1 ? "emerald" : gap <= -1 ? "amber" : "gray",
  };
}

function marketValueRow(md: MarketData): EdgeStackRowData {
  if (md.pinnacleEvPct === null) {
    return { label: "Market Value", evidence: "Sharper price check", delta: "unavailable", deltaTone: "gray" };
  }
  const ev = md.pinnacleEvPct;
  return {
    label: "Market Value",
    evidence: "Sharper price check",
    delta: `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`,
    deltaTone: ev >= 1 ? "emerald" : ev >= 0.3 ? "emerald" : ev <= -1 ? "amber" : "gray",
  };
}

function moneyVsBetsRow(md: MarketData, side: string): EdgeStackRowData {
  if (md.moneyPct === null || md.betsPct === null) {
    return { label: "Money vs Bets", evidence: "Money / Bets", delta: "unavailable", deltaTone: "gray" };
  }
  const gap = md.moneyPct - md.betsPct;
  return {
    label: "Money vs Bets",
    evidence: `Money ${md.moneyPct}% / Bets ${md.betsPct}% on ${side}`,
    delta: `${gap >= 0 ? "+" : ""}${gap}`,
    deltaTone: gap >= 3 ? "emerald" : gap <= -3 ? "amber" : "gray",
  };
}

function lineMoveRow(md: MarketData, side: string): EdgeStackRowData {
  if (md.lineOpenAmerican === null || md.priceAmerican === null) {
    return { label: "Line Move", evidence: "Open → Current", delta: "unavailable", deltaTone: "gray" };
  }
  const open = md.lineOpenAmerican;
  const cur = md.priceAmerican;
  const dir = moveDirection(open, cur);
  const arrow = dir === "toward" ? "↗" : dir === "against" ? "↘" : "→";
  const tone = dir === "toward" ? "emerald" : dir === "against" ? "amber" : "gray";
  return {
    label: "Line Move",
    evidence: `${formatAmericanPrice(open)} → ${formatAmericanPrice(cur)}`,
    delta: `${arrow} ${side}`,
    deltaTone: tone,
  };
}

function playablePriceRow(market: MarketKey, md: MarketData): EdgeStackRowData {
  if (md.priceAmerican === null) {
    return { label: "Playable Price", evidence: "Current", delta: "Not priced", deltaTone: "gray" };
  }
  const ok = isPlayablePrice(market, md.priceAmerican);
  return {
    label: "Playable Price",
    evidence: `Current ${formatAmericanPrice(md.priceAmerican)}`,
    delta: ok ? "✓ Playable" : "⚠ Outside rule",
    deltaTone: ok ? "emerald" : "amber",
  };
}

// ─── Market Pulse ───────────────────────────────────────────────────

function MarketPulse({
  market, marketData: md, compact = false,
}: { market: MarketKey; marketData: MarketData; compact?: boolean }) {
  const hasMovement = md.lineOpenAmerican !== null && md.priceAmerican !== null;
  const hasSplits = md.moneyPct !== null && md.betsPct !== null;
  const side = pickSideLabel(market, md.pick);
  const labelClass = compact
    ? "text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80"
    : "text-[9.5px] uppercase tracking-[0.18em] font-bold text-gray-500";

  if (!hasMovement && !hasSplits) {
    return (
      <section>
        <p className={`${labelClass} mb-2`}>Market Pulse</p>
        <p className="text-[12px] text-gray-500">Market data unavailable for this market.</p>
      </section>
    );
  }

  return (
    <section>
      <p className={`${labelClass} mb-2.5`}>Market Pulse</p>
      {hasMovement ? (
        <LineMovementTrack open={md.lineOpenAmerican!} current={md.priceAmerican!} side={side} compact={compact} />
      ) : (
        <p className="text-[11.5px] text-gray-500 mb-2">Line movement unavailable.</p>
      )}
      {hasSplits ? (
        <SplitsBars moneyPct={md.moneyPct!} betsPct={md.betsPct!} side={side} compact={compact} />
      ) : (
        <p className="text-[11.5px] text-gray-500 mt-2">Public splits unavailable.</p>
      )}
    </section>
  );
}

function LineMovementTrack({
  open, current, side, compact = false,
}: { open: number; current: number; side: string; compact?: boolean }) {
  const openProb = americanToImpliedProb(open);
  const currentProb = americanToImpliedProb(current);
  const direction = moveDirection(open, current);
  const project = (p: number) => 15 + p * 70;
  const openPos = project(openProb);
  const currentPos = project(currentProb);
  const minPos = Math.min(openPos, currentPos);
  const span = Math.abs(currentPos - openPos);
  const trackFill = direction === "toward" ? "bg-emerald-400" : direction === "against" ? "bg-amber-400" : "bg-gray-500";
  const baseArrow = direction === "toward" ? "text-emerald-300" : direction === "against" ? "text-amber-300" : "text-gray-400";
  const arrowColor = compact
    ? (direction === "toward" ? "text-emerald-300/85" : direction === "against" ? "text-amber-300/85" : "text-gray-400")
    : baseArrow;
  const arrowWeight = compact ? "font-semibold" : "font-bold";
  const arrow = direction === "toward" ? "↗" : direction === "against" ? "↘" : "→";
  const caption = direction === "toward" ? `moved toward ${side}` : direction === "against" ? `moved against ${side}` : "stable";
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[10.5px] tabular-nums mb-1.5">
        <span className="text-gray-500">Open <span className="text-gray-300 font-medium">{formatAmericanPrice(open)}</span></span>
        <span className={`${arrowWeight} ${arrowColor}`}>{arrow} {caption}</span>
        <span className="text-gray-500">Now <span className="text-gray-200 font-bold">{formatAmericanPrice(current)}</span></span>
      </div>
      <div className="relative h-1.5 bg-white/[0.04] rounded-full">
        <div className={`absolute h-full ${trackFill} rounded-full`} style={{ left: `${minPos}%`, width: `${span}%` }} />
        <span aria-label="open"
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-gray-500 ring-2 ring-[#0D0D14]"
          style={{ left: `${openPos}%` }} />
        <span aria-label="current"
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${trackFill} ring-2 ring-[#0D0D14]`}
          style={{ left: `${currentPos}%` }} />
      </div>
    </div>
  );
}

function SplitsBars({
  moneyPct, betsPct, side, compact = false,
}: { moneyPct: number; betsPct: number; side: string; compact?: boolean }) {
  const gap = moneyPct - betsPct;
  const tone: "emerald" | "amber" | "gray" = gap >= 3 ? "emerald" : gap <= -3 ? "amber" : "gray";
  const moneyFill = { emerald: "bg-emerald-400", amber: "bg-amber-400", gray: "bg-gray-400" }[tone];
  const caption = gap >= 3 ? `+${gap} sharp gap on ${side}` :
                  gap <= -3 ? `${gap} — public on ${side}` :
                  "Balanced — money matches tickets";
  const captionColor = compact
    ? (tone === "emerald" ? "text-emerald-300/75" : tone === "amber" ? "text-amber-300/75" : "text-gray-500")
    : (tone === "emerald" ? "text-emerald-300/90" : tone === "amber" ? "text-amber-300/90" : "text-gray-500");
  return (
    <div className="space-y-1">
      <SplitBarRow label="Money" value={moneyPct} fill={moneyFill} valueTone={tone} />
      <SplitBarRow label="Bets" value={betsPct} fill="bg-gray-600" valueTone="gray" />
      <p className={`text-[11px] mt-1 ${captionColor}`}>{caption}</p>
    </div>
  );
}

function SplitBarRow({
  label, value, fill, valueTone,
}: { label: string; value: number; fill: string; valueTone: "emerald" | "amber" | "gray" }) {
  const valueColor =
    valueTone === "emerald" ? "text-emerald-200" :
    valueTone === "amber" ? "text-amber-200" :
    "text-gray-300";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500 w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`${fill} h-full rounded-full`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[11px] tabular-nums font-bold w-9 text-right ${valueColor}`}>{value}%</span>
    </div>
  );
}

// ─── Key Stats ──────────────────────────────────────────────────────

function KeyStats({ stats, compact = false }: { stats: KeyStat[]; compact?: boolean }) {
  const labelClass = compact
    ? "text-[9.5px] uppercase tracking-[0.12em] font-semibold text-gray-500/80"
    : "text-[9.5px] uppercase tracking-[0.18em] font-bold text-gray-500";
  if (stats.length < 2) {
    return (
      <section>
        <p className={`${labelClass} mb-2`}>Key Stats</p>
        <p className="text-[12px] text-gray-500">Stat coverage limited for this market.</p>
      </section>
    );
  }
  return (
    <section>
      <p className={`${labelClass} mb-2`}>Key Stats</p>
      <div className="space-y-1.5">
        {stats.slice(0, 3).map((s) => <KeyStatRow key={s.label} {...s} />)}
      </div>
    </section>
  );
}

function KeyStatRow({ label, value, tone }: KeyStat) {
  const valueColor =
    tone === "emerald" ? "text-emerald-300" :
    tone === "amber" ? "text-amber-300" :
    tone === "gray" ? "text-gray-500" :
    "text-gray-100";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] text-gray-400">{label}</span>
      <span className={`text-[12.5px] tabular-nums font-bold ${valueColor}`}>{value}</span>
    </div>
  );
}

// ─── ReadLine ───────────────────────────────────────────────────────

function ReadLine({
  label, body, tone, compact = false,
}: { label: string; body: string; tone: "default" | "amber"; compact?: boolean }) {
  const labelColor = compact
    ? (tone === "amber" ? "text-amber-400/60" : "text-violet-400/60")
    : (tone === "amber" ? "text-amber-400/80" : "text-violet-400/80");
  const bodyColor = compact
    ? (tone === "amber" ? "text-amber-100/70" : "text-gray-300")
    : (tone === "amber" ? "text-amber-100/85" : "text-gray-200");
  const sizeClass = compact ? "text-[11.5px]" : "text-[12.5px]";
  return (
    <p className={`${sizeClass} leading-relaxed ${bodyColor}`}>
      <span className={`text-[9.5px] uppercase tracking-[0.16em] font-bold mr-2 ${labelColor}`}>{label}</span>
      {body}
    </p>
  );
}

// ─── Signal chip ────────────────────────────────────────────────────

type ChipData = { label: string; tone: Tone };

function buildSignalChips(market: MarketKey, md: MarketData): ChipData[] {
  const chips: ChipData[] = [];

  if (market === "total" && md.modelTotal !== undefined && md.marketTotal !== undefined) {
    const delta = md.modelTotal - md.marketTotal;
    const isOver = md.pick.toUpperCase().startsWith("OVER");
    const supports = (isOver && delta > 0) || (!isOver && delta < 0);
    const tone: Tone = Math.abs(delta) < 0.2 ? "gray" : supports ? "emerald" : "amber";
    chips.push({ label: `Edge ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} runs`, tone });
  } else if (md.marketFairProb !== null) {
    const gap = (md.modelProb - md.marketFairProb) * 100;
    chips.push({
      label: `Edge ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`,
      tone: gap >= 1 ? "emerald" : gap <= -1 ? "amber" : "gray",
    });
  } else {
    chips.push({ label: `Model ${(md.modelProb * 100).toFixed(0)}%`, tone: "gray" });
  }

  if (md.pinnacleEvPct !== null) {
    const ev = md.pinnacleEvPct;
    chips.push({
      label: `Value ${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`,
      tone: ev >= 1 ? "emerald" : ev >= 0.3 ? "emerald" : ev <= -1 ? "amber" : "gray",
    });
  }

  if (md.moneyPct !== null && md.betsPct !== null) {
    const gap = md.moneyPct - md.betsPct;
    chips.push({
      label: `Money ${md.moneyPct}/${md.betsPct}`,
      tone: gap >= 3 ? "emerald" : gap <= -3 ? "amber" : "gray",
    });
  }

  if (md.lineOpenAmerican !== null && md.priceAmerican !== null) {
    const dir = moveDirection(md.lineOpenAmerican, md.priceAmerican);
    const arrow = dir === "toward" ? "↗" : dir === "against" ? "↘" : "→";
    chips.push({
      label: `${arrow} ${formatAmericanPrice(md.lineOpenAmerican)}→${formatAmericanPrice(md.priceAmerican)}`,
      tone: dir === "toward" ? "emerald" : dir === "against" ? "amber" : "gray",
    });
  }

  if (chips.length === 1) chips.push({ label: "Limited", tone: "gray" });
  return chips;
}

function SignalChip({ label, tone }: { label: string; tone: Tone }) {
  const styles = {
    emerald: "bg-emerald-500/12 text-emerald-200 border-emerald-500/25",
    amber: "bg-amber-500/12 text-amber-200 border-amber-500/25",
    gray: "bg-white/[0.04] text-gray-400 border-white/[0.08]",
    sky: "bg-sky-500/12 text-sky-200 border-sky-500/25",
    violet: "bg-violet-500/12 text-violet-200 border-violet-500/25",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-bold tabular-nums border ${styles}`}>
      {label}
    </span>
  );
}

// ─── MarketPill ─────────────────────────────────────────────────────

function MarketPill({
  market, marketData, isPromoted: pillPromoted, isCautioned, isSelected, onClick,
}: {
  market: MarketKey;
  marketData: MarketData | null;
  isPromoted: boolean;
  isCautioned: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  if (!marketData) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="border border-dashed border-white/[0.06] bg-white/[0.01] rounded-md px-2.5 py-1.5 min-h-[34px] flex items-center justify-between gap-1.5 text-left cursor-not-allowed min-w-0"
      >
        <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-gray-600">
          {marketLabel(market)}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-gray-600 font-semibold">Held</span>
      </button>
    );
  }

  const railClass = isSelected
    ? "border-l-[2px] border-l-violet-400"
    : isCautioned
    ? "border-l-[2px] border-l-amber-500/50"
    : "border-l-[2px] border-l-transparent";

  // v13.1 — Strengthen the selected pill so the user can't miss which
  // market is feeding the Selected Edge Reader.
  const bgClass = isSelected
    ? "bg-violet-500/[0.18] border-violet-400/55 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.2)]"
    : isCautioned
    ? "bg-amber-500/[0.06] border-amber-500/25"
    : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]";

  const labelColor = isSelected ? "text-violet-200" : isCautioned ? "text-amber-300" : "text-gray-500";
  const pickColor = isSelected ? "text-white" : isCautioned ? "text-amber-100" : "text-gray-100";

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-pressed={isSelected}
      className={`group ${railClass} ${bgClass} border rounded-md px-2.5 py-1.5 transition-colors flex items-center justify-between gap-1.5 text-left min-w-0`}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={`text-[9.5px] uppercase tracking-[0.14em] font-bold whitespace-nowrap ${labelColor}`}>
          {marketLabel(market)}
        </span>
        <span className={`text-[13px] font-black tabular-nums truncate ${pickColor}`} style={{ letterSpacing: "-0.02em" }}>
          {marketData.pick}
        </span>
        <span className="text-[11px] tabular-nums font-semibold text-gray-400 whitespace-nowrap">
          {Math.round(marketData.confidence * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {pillPromoted && <span aria-hidden="true" className="text-[11px] text-emerald-400">★</span>}
        <span aria-hidden="true" className={`text-[11px] font-bold ${SHARP_COLOR[marketData.sharp]}`}>
          {SHARP_GLYPH[marketData.sharp]}
        </span>
      </div>
    </button>
  );
}

// ─── VerdictChip ────────────────────────────────────────────────────

function VerdictChip({ verdict, isSelected }: { verdict: VerdictKey; isSelected: boolean }) {
  if (isSelected) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-400/40 bg-violet-500/15 text-[10px] uppercase tracking-[0.14em] font-bold whitespace-nowrap">
        <span className="text-violet-300">Selected</span>
        <span aria-hidden="true" className="text-gray-700">·</span>
        <span aria-hidden="true" className={VERDICT_TEXT_COLOR[verdict]}>{VERDICT_GLYPH[verdict]}</span>
        <span className={VERDICT_TEXT_COLOR[verdict]}>{VERDICT_LABEL[verdict]}</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.06] text-[10px] uppercase tracking-[0.14em] font-bold whitespace-nowrap ${VERDICT_TEXT_COLOR[verdict]}`}>
      <span aria-hidden="true">{VERDICT_GLYPH[verdict]}</span>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

function RowLiveTags({ game }: { game: Game }) {
  const tags: Array<{ label: string; tone: "emerald" | "amber" | "gray" }> = [];
  if (game.lineupConfirmed) tags.push({ label: "Lineup ✓", tone: "emerald" });
  if (!game.linesLocked) tags.push({ label: "Lines opening", tone: "amber" });
  if (game.sharpSignalPending) tags.push({ label: "Sharp pending", tone: "gray" });
  if (game.marketDataLimited) tags.push({ label: "Market unavailable", tone: "gray" });
  const top = tags[0];
  if (!top) return null;
  return (
    <span className="hidden md:inline-flex items-center gap-1.5">
      <span className="text-gray-700">·</span>
      <span className={`text-[9.5px] uppercase tracking-[0.14em] font-bold ${
        top.tone === "emerald" ? "text-emerald-300/70" :
        top.tone === "amber" ? "text-amber-300/70" :
        "text-gray-500"
      }`}>{top.label}</span>
    </span>
  );
}

// ─── LegendPopover (v11.6: tiny collapsed "How to read this") ───────

function LegendPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-violet-400/35 bg-violet-500/[0.10] text-[10.5px] uppercase tracking-[0.14em] font-bold text-violet-100 hover:bg-violet-500/[0.18] hover:border-violet-400/55 transition-colors"
      >
        How this works
        <span aria-hidden="true" className="text-[9px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="How this works"
          className="absolute right-0 top-full mt-2 z-30 w-[340px] bg-[#13131A] border border-white/[0.08] rounded-lg p-3.5 shadow-xl shadow-black/40"
        >
          <p className="text-[9.5px] uppercase tracking-[0.16em] font-semibold text-gray-500/80 mb-2">
            How this works
          </p>
          <ol className="space-y-1.5 text-[11.5px] leading-snug mb-3 text-gray-300 list-decimal pl-4">
            <li>Pick a game from the Edge Board.</li>
            <li>Click Moneyline, Total, or 1st Inning to inspect that exact market.</li>
            <li>The Selected Edge Reader above updates with the read for that market.</li>
            <li>Start with <span className="font-bold text-violet-200/90">Quick Read</span> to understand how to treat the pick.</li>
            <li>Use <span className="font-bold text-violet-200/75">Supporting Evidence</span> for the deeper model + market proof.</li>
            <li>Use <span className="font-bold text-gray-200">Market Notes</span> for risk, price, and context.</li>
          </ol>

          <p className="text-[9.5px] uppercase tracking-[0.16em] font-semibold text-gray-500/80 mb-2 pt-3 border-t border-white/[0.05]">
            Signal meanings
          </p>
          <ul className="space-y-1.5 text-[11.5px] leading-snug">
            <li className="flex items-baseline gap-2">
              <span aria-hidden="true" className="text-emerald-300 w-3 text-center shrink-0">★</span>
              <span>
                <span className="font-bold text-emerald-200">Best Angle</span>
                <span className="text-gray-400"> — strongest current read on the slate.</span>
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <span aria-hidden="true" className="text-emerald-400 w-3 text-center shrink-0">✓</span>
              <span>
                <span className="font-bold text-emerald-200">Supported</span>
                <span className="text-gray-400"> — market signals back the pick.</span>
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <span aria-hidden="true" className="text-gray-400 w-3 text-center shrink-0">○</span>
              <span>
                <span className="font-bold text-gray-300">Model Read</span>
                <span className="text-gray-500"> — model lean only, not a featured play.</span>
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <span aria-hidden="true" className="text-amber-400 w-3 text-center shrink-0">⚠</span>
              <span>
                <span className="font-bold text-amber-300">Caution</span>
                <span className="text-gray-400"> — model and market disagree; be careful.</span>
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <span aria-hidden="true" className="text-gray-400 w-3 text-center shrink-0">·</span>
              <span>
                <span className="font-bold text-gray-300">Watchlist</span>
                <span className="text-gray-400"> — worth monitoring, not fully confirmed yet.</span>
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Edge Board (desktop) ───────────────────────────────────────────

type SelectHandlers = {
  onSelectGame: (idx: number) => void;
  onSelectMarket: (idx: number, market: MarketKey) => void;
};

function DesktopEdgeBoard({
  games, selectedGameIdx, selectedMarket, onSelectGame, onSelectMarket,
}: { games: Game[]; selectedGameIdx: number; selectedMarket: MarketKey } & SelectHandlers) {
  return (
    <div className="max-w-7xl mx-auto px-6 sm:px-8 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 px-1 flex-wrap">
        <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
          <h2 className="text-[12px] uppercase tracking-[0.18em] font-bold text-gray-100 inline-flex items-center gap-2">
            <span aria-hidden="true" className="w-1 h-3 rounded-full bg-violet-400/80" />
            Edge Board
          </h2>
          <span className="hidden sm:inline text-[11px] text-gray-500">
            Browse the slate. Click any game or market to update the reader above.
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] tabular-nums text-gray-500">
            {games.length} games
          </span>
          <span className="text-gray-700">·</span>
          <LegendPopover />
        </div>
      </div>
      <div className="space-y-2.5">
        {games.map((g, i) => (
          <DesktopEdgeCard
            key={`${g.away}-${g.home}-${i}`}
            game={g}
            isSelected={i === selectedGameIdx}
            selectedMarket={i === selectedGameIdx ? selectedMarket : g.headlineMarket}
            globalSelectedMarket={selectedMarket}
            onSelectGame={() => onSelectGame(i)}
            onSelectMarket={(m) => onSelectMarket(i, m)}
          />
        ))}
      </div>
    </div>
  );
}

function DesktopEdgeCard({
  game, isSelected, selectedMarket, globalSelectedMarket, onSelectGame, onSelectMarket,
}: {
  game: Game;
  isSelected: boolean;
  selectedMarket: MarketKey;
  globalSelectedMarket: MarketKey;
  onSelectGame: () => void;
  onSelectMarket: (m: MarketKey) => void;
}) {
  const isCaution = game.verdict === "caution";
  const isModelOnly = game.verdict === "no_play";

  const railClass = isSelected
    ? "border-l-[3px] border-l-violet-400"
    : isCaution
    ? "border-l-[3px] border-l-amber-500/50"
    : "border-l-[3px] border-l-transparent";

  // v13.1 — Strengthen selected card visibility so the connection to
  // the Selected Edge Reader is unmistakable: violet ring + soft glow.
  const baseClass = isSelected
    ? "bg-[#171724] border-violet-400/40 shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_0_24px_-8px_rgba(167,139,250,0.4)]"
    : "bg-[#13131A]/80 border-white/[0.06] hover:bg-[#15151D] hover:border-white/[0.10]";

  const chipMd = getMarketData(game, selectedMarket);
  // Board cards cap at 3 chips — scan layer, not full evidence. Full
  // Edge Stack lives in the top Edge Console.
  const chips = chipMd ? buildSignalChips(selectedMarket, chipMd).slice(0, 3) : [];

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelectGame}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectGame();
        }
      }}
      className={`group ${railClass} ${baseClass} border rounded-xl px-4 py-3 cursor-pointer transition-colors duration-150 space-y-2.5`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <TeamIdentity abbr={game.away} size={24} />
          <span className="text-[13.5px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.away}
          </span>
          <span className="text-gray-700 text-[12px]">@</span>
          <span className="text-[13.5px] font-bold tracking-tight text-gray-100" style={{ letterSpacing: "-0.02em" }}>
            {game.home}
          </span>
          <TeamIdentity abbr={game.home} size={24} />
          <span className="text-gray-700 mx-1">·</span>
          <span className="text-[11.5px] tabular-nums text-gray-500">{game.gameTime}</span>
          <RowLiveTags game={game} />
        </div>
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          <div className="flex items-baseline gap-1.5 text-[12.5px] tabular-nums">
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">Projected</span>
            <span className="text-gray-100 font-bold">{game.away} {game.awayProjected.toFixed(1)}</span>
            <span className="text-gray-700">—</span>
            <span className="text-gray-100 font-bold">{game.home} {game.homeProjected.toFixed(1)}</span>
          </div>
          <VerdictChip
            verdict={isSelected ? marketVerdictFor(game, globalSelectedMarket) : game.verdict}
            isSelected={isSelected}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarketPill market="ml" marketData={game.markets.ml}
          isPromoted={game.headlineMarket === "ml"}
          isCautioned={isCautionedMarket(game, "ml")}
          isSelected={isSelected && globalSelectedMarket === "ml"}
          onClick={() => onSelectMarket("ml")} />
        <MarketPill market="total" marketData={game.markets.total}
          isPromoted={game.headlineMarket === "total"}
          isCautioned={isCautionedMarket(game, "total")}
          isSelected={isSelected && globalSelectedMarket === "total"}
          onClick={() => onSelectMarket("total")} />
        <MarketPill market="first_inning_total" marketData={game.markets.first_inning_total}
          isPromoted={game.headlineMarket === "first_inning_total"}
          isCautioned={isCautionedMarket(game, "first_inning_total")}
          isSelected={isSelected && globalSelectedMarket === "first_inning_total"}
          onClick={() => onSelectMarket("first_inning_total")} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => <SignalChip key={c.label} label={c.label} tone={c.tone} />)}
          <span className="text-[10px] text-gray-500 ml-0.5">
            — {marketLongLabel(selectedMarket)}
          </span>
        </div>
      )}

      <p className={`text-[12.5px] leading-relaxed ${
        isCaution ? "text-amber-100/85" :
        isModelOnly ? "text-gray-400" :
        "text-gray-300"
      }`}>
        {game.decisionLine}
      </p>
    </article>
  );
}

// ─── Mobile components ──────────────────────────────────────────────

function MobileSelectedSummary({
  game, market, marketData, onViewDetail,
}: { game: Game; market: MarketKey; marketData: MarketData; onViewDetail: () => void }) {
  // v11.8 — mobile sticky reflects the SELECTED market's verdict.
  const summaryVerdict = marketVerdictFor(game, market);
  const promoted = isPromoted(summaryVerdict);
  const guardOk = marketData.priceAmerican !== null && isPlayablePrice(market, marketData.priceAmerican);
  const chips = buildSignalChips(market, marketData).slice(0, 3);

  return (
    <section className="px-4 py-3 space-y-2.5 bg-[#13131A]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamIdentity abbr={game.away} size={24} />
          <span className="text-[13px] font-bold text-gray-100">{game.away}</span>
          <span className="text-gray-700 text-[11px]">@</span>
          <span className="text-[13px] font-bold text-gray-100">{game.home}</span>
          <TeamIdentity abbr={game.home} size={24} />
        </div>
        <VerdictChip verdict={summaryVerdict} isSelected={true} />
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[20px] font-black tabular-nums text-white leading-none" style={{ letterSpacing: "-0.04em" }}>
          {marketData.pick}
        </h2>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-violet-300/90 font-bold">{marketLongLabel(market)}</span>
        <span className="text-gray-700">·</span>
        <span className="text-[13px] tabular-nums font-bold text-gray-300">{Math.round(marketData.confidence * 100)}%</span>
        {marketData.priceAmerican !== null ? (
          <>
            <span className="text-gray-700">·</span>
            <span className="text-[13px] tabular-nums font-semibold text-gray-300">{formatAmericanPrice(marketData.priceAmerican)}</span>
            {promoted && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.12em] font-bold ${
                guardOk
                  ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-200 border border-amber-500/30"
              }`}>
                <span aria-hidden="true">{guardOk ? "✓" : "⚠"}</span>
                {guardOk ? "Playable" : "Outside rule"}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500">not priced</span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 text-[11.5px] tabular-nums">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 font-bold">Projected</span>
        <span className="text-gray-100 font-bold">{game.away} {game.awayProjected.toFixed(1)}</span>
        <span className="text-gray-700">—</span>
        <span className="text-gray-100 font-bold">{game.home} {game.homeProjected.toFixed(1)}</span>
      </div>

      {/* v11.2 What this means card — sticky mode (action + guide only) */}
      <GuidedRead game={game} marketData={marketData} market={market} mode="sticky" />

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => <SignalChip key={c.label} label={c.label} tone={c.tone} />)}
      </div>

      <button
        type="button"
        onClick={onViewDetail}
        className="text-[11px] text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1 font-bold"
      >
        View Edge Detail <span aria-hidden="true">↓</span>
      </button>
    </section>
  );
}

function MobileMarketTabs({
  game, selectedMarket, onSelectMarket,
}: { game: Game; selectedMarket: MarketKey; onSelectMarket: (m: MarketKey) => void }) {
  const tabs: MarketKey[] = ["ml", "total", "first_inning_total"];
  return (
    <div className="grid grid-cols-3 gap-1.5 px-4 pb-3 bg-[#13131A]">
      {tabs.map((m) => {
        const md = getMarketData(game, m);
        return (
          <MarketPill
            key={m}
            market={m}
            marketData={md}
            isPromoted={game.headlineMarket === m}
            isCautioned={isCautionedMarket(game, m)}
            isSelected={selectedMarket === m}
            onClick={() => onSelectMarket(m)}
          />
        );
      })}
    </div>
  );
}

function MobileEdgeDetail({
  game, market, marketData,
}: { game: Game; market: MarketKey; marketData: MarketData }) {
  return (
    <section className="bg-[#0E0E14] border-y border-white/[0.04]">
      <div className="px-4 py-4 space-y-4">
        {/* v11.2 What to watch card — watch-out only at top of detail */}
        <GuidedRead game={game} marketData={marketData} market={market} mode="watchOutOnly" />

        <div className="border-t border-white/[0.04] pt-4">
          <PlayGradeMeter verdict={marketVerdictFor(game, market)} />
        </div>

        <div className="border-t border-white/[0.04] pt-4">
          <p className="text-[9.5px] uppercase tracking-[0.18em] font-bold text-gray-500 mb-2.5">
            Edge Stack · {marketLongLabel(market)}
          </p>
          <div className="space-y-2">
            {buildEdgeStackRows(game, market, marketData).map((r) => (
              <EdgeStackRow key={r.label} {...r} />
            ))}
          </div>
        </div>

        <div className="border-t border-white/[0.04] pt-4">
          <MarketPulse market={market} marketData={marketData} />
        </div>

        <div className="border-t border-white/[0.04] pt-4">
          <KeyStats stats={marketData.keyStats} />
        </div>

        <div className="border-t border-white/[0.04] pt-4 space-y-1.5">
          <ReadLine label="Why" body={marketData.whyLine} tone="default" />
          <ReadLine label="Risk" body={marketData.riskLine} tone="amber" />
        </div>

        <div className="border-t border-white/[0.04] pt-3 flex items-center justify-between flex-wrap gap-2 text-[10.5px] text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="w-1 h-1 rounded-full bg-emerald-400/70" />
            <span className="tabular-nums">Last refreshed 4 min ago</span>
          </span>
          <button type="button" className="text-[11px] text-gray-300 hover:text-violet-300 transition-colors inline-flex items-center gap-1 font-medium">
            Full breakdown <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function MobileEdgeBoard({
  games, selectedGameIdx, selectedMarket, onSelectGame, onSelectMarket,
}: { games: Game[]; selectedGameIdx: number; selectedMarket: MarketKey } & SelectHandlers) {
  return (
    <div className="px-4 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[12px] uppercase tracking-[0.18em] font-bold text-gray-100 inline-flex items-center gap-2">
          <span aria-hidden="true" className="w-1 h-3 rounded-full bg-violet-400/80" />
          Edge Board
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-gray-500">{games.length} games</span>
          <span className="text-gray-700">·</span>
          <LegendPopover />
        </div>
      </div>
      <div className="space-y-2.5">
        {games.map((g, i) => (
          <MobileEdgeCard
            key={`m-${g.away}-${g.home}-${i}`}
            game={g}
            isSelected={i === selectedGameIdx}
            selectedMarket={i === selectedGameIdx ? selectedMarket : g.headlineMarket}
            globalSelectedMarket={selectedMarket}
            onSelectGame={() => onSelectGame(i)}
            onSelectMarket={(m) => onSelectMarket(i, m)}
          />
        ))}
      </div>
    </div>
  );
}

function MobileEdgeCard({
  game, isSelected, selectedMarket, globalSelectedMarket, onSelectGame, onSelectMarket,
}: {
  game: Game;
  isSelected: boolean;
  selectedMarket: MarketKey;
  globalSelectedMarket: MarketKey;
  onSelectGame: () => void;
  onSelectMarket: (m: MarketKey) => void;
}) {
  const isCaution = game.verdict === "caution";
  const isModelOnly = game.verdict === "no_play";

  const railClass = isSelected
    ? "border-l-[3px] border-l-violet-400"
    : isCaution
    ? "border-l-[3px] border-l-amber-500/50"
    : "border-l-[3px] border-l-transparent";

  // v13.1 — Same stronger selected treatment as desktop card.
  const baseClass = isSelected
    ? "bg-[#171724] border-violet-400/40 shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_0_20px_-8px_rgba(167,139,250,0.35)]"
    : "bg-[#13131A]/80 border-white/[0.06]";

  const chipMd = getMarketData(game, selectedMarket);
  const chips = chipMd ? buildSignalChips(selectedMarket, chipMd).slice(0, 2) : [];

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelectGame}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectGame();
        }
      }}
      className={`${railClass} ${baseClass} border rounded-xl px-3 py-2.5 cursor-pointer space-y-2`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <TeamIdentity abbr={game.away} size={22} />
          <span className="text-[12.5px] font-bold text-gray-100">{game.away}</span>
          <span className="text-gray-700 text-[11px]">@</span>
          <span className="text-[12.5px] font-bold text-gray-100">{game.home}</span>
          <TeamIdentity abbr={game.home} size={22} />
          <span className="text-gray-700 mx-1">·</span>
          <span className="text-[10.5px] tabular-nums text-gray-500">{game.gameTime}</span>
        </div>
        <VerdictChip
          verdict={isSelected ? marketVerdictFor(game, globalSelectedMarket) : game.verdict}
          isSelected={isSelected}
        />
      </div>

      <div className="flex items-baseline gap-1.5 text-[11px] tabular-nums">
        <span className="text-[9px] uppercase tracking-[0.14em] text-gray-500 font-bold">Projected</span>
        <span className="text-gray-100 font-bold">{game.away} {game.awayProjected.toFixed(1)}</span>
        <span className="text-gray-700">—</span>
        <span className="text-gray-100 font-bold">{game.home} {game.homeProjected.toFixed(1)}</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <MarketPill market="ml" marketData={game.markets.ml}
          isPromoted={game.headlineMarket === "ml"}
          isCautioned={isCautionedMarket(game, "ml")}
          isSelected={isSelected && globalSelectedMarket === "ml"}
          onClick={() => onSelectMarket("ml")} />
        <MarketPill market="total" marketData={game.markets.total}
          isPromoted={game.headlineMarket === "total"}
          isCautioned={isCautionedMarket(game, "total")}
          isSelected={isSelected && globalSelectedMarket === "total"}
          onClick={() => onSelectMarket("total")} />
        <MarketPill market="first_inning_total" marketData={game.markets.first_inning_total}
          isPromoted={game.headlineMarket === "first_inning_total"}
          isCautioned={isCautionedMarket(game, "first_inning_total")}
          isSelected={isSelected && globalSelectedMarket === "first_inning_total"}
          onClick={() => onSelectMarket("first_inning_total")} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => <SignalChip key={c.label} label={c.label} tone={c.tone} />)}
        </div>
      )}

      <p className={`text-[11.5px] leading-relaxed ${
        isCaution ? "text-amber-100/85" :
        isModelOnly ? "text-gray-400" :
        "text-gray-300"
      }`}>
        {game.decisionLine}
      </p>
    </article>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function DesignPreviewPage() {
  const defaultIdx = Math.max(0, GAMES.findIndex((g) => g.verdict === "best_angle"));
  const [selectedGameIdx, setSelectedGameIdx] = useState(defaultIdx);
  const [selectedMarket, setSelectedMarket] = useState<MarketKey>(GAMES[defaultIdx].headlineMarket);
  const [readerMode, setReaderMode] = useState<ReaderMode>("full");
  const mobileDetailRef = useRef<HTMLDivElement>(null);

  function selectGame(idx: number) {
    setSelectedGameIdx(idx);
    setSelectedMarket(GAMES[idx].headlineMarket);
  }

  function selectMarket(idx: number, market: MarketKey) {
    const game = GAMES[idx];
    if (market === "first_inning_total" && game.markets.first_inning_total === null) return;
    setSelectedGameIdx(idx);
    setSelectedMarket(market);
  }

  function scrollToDetail() {
    mobileDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const selectedGame = GAMES[selectedGameIdx];
  const rawMarketData = selectedGame.markets[selectedMarket];
  const selectedMarketData: MarketData = rawMarketData ?? selectedGame.markets.ml;

  return (
    <div className="bg-[#0A0A0F] text-gray-200 lg:h-[calc(100vh-9rem)] lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0">
      {/* v13 — Locked-reader app console with Full Read / Compact toggle.
          Full mode (default) keeps the v11.12 reader layout. Compact
          mode collapses the reader to a single horizontal readout bar
          so the Edge Board takes a much larger share of the viewport. */}
      <SportRail />
      <SlateControlStrip games={GAMES} />

      {/* Desktop: Selected Edge Reader (locked at top) — Full or Compact */}
      <div className="hidden lg:block">
        <EdgeConsole
          game={selectedGame}
          market={selectedMarket}
          marketData={selectedMarketData}
          mode={readerMode}
          onModeChange={setReaderMode}
        />
      </div>

      {/* Mobile: sticky summary + market tabs (unchanged from v11) */}
      <div className="lg:hidden sticky top-0 z-20 bg-[#0A0A0F] border-b border-white/[0.06]">
        <MobileSelectedSummary
          game={selectedGame}
          market={selectedMarket}
          marketData={selectedMarketData}
          onViewDetail={scrollToDetail}
        />
        <MobileMarketTabs
          game={selectedGame}
          selectedMarket={selectedMarket}
          onSelectMarket={(m) => selectMarket(selectedGameIdx, m)}
        />
      </div>

      <div className="lg:hidden" ref={mobileDetailRef}>
        <MobileEdgeDetail game={selectedGame} market={selectedMarket} marketData={selectedMarketData} />
      </div>

      {/* Edge Board — internal scroll on desktop, natural flow on mobile */}
      <div
        className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto relative"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(167,139,250,0.35) transparent" }}
      >
        <div className="hidden lg:block">
          <DesktopEdgeBoard
            games={GAMES}
            selectedGameIdx={selectedGameIdx}
            selectedMarket={selectedMarket}
            onSelectGame={selectGame}
            onSelectMarket={selectMarket}
          />
        </div>
        <div className="lg:hidden">
          <MobileEdgeBoard
            games={GAMES}
            selectedGameIdx={selectedGameIdx}
            selectedMarket={selectedMarket}
            onSelectGame={selectGame}
            onSelectMarket={selectMarket}
          />
        </div>

        <footer className="text-center pb-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-gray-600 font-medium">
            Design preview · v13.1 · OddSphere Edge Console · Full View / Compact toggle
          </p>
        </footer>

        {/* Subtle bottom fade pinned to the visible scroll edge */}
        <div
          aria-hidden="true"
          className="hidden lg:block lg:sticky lg:bottom-0 lg:left-0 lg:right-0 lg:h-8 lg:-mt-8 lg:pointer-events-none lg:bg-gradient-to-t lg:from-[#0A0A0F] lg:via-[#0A0A0F]/70 lg:to-transparent lg:z-10"
        />
      </div>
    </div>
  );
}
