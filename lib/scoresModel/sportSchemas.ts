/**
 * Per-sport scores-model schemas.
 *
 * Each schema declares the canonical fields the manual upload UI renders
 * AND the validator enforces. Driving both flows from the same definition
 * keeps "what fields exist for MLB" / "what fields exist for UCL" in one
 * place.
 *
 * Field scopes:
 *   • top_level         — stored on a column on game_predictions.
 *   • sport_specific    — stored inside sport_specific JSONB.
 *   • mirror_to_sport_specific — top_level + also mirrored into the JSONB
 *                          for the multi-sport read path (MLB NRFI use).
 *
 * The admin UI in 4H renders fields in schema order with labels and types.
 * The ingester in this directory validates each row against the schema
 * before upsert.
 *
 * To add a new sport: add a SportSchema entry to SPORT_SCHEMAS and the
 * factory + ingester pick it up automatically.
 */

import type { Sport } from "../types/domain/Sport";

export type SportSchemaFieldType = "number" | "percent" | "enum" | "boolean";

export type SportSchemaField = {
  /** Property name on the input row. Stable contract — admin UI form `name` + DB column or sport_specific key. */
  key: string;
  /** Display label (UI) — also used in error messages. */
  label: string;
  type: SportSchemaFieldType;
  required: boolean;
  /** Where this value lives in the DB. */
  scope: "top_level" | "sport_specific";
  /** When true and scope='top_level', ALSO mirrored into sport_specific JSONB. */
  mirrorToSportSpecific?: boolean;
  /** For type='enum'. */
  options?: readonly string[];
  /** For type='number' / 'percent'. */
  min?: number;
  max?: number;
  /** Optional tooltip / help text rendered next to the form input. */
  helpText?: string;
  /**
   * Fix 7.2.3: when true, the admin UI renders this field as a decimal-safe
   * text input (type="text" + inputMode="decimal") with a raw-string-while-
   * editing state, instead of the default type="number". Solves the
   * "can't type a dot" UX bug caused by Number() round-tripping in the
   * default onChange path. Validator still treats the value as a number.
   */
  decimal?: boolean;
  /**
   * Fix 7.2.3: when set, the field is derived from other fields rather
   * than entered by the operator. The UI renders it as a disabled input
   * showing the computed value. The form's buildPredictions also computes
   * the value when assembling the payload; the ingester recomputes
   * defensively before UPSERT (server-side invariant).
   *
   * Currently supported computeFrom values:
   *   "predicted_home_score + predicted_away_score"
   *     → round((home + away) * 10) / 10
   */
  computeFrom?: "predicted_home_score + predicted_away_score";
};

export type SportSchema = {
  sport: Sport;
  displayName: string;
  fields: readonly SportSchemaField[];
};

