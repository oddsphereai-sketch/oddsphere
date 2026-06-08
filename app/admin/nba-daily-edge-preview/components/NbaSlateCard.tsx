/**
 * Phase 7B v0c-DE — NBA slate card (left-rail).
 *
 * One per game. Compact summary showing matchup, tip time ET, series
 * state, top-grade pill, and the three market verdict pills (ML /
 * Spread / Total) so the operator can scan the slate at a glance.
 *
 * Selected state: violet halo (matches MLB convention — violet is the
 * "selected" tone, never used as a verdict).
 */

"use client";

import type { NbaDailyEdgeGameDto } from "@/lib/services/nba/buildNbaDailyEdgeDto";
import {
  GRADE_LABEL,
  GRADE_GLYPH,
  GRADE_TEXT_COLOR,
  GRADE_PILL_TINT,
} from "./NbaVerdictPalette";
import { nbaTeamPrimary } from "./NbaTeamColors";

function MarketPill({
  label,
  grade,
  pickLabel,
}: {
  label: string;
  grade: NbaDailyEdgeGameDto["intelligence"]["ml"]["grade"];
  pickLabel: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border ${GRADE_PILL_TINT[grade]}`}>
      <div className="flex items-center gap-1">
        <span className={`text-[10px] uppercase tracking-wider ${GRADE_TEXT_COLOR[grade]}`}>
          {label}
        </span>
        <span className={GRADE_TEXT_COLOR[grade]}>{GRADE_GLYPH[grade]}</span>
      </div>
      <div className="text-xs text-gray-200 truncate text-right">{pickLabel}</div>
    </div>
  );
}

export function NbaSlateCard({
  game,
  selected,
  onSelect,
}: {
  game: NbaDailyEdgeGameDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  const tipShort = (() => {
    if (game.tip_iso_utc === null) return "tip tbd";
    try {
      return new Date(game.tip_iso_utc).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return "tip tbd";
    }
  })();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border bg-gray-950/60 transition-colors p-3 space-y-2 ${
        selected
          ? "border-violet-400/60 shadow-[0_0_0_2px_rgba(167,139,250,0.18)]"
          : "border-gray-800/60 hover:border-gray-700"
      }`}
    >
      {/* Team color strip */}
      <div className="h-1 rounded-full overflow-hidden flex">
        <div style={{ background: nbaTeamPrimary(game.away_abbr), flex: 1 }} />
        <div style={{ background: nbaTeamPrimary(game.home_abbr), flex: 1 }} />
      </div>
      {/* Header line */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-semibold text-gray-100">
          {game.away_abbr} <span className="text-gray-500 text-sm">@</span> {game.home_abbr}
        </div>
        <div className={`flex items-center gap-1 ${GRADE_TEXT_COLOR[topGrade]}`}>
          <span>{GRADE_GLYPH[topGrade]}</span>
          <span className="text-[10px] uppercase tracking-wider font-semibold">{GRADE_LABEL[topGrade]}</span>
        </div>
      </div>
      <div className="text-[11px] text-gray-500">
        {tipShort} · {game.series.text}
      </div>
      {/* 3 market pills */}
      <div className="grid grid-cols-1 gap-1 pt-1">
        <MarketPill label="ML" grade={intel.ml.grade} pickLabel={intel.ml.pick_label} />
        <MarketPill label="Spread" grade={intel.spread.grade} pickLabel={intel.spread.pick_label} />
        <MarketPill label="Total" grade={intel.total.grade} pickLabel={intel.total.pick_label} />
      </div>
    </button>
  );
}
