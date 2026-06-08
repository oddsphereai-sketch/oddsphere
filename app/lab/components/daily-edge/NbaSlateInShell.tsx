"use client";

/**
 * NBA Daily Edge panel — renders inside /lab/daily-edge when
 * ?sport=nba is selected. Uses the same SportRail at the top so the
 * sport tabs feel identical to MLB. Body mirrors MLB visual rhythm.
 *
 * Three markets: Moneyline / Spread / Total (no first_inning for NBA).
 *
 * Public Market Pulse panel is env-aware: when SHARPAPI_KEY is missing
 * in the deployed Vercel Preview env (intentional safety posture), the
 * panel shows a clean "unavailable in this preview environment" state
 * with explanation — never blank, never fake data.
 *
 * v0 active (nbaAutoModelV1). v1 parked as research only. Member-facing
 * UI MUST NOT surface "v1" / "research-prior" / "calibration pending"
 * tokens — none of those appear here.
 */

import { useCallback, useEffect, useState } from "react";
import { SportRail } from "./DailyEdgeShell";
import type {
  NbaDailyEdgeDto,
  NbaDailyEdgeGameDto,
  MarketIntelligence,
} from "@/lib/services/nba/buildNbaDailyEdgeDto";
import type { RecommendationGrade } from "@/lib/services/nba/nbaMarketReview";

// ─── Visual tokens — mirror MLB Daily Edge palette (R-16H locked) ──

const GRADE_LABEL: Record<RecommendationGrade, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watch: "Watchlist",
  caution: "Caution",
  no_market: "No Market",
  held: "Held",
};
const GRADE_GLYPH: Record<RecommendationGrade, string> = {
  best_angle: "★",
  lean: "↗",
  watch: "◐",
  caution: "⚠",
  no_market: "·",
  held: "○",
};
const GRADE_TEXT: Record<RecommendationGrade, string> = {
  best_angle: "text-emerald-300",
  lean: "text-sky-300",
  watch: "text-indigo-300",
  caution: "text-amber-300",
  no_market: "text-gray-400",
  held: "text-gray-500",
};
const GRADE_BAND: Record<RecommendationGrade, string> = {
  best_angle: "from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent border-emerald-500/30",
  lean: "from-sky-500/[0.10] via-sky-500/[0.03] to-transparent border-sky-500/25",
  watch: "from-white/[0.04] via-white/[0.015] to-transparent border-white/[0.08]",
  caution: "from-amber-500/[0.12] via-amber-500/[0.04] to-transparent border-amber-500/30",
  no_market: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
  held: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
};
const GRADE_PILL: Record<RecommendationGrade, string> = {
  best_angle: "bg-emerald-500/[0.12] border-emerald-500/35",
  lean: "bg-sky-500/[0.09] border-sky-500/25",
  watch: "bg-indigo-500/[0.08] border-indigo-500/25",
  caution: "bg-amber-500/[0.10] border-amber-500/30",
  no_market: "bg-gray-900/40 border-gray-700/40",
  held: "bg-gray-900/40 border-gray-700/40",
};
const GRADE_GLOW: Record<RecommendationGrade, string> = {
  best_angle: "drop-shadow-[0_0_6px_rgba(110,231,183,0.55)]",
  lean: "",
  watch: "",
  caution: "drop-shadow-[0_0_5px_rgba(251,191,36,0.50)]",
  no_market: "",
  held: "",
};

// ─── NBA team identity (color + nickname + city) ───────────────────

type TeamIdentity = {
  abbr: string;
  nickname: string;
  city: string;
  color: string;       // primary
  secondary: string;   // accent
};

