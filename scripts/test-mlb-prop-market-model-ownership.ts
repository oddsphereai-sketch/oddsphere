import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BATTER_HITS_PA_MODEL_VERSION } from "../lib/mlb/props/batterHitsPaModel";
import { BATTER_HRR_MODEL_VERSION } from "../lib/mlb/props/batterHrrCountModel";
import { MLB_PROP_MARKET_KEYS } from "../lib/mlb/props/config";
import {
  activeMlbPropMarketModelVersions,
  MLB_PROPS_MODEL_RELEASE_ID,
} from "../lib/mlb/props/marketModelVersions";
import { modelForRealPitcherMarket } from "../lib/mlb/props/models";
import {
  MLB_PROPS_GAME_LOCK_MINUTES,
  MLB_PROPS_TRACKING_POLICY_RELEASE_ID,
  mlbPropsGameLockCutoff,
  mlbPropsGameLockIsDue,
} from "../lib/mlb/props/lockPolicy";

const versions = activeMlbPropMarketModelVersions();
assert.deepEqual(Object.keys(versions).sort(), [...MLB_PROP_MARKET_KEYS].sort());
assert.equal(versions.batter_hits, `${BATTER_HITS_PA_MODEL_VERSION}_actionability_v6_uncapped_validated_under_best_angle`);
assert.equal(versions.batter_hits_runs_rbis, `${BATTER_HRR_MODEL_VERSION}_actionability_v5_uncapped_validated_under_best_angle`);
assert.equal(versions.pitcher_strikeouts, "pitcher_strikeouts_distribution_v4_over_actionable_only");
assert.equal(versions.pitcher_outs, "pitcher_outs_peer_consensus_compact_core_v4_over_actionable_only");
assert.equal(versions.pitcher_walks, "pitcher_walks_distribution_v1_conservative_over_market_only_calibrated");
assert.equal(versions.pitcher_earned_runs, "pitcher_earned_runs_distribution_v2_watchlist_only");
assert.equal(versions.batter_runs_scored, "batter_runs_context_opportunity_integrated_read_v4_unvalidated_special_promotion_removed");
assert.equal(versions.batter_home_runs, "batter_home_runs_rare_event_integrated_read_v10_consensus_best_price_lean_path");
assert.equal(versions.batter_singles, "batter_singles_event_distribution_integrated_read_v5_under_lean_only");
assert.equal(versions.batter_doubles, "batter_doubles_event_distribution_integrated_read_v3_reliability_calibrated");
assert.equal(MLB_PROPS_MODEL_RELEASE_ID, "mlb_props_2026_07_29_r17");
assert.match(MLB_PROPS_MODEL_RELEASE_ID, /^mlb_props_\d{4}_\d{2}_\d{2}_r\d+$/);
assert.equal(modelForRealPitcherMarket("pitcher_strikeouts")?.modelName, "pitcher_strikeouts_distribution_v3_verified");
assert.equal(modelForRealPitcherMarket("pitcher_outs")?.modelName, "pitcher_outs_peer_consensus_compact_core_v3_verified");
assert.equal(modelForRealPitcherMarket("pitcher_hits_allowed")?.modelName, "pitcher_hits_allowed_distribution_v1_conservative");
assert.equal(modelForRealPitcherMarket("pitcher_walks")?.modelName, "pitcher_walks_distribution_v1_conservative");
assert.equal(modelForRealPitcherMarket("pitcher_earned_runs")?.modelName, "pitcher_earned_runs_distribution_v1_conservative");
assert.equal(modelForRealPitcherMarket("batter_hits"), null);
assert.equal(modelForRealPitcherMarket("batter_singles"), null);
assert.equal(MLB_PROPS_GAME_LOCK_MINUTES, 60);
assert.equal(MLB_PROPS_TRACKING_POLICY_RELEASE_ID, "mlb_props_tracking_t60_game_v1");
assert.equal(mlbPropsGameLockCutoff("2026-07-23T21:15:00.000Z"), "2026-07-23T20:15:00.000Z");
assert.equal(mlbPropsGameLockIsDue("2026-07-23T21:15:00.000Z", "2026-07-23T20:14:59.999Z"), false);
assert.equal(mlbPropsGameLockIsDue("2026-07-23T21:15:00.000Z", "2026-07-23T20:15:00.000Z"), true);
assert.equal(mlbPropsGameLockIsDue("2026-07-23T21:15:00.000Z", "2026-07-23T21:15:00.000Z"), false);

