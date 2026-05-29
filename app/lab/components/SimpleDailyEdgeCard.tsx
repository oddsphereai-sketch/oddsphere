"use client";

import { useState } from "react";
import type {
  DailyEdgeGameDto,
  SharpSignalDto,
  SharpStatus,
} from "../lib/labTypes";
import type { Grade } from "@/lib/types/domain/Grade";
import Icon, { type IconName } from "./Icon";
import GradeBadge from "@/app/components/GradeBadge";
import { getAttribution } from "../lib/gradeAttribution";
import {
  headlineGrade,
  headlinePrimaryMarket,
} from "../lib/perPickHeadline";

type Props = {
  game: DailyEdgeGameDto;
};

/**
 * Derive the row's primary pick for display in the best_signal attribution
 * sentence. Mirrors the ML → OU → NRFI precedence used server-side by
 * marketSignalDerivationService (6.3c) + gradeDerivationService (6.3d) so
 * the visible pick matches the pick the grade engine actually classified.
 *
 * Format:
 *   ML  → "{team} ML"        (e.g. "NYY ML")
 *   OU  → "{side} {line}"    (e.g. "Over 9.5")
 *   NRFI→ "{NRFI|YRFI}"
 *
 * Used only for best_signal — the other six grades carry generic copy that
 * ignores the primary pick. We always compute it (cheap) so the call site
 * stays uniform.
 */
function deriveCardPrimaryPick(
  predictions: DailyEdgeGameDto["predictions"]
): string {
  const ml = predictions.ml.pick;
  if (ml && ml !== "—") {
    return `${ml} ML`;
  }
  const total = predictions.total;
  if (total.pick) {
    // Fix 7.2.5: total.line may be null when no market line is available
    // (manual slate without sharp_signals + no listed_line). Render the
    // side alone in that case — "Under 7.8" would falsely imply the
    // model projection is the market line.
    return total.line !== null ? `${total.pick} ${total.line}` : total.pick;
  }
  return predictions.nrfi.pick;
}

// ─── Per-pick sharpStatus visuals (tile border + leading icon + tag) ──────

function getTileBorder(status: SharpStatus): string {
  if (status === "confirm") return "border-emerald-500/30";
  if (status === "caution") return "border-amber-500/30";
  return "border-gray-800";
}

/**
 * V2.1 6.4d tile-tag rename: pre-6.4d the bottom-right tag rendered "SHARPS"
 * only when sharpStatus === "confirm", which collided with the card-level
 * "Sharp Confirmed" GradeBadge label. The new 3-state mapping reads as
 * tile-relative status (per V2.1 6.4d founder review item 3):
 *   confirm → "Confirmed" (emerald)
 *   mixed   → "Mixed"     (subdued gray — reads as background, not callout)
 *   caution → "Against"   (amber)
 */
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
    return (
      <Icon
        name="alert-triangle"
        className="w-[13px] h-[13px] text-amber-400"
      />
    );
  }
  return <Icon name="minus" className="w-[13px] h-[13px] text-gray-400" />;
}

// ─── Tile pick formatters ─────────────────────────────────────────────────

// Fix 7.2.5: `line` may be null when no market line is available. Render
// the side alone ("U", "O", "Under", "Over") in that case rather than
// falsely showing the model projection as the market line.
function formatTotalPick(pick: string, line: number | null): string {
  if (line === null) {
    if (pick === "Over") return "O";
    if (pick === "Under") return "U";
    return pick;
  }
  if (pick === "Over") return `O ${line}`;
  if (pick === "Under") return `U ${line}`;
  return `${pick} ${line}`;
}

/**
 * NRFI = "no first-inning run" (semantic green, the under-bet side).
 * YRFI = "yes first-inning run" — V2.1 6.4 fix: violet, NOT rose. The prior
 * rose color falsely conveyed "bad news"; YRFI is a valid pick, just a
 * different direction.
 */
function getNrfiPickColor(pick: string): string {
  if (pick === "NRFI") return "text-emerald-400";
  if (pick === "YRFI") return "text-violet-400";
  return "text-gray-200";
}