// ─────────────────────────────────────────────────────────────────────────
// MLB
// ─────────────────────────────────────────────────────────────────────────
export const MLB_SCHEMA: SportSchema = {
  sport: "mlb",
  displayName: "MLB ⚾",
  fields: [
    { key: "predicted_home_score", label: "Home Runs", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_away_score", label: "Away Runs", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_total", label: "Total Runs", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
    { key: "predicted_ml_winner", label: "ML Winner", type: "enum", required: true, options: ["home", "away"], scope: "top_level" },
    { key: "ml_confidence", label: "ML Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
    { key: "predicted_ou_side", label: "O/U Lean", type: "enum", required: true, options: ["over", "under"], scope: "top_level" },
    { key: "ou_confidence", label: "O/U Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
    { key: "predicted_nrfi", label: "NRFI", type: "boolean", required: true, scope: "top_level", mirrorToSportSpecific: true, helpText: "NO Run First Inning" },
    { key: "nrfi_confidence", label: "NRFI Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level", mirrorToSportSpecific: true },
    // Fix 7.2.5: optional market O/U line — operator can enter the
    // sportsbook total at upload time so the Daily Edge total card has
    // a real line to display when sharp_signals / lines data isn't
    // populated. Lives in sport_specific JSONB (same pattern as NBA +
    // NCAAB). Daily Edge route falls back to this value when the lines
    // table has no entry for the game; lines table still wins when both
    // are present (more current via real-time sharp data).
    { key: "listed_line", label: "Listed Line (O/U)", type: "number", required: false, scope: "sport_specific", decimal: true, helpText: "Sportsbook total at upload (e.g. 8.5). Optional — leave blank if unknown." },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// NBA — no confidence ratings yet (Daniel's model doesn't produce them).
// listed_line is the sportsbook total at upload time; useful for diff vs predicted_total.
// ─────────────────────────────────────────────────────────────────────────
export const NBA_SCHEMA: SportSchema = {
  sport: "nba",
  displayName: "NBA 🏀",
  fields: [
    { key: "predicted_home_score", label: "Home Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_away_score", label: "Away Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_total", label: "Predicted Total", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
    { key: "listed_line", label: "Listed Line", type: "number", required: false, scope: "sport_specific", helpText: "Sportsbook total at upload" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// NFL / NCAAF — identical shape per spec
// ─────────────────────────────────────────────────────────────────────────
const FOOTBALL_FIELDS: readonly SportSchemaField[] = [
  { key: "predicted_home_score", label: "Home Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
  { key: "predicted_away_score", label: "Away Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
  { key: "predicted_total", label: "Predicted Total", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
  { key: "predicted_ml_winner", label: "ML Winner", type: "enum", required: true, options: ["home", "away"], scope: "top_level" },
  { key: "ml_confidence", label: "ML Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
  { key: "predicted_ou_side", label: "O/U Lean", type: "enum", required: true, options: ["over", "under"], scope: "top_level" },
  { key: "ou_confidence", label: "O/U Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
];

export const NFL_SCHEMA: SportSchema = {
  sport: "nfl",
  displayName: "NFL 🏈",
  fields: FOOTBALL_FIELDS,
};

export const NCAAF_SCHEMA: SportSchema = {
  sport: "cfb",
  displayName: "NCAAF 🏈",
  fields: FOOTBALL_FIELDS,
};

// ─────────────────────────────────────────────────────────────────────────
// NHL — same core shape as football
// ─────────────────────────────────────────────────────────────────────────
export const NHL_SCHEMA: SportSchema = {
  sport: "nhl",
  displayName: "NHL 🏒",
  fields: [
    { key: "predicted_home_score", label: "Home Goals", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_away_score", label: "Away Goals", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_total", label: "Predicted Total", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
    { key: "predicted_ml_winner", label: "ML Winner", type: "enum", required: true, options: ["home", "away"], scope: "top_level" },
    { key: "ml_confidence", label: "ML Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
    { key: "predicted_ou_side", label: "O/U Lean", type: "enum", required: true, options: ["over", "under"], scope: "top_level" },
    { key: "ou_confidence", label: "O/U Confidence %", type: "percent", required: true, min: 0, max: 100, scope: "top_level" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// UCL — predicted scores ARE expected goals. ML can be home/away/draw.
// Win %s + xG go in sport_specific.
// ─────────────────────────────────────────────────────────────────────────
export const UCL_SCHEMA: SportSchema = {
  sport: "ucl",
  displayName: "UCL ⚽",
  fields: [
    { key: "predicted_home_score", label: "Expected Goals (Home)", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_away_score", label: "Expected Goals (Away)", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_total", label: "Predicted Total Goals", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
    { key: "predicted_ml_winner", label: "Pick", type: "enum", required: true, options: ["home", "away", "draw"], scope: "top_level" },
    { key: "home_win_pct", label: "Home Win %", type: "percent", required: true, min: 0, max: 100, scope: "sport_specific" },
    { key: "draw_pct", label: "Draw %", type: "percent", required: true, min: 0, max: 100, scope: "sport_specific" },
    { key: "away_win_pct", label: "Away Win %", type: "percent", required: true, min: 0, max: 100, scope: "sport_specific" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// NCAAB — V1 starts NBA-like (Daniel TBD). Auto-model in Phase 11.
// ─────────────────────────────────────────────────────────────────────────
export const NCAAB_SCHEMA: SportSchema = {
  sport: "cbb",
  displayName: "NCAAB 🏀",
  fields: [
    { key: "predicted_home_score", label: "Home Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_away_score", label: "Away Score", type: "number", required: true, min: 0, scope: "top_level", decimal: true },
    { key: "predicted_total", label: "Predicted Total", type: "number", required: true, min: 0, scope: "top_level", computeFrom: "predicted_home_score + predicted_away_score" },
    { key: "listed_line", label: "Listed Line", type: "number", required: false, scope: "sport_specific", helpText: "Sportsbook total at upload" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Schema registry — single source of truth for per-sport routing
// ─────────────────────────────────────────────────────────────────────────
export const SPORT_SCHEMAS: Record<Sport, SportSchema> = {
  mlb:  MLB_SCHEMA,
  nba:  NBA_SCHEMA,
  nfl:  NFL_SCHEMA,
  nhl:  NHL_SCHEMA,
  ucl:  UCL_SCHEMA,
  cfb:  NCAAF_SCHEMA,
  cbb:  NCAAB_SCHEMA,
};

export function getSportSchema(sport: Sport): SportSchema {
  const schema = SPORT_SCHEMAS[sport];
  if (!schema) {
    throw new Error(`No scores-model schema defined for sport '${sport}'`);
  }
  return schema;
}