const liveBoard = readFileSync(resolve(process.cwd(), "lib/mlb/props/liveBoard.ts"), "utf8");
const realScoring = readFileSync(resolve(process.cwd(), "lib/mlb/props/realScoring.ts"), "utf8");
const hitsBranch = liveBoard.indexOf('args.definition.marketKey === "batter_hits"');
const hrrBranch = liveBoard.indexOf('args.definition.marketKey === "batter_hits_runs_rbis"');
const legacyHitterMath = liveBoard.indexOf("const l5 = recent", hitsBranch);
assert.ok(hitsBranch >= 0 && hitsBranch < legacyHitterMath, "Batter Hits must exit before legacy hitter math");
assert.ok(hrrBranch >= 0 && hrrBranch < legacyHitterMath, "H+R+RBI must exit before legacy hitter math");
assert.ok(!liveBoard.includes("applyValidatedPremiumBestAngles"));
assert.ok(!liveBoard.includes("VALIDATED_SINGLES_PREMIUM_BEST_ANGLE"));
assert.ok(!liveBoard.includes("HOME_RUN_PROMOTION_DAILY_CAP"));
assert.ok(liveBoard.includes("selectStandardizedQualityCandidateIds"));
assert.ok(liveBoard.includes("VALIDATED_HOME_RUN_CONSENSUS_BEST_PRICE_PROMOTION"));
assert.ok(realScoring.includes("if (!isPitcherMarket(row.odds.marketKey)) continue;"));
assert.ok(realScoring.includes("modelForRealPitcherMarket"));

const tracking = readFileSync(resolve(process.cwd(), "lib/mlb/props/internalTracking.ts"), "utf8");
assert.ok(tracking.includes("snapshot.modelContext?.marketModelVersions?.[row.market]"));
assert.ok(tracking.includes("snapshot.modelContext?.modelReleaseId"));
assert.ok(tracking.includes("byRelease: groupMetrics(actionable, modelReleaseForTracking)"));
assert.ok(tracking.includes("legacy_unstamped:${row.model_version}"));
assert.ok(!tracking.includes("process.env.ODDSPHERE_PROPS_MODEL_VERSION"));
assert.ok(!tracking.includes("ODDSPHERE_PROPS_TRACKING_LOCK_MINUTES"));
assert.ok(!tracking.includes("ODDSPHERE_PROPS_TRACKING_LOCK_GRACE_MINUTES"));
assert.ok(tracking.includes("MLB_PROPS_GAME_LOCK_AUDIT_ACTION"));
assert.ok(tracking.includes("loadMlbPropsBoardSnapshotAtOrBefore"));
assert.ok(tracking.includes("authoritativeGameLock: true"));

const propsCron = readFileSync(resolve(process.cwd(), "app/api/cron/mlb-player-props-refresh/route.ts"), "utf8");
assert.ok(propsCron.includes('leaseGroup: "prediction_pipeline"'));
assert.ok(propsCron.includes("requireLease: true"));
const pregameSweep = readFileSync(resolve(process.cwd(), "app/api/cron/pregame-sweep/route.ts"), "utf8");
assert.ok(pregameSweep.includes("ensureMlbPropsGameLocksForSchedule"));
assert.ok(pregameSweep.includes("loadLatestMlbPropsGameLockSchedule(date)"));
assert.ok(pregameSweep.includes("publishMlbPropsMemberReadSnapshots(propsSnapshot, { compactOnly: true })"));

assert.ok(liveBoard.includes("modelReleaseId: MLB_PROPS_MODEL_RELEASE_ID"));

console.log(`PASS market model ownership: ${Object.keys(versions).length} markets versioned; dedicated branches precede legacy hitter math`);
