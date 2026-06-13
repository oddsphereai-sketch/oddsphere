/**
 * Phase 7B v0c-DE — NBA Daily Edge DTO builder.
 *
 * Pure function. Composes the snapshot + prediction + provenance +
 * per-market intelligence into the shape the UI consumes. This is the
 * single contract between the API route and the page.
 *
 * No DB writes. No network.
 */

import type {
  NbaAutoModelOutput,
  NbaGameSnapshot,
} from "../../automodel/nba/types";
import type { NbaModelV1Output } from "../../automodel/nba/nbaAutoModelV2";
import type { NbaSnapshotProvenance } from "./featureSnapshot";
import {
  buildNbaGameIntelligence,
  type MarketIntelligence,
  type NbaGameIntelligence,
  type NbaLineRow,
  type SourceBadges,
} from "./nbaMarketIntelligence";
import type { NbaSplitsRow } from "./nbaSplitsClient";
import type { NbaOpportunity } from "./nbaOpportunitiesClient";

const ET_TIMEZONE = "America/New_York";

function toEtIso(utcIso: string | null): string | null {
  if (utcIso === null) return null;
  try {
    const d = new Date(utcIso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-US", {
      timeZone: ET_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return null;
  }
}

function seriesLine(snapshot: NbaGameSnapshot): {
  text: string;
  game_number: number | null;
  leader_text: string;
  venue_shift: boolean;
  closeout: boolean;
  elimination_for: "home" | "away" | null;
} {
  const s = snapshot.series;
  if (s === null) {
    return {
      text: "Regular game",
      game_number: null,
      leader_text: "",
      venue_shift: false,
      closeout: false,
      elimination_for: null,
    };
  }
  const homeAbbr = snapshot.home_team.abbreviation;
  const awayAbbr = snapshot.away_team.abbreviation;
  const leader =
    s.series_score_home > s.series_score_away
      ? `${homeAbbr} leads ${s.series_score_home}-${s.series_score_away}`
      : s.series_score_away > s.series_score_home
        ? `${awayAbbr} leads ${s.series_score_away}-${s.series_score_home}`
        : `series tied ${s.series_score_home}-${s.series_score_away}`;
  const elim: "home" | "away" | null = s.is_elimination_for_home
    ? "home"
    : s.is_elimination_for_away
      ? "away"
      : null;
  return {
    text: `Game ${s.game_number} · ${leader}${s.venue_shift ? " · venue shift" : ""}${elim !== null ? ` · ${elim === "home" ? homeAbbr : awayAbbr} elim` : ""}`,
    game_number: s.game_number,
    leader_text: leader,
    venue_shift: s.venue_shift,
    closeout: elim !== null,
    elimination_for: elim,
  };
}

function injurySummary(snapshot: NbaGameSnapshot): {
  home_out: number;
  home_questionable: number;
  home_unknown: number;
  away_out: number;
  away_questionable: number;
  away_unknown: number;
  home_known: boolean;
  away_known: boolean;
} {
  return {
    home_out: snapshot.home_injuries.filter((i) => i.status === "out").length,
    home_questionable: snapshot.home_injuries.filter((i) => i.status === "questionable").length,
    home_unknown: snapshot.home_injuries.filter((i) => i.status === "unknown").length,
    away_out: snapshot.away_injuries.filter((i) => i.status === "out").length,
    away_questionable: snapshot.away_injuries.filter((i) => i.status === "questionable").length,
    away_unknown: snapshot.away_injuries.filter((i) => i.status === "unknown").length,
    home_known: snapshot.data_quality.home_injuries_known,
    away_known: snapshot.data_quality.away_injuries_known,
  };
}

/**
 * Compose a brief Quick Read sentence describing the strongest market.
 * Honest about missing data.
 */
function composeQuickRead(intel: NbaGameIntelligence, snapshot: NbaGameSnapshot): string {
  const home = snapshot.home_team.abbreviation;
  const away = snapshot.away_team.abbreviation;
  const matchup = `${away} @ ${home}`;
  const top = intel.top_market;
  if (top === null) {
    return `${matchup} — model held on all markets.`;
  }
  const m =
    top === "moneyline" ? intel.ml : top === "spread" ? intel.spread : intel.total;
  const grade = m.grade;
  switch (grade) {
    case "best_angle":
      return `${matchup} — Best Angle on ${m.pick_label} (model ${m.effective_confidence.toFixed(0)}, market ${m.conflict_band.replace("_", " ")}).`;
    case "lean":
      return `${matchup} — Lean ${m.pick_label} (model ${m.effective_confidence.toFixed(0)}, market ${m.conflict_band.replace("_", " ")}).`;
    case "watch":
      return `${matchup} — Watchlist on ${m.pick_label}. ${m.rationale[0] ?? ""}`.trim();
    case "caution":
      return `${matchup} — Caution on ${m.pick_label}. ${m.rationale[0] ?? ""}`.trim();
    case "no_market":
      return `${matchup} — model picks ${m.pick_label} but market data unavailable for comparison.`;
    case "held":
      return `${matchup} — model held; no actionable read.`;
  }
}

// ─── Public DTO shapes ──────────────────────────────────────────────

/**
 * ADMIN/AUDIT-ONLY v1 metadata exposed to the admin preview only.
 * Customer-facing rendering must NEVER surface these tokens.
 */
export type NbaAdminModelBadge = {
  /** Always "v1 · research-prior · calibration pending" for this build. */
  label: string;
  /** Flagged audit deltas (e.g. spread Δ > 2pt vs v0). Empty when none. */
  audit_flags: string[];
  /** Net rating-blend playoff weight for each team (small admin signal). */
  home_playoff_weight: number | null;
  away_playoff_weight: number | null;
  /** Capped Four Factors modifier per team (pp100). */
  home_ff_modifier_pp100: number | null;
  away_ff_modifier_pp100: number | null;
  /** Confidence caps applied (label + value). */
  applied_caps: Array<{ source: string; cap: number }>;
};

export type NbaDailyEdgeGameDto = {
  game_external_id: number;
  matchup: string;
  home_abbr: string;
  away_abbr: string;
  home_full_name: string;
  away_full_name: string;
  tip_iso_utc: string | null;
  tip_display_et: string | null;
  series: ReturnType<typeof seriesLine>;
  rest: {
    home_days: number | null;
    away_days: number | null;
  };
  injuries: ReturnType<typeof injurySummary>;
  data_quality_tier: NbaAutoModelOutput["audit"]["data_quality_tier"];
  projection: {
    home_score: number;
    away_score: number;
    total: number;
    spread_home: number;
  };
  intelligence: NbaGameIntelligence;
  quick_read: string;
  sources: SourceBadges;
  provenance: NbaSnapshotProvenance;
  /** ADMIN-ONLY v1 model metadata. Member-facing UI must not render. */
  admin_model_badge: NbaAdminModelBadge | null;
  /**
   * NBA-P0 — operator-only audit substrate from the V2 + consensus + grounding
   * overlay (raw V2 → clean baseline → grounded → regularized). Typed loosely
   * here to avoid a circular import with applyNbaGrounding; populated by
   * applyNbaGroundingOverlay. Member UI must not render this.
   */
  grounding_audit?: Record<string, unknown> | null;
};

/**
 * Discriminator for whether the route was able to fetch SharpAPI
 * splits/opportunities/EV in the current environment. Set by the
 * route at request time based on whether SHARPAPI_KEY is present.
 *
 *   • "available"             — key present; per-game has_splits /
 *                               has_opportunities reflect real data
 *                               availability for the matchup.
 *   • "unavailable_no_api_key" — env has no SHARPAPI_KEY; the UI
 *                               should render a "this environment
 *                               does not have public-market access"
 *                               empty state instead of "no splits for
 *                               this matchup" (which would be misleading).
 */
export type NbaMarketSignalsCapability = "available" | "unavailable_no_api_key";

export type NbaDailyEdgeDto = {
  as_of: string;
  slate_date_et: string;
  utc_window: { startISO: string; endISO: string };
  provisional: true;
  notice: string;
  injury_ingest_enabled: boolean;
  /**
   * Honest signal about whether the deployment environment has access
   * to SharpAPI splits/EV/opportunities. Decoupled from per-game
   * `has_splits` flags so the UI can show env-aware copy without
   * lying about per-matchup data availability.
   */
  market_signals_capability: NbaMarketSignalsCapability;
  games: NbaDailyEdgeGameDto[];
};

// ─── Builder ────────────────────────────────────────────────────────

export function buildNbaDailyEdgeGameDto(opts: {
  snapshot: NbaGameSnapshot;
  /**
   * Prediction may be either v0 (NbaAutoModelOutput) or v1 (NbaModelV1Output,
   * which is a superset). When v1 fields are present we emit the
   * admin_model_badge. When v0 only, badge stays null.
   */
  prediction: NbaAutoModelOutput | NbaModelV1Output;
  provenance: NbaSnapshotProvenance;
  lines: NbaLineRow[];
  splitsRow: NbaSplitsRow | null;
  opportunities: NbaOpportunity[];
}): NbaDailyEdgeGameDto {
  const intel = buildNbaGameIntelligence({
    snapshot: opts.snapshot,
    prediction: opts.prediction,
    lines: opts.lines,
    splitsRow: opts.splitsRow,
    opportunities: opts.opportunities,
    injuriesSource: opts.provenance.injuries_source,
  });

  return {
    game_external_id: opts.snapshot.game_external_id,
    matchup: `${opts.snapshot.away_team.abbreviation} @ ${opts.snapshot.home_team.abbreviation}`,
    home_abbr: opts.snapshot.home_team.abbreviation,
    away_abbr: opts.snapshot.away_team.abbreviation,
    home_full_name: opts.snapshot.home_team.abbreviation,
    away_full_name: opts.snapshot.away_team.abbreviation,
    tip_iso_utc: opts.snapshot.game_time_iso,
    tip_display_et: toEtIso(opts.snapshot.game_time_iso),
    series: seriesLine(opts.snapshot),
    rest: {
      home_days: opts.snapshot.series?.days_rest_home ?? null,
      away_days: opts.snapshot.series?.days_rest_away ?? null,
    },
    injuries: injurySummary(opts.snapshot),
    data_quality_tier: opts.prediction.audit.data_quality_tier,
    projection: {
      home_score: opts.prediction.predicted_home_score,
      away_score: opts.prediction.predicted_away_score,
      total: opts.prediction.predicted_total,
      spread_home: opts.prediction.predicted_spread_home,
    },
    intelligence: intel,
    quick_read: composeQuickRead(intel, opts.snapshot),
    sources: intel.sources,
    provenance: opts.provenance,
    admin_model_badge: buildAdminModelBadge(opts.prediction),
  };
}

/**
 * ADMIN/AUDIT-ONLY helper. Extracts v1-specific metadata when present.
 * Returns null when the prediction is a plain v0 output.
 *
 * Member-facing UI MUST NOT consume this field.
 */
function buildAdminModelBadge(
  prediction: NbaAutoModelOutput | NbaModelV1Output,
): NbaAdminModelBadge | null {
  if (!("model_version_v1" in prediction)) return null;
  const v1 = prediction;
  return {
    label: "v1 · research-prior · calibration pending",
    audit_flags: v1.v0_v1_delta.flagged,
    home_playoff_weight: v1.v1_breakdown.home_recency.playoff_weight,
    away_playoff_weight: v1.v1_breakdown.away_recency.playoff_weight,
    home_ff_modifier_pp100: v1.v1_breakdown.home_ff.capped_modifier_pp100,
    away_ff_modifier_pp100: v1.v1_breakdown.away_ff.capped_modifier_pp100,
    applied_caps: v1.v1_breakdown.applied_caps,
  };
}

// Re-export key types so the route + UI can import from this one module.
export type {
  MarketIntelligence,
  NbaGameIntelligence,
  SourceBadges,
} from "./nbaMarketIntelligence";