const NBA_TEAMS: Record<string, TeamIdentity> = {
  ATL: { abbr: "ATL", nickname: "Hawks",        city: "Atlanta",       color: "#E03A3E", secondary: "#C1D32F" },
  BOS: { abbr: "BOS", nickname: "Celtics",      city: "Boston",        color: "#007A33", secondary: "#BA9653" },
  BKN: { abbr: "BKN", nickname: "Nets",         city: "Brooklyn",      color: "#000000", secondary: "#FFFFFF" },
  CHA: { abbr: "CHA", nickname: "Hornets",      city: "Charlotte",     color: "#1D1160", secondary: "#00788C" },
  CHI: { abbr: "CHI", nickname: "Bulls",        city: "Chicago",       color: "#CE1141", secondary: "#000000" },
  CLE: { abbr: "CLE", nickname: "Cavaliers",    city: "Cleveland",     color: "#860038", secondary: "#FDBB30" },
  DAL: { abbr: "DAL", nickname: "Mavericks",    city: "Dallas",        color: "#00538C", secondary: "#002B5E" },
  DEN: { abbr: "DEN", nickname: "Nuggets",      city: "Denver",        color: "#0E2240", secondary: "#FEC524" },
  DET: { abbr: "DET", nickname: "Pistons",      city: "Detroit",       color: "#C8102E", secondary: "#1D42BA" },
  GSW: { abbr: "GSW", nickname: "Warriors",     city: "Golden State",  color: "#1D428A", secondary: "#FFC72C" },
  HOU: { abbr: "HOU", nickname: "Rockets",      city: "Houston",       color: "#CE1141", secondary: "#000000" },
  IND: { abbr: "IND", nickname: "Pacers",       city: "Indiana",       color: "#002D62", secondary: "#FDBB30" },
  LAC: { abbr: "LAC", nickname: "Clippers",     city: "Los Angeles",   color: "#C8102E", secondary: "#1D428A" },
  LAL: { abbr: "LAL", nickname: "Lakers",       city: "Los Angeles",   color: "#552583", secondary: "#FDB927" },
  MEM: { abbr: "MEM", nickname: "Grizzlies",    city: "Memphis",       color: "#5D76A9", secondary: "#12173F" },
  MIA: { abbr: "MIA", nickname: "Heat",         city: "Miami",         color: "#98002E", secondary: "#F9A01B" },
  MIL: { abbr: "MIL", nickname: "Bucks",        city: "Milwaukee",     color: "#00471B", secondary: "#EEE1C6" },
  MIN: { abbr: "MIN", nickname: "Timberwolves", city: "Minnesota",     color: "#0C2340", secondary: "#236192" },
  NOP: { abbr: "NOP", nickname: "Pelicans",     city: "New Orleans",   color: "#0C2340", secondary: "#C8102E" },
  NY:  { abbr: "NY",  nickname: "Knicks",       city: "New York",      color: "#006BB6", secondary: "#F58426" },
  NYK: { abbr: "NYK", nickname: "Knicks",       city: "New York",      color: "#006BB6", secondary: "#F58426" },
  OKC: { abbr: "OKC", nickname: "Thunder",      city: "Oklahoma City", color: "#007AC1", secondary: "#EF3B24" },
  ORL: { abbr: "ORL", nickname: "Magic",        city: "Orlando",       color: "#0077C0", secondary: "#C4CED4" },
  PHI: { abbr: "PHI", nickname: "76ers",        city: "Philadelphia",  color: "#006BB6", secondary: "#ED174C" },
  PHX: { abbr: "PHX", nickname: "Suns",         city: "Phoenix",       color: "#1D1160", secondary: "#E56020" },
  POR: { abbr: "POR", nickname: "Trail Blazers", city: "Portland",     color: "#E03A3E", secondary: "#000000" },
  SAC: { abbr: "SAC", nickname: "Kings",        city: "Sacramento",    color: "#5A2D81", secondary: "#63727A" },
  SA:  { abbr: "SA",  nickname: "Spurs",        city: "San Antonio",   color: "#C4CED4", secondary: "#000000" },
  SAS: { abbr: "SAS", nickname: "Spurs",        city: "San Antonio",   color: "#C4CED4", secondary: "#000000" },
  TOR: { abbr: "TOR", nickname: "Raptors",      city: "Toronto",       color: "#CE1141", secondary: "#000000" },
  UTA: { abbr: "UTA", nickname: "Jazz",         city: "Utah",          color: "#002B5C", secondary: "#00471B" },
  WAS: { abbr: "WAS", nickname: "Wizards",      city: "Washington",    color: "#002B5C", secondary: "#E31837" },
};

function teamIdentity(abbr: string): TeamIdentity {
  return (
    NBA_TEAMS[abbr.toUpperCase()] ?? {
      abbr,
      nickname: abbr,
      city: abbr,
      color: "#4B5563",
      secondary: "#1F2937",
    }
  );
}

// ESPN's public CDN logo URL.
function nbaLogoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;
}

// ─── Formatting helpers ────────────────────────────────────────────

