// Candidate only. No member route, cron or writer imports this package.
export const CBB_MODEL_RELEASE = "cbb_candidate_2026_10_28_r1_adjusted_efficiency" as const;
export const CBB_EVIDENCE_RELEASE = "cbb_evidence_2026_10_28_r1_source_chronology" as const;
export const CBB_ACTIVATION = Object.freeze({
  status: "prelaunch" as const,
  memberPublication: false,
  predictionWrites: false,
  stakes: false,
});
