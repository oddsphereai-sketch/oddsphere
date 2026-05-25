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
    return `${total.pick} ${total.line}`;
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

function formatTotalPick(pick: string, line: number): string {
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

// ─── Sharp signals breakdown row visuals ──────────────────────────────────

const MARKET_ORDER: Record<SharpSignalDto["market"], number> = {
  ML: 0,
  OU: 1,
  NRFI: 2,
};

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

  // V2.1 grade is the headline verdict. Defensive default: a slate that ran
  // before the grade engine landed will return grade=null — render the
  // market_watch fallback so every card always has a badge.
  const displayGrade: Grade = game.grade ?? "market_watch";
  const primaryPick = deriveCardPrimaryPick(game.predictions);
  const attribution = getAttribution(displayGrade, primaryPick);

  const sortedSignals = [...game.sharpSignals].sort(
    (a, b) => MARKET_ORDER[a.market] - MARKET_ORDER[b.market]
  );

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
          the market_watch defensive default when game.grade is null). */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <GradeBadge grade={displayGrade} context="daily-edge" />
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
          CSS uppercase transform handles display rendering. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <PredictionTile
          label="Moneyline"
          pick={game.predictions.ml.pick}
          confidence={game.predictions.ml.confidence}
          sharpStatus={game.predictions.ml.sharpStatus}
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
          pickColor="text-white"
          pickGlow=""
        />
        <PredictionTile
          label="1st Inning"
          pick={game.predictions.nrfi.pick}
          confidence={game.predictions.nrfi.confidence}
          sharpStatus={game.predictions.nrfi.sharpStatus}
          pickColor={getNrfiPickColor(game.predictions.nrfi.pick)}
          pickGlow={getNrfiPickGlow(game.predictions.nrfi.pick)}
        />
      </div>

      {/* Expand/collapse toggle — "Why this matters · N signals" */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full py-2 text-xs text-gray-400 hover:text-violet-300 hover:bg-gray-900/40 rounded transition-all duration-200 inline-flex items-center justify-center gap-1.5 border-t border-gray-800/60"
      >
        <span>
          {expanded
            ? "Hide why this matters"
            : game.sharpSignals.length === 0
            ? "No additional signals tonight"
            : `Why this matters · ${game.sharpSignals.length} ${
                game.sharpSignals.length === 1 ? "signal" : "signals"
              }`}
        </span>
        {game.sharpSignals.length > 0 && (
          <Icon
            name="chevron-down"
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* "Why this matters" breakdown — ✓ / ⚠ / — bullets by direction */}
      {expanded && game.sharpSignals.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-800/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-300">
              Why this matters
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              {game.sharpSignals.length}{" "}
              {game.sharpSignals.length === 1 ? "signal" : "signals"}
            </span>
          </div>
          <div className="space-y-2">
            {sortedSignals.map((signal, i) => (
              <SignalRow
                key={`${signal.market}-${signal.category}-${i}`}
                signal={signal}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function PredictionTile({
  label,
  pick,
  confidence,
  sharpStatus,
  pickColor,
  pickGlow,
}: {
  label: string;
  pick: string;
  confidence: number;
  sharpStatus: SharpStatus;
  pickColor: string;
  pickGlow: string;
}) {
  const borderClass = getTileBorder(sharpStatus);
  return (
    <div
      className={`bg-gray-900/60 border ${borderClass} rounded-md p-3.5 transition-colors duration-150 hover:bg-gray-900/80 relative`}
    >
      <div className="absolute top-2 right-2">
        <SharpStatusIcon status={sharpStatus} />
      </div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-gray-400 mb-1.5 font-semibold">
        {label}
      </p>
      <p
        className={`text-xl font-medium tracking-tight mb-1.5 truncate leading-tight ${pickColor} ${pickGlow}`}
      >
        {pick}
      </p>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-medium tabular-nums text-gray-300">
          {Math.round(confidence * 100)}%
        </span>
        <span
          className={`text-[9px] font-medium tracking-[0.1em] uppercase ${TILE_TAG[sharpStatus].color}`}
        >
          {TILE_TAG[sharpStatus].text}
        </span>
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