function fmtAmerican(o: number | null): string {
  if (o === null) return "—";
  return o > 0 ? `+${o}` : `${o}`;
}
function fmtProb(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}
function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}
function fmtLine(line: number | null): string {
  if (line === null) return "—";
  return line > 0 ? `+${line}` : `${line}`;
}
function fmtScore(n: number): string {
  return n.toFixed(1);
}
function todayEt(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// ─── Small primitives ──────────────────────────────────────────────

function TeamLogo({ abbr, size = 32 }: { abbr: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden bg-white/[0.04] ring-1 ring-white/[0.06]"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nbaLogoUrl(abbr)}
        alt={abbr}
        width={size}
        height={size}
        className="object-contain"
        onError={(e) => {
          const t = e.target as HTMLImageElement;
          t.style.display = "none";
          t.parentElement!.textContent = abbr;
          t.parentElement!.className += " text-[10px] font-bold text-gray-300";
        }}
      />
    </span>
  );
}

function GradePill({ grade, label }: { grade: RecommendationGrade; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${GRADE_PILL[grade]} ${GRADE_TEXT[grade]}`}
    >
      <span className={GRADE_GLOW[grade]}>{GRADE_GLYPH[grade]}</span>
      {label}
    </span>
  );
}

// ─── Slate card (one per game) ─────────────────────────────────────

function MarketChipInCard({
  marketLabel,
  intel,
  pickAccent,
  selected,
  onClick,
}: {
  marketLabel: string;
  intel: MarketIntelligence;
  /** Hex color of the picked team — used for left-border indicator. */
  pickAccent: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`relative w-full flex items-center justify-between gap-2 pl-3 pr-2 py-1.5 rounded border transition-colors ${GRADE_PILL[intel.grade]} ${selected ? "ring-1 ring-violet-400/55" : ""}`}
      style={pickAccent !== null ? { borderLeft: `3px solid ${pickAccent}` } : undefined}
    >
      <span className="flex items-center gap-1">
        <span className={`text-[10px] uppercase tracking-wider ${GRADE_TEXT[intel.grade]}`}>{marketLabel}</span>
        <span className={GRADE_TEXT[intel.grade]}>{GRADE_GLYPH[intel.grade]}</span>
      </span>
      <span className="text-xs text-gray-200 truncate">{intel.pick_label}</span>
    </button>
  );
}

function SlateCard({
  game,
  active,
  activeMarket,
  onSelectGame,
  onSelectMarket,
}: {
  game: NbaDailyEdgeGameDto;
  active: boolean;
  activeMarket: "ml" | "spread" | "total" | null;
  onSelectGame: () => void;
  onSelectMarket: (m: "ml" | "spread" | "total") => void;
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  const away = teamIdentity(game.away_abbr);
  const home = teamIdentity(game.home_abbr);

  const pickColor = (side: "home" | "away" | "over" | "under" | null) => {
    if (side === "home") return home.color;
    if (side === "away") return away.color;
    return null;
  };

  return (
    <button
      type="button"
      onClick={onSelectGame}
      className={`w-full text-left rounded-xl border bg-[#0D0D14] transition-colors p-3 space-y-2.5 ${
        active
          ? "border-violet-400/60 shadow-[0_0_0_2px_rgba(167,139,250,0.18)]"
          : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      {/* Team-color top strip — split 50/50 */}
      <div className="h-1.5 rounded-full overflow-hidden flex">
        <div style={{ background: away.color, flex: 1 }} />
        <div style={{ background: home.color, flex: 1 }} />
      </div>
      {/* Header row — Away (logo + ABBR + nickname) @ Home */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo abbr={game.away_abbr} size={28} />
          <div className="leading-tight">
            <div className="text-xs font-bold text-gray-100" style={{ color: away.color }}>{away.abbr}</div>
            <div className="text-[9px] uppercase tracking-wider text-gray-500">{away.nickname}</div>
          </div>
          <span className="text-gray-600 text-sm mx-1">@</span>
          <TeamLogo abbr={game.home_abbr} size={28} />
          <div className="leading-tight">
            <div className="text-xs font-bold" style={{ color: home.color }}>{home.abbr}</div>
            <div className="text-[9px] uppercase tracking-wider text-gray-500">{home.nickname}</div>
          </div>
        </div>
        <GradePill grade={topGrade} label={GRADE_LABEL[topGrade]} />
      </div>
      <div className="text-[11px] text-gray-500">
        {game.tip_display_et ?? "tip tbd"} · {game.series.text}
      </div>
      <div className="grid grid-cols-1 gap-1 pt-1">
        <MarketChipInCard
          marketLabel="ML"
          intel={intel.ml}
          pickAccent={pickColor(intel.ml.pick_side)}
          selected={active && activeMarket === "ml"}
          onClick={() => onSelectMarket("ml")}
        />
        <MarketChipInCard
          marketLabel="Spread"
          intel={intel.spread}
          pickAccent={pickColor(intel.spread.pick_side)}
          selected={active && activeMarket === "spread"}
          onClick={() => onSelectMarket("spread")}
        />
        <MarketChipInCard
          marketLabel="Total"
          intel={intel.total}
          pickAccent={null}
          selected={active && activeMarket === "total"}
          onClick={() => onSelectMarket("total")}
        />
      </div>
    </button>
  );
}

// ─── Reader sections ───────────────────────────────────────────────

function ReaderMatchupHeader({
  game,
  topGrade,
}: {
  game: NbaDailyEdgeGameDto;
  topGrade: RecommendationGrade;
}) {
  const away = teamIdentity(game.away_abbr);
  const home = teamIdentity(game.home_abbr);
  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-widest text-gray-400">{game.series.text}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5">
        {/* Away team block */}
        <div
          className="flex items-center gap-3 sm:gap-4 rounded-xl border bg-white/[0.02] p-3 sm:p-4"
          style={{ borderColor: `${away.color}55`, boxShadow: `inset 4px 0 0 0 ${away.color}` }}
        >
          <TeamLogo abbr={game.away_abbr} size={54} />
          <div className="leading-tight min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Away</div>
            <div className="text-2xl font-bold truncate" style={{ color: away.color }}>{away.abbr}</div>
            <div className="text-[11px] text-gray-400 truncate">{away.city} {away.nickname}</div>
          </div>
        </div>
        {/* Center separator + top read */}
        <div className="text-center px-1">
          <div className="text-gray-600 text-xl mb-1">@</div>
          <div className={`text-[11px] uppercase tracking-wider ${GRADE_TEXT[topGrade]} ${GRADE_GLOW[topGrade]}`}>
            {GRADE_GLYPH[topGrade]} {GRADE_LABEL[topGrade]}
          </div>
          <div className="text-[9px] text-gray-500 uppercase mt-0.5">top read</div>
        </div>
        {/* Home team block */}
        <div
          className="flex items-center gap-3 sm:gap-4 rounded-xl border bg-white/[0.02] p-3 sm:p-4"
          style={{ borderColor: `${home.color}55`, boxShadow: `inset -4px 0 0 0 ${home.color}` }}
        >
          <div className="leading-tight min-w-0 text-right ml-auto sm:ml-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Home</div>
            <div className="text-2xl font-bold truncate" style={{ color: home.color }}>{home.abbr}</div>
            <div className="text-[11px] text-gray-400 truncate">{home.city} {home.nickname}</div>
          </div>
          <TeamLogo abbr={game.home_abbr} size={54} />
        </div>
      </div>
      <div className="text-xs text-gray-400">{game.tip_display_et ?? "tip tbd"}</div>
    </div>
  );
}

function ProjectionStrip({ game }: { game: NbaDailyEdgeGameDto }) {
  const intel = game.intelligence;
  const away = teamIdentity(game.away_abbr);
  const home = teamIdentity(game.home_abbr);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Away projected score */}
      <div
        className="rounded-xl border bg-white/[0.02] p-3"
        style={{ borderColor: `${away.color}40`, boxShadow: `inset 3px 0 0 0 ${away.color}` }}
      >
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
          <span className="text-gray-500">Away ·</span>
          <span style={{ color: away.color }}>{away.abbr}</span>
        </div>
        <div className="text-2xl font-bold font-mono mt-0.5" style={{ color: away.color }}>
          {fmtScore(game.projection.away_score)}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">{away.nickname}</div>
      </div>
      {/* Home projected score */}
      <div
        className="rounded-xl border bg-white/[0.02] p-3"
        style={{ borderColor: `${home.color}40`, boxShadow: `inset 3px 0 0 0 ${home.color}` }}
      >
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
          <span className="text-gray-500">Home ·</span>
          <span style={{ color: home.color }}>{home.abbr}</span>
        </div>
        <div className="text-2xl font-bold font-mono mt-0.5" style={{ color: home.color }}>
          {fmtScore(game.projection.home_score)}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">{home.nickname}</div>
      </div>
      {/* Projected total */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Total</div>
        <div className="text-2xl font-bold font-mono text-gray-100 mt-0.5">
          {fmtScore(game.projection.total)}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">market {intel.total.consensus_line ?? "—"}</div>
      </div>
      {/* Projected spread */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Spread (home)</div>
        <div className="text-2xl font-bold font-mono text-gray-100 mt-0.5">
          {game.projection.spread_home > 0 ? "+" : ""}{fmtScore(game.projection.spread_home)}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">market {intel.spread.consensus_line ?? "—"}</div>
      </div>
    </div>
  );
}

function QuickReadPanel({ game }: { game: NbaDailyEdgeGameDto }) {
  // The server-generated quick_read already names the top pick + grade.
  // We frame it with an explicit "Model lean:" prefix so reviewers see
  // the headline immediately.
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Quick Read</div>
      <div className="text-sm text-gray-100">{game.quick_read}</div>
    </div>
  );
}

function MarketPanel({
  market,
  intel,
  game,
}: {
  market: "ml" | "spread" | "total";
  intel: MarketIntelligence;
  game: NbaDailyEdgeGameDto;
}) {
  const grade = intel.grade;
  const longLabel = market === "ml" ? "Moneyline" : market === "spread" ? "Spread" : "Total";
  const pickIsHome = intel.pick_side === "home";
  const pickIsAway = intel.pick_side === "away";
  const pickTeam =
    pickIsHome
      ? teamIdentity(game.home_abbr)
      : pickIsAway
        ? teamIdentity(game.away_abbr)
        : null;
  const accentColor = pickTeam?.color ?? null;
  return (
    <div
      className={`rounded-xl border bg-gradient-to-b ${GRADE_BAND[grade]} p-4 space-y-3`}
      style={accentColor !== null ? { borderColor: `${accentColor}50` } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-400">{longLabel}</div>
          <div
            className={`text-2xl font-semibold mt-0.5 ${GRADE_TEXT[grade]} ${GRADE_GLOW[grade]}`}
            style={accentColor !== null ? { color: accentColor } : undefined}
          >
            {intel.pick_label}
          </div>
          {pickTeam !== null && (
            <div className="text-[11px] text-gray-400 mt-0.5">
              Model lean: <span className="font-semibold" style={{ color: accentColor ?? undefined }}>{pickTeam.city} {pickTeam.nickname}</span>
            </div>
          )}
        </div>
        <div className="text-right">
          <GradePill grade={grade} label={GRADE_LABEL[grade]} />
          <div className="text-[10px] text-gray-500 mt-1">
            eff conf {intel.effective_confidence.toFixed(0)} / model {intel.model_confidence.toFixed(0)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Line</div>
          <div className="text-sm font-mono text-gray-200">
            {market === "ml" ? "—" : fmtLine(intel.consensus_line)}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Best Price</div>
          <div className="text-sm font-mono text-gray-200">{fmtAmerican(intel.current_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.current_price.sportsbook ?? "—"}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Other Side</div>
          <div className="text-sm font-mono text-gray-300">{fmtAmerican(intel.other_side_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.other_side_price.sportsbook ?? "—"}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300 uppercase tracking-wider">
          {intel.conflict_band.replace("_", " ")}
        </span>
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300">
          no-vig {fmtProb(intel.market_no_vig_prob_pick)}
        </span>
        {intel.opp_ev_percentage_pick !== null && (
          <span
            className={`px-2 py-0.5 rounded border uppercase tracking-wider ${
              intel.opp_ev_percentage_pick > 0
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-gray-800/40 border-gray-700/40 text-gray-400"
            }`}
          >
            EV {intel.opp_ev_percentage_pick > 0 ? "+" : ""}{intel.opp_ev_percentage_pick.toFixed(2)}%
          </span>
        )}
        {intel.opp_possibly_stale && (
          <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-300">
            possibly stale
          </span>
        )}
      </div>
      {intel.rationale.length > 0 && (
        <div className="border-t border-gray-800/40 pt-2 text-[11px] text-gray-400 space-y-1">
          {intel.rationale.map((r, i) => <div key={i}>· {r}</div>)}
        </div>
      )}
      <div className="text-[10px] text-gray-500 italic border-t border-gray-800/40 pt-2">
        {intel.movement_note}
      </div>
    </div>
  );
}

// ─── Public Market Pulse (env-aware) ───────────────────────────────

/**
 * Two-bar visualization for a single market's bets% vs handle% on the
 * model-picked side. Side-by-side comparison + "money supports pick"
 * vs "money opposes pick" wording.
 */
function PulseMarketRow({
  market,
  intel,
  game,
}: {
  market: "ml" | "spread" | "total";
  intel: MarketIntelligence;
  game: NbaDailyEdgeGameDto;
}) {
  const pick = intel.splits.pick_side;
  const other = intel.splits.other_side;
  if (pick === null && other === null) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-400">
          {market === "ml" ? "Moneyline" : market === "spread" ? "Spread" : "Total"}
        </div>
        <div className="text-[10.5px] text-gray-500 italic">
          No splits posted for this market.
        </div>
      </div>
    );
  }

  // Side labels: ML/spread use team names; total uses Over/Under.
  const pickIsHome = intel.pick_side === "home";
  const pickIsAway = intel.pick_side === "away";
  const home = teamIdentity(game.home_abbr);
  const away = teamIdentity(game.away_abbr);
  const pickLabel =
    market === "total"
      ? intel.pick_side === "over" ? "Over" : "Under"
      : pickIsHome ? home.abbr : pickIsAway ? away.abbr : "Pick";
  const otherLabel =
    market === "total"
      ? intel.pick_side === "over" ? "Under" : "Over"
      : pickIsHome ? away.abbr : pickIsAway ? home.abbr : "Other";
  const pickColor =
    pickIsHome ? home.color : pickIsAway ? away.color : "#7C3AED"; // violet for over/under

  // Sharp/square wording based on divergence on the model-picked side.
  const handle = pick?.handle_pct ?? null;
  const bets = pick?.bets_pct ?? null;
  let supportLabel = "balanced";
  let supportColor = "text-gray-400 border-gray-700/40 bg-gray-800/40";
  if (handle !== null && bets !== null) {
    const delta = (handle - bets) * 100;
    if (delta >= 10) { supportLabel = "money supports our pick"; supportColor = "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"; }
    else if (delta >= 5) { supportLabel = "money leans our pick"; supportColor = "text-emerald-300/80 border-emerald-500/25 bg-emerald-500/8"; }
    else if (delta <= -10) { supportLabel = "money opposes our pick"; supportColor = "text-amber-300 border-amber-500/30 bg-amber-500/10"; }
    else if (delta <= -5) { supportLabel = "money leans other side"; supportColor = "text-amber-300/80 border-amber-500/25 bg-amber-500/8"; }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
        <span className="text-gray-300">
          {market === "ml" ? "Moneyline" : market === "spread" ? "Spread" : "Total"}
          <span className="text-gray-600 mx-1">·</span>
          <span style={{ color: pickColor }}>pick {pickLabel}</span>
          <span className="text-gray-600 mx-1">vs</span>
          <span className="text-gray-400">{otherLabel}</span>
        </span>
        <span className={`px-1.5 py-0.5 rounded border text-[9.5px] uppercase tracking-wider ${supportColor}`}>
          {supportLabel}
        </span>
      </div>
      {/* Bets % bar */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[9.5px] text-gray-500">
          <span>Bets %</span>
          <span className="font-mono">{fmtPct(pick?.bets_pct ?? null)} / {fmtPct(other?.bets_pct ?? null)}</span>
        </div>
        <div className="flex w-full h-1.5 bg-gray-900/60 rounded overflow-hidden">
          <div style={{ background: `${pickColor}80`, width: `${(pick?.bets_pct ?? 0) * 100}%` }} />
          <div className="bg-gray-600/50" style={{ width: `${(other?.bets_pct ?? 0) * 100}%` }} />
        </div>
      </div>
      {/* Handle % bar */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[9.5px] text-gray-500">
          <span>Money %</span>
          <span className="font-mono">{fmtPct(pick?.handle_pct ?? null)} / {fmtPct(other?.handle_pct ?? null)}</span>
        </div>
        <div className="flex w-full h-1.5 bg-gray-900/60 rounded overflow-hidden">
          <div style={{ background: pickColor, width: `${(pick?.handle_pct ?? 0) * 100}%` }} />
          <div className="bg-gray-500/70" style={{ width: `${(other?.handle_pct ?? 0) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function PublicMarketPulse({
  game,
  capability,
}: {
  game: NbaDailyEdgeGameDto;
  capability: "available" | "unavailable_no_api_key";
}) {
  const intel = game.intelligence;

  // Env-unavailable: clean explained panel — never blank, never fake.
  if (capability === "unavailable_no_api_key") {
    return (
      <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-300">
            Public Market Pulse
          </div>
          <span className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[9.5px] uppercase tracking-wider text-amber-300">
            unavailable
          </span>
        </div>
        <div className="text-[12px] text-gray-300">
          Public market data is unavailable in this preview environment.
        </div>
        <div className="text-[11px] text-gray-500 leading-relaxed">
          Current odds + best price are still available (above), but splits, money/bets %,
          and EV/no-vig opportunities require SharpAPI access. The Vercel Preview
          environment intentionally does not have <code className="text-gray-400">SHARPAPI_KEY</code> set —
          full market data renders only on local dev or production.
        </div>
        <div className="text-[10px] text-gray-600 italic border-t border-gray-800/40 pt-2 mt-1">
          Limited-book + no-opener honest labels remain visible in each market panel.
        </div>
      </div>
    );
  }

  // Available capability but per-matchup no splits row.
  if (!intel.sources.has_splits) {
    return (
      <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-300">
          Public Market Pulse
        </div>
        <div className="text-[12px] text-gray-400 italic">
          SharpAPI returned no consensus splits row for this matchup yet. Will populate
          as the book closes lines and the splits feed catches up.
        </div>
      </div>
    );
  }

  // Available + has splits.
  return (
    <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-300">
          Public Market Pulse
        </div>
        <span className="px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[9.5px] uppercase tracking-wider text-emerald-300">
          SharpAPI · consensus
        </span>
      </div>
      <PulseMarketRow market="ml" intel={intel.ml} game={game} />
      <PulseMarketRow market="spread" intel={intel.spread} game={game} />
      <PulseMarketRow market="total" intel={intel.total} game={game} />
      <div className="text-[10px] text-gray-600 border-t border-gray-800/40 pt-2">
        NBA posture: do not auto-follow handle. Do not auto-fade public. Splits are a
        context signal, not a trigger.
      </div>
    </div>
  );
}

function SelectedEdgeReader({
  game,
  selectedMarket,
  onMarketChange,
  capability,
}: {
  game: NbaDailyEdgeGameDto;
  selectedMarket: "ml" | "spread" | "total";
  onMarketChange: (m: "ml" | "spread" | "total") => void;
  capability: "available" | "unavailable_no_api_key";
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  return (
    <div className={`rounded-2xl border bg-[#0D0D14] bg-gradient-to-b ${GRADE_BAND[topGrade]} p-5 space-y-5`}>
      <ReaderMatchupHeader game={game} topGrade={topGrade} />
      <QuickReadPanel game={game} />
      <ProjectionStrip game={game} />

      {/* Tier + data-quality strip */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300 uppercase tracking-wider">
          tier {game.data_quality_tier}
        </span>
        {intel.sources.limited_book_coverage && (
          <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-300">
            ⚠ limited book coverage ({intel.sources.book_count} {intel.sources.book_count === 1 ? "book" : "books"})
          </span>
        )}
        {game.provenance.series_priors_found && (
          <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-400 uppercase tracking-wider">
            series context
          </span>
        )}
        {game.provenance.injuries_source === "espn" && (
          <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-400 uppercase tracking-wider">
            espn injuries
          </span>
        )}
      </div>

      {/* Market selector tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(["ml", "spread", "total"] as const).map((m) => {
          const i = m === "ml" ? intel.ml : m === "spread" ? intel.spread : intel.total;
          const label = m === "ml" ? "Moneyline" : m === "spread" ? "Spread" : "Total";
          return (
            <button
              key={m}
              type="button"
              onClick={() => onMarketChange(m)}
              className={`px-3 py-1.5 rounded border text-xs ${
                selectedMarket === m
                  ? "border-violet-400/60 bg-violet-500/15 text-violet-100"
                  : `${GRADE_PILL[i.grade]} ${GRADE_TEXT[i.grade]}`
              }`}
            >
              <span>{label}</span>
              <span className="ml-1.5 opacity-75">{i.pick_label}</span>
            </button>
          );
        })}
      </div>

      {/* Selected market detail */}
      <MarketPanel
        market={selectedMarket}
        intel={selectedMarket === "ml" ? intel.ml : selectedMarket === "spread" ? intel.spread : intel.total}
        game={game}
      />

      {/* Public Market Pulse (env-aware) */}
      <PublicMarketPulse game={game} capability={capability} />

      {/* Source badges */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <SourceChip label={`ESPN schedule`} on={true} />
        <SourceChip label={`BBR ratings`} on={game.provenance.home_ratings.populated && game.provenance.away_ratings.populated} />
        <SourceChip label={`Lines (${intel.sources.book_count} ${intel.sources.book_count === 1 ? "book" : "books"})`} on={intel.sources.has_lines} />
        <SourceChip
          label="SharpAPI splits"
          on={capability === "available" && intel.sources.has_splits}
          dimmed={capability !== "available"}
        />
        <SourceChip
          label="SharpAPI EV"
          on={capability === "available" && intel.sources.has_opportunities}
          dimmed={capability !== "available"}
        />
        <SourceChip label="Injuries (ESPN)" on={game.provenance.injuries_source === "espn"} />
        <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/35 text-amber-300 uppercase tracking-wider">
          internal preview
        </span>
      </div>
    </div>
  );
}

function SourceChip({ label, on, dimmed }: { label: string; on: boolean; dimmed?: boolean }) {
  if (dimmed === true) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium uppercase tracking-wider bg-gray-800/40 border-gray-700/40 text-gray-500"
        title="Unavailable in this preview environment"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
        {label} · env
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium uppercase tracking-wider ${
        on
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-gray-800/40 border-gray-700/40 text-gray-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-gray-500"}`} />
      {label}
    </span>
  );
}

// ─── Top-level NBA shell ──────────────────────────────────────────

export default function NbaSlateInShell() {
  const [date, setDate] = useState<string>(todayEt());
  const [dto, setDto] = useState<NbaDailyEdgeDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [adminToken, setAdminToken] = useState<string>("");
  const [selectedMarket, setSelectedMarket] = useState<"ml" | "spread" | "total">("ml");

  const isHostedPreview =
    typeof window !== "undefined" && window.location.hostname.endsWith(".vercel.app");

  const fetchDto = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (adminEmail !== "" && adminToken !== "") {
        headers["x-admin-email"] = adminEmail;
        headers["x-admin-token"] = adminToken;
      }
      const res = await fetch(`/api/admin/nba-preview?date=${date}`, { headers });
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        setDto(null);
        return;
      }
      const json = (await res.json()) as NbaDailyEdgeDto;
      setDto(json);
    } catch (e) {
      setError((e as Error).message);
      setDto(null);
    } finally {
      setLoading(false);
    }
  }, [date, adminEmail, adminToken]);

  useEffect(() => {
    if (isHostedPreview) {
      void fetchDto();
    }
  }, [isHostedPreview, fetchDto]);

  const game = dto?.games[0] ?? null;
  const capability = dto?.market_signals_capability ?? "available";

  return (
    <div className="bg-[#0A0A0F] text-gray-200 min-h-screen">
      <SportRail sport="nba" />

      {/* Slate control strip — matches MLB's layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="uppercase tracking-widest text-gray-500">Slate ·</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-100"
          />
          <span className="text-gray-500">·</span>
          <span>{dto?.games.length ?? 0} {(dto?.games.length ?? 0) === 1 ? "game" : "games"}</span>
          <button
            type="button"
            onClick={() => void fetchDto()}
            className="ml-2 px-2.5 py-1 rounded bg-violet-500/15 border border-violet-400/30 text-[11px] text-violet-200 hover:bg-violet-500/25"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {!isHostedPreview && (
          <div className="flex items-center gap-1.5">
            <input
              type="email"
              placeholder="admin email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
            <input
              type="password"
              placeholder="admin token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
          </div>
        )}
      </div>

      {/* Internal preview notice */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-amber-200">
          NBA · internal preview · provisional · not member-facing
          {capability === "unavailable_no_api_key" && (
            <span className="ml-2 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-200 normal-case">
              public market data unavailable in preview env
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-3 pb-10">
        {error !== null && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            ✗ {error}
          </div>
        )}
        {dto === null ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-gray-500">
            {loading ? "Loading NBA slate…" : "Enter admin credentials and click Refresh."}
          </div>
        ) : game === null ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-gray-500">
            No NBA games on this slate.
          </div>
        ) : (
          <>
            {/* Selected Edge Reader — top, non-sticky (matches MLB layout) */}
            <div className="mb-6">
              <SelectedEdgeReader
                game={game}
                selectedMarket={selectedMarket}
                onMarketChange={setSelectedMarket}
                capability={capability}
              />
            </div>

            {/* Slate Board header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">
                Slate · {dto.slate_date_et} ET
              </div>
              <div className="text-[10px] text-gray-500">
                {dto.games.length} {dto.games.length === 1 ? "game" : "games"}
              </div>
            </div>

            {/* Slate grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dto.games.map((g) => (
                <SlateCard
                  key={g.game_external_id}
                  game={g}
                  active={g.game_external_id === game.game_external_id}
                  activeMarket={g.game_external_id === game.game_external_id ? selectedMarket : null}
                  onSelectGame={() => { /* single-card slate tonight; no-op selection */ }}
                  onSelectMarket={(m) => setSelectedMarket(m)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="text-center pb-10">
        <p className="text-[11px] uppercase tracking-[0.16em] text-gray-600 font-medium">
          OddSphere · Daily Edge · NBA · Preview
        </p>
      </footer>
    </div>
  );
}
