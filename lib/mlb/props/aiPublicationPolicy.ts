/** Future publication/reader opt-in. Stored legacy sources keep their contract. */
export const MLB_PROPS_AI_HANDOFF_RELEASE = "mlb_props_ai_handoff_2026_11_14_r2_unknown_ack_fence" as const;
export const MLB_PROPS_LOCKED_SOURCE_READER_RELEASE = "mlb_props_locked_source_reader_2026_11_14_r1_exact_original_authority" as const;

export function mlbPropsAiCutoffPolicy(release: unknown): "legacy" | "indexed" | "unsupported" {
  if (release === undefined || release === "mlb_props_ai_handoff_2026_11_10_r1_ready_publication") return "legacy";
  if (release === MLB_PROPS_AI_HANDOFF_RELEASE) return "indexed";
  return "unsupported";
}

export class MlbPropsPublicationUncertainError extends Error {
  constructor() {
    super("MLB props publication acknowledgement unavailable; publication authority must be read by the next ordinary invocation.");
    this.name = "MlbPropsPublicationUncertainError";
  }
}
