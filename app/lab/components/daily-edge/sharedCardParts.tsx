/**
 * Phase 4.1.8.C-final (B+C Hybrid) — sharedCardParts.
 *
 * Subcomponents used by Daily Edge card variants. Reworked from the
 * prior implementation:
 *   • MatchupHeader supports a "featured" mode (48px logos, team
 *     name + projected score block) and a "compact" mode (28px logos +
 *     inline matchup).
 *   • TeamColorAccent renders the 3px team-color gradient strip used
 *     at the top of Featured cards.
 *   • SecondaryAnglesChips and ProjectedFinalCompact removed —
 *     "Other markets" inline text + footer projected row are now baked
 *     into each variant directly.
 *   • Kept: buildMarketChip, countPickGrades, PickTilesRow (for
 *     Watchlist expand), FullBreakdownExpandable, NoPlayStrip.
 *   • Removed dependency on VerdictPill — verdict expresses through
 *     eyebrow text color.
 */

"use client";

import type {
  DailyEdgeGameDto,
  SharpSignalDto,
  SharpStatus,
} from "../../lib/labTypes";
import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";
import {
  headlinePrimaryMarket,
  type HeadlineMarket,
} from "../../lib/perPickHeadline";
import type { ComposedTakeaway } from "../../lib/composeTakeaway";
import Icon, { type IconName } from "../Icon";
import GradeBadge from "@/app/components/GradeBadge";
import { teamPrimaryColor } from "./teamColors";

// ═══════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════

export function buildMarketChip(game: DailyEdgeGameDto): string | null {
  if (game.breakdown.verdict.key === "no_play") return null;
  const market = headlinePrimaryMarket(game);
  if (market === null) return null;
  if (market === "moneyline") {
    const pick = game.predictions.ml.pick;
    if (!pick || pick === "—") return null;
    return `Moneyline · ${pick}`;
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (!t.pick) return null;
    return t.line !== null
      ? `Total · ${t.pick} ${t.line}`
      : `Total · ${t.pick}`;
  }
  const nrfiPick = game.predictions.nrfi.pick;
  if (!nrfiPick || nrfiPick === "—") return null;
  return `1st Inning · ${nrfiPick}`;
}

export function countPickGrades(game: DailyEdgeGameDto): {
  confirmedCount: number;
  cautionCount: number;
} {
  const grades: Grade[] = [];
  if (game.predictions.ml.grade !== null) grades.push(game.predictions.ml.grade);
  if (game.predictions.total.grade !== null) grades.push(game.predictions.total.grade);
  if (game.predictions.nrfi.grade !== null) grades.push(game.predictions.nrfi.grade);
  const confirmedCount = grades.filter(
    (g) => g === "best_signal" || g === "sharp_confirmed" || g === "market_led"
  ).length;
  const cautionCount = grades.filter((g) => g === "sharp_conflict").length;
  return { confirmedCount, cautionCount };
}

/**
 * Hero pick string for Featured cards. "PHI MONEYLINE" / "OVER 8.5" /
 * "NRFI". Returns null when no headline can be resolved.
 */
export function heroPickString(game: DailyEdgeGameDto): string | null {
  const market = headlinePrimaryMarket(game);
  if (market === null) return null;
  if (market === "moneyline") {
    const pick = game.predictions.ml.pick;
    if (!pick || pick === "—") return null;
    return `${pick} MONEYLINE`;
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (!t.pick) return null;
    return t.line !== null
      ? `${t.pick.toUpperCase()} ${t.line}`
      : t.pick.toUpperCase();
  }
  const nrfiPick = game.predictions.nrfi.pick;
  if (!nrfiPick || nrfiPick === "—") return null;
  return nrfiPick;
}

/** Confidence value for the headline market. */
export function headlineConfidence(game: DailyEdgeGameDto): number | null {
  const market = headlinePrimaryMarket(game);
  if (market === "moneyline") return game.predictions.ml.confidence;
  if (market === "total") return game.predictions.total.confidence;
  if (market === "first_inning_total") return game.predictions.nrfi.confidence;
  return null;
}

/**
 * Build the "Other markets:" inline label list shown at the bottom of
 * Featured cards. Returns the two non-headline picks formatted compactly,
 * or null when none exist.
 */