function getNrfiPickGlow(pick: string): string {
  if (pick === "NRFI") return "drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]";
  if (pick === "YRFI") return "drop-shadow-[0_0_8px_rgba(167,139,250,0.45)]";
  return "";
}

// ─── Per-market display helpers (V2.1.1 Pick Breakdown) ──────────────────

type MarketKey = "ml" | "total" | "nrfi";

const MARKET_HEADING: Record<MarketKey, string> = {
  ml: "Moneyline",
  total: "Total",
  nrfi: "1st Inning",
};

/** Map DTO market key to the sharp-signal market tag for filtering. */
const SIGNAL_MARKET_FOR: Record<MarketKey, SharpSignalDto["market"]> = {
  ml: "ML",
  total: "OU",
  nrfi: "NRFI",
};

/**
 * Per-market pick formatter for the Pick Breakdown block. Matches the
 * readable format used by the headline attribution copy + Top Reads:
 *   ml    → "{team} ML"   (e.g. "NYY ML")
 *   total → "{Over|Under} {line}"
 *   nrfi  → "{NRFI|YRFI}"
 *
 * Returns "—" when the model didn't pick that market (rare in V1 MLB but
 * the helper handles it defensively).
 */
function formatPickFor(
  market: MarketKey,
  game: DailyEdgeGameDto
): string {
  if (market === "ml") {
    const pick = game.predictions.ml.pick;
    return pick && pick !== "—" ? `${pick} ML` : "—";
  }
  if (market === "total") {
    // Fix 7.2.5: handle null line — render side alone.
    const t = game.predictions.total;
    return t.line !== null ? `${t.pick} ${t.line}` : t.pick;
  }
  return game.predictions.nrfi.pick;
}

// ─── Sharp signals breakdown row visuals ──────────────────────────────────

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

// ─── Card ─────────────────────────────────────────────────────────────────

