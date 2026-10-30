// Owner-approved member publication after the sole leased writer published
// and its stored seven-game board was verified in production.
export const CBB_MODEL_RELEASE = "cbb_candidate_2026_10_28_r1_adjusted_efficiency" as const;
export const CBB_EVIDENCE_RELEASE = "cbb_evidence_2026_10_28_r1_source_chronology" as const;
export const CBB_ACTIVATION = Object.freeze({
  release: "cbb_member_activation_2026_10_30_r1_verified_writer" as const,
  status: "member_live" as const,
  memberPublication: true,
  predictionWrites: true,
  stakes: false,
});
