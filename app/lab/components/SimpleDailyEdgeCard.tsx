"use client";

import { useState } from "react";
import type {
  DailyEdgeGameDto,
  DailyEdgeVerdict,
  SharpSignalDto,
  SharpStatus,
} from "../lib/labTypes";
import Icon, { type IconName } from "./Icon";

type Props = {
  game: DailyEdgeGameDto;
};

// ─── Verdict visuals (3 states per locked UI spec §4) ───────────────────────
// "strong"  → green banner (sharps support pick)
// "caution" → amber/rose banner (sharps moving against pick)
// null      → NO BANNER (default for most games; absence ≠ negative)

type NonNullVerdict = Exclude<DailyEdgeVerdict, null>;

const VERDICT_STYLES: Record<
  NonNullVerdict,
  {
    label: string;
    barBg: string;
    borderColor: string;
    textColor: string;
    cardShadow: string;
    cardShadowHover: string;
  }
> = {
  strong: {
    label: "STRONG",
    barBg: "bg-emerald-500/10",
    borderColor: "border-emerald-500",
    textColor: "text-emerald-400",
    cardShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_24px_rgba(16,185,129,0.10)]",
    cardShadowHover:
      "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_28px_rgba(16,185,129,0.14)]",
  },
  caution: {
    label: "CAUTION",
    barBg: "bg-amber-500/8",
    borderColor: "border-amber-500",
    textColor: "text-amber-400",
    cardShadow: "shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
    cardShadowHover:
      "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_24px_rgba(245,158,11,0.08)]",
  },
};

const NEUTRAL_CARD_SHADOW = {
  cardShadow: "shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
  cardShadowHover: "hover:border-gray-700",
};

function getTileBorder(status: SharpStatus): string {
  if (status === "confirm") return "border-emerald-500/30";
  if (status === "caution") return "border-amber-500/30";
  return "border-gray-800";
}

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

function formatTotalPick(pick: string, line: number): string {
  if (pick === "Over") return `O ${line}`;
  if (pick === "Under") return `U ${line}`;
  return `${pick} ${line}`;
}

function getNrfiPickColor(pick: string): string {
  if (pick === "NRFI") return "text-emerald-400";
  if (pick === "YRFI") return "text-rose-400";
  return "text-gray-200";
}

function getNrfiPickGlow(pick: string): string {
  if (pick === "NRFI")
    return "drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]";
  if (pick === "YRFI") return "drop-shadow-[0_0_8px_rgba(244,63,94,0.45)]";
  return "";
}

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
    };
  }
  if (direction === "negative") {
    return {
      border: "border-amber-500",
      bg: "bg-amber-500/5",
      badgeBg: "bg-amber-500/15",
      badgeText: "text-amber-300",
      iconColor: "text-amber-400",
    };
  }
  return {
    border: "border-gray-500",
    bg: "bg-gray-500/5",
    badgeBg: "bg-gray-500/15",
    badgeText: "text-gray-300",
    iconColor: "text-gray-300",
  };
}

export default function SimpleDailyEdgeCard({ game }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Verdict + subtitle come from the server (Decision G — UI does not
  // re-derive). 5F.1: verdict is now nullable — null means "no banner".
  const verdict = game.verdict;
  const style = verdict !== null ? VERDICT_STYLES[verdict] : null;
  const cardShadowClasses = style
    ? `${style.cardShadow} ${style.cardShadowHover}`
    : `${NEUTRAL_CARD_SHADOW.cardShadow} ${NEUTRAL_CARD_SHADOW.cardShadowHover}`;

  const sortedSignals = [...game.sharpSignals].sort(
    (a, b) => MARKET_ORDER[a.market] - MARKET_ORDER[b.market]
  );

  return (
    <article
      className={`bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-4 sm:p-5 transition-all duration-200 hover:border-gray-700 ${cardShadowClasses}`}
    >
      {/* Header — teams + time pill */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-medium tracking-tight text-white">
          {game.awayTeam} <span className="text-gray-500">@</span>{" "}
          {game.homeTeam}
        </h3>
        <span className="inline-flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-full px-3 py-1 text-xs font-medium text-violet-300 tracking-tight whitespace-nowrap">
          <Icon name="clock" className="w-3 h-3" />
          {game.gameTime}
        </span>
      </div>

      {/* Verdict bar — only renders for "strong" or "caution"; null = no banner */}
      {style && game.verdictSubtitle && (
        <div
          className={`flex items-center gap-2 flex-wrap ${style.barBg} ${style.borderColor} border-l-[3px] rounded-r-md pl-3 pr-3 py-2 mb-4`}
        >
          <span
            className={`text-[11px] uppercase font-medium tracking-[0.08em] ${style.textColor}`}
          >
            {style.label}
          </span>
          <span className="text-sm text-gray-200">{game.verdictSubtitle}</span>
        </div>
      )}

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
          <span className="text-2xl font-bold text-gray-600 leading-none">—</span>
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

      {/* 3 pick boxes */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <PredictionTile
          label="ML"
          pick={game.predictions.ml.pick}
          confidence={game.predictions.ml.confidence}
          sharpStatus={game.predictions.ml.sharpStatus}
          pickColor="text-white"
          pickGlow=""
        />
        <PredictionTile
          label="TOTAL"
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
          label="NRFI"
          pick={game.predictions.nrfi.pick}
          confidence={game.predictions.nrfi.confidence}
          sharpStatus={game.predictions.nrfi.sharpStatus}
          pickColor={getNrfiPickColor(game.predictions.nrfi.pick)}
          pickGlow={getNrfiPickGlow(game.predictions.nrfi.pick)}
        />
      </div>

      {/* Expand/collapse toggle — "Show signal breakdown · N signals" */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full py-2 text-xs text-gray-400 hover:text-violet-300 hover:bg-gray-900/40 rounded transition-all duration-200 inline-flex items-center justify-center gap-1.5 border-t border-gray-800/60"
      >
        <span>
          {expanded
            ? "Hide signal breakdown"
            : game.sharpSignals.length === 0
            ? "No sharp signals tonight"
            : `Show signal breakdown · ${game.sharpSignals.length} ${game.sharpSignals.length === 1 ? "signal" : "signals"}`}
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

      {/* Sharp signals breakdown */}
      {expanded && game.sharpSignals.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-800/60">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-violet-400">
              <span aria-hidden="true">🦈</span>
              Sharp Signals
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              {game.sharpSignals.length}{" "}
              {game.sharpSignals.length === 1 ? "signal" : "signals"}
            </span>
          </div>
          <div className="space-y-2">
            {sortedSignals.map((signal, i) => (
              <SignalRow key={`${signal.market}-${signal.category}-${i}`} signal={signal} />
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
        {sharpStatus === "confirm" && (
          <span className="text-[9px] font-medium tracking-[0.1em] text-emerald-400 uppercase">
            Sharps
          </span>
        )}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: SharpSignalDto }) {
  const styles = getDirectionStyles(signal.direction);
  return (
    <div
      className={`flex items-start gap-2.5 ${styles.border} ${styles.bg} border-l-[3px] rounded-r-md pl-3 pr-3 py-2`}
    >
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