export function otherMarketsLabels(game: DailyEdgeGameDto): string[] {
  const headline = headlinePrimaryMarket(game);
  const out: string[] = [];
  if (headline !== "moneyline" && game.predictions.ml.pick && game.predictions.ml.pick !== "—") {
    out.push(`${game.predictions.ml.pick} ML`);
  }
  if (headline !== "total" && game.predictions.total.pick !== null && game.predictions.total.pick !== "—") {
    const t = game.predictions.total;
    const pick = t.pick as string;  // narrowed by the guard above
    out.push(t.line !== null ? `${pick} ${t.line}` : pick);
  }
  if (
    headline !== "first_inning_total" &&
    game.predictions.nrfi.pick &&
    game.predictions.nrfi.pick !== "—"
  ) {
    out.push(game.predictions.nrfi.pick);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// TeamColorAccent — 3px top-edge gradient
// ═══════════════════════════════════════════════════════════════════

/**
 * Renders a 3px gradient strip across the top of a Featured card. Away
 * team color flows in from the left, home team color flows in from the
 * right, with a soft transparent center to keep the line restrained.
 *
 * Inline `style` is used because Tailwind doesn't ship dynamic gradient
 * stops driven by per-render hex values. Restrained per Sub-D1 — no
 * fantasy-football-style full color washes.
 */
export function TeamColorAccent({
  awayTeam,
  homeTeam,
}: {
  awayTeam: string;
  homeTeam: string;
}) {
  const awayColor = teamPrimaryColor(awayTeam);
  const homeColor = teamPrimaryColor(homeTeam);
  const gradient = `linear-gradient(to right, ${awayColor} 0%, ${awayColor} 38%, transparent 48%, transparent 52%, ${homeColor} 62%, ${homeColor} 100%)`;
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 right-0 top-0 h-[3px] rounded-t-2xl"
      style={{ background: gradient }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// CardEyebrow — verdict label + time
// ═══════════════════════════════════════════════════════════════════

const VERDICT_GLYPH: Record<Verdict, string> = {
  best_angle: "★",
  lean: "↗",
  watchlist: "·",
  caution: "⚠",
  no_play: "○",
};

const VERDICT_EYEBROW_COLOR: Record<Verdict, string> = {
  best_angle: "text-emerald-300",
  // R-16H: Lean keeps sky here (already matched the shell palette);
  // Watchlist moved from gray-500 → indigo-300 so the card eyebrows
  // stay consistent with the shell's swapped palette.
  lean: "text-sky-300",
  watchlist: "text-indigo-300",
  caution: "text-amber-300",
  no_play: "text-gray-500",
};

const VERDICT_EYEBROW_LABEL: Record<Verdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

export function CardEyebrow({
  verdictKey,
  gameTime,
  compact = false,
}: {
  verdictKey: Verdict;
  gameTime: string;
  compact?: boolean;
}) {
  const color = VERDICT_EYEBROW_COLOR[verdictKey];
  return (
    <div
      className={`flex items-center justify-between gap-2 ${
        compact ? "mb-2" : "mb-5"
      }`}
    >
      <span
        className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] font-semibold ${color}`}
      >
        <span aria-hidden="true">{VERDICT_GLYPH[verdictKey]}</span>
        {VERDICT_EYEBROW_LABEL[verdictKey]}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-gray-400 tracking-tight whitespace-nowrap tabular-nums">
        <Icon name="clock" className="w-3 h-3" />
        {gameTime}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FeaturedMatchupHeader — 48px logos + team names + projected scores
// ═══════════════════════════════════════════════════════════════════

/**
 * Featured-card matchup anchor. Each side has a 48px logo, the full
 * team abbreviation, and the projected score stacked vertically. The
 * "vs" divider sits between the two sides.
 *
 * Identity-led per Sub-D5 — the logos are the visual anchor. The
 * projected score reads as supporting context, not the hero.
 */
export function FeaturedMatchupHeader({
  awayTeam,
  awayTeamLogo,
  awayProjected,
  homeTeam,
  homeTeamLogo,
  homeProjected,
}: {
  awayTeam: string;
  awayTeamLogo: string | null;
  awayProjected: number;
  homeTeam: string;
  homeTeamLogo: string | null;
  homeProjected: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <FeaturedTeamSide
        team={awayTeam}
        logo={awayTeamLogo}
        projected={awayProjected}
        align="left"
      />
      <span className="text-[10px] uppercase tracking-[0.18em] font-medium text-gray-600">
        vs
      </span>
      <FeaturedTeamSide
        team={homeTeam}
        logo={homeTeamLogo}
        projected={homeProjected}
        align="right"
      />
    </div>
  );
}

/**
 * R-16H: per-team CSS filter overrides for logos that read too dark or
 * low-contrast against the dark UI background. Mirrors the same map in
 * DailyEdgeShell.tsx — keep both in sync if teams are added/removed.
 * SD (Padres) — primary mark is brown-on-brown; brightness lift +
 * slight desaturation makes it legible without skewing orange.
 */
const LOGO_FILTER: Record<string, string> = {
  SD: "brightness(1.45) saturate(0.95)",
};

function FeaturedTeamSide({
  team,
  logo,
  projected,
  align,
}: {
  team: string;
  logo: string | null;
  projected: number;
  align: "left" | "right";
}) {
  const alignClass =
    align === "left" ? "items-start text-left" : "items-end text-right";
  const filter = LOGO_FILTER[team];
  return (
    <div className={`flex-1 flex flex-col ${alignClass} gap-1 min-w-0`}>
      <div
        className={`flex items-center gap-2.5 ${
          align === "right" ? "flex-row-reverse" : "flex-row"
        }`}
      >
        {logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="w-12 h-12 rounded-sm object-contain shrink-0"
            style={filter !== undefined ? { filter } : undefined}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="text-[16px] sm:text-[18px] font-semibold tracking-tight text-white truncate">
          {team}
        </span>
      </div>
      <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
        Projected
      </span>
      <span className="text-[22px] sm:text-[24px] font-bold tabular-nums tracking-tight text-gray-300 leading-none">
        {projected.toFixed(1)}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CompactMatchupHeader — for Watchlist cards (28px logos, inline)
// ═══════════════════════════════════════════════════════════════════

export function CompactMatchupHeader({
  awayTeam,
  awayTeamLogo,
  homeTeam,
  homeTeamLogo,
}: {
  awayTeam: string;
  awayTeamLogo: string | null;
  homeTeam: string;
  homeTeamLogo: string | null;
}) {
  return (
    <h3 className="inline-flex items-center gap-2">
      <CompactTeamBadge logo={awayTeamLogo} abbreviation={awayTeam} />
      <span className="text-gray-500 text-sm">@</span>
      <CompactTeamBadge logo={homeTeamLogo} abbreviation={homeTeam} />
    </h3>
  );
}

function CompactTeamBadge({
  logo,
  abbreviation,
}: {
  logo: string | null;
  abbreviation: string;
}) {
  if (!logo) {
    return (
      <span className="text-[15px] font-semibold tracking-tight text-gray-200">
        {abbreviation}
      </span>
    );
  }
  const filter = LOGO_FILTER[abbreviation];
  return (
    <span className="inline-flex items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="w-7 h-7 rounded-sm object-contain"
        style={filter !== undefined ? { filter } : undefined}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="text-[15px] font-semibold tracking-tight text-gray-200">
        {abbreviation}
      </span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PickTilesRow — used inside Watchlist expand
// ═══════════════════════════════════════════════════════════════════

const TILE_TAG: Record<SharpStatus, { text: string; color: string }> = {
  confirm: { text: "Confirmed", color: "text-emerald-400" },
  mixed: { text: "Mixed", color: "text-gray-500" },
  caution: { text: "Against", color: "text-amber-400" },
};

function SharpStatusIcon({ status }: { status: SharpStatus }) {
  if (status === "confirm") {
    return (
      <Icon
        name="check"
        className="w-[13px] h-[13px] text-emerald-400"
        strokeWidth={2.5}
      />
    );
  }
  if (status === "caution") {
    return <Icon name="alert-triangle" className="w-[13px] h-[13px] text-amber-400" />;
  }
  return <Icon name="minus" className="w-[13px] h-[13px] text-gray-400" />;
}

function getTileBorder(status: SharpStatus): string {
  if (status === "confirm") return "border-emerald-500/30";
  if (status === "caution") return "border-amber-500/30";
  return "border-gray-800";
}

// Phase 4.2.C.2 — accept null pick for held FI markets. Held returns the
// neutral gray treatment; PredictionTile's isNoPick check overrides the
// pick display to "—" anyway, but the prop type must allow null.
//
// R-16H: explicit "Toss-Up" case so a model-emitted Toss-Up pick reads
// visually distinct from a held/null pick (both used to share the same
// gray treatment, making toss-ups look like "no data"). Toss-Up gets
// a slightly brighter neutral with no glow — clearly "the model called
// it neutral" rather than "no call was made."
function getNrfiPickColor(pick: string | null): string {
  if (pick === "NRFI") return "text-emerald-400";
  if (pick === "YRFI") return "text-violet-400";
  if (pick === "Toss-Up") return "text-slate-300";
  return "text-gray-200";
}

function getNrfiPickGlow(pick: string | null): string {
  if (pick === "NRFI") return "drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]";
  if (pick === "YRFI") return "drop-shadow-[0_0_8px_rgba(167,139,250,0.45)]";
  // Toss-Up intentionally has no glow — it's a "neutral call", not a
  // confident one. Glow is reserved for directional picks.
  return "";
}

// Phase 4.2.C.2 — accept null pick. PredictionTile's isNoPick check
// renders "—" instead of this formatted output for held markets, but the
// signature must permit null. Null pick returns "—" defensively in case
// a caller bypasses PredictionTile.
function formatTotalPickShort(pick: string | null, line: number | null): string {
  if (pick === null) return "—";
  if (line === null) {
    if (pick === "Over") return "O";
    if (pick === "Under") return "U";
    return pick;
  }
  if (pick === "Over") return `O ${line}`;
  if (pick === "Under") return `U ${line}`;
  return `${pick} ${line}`;
}

export function PickTilesRow({ game }: { game: DailyEdgeGameDto }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <PredictionTile
        label="Moneyline"
        pick={game.predictions.ml.pick}
        confidence={game.predictions.ml.confidence}
        sharpStatus={game.predictions.ml.sharpStatus}
        grade={game.predictions.ml.grade}
        pickColor="text-white"
        pickGlow=""
      />
      <PredictionTile
        label="Total"
        pick={formatTotalPickShort(
          game.predictions.total.pick,
          game.predictions.total.line
        )}
        confidence={game.predictions.total.confidence}
        sharpStatus={game.predictions.total.sharpStatus}
        grade={game.predictions.total.grade}
        pickColor="text-white"
        pickGlow=""
      />
      <PredictionTile
        label="1st Inning"
        pick={game.predictions.nrfi.pick}
        confidence={game.predictions.nrfi.confidence}
        sharpStatus={game.predictions.nrfi.sharpStatus}
        grade={game.predictions.nrfi.grade}
        pickColor={getNrfiPickColor(game.predictions.nrfi.pick)}
        pickGlow={getNrfiPickGlow(game.predictions.nrfi.pick)}
      />
    </div>
  );
}

function PredictionTile({
  label,
  pick,
  confidence,
  sharpStatus,
  grade,
  pickColor,
  pickGlow,
}: {
  label: string;
  /** Phase 4.2.C.2 — null when the auto-model held this market. */
  pick: string | null;
  /** Phase 4.2.C.2 — null when the auto-model held this market. */
  confidence: number | null;
  sharpStatus: SharpStatus;
  grade: Grade | null;
  pickColor: string;
  pickGlow: string;
}) {
  // Phase 4.2.C.2 — isNoPick treats either null pick OR null grade as
  // "held / no displayable pick". Either condition fires the "—" treatment.
  // Pre-4.2.C.2 only checked grade === null; held games still rendered fake
  // pick strings because the route defaulted them to "Under" / "NRFI" etc.
  const isNoPick = grade === null || pick === null || confidence === null;
  const borderClass = getTileBorder(sharpStatus);
  const displayPick = isNoPick ? "—" : pick;
  const displayConfidence =
    isNoPick || confidence === null ? "—" : `${Math.round(confidence * 100)}%`;
  return (
    <div
      className={`bg-gray-900/60 border ${borderClass} rounded-md p-3 sm:p-3.5 transition-colors duration-150 hover:bg-gray-900/80 relative`}
    >
      <div className="absolute top-2 right-2">
        {!isNoPick && <SharpStatusIcon status={sharpStatus} />}
      </div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <GradeBadge grade={grade} context="daily-edge" size="sm" emojiOnly />
        <p className="text-[10px] uppercase tracking-[0.1em] text-gray-400 font-semibold">
          {label}
        </p>
      </div>
      <p
        className={`text-lg sm:text-xl font-medium tracking-tight mb-1.5 truncate leading-tight ${
          isNoPick ? "text-gray-500" : pickColor
        } ${isNoPick ? "" : pickGlow}`}
      >
        {displayPick}
      </p>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-medium tabular-nums text-gray-300">
          {displayConfidence}
        </span>
        {!isNoPick && (
          <span
            className={`text-[9px] font-medium tracking-[0.1em] uppercase ${TILE_TAG[sharpStatus].color}`}
          >
            {TILE_TAG[sharpStatus].text}
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FullBreakdownExpandable — CTA + per-market detail
// ═══════════════════════════════════════════════════════════════════

type MarketKey = "ml" | "total" | "nrfi";

const MARKET_HEADING: Record<MarketKey, string> = {
  ml: "Moneyline",
  total: "Total",
  nrfi: "1st Inning",
};

const SIGNAL_MARKET_FOR: Record<MarketKey, SharpSignalDto["market"]> = {
  ml: "ML",
  total: "OU",
  nrfi: "NRFI",
};

function formatPickFor(market: MarketKey, game: DailyEdgeGameDto): string {
  // Phase 4.2.C.2 — null pick (held market) renders as "—". Pre-4.2.C.2
  // this returned fake strings like "Under undefined" because pick was
  // typed as string but ran as null at runtime for held games.
  if (market === "ml") {
    const pick = game.predictions.ml.pick;
    return pick !== null && pick !== "—" ? `${pick} ML` : "—";
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (t.pick === null) return "—";
    return t.line !== null ? `${t.pick} ${t.line}` : t.pick;
  }
  return game.predictions.nrfi.pick ?? "—";
}

export function FullBreakdownExpandable({
  game,
  expanded,
  onToggle,
  ctaLabelCollapsed = "View full breakdown",
}: {
  game: DailyEdgeGameDto;
  expanded: boolean;
  onToggle: () => void;
  ctaLabelCollapsed?: string;
}) {
  const { confirmedCount, cautionCount } = countPickGrades(game);
  const ctaSuffix =
    confirmedCount > 0
      ? ` · ${confirmedCount} confirmed`
      : cautionCount > 0
      ? ` · ${cautionCount} caution`
      : "";

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full py-2 text-xs text-gray-400 hover:text-violet-300 hover:bg-gray-900/40 rounded transition-all duration-200 inline-flex items-center justify-center gap-1.5 border-t border-gray-800/60"
      >
        <span>
          {expanded ? "Hide full breakdown" : `${ctaLabelCollapsed}${ctaSuffix}`}
        </span>
        <Icon
          name="chevron-down"
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-800/60">
          <div className="mb-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-300">
              Full Breakdown
            </span>
          </div>
          <div className="space-y-4">
            <MarketBlock game={game} market="ml" />
            <MarketBlock game={game} market="total" />
            <MarketBlock game={game} market="nrfi" />
          </div>
        </div>
      )}
    </>
  );
}

function MarketBlock({
  game,
  market,
}: {
  game: DailyEdgeGameDto;
  market: MarketKey;
}) {
  const tile = game.predictions[market];
  const displayGrade: Grade | null = tile.grade;
  // Phase 4.2.C.2 — isNoPick also true when pick or confidence is null
  // (held market). Pre-4.2.C.2 only checked grade.
  const isNoPick = displayGrade === null || tile.pick === null || tile.confidence === null;
  const pickText = isNoPick ? "—" : formatPickFor(market, game);
  const signalsForMarket = game.sharpSignals.filter(
    (s) => s.market === SIGNAL_MARKET_FOR[market]
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-gray-300">
          {MARKET_HEADING[market]}
        </p>
        <GradeBadge grade={displayGrade} context="daily-edge" size="sm" />
      </div>
      <p className="text-sm font-medium text-white tracking-tight mb-2">
        {pickText}
        <span className="text-gray-400 tabular-nums">
          {" · "}
          {isNoPick || tile.confidence === null
            ? "—"
            : `${Math.round(tile.confidence * 100)}%`}
        </span>
      </p>
      {signalsForMarket.length > 0 && (
        <div className="space-y-1.5">
          {signalsForMarket.map((signal, i) => (
            <SignalRow
              key={`${signal.market}-${signal.category}-${i}`}
              signal={signal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getDirectionStyles(direction: SharpSignalDto["direction"]) {
  if (direction === "positive") {
    return {
      border: "border-emerald-500",
      bg: "bg-emerald-500/5",
      badgeBg: "bg-emerald-500/15",
      badgeText: "text-emerald-300",
      iconColor: "text-emerald-400",
      bulletIcon: "check" as IconName,
      bulletColor: "text-emerald-400",
    };
  }
  if (direction === "negative") {
    return {
      border: "border-amber-500",
      bg: "bg-amber-500/5",
      badgeBg: "bg-amber-500/15",
      badgeText: "text-amber-300",
      iconColor: "text-amber-400",
      bulletIcon: "alert-triangle" as IconName,
      bulletColor: "text-amber-400",
    };
  }
  return {
    border: "border-gray-500",
    bg: "bg-gray-500/5",
    badgeBg: "bg-gray-500/15",
    badgeText: "text-gray-300",
    iconColor: "text-gray-300",
    bulletIcon: "minus" as IconName,
    bulletColor: "text-gray-400",
  };
}

function signalIcon(category: SharpSignalDto["category"]): IconName {
  switch (category) {
    case "pinnacle_agree":
      return "check";
    case "pinnacle_disagree":
      return "alert-triangle";
    case "line_move_toward":
      return "trending-up";
    case "line_move_away":
      return "trending-down";
    case "steam":
      return "bolt";
    case "handle_gap":
      return "users";
    case "context_weather":
      return "cloud";
    case "context_park":
      return "building";
    case "no_signal":
      return "minus";
  }
}

function SignalRow({ signal }: { signal: SharpSignalDto }) {
  const styles = getDirectionStyles(signal.direction);
  return (
    <div
      className={`flex items-start gap-2.5 ${styles.border} ${styles.bg} border-l-[3px] rounded-r-md pl-3 pr-3 py-2`}
    >
      <Icon
        name={styles.bulletIcon}
        className={`shrink-0 w-4 h-4 mt-0.5 ${styles.bulletColor}`}
        strokeWidth={styles.bulletIcon === "check" ? 2.5 : undefined}
      />
      <span
        className={`shrink-0 inline-flex items-center font-mono text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 mt-0.5 ${styles.badgeBg} ${styles.badgeText}`}
      >
        {signal.market}
      </span>
      <div className="shrink-0 mt-0.5">
        <Icon
          name={signalIcon(signal.category)}
          className={`w-4 h-4 ${styles.iconColor}`}
        />
      </div>
      <span className="flex-1 text-xs sm:text-sm text-gray-200 leading-snug">
        {signal.description}
      </span>
      {(signal.source || signal.timestamp) && (
        <div className="shrink-0 flex flex-col items-end gap-0.5 text-[9px] uppercase tracking-[0.1em] text-gray-500 font-medium leading-tight whitespace-nowrap">
          {signal.source && <span>{signal.source}</span>}
          {signal.timestamp && <span>{signal.timestamp}</span>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NoPlayStrip — single-row stacked strip
// ═══════════════════════════════════════════════════════════════════

export function NoPlayStrip({
  game,
  takeaway,
}: {
  game: DailyEdgeGameDto;
  takeaway: ComposedTakeaway;
}) {
  return (
    <div className="bg-gray-900/30 border border-gray-800/50 rounded-md px-4 py-2.5 flex items-center gap-3 text-xs">
      <span aria-hidden="true" className="text-gray-500 text-sm leading-none">
        {VERDICT_GLYPH.no_play}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        No Play
      </span>
      <span className="text-gray-500 tabular-nums tracking-tight">
        {game.gameTime}
      </span>
      <span className="text-gray-500">·</span>
      <span className="text-gray-400 font-medium tracking-tight">
        {game.awayTeam} @ {game.homeTeam}
      </span>
      <span className="text-gray-500">·</span>
      <span className="text-gray-400 flex-1 min-w-0 truncate">
        {takeaway.lead}
      </span>
    </div>
  );
}

export type { HeadlineMarket };
