/**
 * Shared shape for `snapshot_json.displayed_context_markets.<market>`
 * — the internal lock-time substrate for displayed-but-not-publicly-
 * tracked markets (NBA spread, NHL puck-line; future analogues).
 *
 * Per [[feedback-public-tracking-vs-internal-audit]]:
 *   • If a market is rendered on the card, it must be internally
 *     auditable. This substrate is the auditable record.
 *   • The substrate does NOT join into the public tracking page. It
 *     lives on each game's existing officially-tracked rows (NBA ML +
 *     NBA Total; NHL ML + NHL Total) so the auditor can query by
 *     (game_id, market) and either lookup succeeds.
 *
 * NEVER:
 *   • Set `official_tracked: true` in this substrate. By definition
 *     these are context-only. A `true` value indicates a routing bug
 *     and the auditor flags it as HIGH.
 *   • Generate a `prediction_records.market="spread"` row for a sport
 *     whose registry entry classifies "spread" as context-only.
 *
 * INTRODUCED: 2026-06-10 by P1-2 commit A (writer substrate).
 * ENFORCED by auditor: P1-2 commit B (rollout-aware HIGH checks).
 */

/** Canonical short label as rendered by DailyEdgeShell.tsx
 *  `marketShortLabelFor` for the context-only chip. */
export type DisplayedContextMarketLabel = "Sprd*" | "PL*";

/** Side / pick direction. `null` when the model held on the context
 *  market and no chip side was rendered. */
export type DisplayedContextMarketSide =
  | "home"
  | "away"
  | "over"
  | "under"
  | null;

/** Verdict-key as rendered on the chip. Mirrors the small finite set
 *  used by the UI. `null` only when held with no verdict displayed. */
export type DisplayedContextMarketVerdict =
  | "best_angle"
  | "lean"
  | "watchlist"
  | "watch"
  | "caution"
  | "no_play"
  | "held"
  | null;

/** Provenance for the displayed line/odds.
 *
 *  • `real_book`         — chip rendered with a real sportsbook price.
 *  • `consensus_fallback`— chip rendered with consensus/no-vig fallback.
 *  • `unavailable`       — chip rendered with nothing (or in "—" state).
 */
export type DisplayedContextLineSourceQuality =
  | "real_book"
  | "consensus_fallback"
  | "unavailable";

/** Universal shape fields shared by every sport's context-only chip. */
export interface DisplayedContextMarketBase {
  /** Canonical market key — e.g., "spread" for NBA (Sprd*) and NHL (PL*). */
  market: string;
  /** Exact label that rendered on the chip. */
  display_label: DisplayedContextMarketLabel;
  /** ALWAYS false — by definition, this substrate is for non-tracked markets. */
  official_tracked: false;
  /** ALWAYS true — corollary of `official_tracked: false`. */
  context_only: true;
  /** True when the card actually rendered this chip at lock time. False
   *  when the model held or pick was unavailable but the chip slot
   *  collapsed gracefully. */
  displayed_at_lock: boolean;
  /** Member-facing pick string (e.g., "NY -2", "VGK +1.5"); null when held. */
  pick: string | null;
  /** Structured side; null when held. */
  side: DisplayedContextMarketSide;
  /** Numeric line value at lock; null when no line was rendered. */
  line: number | null;
  /** Best price at lock; null when no real-book price was rendered. */
  odds_american: number | null;
  /** Source sportsbook for `odds_american`; null when no price. */
  sportsbook: string | null;
  /** Verdict shown on the chip. */
  verdict: DisplayedContextMarketVerdict;
  /** 0-100 confidence as the chip displayed; null when held / not shown. */
  confidence_displayed: number | null;
  /** Model edge vs market in pp (probability) or signed pts; null when not computed. */
  edge_pct: number | null;
  /** One-liner from the model rationale; null when none. */
  rationale_one_liner: string | null;
  /** Source / line quality at the time the chip rendered. */
  source_evidence: {
    line_source_quality: DisplayedContextLineSourceQuality;
    lines_observed_count: number;
    /** Reserved for the future "true movement" P3 item. Always null in v1. */
    open_to_current_movement: null;
  };
  /** Static disclosure string mirroring the on-card footnote. */
  snapshot_note: string;
  /** ISO timestamp matching the writer's `nowIso` / `locked_at_iso`. */
  captured_at: string;
}

/** NBA spread context — `Sprd*` chip in the slate card / reader. */
export interface NbaSpreadDisplayedContext extends DisplayedContextMarketBase {
  market: "spread";
  display_label: "Sprd*";
  model_projection: {
    /** MODEL convention: positive = home wins by N. Same value as
     *  `predicted_spread_home` at the top of snapshot_json. */
    predicted_spread_home: number;
  };
}

/** NHL puck-line context — `PL*` chip in the slate card / reader. */
export interface NhlPuckLineDisplayedContext extends DisplayedContextMarketBase {
  market: "spread";
  display_label: "PL*";
  model_projection: {
    /** Signed home - away goals from `nhlAutoModelV0.expected_goal_diff`. */
    predicted_goal_diff_home: number;
    /** Optional context — projected total goals. */
    predicted_total_goals: number | null;
  };
}

/** Discriminated union of all known sport-specific context-only payloads. */
export type DisplayedContextMarket =
  | NbaSpreadDisplayedContext
  | NhlPuckLineDisplayedContext;

/** Shape of the top-level `snapshot_json.displayed_context_markets`. */
export type DisplayedContextMarketsBlock = Record<string, DisplayedContextMarket>;

/** Static disclosure note — mirrors the on-card footnote. */
export const CONTEXT_SNAPSHOT_NOTE =
  "Model context · Not part of official tracking";
