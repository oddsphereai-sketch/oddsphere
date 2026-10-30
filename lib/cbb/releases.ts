// Owner-approved staged production cutover. The member reader remains closed
// until the sole leased writer publishes and its stored board is verified.
export const CBB_MODEL_RELEASE = "cbb_candidate_2026_10_28_r1_adjusted_efficiency" as const;
export const CBB_EVIDENCE_RELEASE = "cbb_evidence_2026_10_28_r1_source_chronology" as const;
export const CBB_ACTIVATION = Object.freeze({
  status: "writer_warmup" as const,
  memberPublication: false,
  predictionWrites: true,
  stakes: false,
});
