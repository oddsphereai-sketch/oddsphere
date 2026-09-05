import assert from "node:assert/strict";
import {
  assessMlbModelLayerStamp,
  classifyFiHoldDiagnostic,
  isDailyEdgeActionableGrade,
} from "../lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import {
  buildMlbModelLayerVersions,
  MLB_MODEL_LAYER_VERSION_IDS,
} from "../lib/automodel/mlbModelLayerVersions";

assert.equal(isDailyEdgeActionableGrade("Lean"), true);
assert.equal(isDailyEdgeActionableGrade("Best Angle"), true);
assert.equal(isDailyEdgeActionableGrade("best_angle"), true);
assert.equal(isDailyEdgeActionableGrade("Watchlist"), false);
assert.equal(isDailyEdgeActionableGrade("market_aligned"), false);
assert.equal(isDailyEdgeActionableGrade("No Play"), false);
assert.equal(isDailyEdgeActionableGrade(null), false);

const currentFiStamp = buildMlbModelLayerVersions("first_inning");
assert.equal(
  assessMlbModelLayerStamp({ actual: currentFiStamp, market: "first_inning", locked: false }).classification,
  "current_contract",
  "the health monitor must accept the active FI-scoped probability head",
);
assert.notEqual(
  currentFiStamp.first_inning_probability_head,
  MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
  "the FI release remains intentionally scoped without changing the full-game base stamp",
);
assert.equal(
  assessMlbModelLayerStamp({
    actual: {
      ...currentFiStamp,
      first_inning_probability_head: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
      active_probability_head: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
    },
    market: "first_inning",
    locked: false,
  }).classification,
  "incoherent",
  "an unlocked FI row stamped with the superseded base head must still be flagged",
);

const sparseKnownStarter = classifyFiHoldDiagnostic({
  fi_v2_audit: {
    fi_pick: "Held",
    fi_pick_reason: "fi_waiting_for_fresh_data",
    fi_no_bet_reason: "Held — data quality insufficient.",
    fi_play_grade: "held",
    data_quality_tier: "fallback",
    market_data_quality: "ok",
    feature_audit: {
      missing_count: 1,
      present_count: 7,
      reason_codes: ["fi_starter_missing"],
    },
  },
  v2_2_audit: {
    feature_capture: {
      starter: {
        home: {
          name: "Established Starter",
          first_inning_starts: 10,
          season_games_started: 10,
          season_innings_pitched: 50.2,
          season_era: 4.1,
        },
        away: {
          name: "Sparse Starter",
          first_inning_starts: 1,
          season_games_started: 1,
          season_innings_pitched: 4.1,
          season_era: 0,
        },
      },
    },
  },
  mlb_data_completeness: {
    status: "provisional_starters_pending",
    can_publish_normal: true,
    repair_eligible: true,
    degraded_fields: [
      "home_starter_confirmation",
      "away_starter_confirmation",
      "home_lineup_offense_stats",
      "away_lineup_offense_stats",
    ],
  },
});

assert.equal(
  sparseKnownStarter.classification,
  "sparse_starter_history",
  "a known starter with one start and a 0.00 ERA is sparse history, not an ingestion miss",
);
assert.equal(sparseKnownStarter.materiality, "medium");

const trulyMissingStarter = classifyFiHoldDiagnostic({
  fi_v2_audit: {
    fi_pick: "Held",
    fi_pick_reason: "fi_waiting_for_fresh_data",
    fi_no_bet_reason: "Held — missing starter.",
    data_quality_tier: "fallback",
    market_data_quality: "ok",
    feature_audit: {
      missing_count: 1,
      present_count: 7,
      reason_codes: ["fi_starter_missing"],
    },
  },
  v2_2_audit: {
    feature_capture: { starter: { home: null, away: null } },
  },
  mlb_data_completeness: {
    status: "incomplete_missing_required_data",
    can_publish_normal: false,
    repair_eligible: true,
    degraded_fields: ["home_probable_pitcher"],
  },
});

assert.equal(
  trulyMissingStarter.classification,
  "missing_inputs",
  "a genuinely absent starter remains a high-severity missing-input diagnosis",
);
assert.equal(trulyMissingStarter.materiality, "high");

console.log("PASS Daily Edge health classifies actionable grades and distinguishes sparse starter history from missing ingestion");