export default function SimpleDailyEdgeCard({ game }: Props) {
  const [expanded, setExpanded] = useState(false);

  // V2.1.1 (Phase 6.3.5e): headline derives client-side from per-pick
  // via headlineGrade — strongest per-pick grade across ML/OU/NRFI with
  // ML→OU→NRFI tiebreaker. Fix 1.3 (Gap-21): returns `Grade | null`; the
  // null branch is the framework-honest "No Pick" treatment for games where
  // the model didn't pick any market. GradeBadge + getAttribution both
  // accept null and render the No Pick variant.
  const displayGrade: Grade | null = headlineGrade(game);
  const primaryPick = deriveCardPrimaryPick(game.predictions);
  const attribution = getAttribution(displayGrade, primaryPick);

  // V2.1.1 CTA suffix (Phase 6.3.5d core item 2): counts per-pick grades
  // across ml + total + nrfi tiles. "confirmed" = any of best_signal /
  // sharp_confirmed / market_led (the quality floor that gates Top Reads).
  // "caution" = sharp_conflict only. Confirmed wins precedence when both
  // are present.
  const pickGrades: Grade[] = [];
  if (game.predictions.ml.grade !== null) pickGrades.push(game.predictions.ml.grade);
  if (game.predictions.total.grade !== null) pickGrades.push(game.predictions.total.grade);
  if (game.predictions.nrfi.grade !== null) pickGrades.push(game.predictions.nrfi.grade);
  const confirmedCount = pickGrades.filter(
    (g) => g === "best_signal" || g === "sharp_confirmed" || g === "market_led"
  ).length;
  const cautionCount = pickGrades.filter((g) => g === "sharp_conflict").length;
  const ctaSuffix =
    confirmedCount > 0
      ? ` · ${confirmedCount} confirmed`
      : cautionCount > 0
      ? ` · ${cautionCount} caution`
      : "";

  return (
    <article className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-4 sm:p-5 transition-all duration-200 hover:border-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {/* Header — team logos + abbreviations + time pill */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="inline-flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white">
          <TeamBadge logo={game.awayTeamLogo} abbreviation={game.awayTeam} />
          <span className="text-gray-500">@</span>
          <TeamBadge logo={game.homeTeamLogo} abbreviation={game.homeTeam} />
        </h3>
        <span className="inline-flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-full px-3 py-1 text-xs font-medium text-violet-300 tracking-tight whitespace-nowrap tabular-nums">
          <Icon name="clock" className="w-3 h-3" />
          {game.gameTime}
        </span>
      </div>

      {/* V2.1 grade band — badge + attribution copy. Always renders (uses
          the market_watch defensive default when no per-pick grade exists).
          V2.1.1 (Phase 6.3.5d core item 1): headline badge appends the
          primary market — "✅ Sharp Confirmed · Moneyline" — so members
          see which market the headline grade is "about" without expanding
          the breakdown. 6.3.5e derives both fields client-side via
          headlineGrade + headlinePrimaryMarket. */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <GradeBadge
          grade={displayGrade}
          context="daily-edge"
          market={headlinePrimaryMarket(game)}
        />
        <p className="text-sm text-gray-300 leading-snug flex-1 min-w-0">
          {attribution}
        </p>
      </div>

      {/* PROJECTED FINAL — HERO STAT (5F.1, per locked UI spec §3). 44px bold. */}
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-1.5 text-center">
          Projected final
        </p>
        <div className="flex items-baseline justify-center gap-3 sm:gap-4">
          <span className="inline-flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
              {game.awayTeam}
            </span>
            <span className="text-[44px] leading-none font-black tabular-nums tracking-tight text-white">
              {game.projected.away.toFixed(1)}
            </span>
          </span>
          <span className="text-2xl font-bold text-gray-600 leading-none">
            —
          </span>
          <span className="inline-flex items-baseline gap-2">
            <span className="text-[44px] leading-none font-black tabular-nums tracking-tight text-white">
              {game.projected.home.toFixed(1)}
            </span>
            <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
              {game.homeTeam}
            </span>
          </span>
        </div>
      </div>

      {/* 3 pick tiles — labels per V2.1 spec Part 11: Moneyline / Total /
          1st Inning. Stored in title case to match the spec; the tile's
          CSS uppercase transform handles display rendering. V2.1.1 (Phase
          6.3.5d core): each tile gets its own GradeBadge sourced from the
          per-pick column (predictions.<market>.grade). Badge renders only
          when the model picked that market — a tile with no model pick
          stays clean (no badge). */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
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
          pick={formatTotalPick(
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

      {/* Expand toggle — V2.1.1 (Phase 6.3.5d core item 2): per-pick
          CTA replaces the old sharp-signal count. "View all 3 reads ·
          N confirmed" surfaces how many of the row's picks land at or
          above the market_led quality floor; falls back to caution count
          for sharp_conflict; no suffix when neither bucket fires. Every
          card now has a 3-pick breakdown worth opening — no "no signals
          tonight" branch. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full py-2 text-xs text-gray-400 hover:text-violet-300 hover:bg-gray-900/40 rounded transition-all duration-200 inline-flex items-center justify-center gap-1.5 border-t border-gray-800/60"
      >
        <span>{expanded ? "Hide pick breakdown" : `View all 3 reads${ctaSuffix}`}</span>
        <Icon
          name="chevron-down"
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* V2.1.1 Pick Breakdown (Phase 6.3.5d core item 3): per-market
          blocks always render when expanded. Each block carries its own
          grade, pick, attribution, and the sharp signals tagged to that
          market (Option B — sharp signals folded into per-market blocks
          for self-contained per-market story). */}
      {expanded && <PickBreakdown game={game} />}
    </article>
  );
}

/**
 * V2.1.1 Pick Breakdown (Phase 6.3.5d core item 3) — replaces the
 * pre-6.3.5d flat sharp-signals list in the expanded section. Renders all
 * 3 markets unconditionally so members can compare per-pick grades + see
 * why the same game can carry divergent reads across markets.
 *
 * Sharp signals are folded INTO each market's block (Option B per kickoff
 * design flag) so each market's story — grade, pick, attribution,
 * supporting signal detail — lives in one self-contained spot.
 */
function PickBreakdown({ game }: { game: DailyEdgeGameDto }) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-800/60">
      <div className="mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-300">
          Pick Breakdown
        </span>
      </div>
      <div className="space-y-4">
        <MarketBlock game={game} market="ml" />
        <MarketBlock game={game} market="total" />
        <MarketBlock game={game} market="nrfi" />
      </div>
    </div>
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
  // Fix 1.3 (Gap-27): null grade signals "model didn't pick this market".
  // Pre-fix this branch coerced null to "market_watch" — framework-violating
  // per SHARP_SIGNAL_FRAMEWORK.md §"Edge Case Handling — Model didn't pick
  // the market". Now the null state flows through GradeBadge + getAttribution
  // which render the honest No Pick treatment. Pick text + confidence
  // become "—" per Flag E1 (no fake pick alongside a No Pick badge).
  const displayGrade: Grade | null = tile.grade;
  const isNoPick = displayGrade === null;
  const pickText = isNoPick ? "—" : formatPickFor(market, game);
  const attribution = getAttribution(displayGrade, pickText);
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
      <p className="text-sm font-medium text-white tracking-tight mb-1">
        {pickText}
        <span className="text-gray-400 tabular-nums">
          {" · "}
          {isNoPick ? "—" : `${Math.round(tile.confidence * 100)}%`}
        </span>
      </p>
      <p className="text-xs text-gray-300 leading-snug mb-2">{attribution}</p>
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
  pick: string;
  confidence: number;
  sharpStatus: SharpStatus;
  /** V2.1.1 per-pick grade (Phase 6.3.5d core). NULL when the model didn't
   * pick this market — tile renders the No Pick treatment per Fix 1.3
   * (Gap-26): em-dash badge + "—" pick text + "—" confidence + hidden
   * sharpStatus tag. Pre-Fix-1.3 the tile silently dropped the badge but
   * kept showing pick/confidence, creating a contradictory state with
   * the upstream null-grade semantics. */
  grade: Grade | null;
  pickColor: string;
  pickGlow: string;
}) {
  const isNoPick = grade === null;
  const borderClass = getTileBorder(sharpStatus);
  // Fix 1.3 (Gap-26): when no model pick exists, suppress the pick text,
  // confidence, and sharpStatus tag. Showing "PHI · 0% · Mixed" alongside
  // a No Pick badge would contradict the framework's "honest representation"
  // mandate. The No Pick badge alone carries the meaning.
  const displayPick = isNoPick ? "—" : pick;
  const displayConfidence = isNoPick ? "—" : `${Math.round(confidence * 100)}%`;
  return (
    <div
      className={`bg-gray-900/60 border ${borderClass} rounded-md p-3.5 transition-colors duration-150 hover:bg-gray-900/80 relative`}
    >
      <div className="absolute top-2 right-2">
        {/* sharpStatus icon hidden in no-pick state — same honesty principle:
            no model pick means no per-market sharp posture to surface. */}
        {!isNoPick && <SharpStatusIcon status={sharpStatus} />}
      </div>
      {/* Label row — V2.1.1: prefix with per-pick GradeBadge (emoji-only,
          small). Fix 1.3 (Gap-26): badge always renders, using the No Pick
          variant when grade is null. */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <GradeBadge
          grade={grade}
          context="daily-edge"
          size="sm"
          emojiOnly
        />
        <p className="text-[10px] uppercase tracking-[0.1em] text-gray-400 font-semibold">
          {label}
        </p>
      </div>
      <p
        className={`text-xl font-medium tracking-tight mb-1.5 truncate leading-tight ${
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

/**
 * Team badge — 24px logo + abbreviation, or just the abbreviation when no
 * logo URL is available. Uses native <img> instead of next/image because
 * the source is an external CDN we don't pre-register; if loading fails we
 * hide the broken-image icon and fall back to the abbreviation.
 */
function TeamBadge({
  logo,
  abbreviation,
}: {
  logo: string | null;
  abbreviation: string;
}) {
  if (!logo) {
    return <span className="font-medium">{abbreviation}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        className="w-6 h-6 rounded-sm object-contain"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="font-medium">{abbreviation}</span>
    </span>
  );
}

function SignalRow({ signal }: { signal: SharpSignalDto }) {
  const styles = getDirectionStyles(signal.direction);
  return (
    <div
      className={`flex items-start gap-2.5 ${styles.border} ${styles.bg} border-l-[3px] rounded-r-md pl-3 pr-3 py-2`}
    >
      {/* Leading ✓ / ⚠ / — bullet by direction (V2.1 6.4 6) */}
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
