/**
 * V2.1 grade engine vocabularies (Phase 6.3a).
 *
 * Single home for the union types introduced by schema migrations V6, V7,
 * V8, and V11. Each union mirrors the CHECK constraint in its migration —
 * keep the two in sync. Adding a new value here means adding it to the
 * matching SQL CHECK and writing a new migration; never silently widen one
 * side.
 *
 * Why a dedicated file rather than scattering these across Prediction.ts,
 * PropPrediction.ts, Tracking.ts, and Game.ts: the same vocabulary is used
 * by every layer of the grade engine (derivation services, UI badges,
 * tracking aggregates). Co-locating the unions keeps a single source of
 * truth that imports cleanly into all consumers.
 */

/**
 * Layer 3 — market read on a single pick. Set by marketSignalDerivationService
 * (Phase 6.3c). NULL means the service has not run for this row yet.
 *
 * Mirrors CHECK constraint in schema-migration-v6.sql.
 */
export type MarketSignal =
  | "market_confirmed"   // sharp money + line move agree with model
  | "market_neutral"     // no meaningful market read either way
  | "market_resistance"  // market drifting against model conviction
  | "public_smoke"       // heavy public action without sharp confirmation
  | "steam_alert";       // sudden coordinated sharp move worth flagging

/**
 * Final 7-category grade produced by gradeDerivationService (Phase 6.3d).
 * Same vocabulary for Daily Edge and Player Props — same engine, different
 * display labels per V2.1 Part 6.
 *
 * Mirrors CHECK constraint in schema-migration-v7.sql.
 */
export type Grade =
  | "best_signal"      // 🔥 5%+ edge (games) / 10%+ (props), market-aligned, no risk conflict
  | "sharp_confirmed"  // ✅ sharp money behind a positive-edge pick
  | "market_led"       // ⚡ V2.1-new: market lead, model concurs
  | "model_only"       // 📊 model edge with no market read
  | "market_watch"     // 👀 market moving without model agreement yet
  | "public_smoke"     // 💨 heavy public action, no sharp confirmation
  | "sharp_conflict";  // ⚠️ sharps disagree with model — caution

/**
 * Attribution: which signal layer drove the final grade. Used by tracking to
 * answer "how do market-led picks ROI vs. model-only?" without re-deriving
 * from raw layer data.
 *
 * Mirrors CHECK constraint in schema-migration-v7.sql. Stored on both the
 * prediction tables (live) and prediction_results (carried forward at
 * resolve time so tracking doesn't have to rejoin regenerated predictions).
 */
export type SignalType =
  | "model_dominant"
  | "market_dominant"
  | "balanced"
  | "model_only"
  | "market_only";

/**
 * Publish lifecycle for a slate (set on `games.slate_status`).
 * Filtered by slatePublishService (Phase 6.3d) — read paths in 6.3a do
 * not filter on this column yet.
 *
 * Mirrors CHECK constraint in schema-migration-v8.sql.
 */
export type SlateStatus =
  | "draft"      // admin loaded, not visible to members
  | "published"  // live on Daily Edge / Player Props
  | "final"      // all games settled — kept for tracking, hidden from live views
  | "hidden";    // retracted (escape hatch)

/**
 * Data provenance for any prediction. NOT NULL with DEFAULT 'mock' at the
 * DB layer — every row has a value.
 *
 * Mirrors CHECK constraint in schema-migration-v11.sql + v12.sql.
 */
export type SourceType =
  | "mock"      // V1 default — MockOddsProvider / MockSharpSignalProvider / etc.
  | "manual"    // pasted in via Phase 7.25 Admin Manual Upload tool
  | "real_api"; // pulled from a live paid feed (Phase 8)
