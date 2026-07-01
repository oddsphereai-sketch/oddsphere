import assert from "node:assert/strict";
import {
  applyGuardedLiveQcPolicy,
  type AiAuditorCardAuditResult,
} from "@/lib/services/aiAuditor/guardedLiveQc";
import type { AiAuditorPayloadEstimate } from "@/lib/services/aiAuditor/costPreview";

function payload(overrides: Partial<AiAuditorPayloadEstimate["payload"]["markets"][number]> = {}): AiAuditorPayloadEstimate {
  const market = {
    market: "moneyline" as const,
    pick: "CWS",
    playGrade: "Best Angle",
    modelProbabilityPct: 60,
    marketProbabilityPct: 53,
    probabilityUnits: "percent_0_100" as const,
    modelMarketGapPct: 7,
    priceAmerican: -120,
    displayPriceAmerican: -120,
    priceSource: "current_recommendation" as const,
    priceNullReason: null,
    line: null,
    lineValue: null,
    openLineValue: null,
    currentLineValue: null,
    lineValueSource: "unavailable" as const,
    lineValueNullReason: "moneyline_has_no_point_line",
    verdict: "Best Angle",
    quickRead: "Market support.",
    marketRead: { status: "mixed", label: "Mixed", copy: "Consensus and sharp-book signals conflict." },
    sourceConflict: true,
    reasonCodes: ["source_conflict"],
    consensusSplits: { label: "Consensus Splits", rows: [{ label: "CWS", moneyPct: 66, betsPct: 62 }] },
    sharpBookSplits: { label: "Sharp Book Signal", summary: "Resistance", rows: [] },
    lineMovement: {
      openAmerican: -110,
      currentAmerican: -120,
      displayCurrentAmerican: -120,
      lockedAmerican: null,
      firstTrackedLine: null,
      currentLine: null,
      lastMovePreviousAmerican: null,
      lastMoveCurrentAmerican: null,
      lastMovePreviousLine: null,
      lastMoveCurrentLine: null,
      directionRelativeToPick: "support",
      lastMoveAt: null,
    },
    dataQuality: {
      held: false,
      marketDataQuality: "two_sided_consensus",
      reviewFlags: [],
      reviewActionSummary: null,
    },
    deterministicPreScore: {
      modelEdgeScore: 70,
      priceQualityScore: 65,
      marketAlignmentScore: 45,
      marketResistanceScore: 35,
      dataQualityScore: 80,
      lineMovementScore: 55,
      historicalCohortScore: 42,
      finalGradeCandidateScore: 57,
      notes: ["fixture"],
    },
    fiContext: {
      isFirstInning: false,
      expectedRunsAvailable: null,
      fiMarketSignalExpected: false,
      fiMarketSignalNullReason: null,
    },
    ...overrides,
  };
  return {
    date: "2026-06-28",
    sport: "mlb",
    gameId: "mlb-1",
    externalId: 1,
    matchup: "CWS @ KC",
    marketCount: 1,
    markets: ["moneyline"],
    payloadHash: "abc123",
    payloadBytes: 1000,
    estimatedInputTokens: 300,
    estimatedOutputTokens: 700,
    cacheSkipped: false,
    skipReason: null,
    payload: {
      schemaVersion: "ai-auditor-cost-preview-v1",
      auditMode: "cost_preview",
      sport: "mlb",
      slateDate: "2026-06-28",
      gameId: "mlb-1",
      externalId: 1,
      teams: { away: "CWS", home: "KC" },
      gameTime: "7:10 PM",
      lockState: "open",
      lockedAt: null,
      updatedAt: "2026-06-28T12:00:00.000Z",
      asOfTimestamp: "2026-06-28T12:00:00.000Z",
      projectedScore: { away: 4.6, home: 4.1 },
      sourceState: { sourceConflict: true },
      markets: [market],
      guardrails: {
        noMemberFacingChanges: true,
        noProviderNames: true,
        noPostgameResultsIncluded: true,
        oneCallPerGameCard: true,
      },
    },
  };
}

function result(overrides: Partial<AiAuditorCardAuditResult> = {}): AiAuditorCardAuditResult {
  return {
    data_integrity_review: { status: "pass", summary: "ok", flags: [] },
    market_read_review: {
      status: "warn",
      summary: "canonical read is mixed",
      current_market_read: "consensus_support",
      recommended_market_read: "mixed",
    },
    play_grade_review: {
      status: "warn",
      summary: "downgrade public contradiction",
      current_play_grade: "Best Angle",
      recommended_play_grade: "Lean",
    },
    full_card_coherence_review: {
      status: "warn",
      summary: "copy contradicts source state",
      contradictions: ["Market Read copy says support while source state is mixed."],
    },
    recommended_market_read: "mixed",
    recommended_play_grade: "Lean",
    issues: [{ code: "market_read_copy_mismatch", severity: "medium", message: "copy mismatch" }],
    recommended_actions: ["apply_copy_fixes", "downgrade_grade"],
    safe_copy_fixes: [{ field: "market_read", replacement: "Mixed" }],
    confidence: 0.88,
    severity: "medium",
    provider_name_check: { provider_names_present: false, offending_terms: [] },
    ...overrides,
  };
}

process.env.AI_AUDITOR_ENABLED = "true";
process.env.AI_AUDITOR_GUARDED_LIVE_QC = "true";
process.env.AI_AUDITOR_APPLY_SAFE_COPY_FIXES = "true";
process.env.AI_AUDITOR_APPLY_GUARDED_DOWNGRADES = "true";
process.env.AI_AUDITOR_ALLOW_UPGRADES = "false";
process.env.AI_AUDITOR_ALLOW_PICK_FLIPS = "false";
process.env.AI_AUDITOR_ALLOW_PROBABILITY_CHANGES = "false";
process.env.AI_AUDITOR_DISABLE_GPT55_LIVE = "true";

const mixedFix = applyGuardedLiveQcPolicy({ payload: payload(), aiResult: result(), schemaValid: true });
assert.equal(mixedFix.applied, true);
assert.equal(mixedFix.appliedChanges.some((change) => change.action === "safe_copy_fix" && change.to === "Mixed"), true);
assert.equal(mixedFix.appliedChanges.some((change) => change.action === "guarded_downgrade" && change.from === "Best Angle" && change.to === "Lean"), true);
assert.equal(mixedFix.ledgerMetadata.deterministicRuleAgreement, true);

const upgrade = applyGuardedLiveQcPolicy({
  payload: payload({ playGrade: "Lean", marketRead: { status: "aligned", label: "Aligned", copy: "Aligned support." }, sourceConflict: false }),
  aiResult: result({
    recommended_market_read: "aligned",
    recommended_play_grade: "Best Angle",
    recommended_actions: ["downgrade_grade"],
    play_grade_review: { status: "warn", summary: "bad upgrade", current_play_grade: "Lean", recommended_play_grade: "Best Angle" },
  }),
  schemaValid: true,
});
assert.equal(upgrade.appliedChanges.some((change) => change.action === "guarded_downgrade"), false);
assert.equal(upgrade.blockedActions.includes("upgrade_blocked"), true);

const providerLeak = applyGuardedLiveQcPolicy({
  payload: payload(),
  aiResult: result({
    provider_name_check: { provider_names_present: true, offending_terms: ["SharpAPI"] },
    safe_copy_fixes: [{ field: "market_read", replacement: "SharpAPI says Mixed" }],
  }),
  schemaValid: true,
});
assert.equal(providerLeak.applied, false);
assert.equal(providerLeak.blockedActions.includes("provider_name_leak_blocked"), true);

const wnbaConsensusOnly = applyGuardedLiveQcPolicy({
  payload: payload({
    marketRead: { status: "consensus_support", label: "Consensus Support", copy: "Consensus supports the pick." },
    sourceConflict: false,
    sharpBookSplits: null,
    playGrade: "Watchlist",
  }),
  aiResult: result({
    recommended_market_read: "consensus_support",
    recommended_play_grade: "Watchlist",
    recommended_actions: ["apply_copy_fixes"],
    safe_copy_fixes: [{ field: "sharp_label", replacement: "Consensus Splits" }],
    play_grade_review: { status: "pass", summary: "no grade change", current_play_grade: "Watchlist", recommended_play_grade: "Watchlist" },
  }),
  schemaValid: true,
});
assert.equal(wnbaConsensusOnly.appliedChanges.some((change) => change.field === "sharp_label"), true);
assert.equal(wnbaConsensusOnly.appliedChanges.some((change) => /sharp/i.test(change.to)), false);

const schemaFail = applyGuardedLiveQcPolicy({ payload: payload(), aiResult: null, schemaValid: false });
assert.equal(schemaFail.applied, false);
assert.equal(schemaFail.blockedActions.includes("schema_validation_failed"), true);

const block = applyGuardedLiveQcPolicy({
  payload: payload(),
  aiResult: result({ recommended_actions: ["block_card"], severity: "block" }),
  schemaValid: true,
});
assert.equal(block.blocked, true);
assert.equal(block.status, "block");

console.log("✓ AI auditor guarded live QC policy tests passed");
