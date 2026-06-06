/**
 * Push 4 — pure CSV parser for the legacy tracking baseline.
 *
 * The CSV the operator hands us has this exact shape (header row +
 * 17 data rows in the launch import):
 *
 *   Model Tracking,Lifetime Tally,Lifetime %,Current Season,Weekly Tally,%
 *   NFL (ML) 🏈,181/284,63.7%,,,
 *   MLB (ML) ⚾,1705/3027,56.3%,502/949,73/144,
 *
 * Parsing rules:
 *   - Tally fields ("181/284") split on "/" into wins + total.
 *   - Percent fields ("63.7%") strip the trailing "%" and parse as float.
 *   - Blank Current Season / Weekly cells parse to null (no fake zeros).
 *   - The trailing "%" column (weekly_pct) is observed to be empty in
 *     the launch CSV; computed from weekly tally if present.
 *
 * Label → (sport, market) mapping:
 *   "MLB (ML) ⚾"          → mlb, moneyline
 *   "MLB (O/U*) ⚾"        → mlb, total
 *   "MLB (NRFI/YRFI) ⚾"   → mlb, first_inning
 *   "MLB (NRFI*) ⚾"       → mlb, nrfi
 *   "MLB (YRFI*) ⚾"       → mlb, yrfi
 *   "UCL (Double Chance) ⚽" → ucl, double_chance
 *   (full table inline below)
 *
 * Anything that doesn't match the table yields a parse error rather
 * than a silent skip — we want a vocal failure if a label is added.
 *
 * Pure: no DB, no FS, no network. Operator script reads the file and
 * passes the text in.
 */

import type {
  TrackingBaselineRow,
  TrackedSport,
  TrackedMarketV17,
} from "../types/domain/Tracking";

export type CsvParseError = {
  line: number;
  raw: string;
  reason: string;
};

export type CsvParseResult = {
  rows: TrackingBaselineRow[];
  errors: CsvParseError[];
};

const LABEL_MAP: Record<string, { sport: TrackedSport; market: TrackedMarketV17 }> = {
  "NFL (ML)": { sport: "nfl", market: "moneyline" },
  "NFL (O/U)": { sport: "nfl", market: "total" },
  "CFB (ML)": { sport: "cfb", market: "moneyline" },
  "CFB (O/U)": { sport: "cfb", market: "total" },
  "NBA (ML)": { sport: "nba", market: "moneyline" },
  "NBA (O/U's)": { sport: "nba", market: "total" },
  "CBB (ML)": { sport: "cbb", market: "moneyline" },
  "CBB (O/U's)": { sport: "cbb", market: "total" },
  "MLB (ML)": { sport: "mlb", market: "moneyline" },
  "MLB (NRFI/YRFI)": { sport: "mlb", market: "first_inning" },
  "MLB (NRFI*)": { sport: "mlb", market: "nrfi" },
  "MLB (YRFI*)": { sport: "mlb", market: "yrfi" },
  "MLB (O/U*)": { sport: "mlb", market: "total" },
  "UCL (ML)": { sport: "ucl", market: "moneyline" },
  "UCL (Double Chance)": { sport: "ucl", market: "double_chance" },
  "NHL (ML)": { sport: "nhl", market: "moneyline" },
  "NHL (O/U)": { sport: "nhl", market: "total" },
};

// Strip trailing emoji + whitespace, leaving the canonical label key.
function normalizeLabel(raw: string): string {
  // Remove anything past the closing ")" of the label parens. The CSV
  // labels are all "<SPORT> (<MARKET>) <EMOJI>".
  const closeParen = raw.lastIndexOf(")");
  if (closeParen === -1) return raw.trim();
  return raw.slice(0, closeParen + 1).trim();
}

function parseTally(raw: string): { wins: number; total: number } | null {
  if (raw.trim().length === 0) return null;
  const m = raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m === null) return null;
  const wins = Number.parseInt(m[1], 10);
  const total = Number.parseInt(m[2], 10);
  if (!Number.isFinite(wins) || !Number.isFinite(total)) return null;
  if (total < 0 || wins < 0 || wins > total) return null;
  return { wins, total };
}

function parsePct(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  const cleaned = raw.replace(/%/g, "").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// CSV line splitter — handles the simple no-quoted-comma case our
// known CSV has. The launch file has no embedded commas in labels.
function splitCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.replace(/\r$/, ""));
}

/**
 * Parse a CSV text body into TrackingBaselineRow objects ready for
 * upsert.
 *
 * `importedFrom` becomes the row's `imported_from` field and pairs
 * with `source_label` to form the UPSERT key.
 */
export function parseTrackingBaselineCsv(
  csvText: string,
  importedFrom: string,
): CsvParseResult {
  const lines = csvText.split(/\r?\n/);
  const errors: CsvParseError[] = [];
  const rows: TrackingBaselineRow[] = [];
  if (lines.length === 0) {
    errors.push({ line: 0, raw: "", reason: "empty CSV" });
    return { rows, errors };
  }
  // Skip header line if present
  const startIndex = /Model\s*Tracking/i.test(lines[0]) ? 1 : 0;
  for (let i = startIndex; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const cells = splitCsvLine(raw);
    if (cells.length < 3) {
      errors.push({ line: i + 1, raw, reason: `expected >=3 columns, got ${cells.length}` });
      continue;
    }
    const labelRaw = cells[0] ?? "";
    const label = normalizeLabel(labelRaw);
    const mapping = LABEL_MAP[label];
    if (mapping === undefined) {
      errors.push({ line: i + 1, raw, reason: `unknown label "${label}" (raw: "${labelRaw}")` });
      continue;
    }
    const lifetimeTally = parseTally(cells[1] ?? "");
    if (lifetimeTally === null) {
      errors.push({ line: i + 1, raw, reason: `bad lifetime tally "${cells[1] ?? ""}"` });
      continue;
    }
    const lifetimePct = parsePct(cells[2] ?? "");
    if (lifetimePct === null) {
      errors.push({ line: i + 1, raw, reason: `bad lifetime pct "${cells[2] ?? ""}"` });
      continue;
    }
    const csTally = parseTally(cells[3] ?? "");
    const weeklyTally = parseTally(cells[4] ?? "");
    const weeklyPctRaw = cells[5] ?? "";
    const weeklyPctParsed = parsePct(weeklyPctRaw);

    // Derive current-season % from the tally (CSV omits it for most rows).
    const currentSeasonPct =
      csTally !== null && csTally.total > 0
        ? Math.round((csTally.wins / csTally.total) * 1000) / 10
        : null;
    // Same for weekly when the CSV % column is blank.
    const weeklyPctFinal =
      weeklyPctParsed !== null
        ? weeklyPctParsed
        : weeklyTally !== null && weeklyTally.total > 0
        ? Math.round((weeklyTally.wins / weeklyTally.total) * 1000) / 10
        : null;

    rows.push({
      source_label: labelRaw.trim(),
      sport: mapping.sport,
      market: mapping.market,
      model_family: "legacy",
      lifetime_wins: lifetimeTally.wins,
      lifetime_total: lifetimeTally.total,
      lifetime_pct: lifetimePct,
      current_season_wins: csTally?.wins ?? null,
      current_season_total: csTally?.total ?? null,
      current_season_pct: currentSeasonPct,
      weekly_wins: weeklyTally?.wins ?? null,
      weekly_total: weeklyTally?.total ?? null,
      weekly_pct: weeklyPctFinal,
      imported_from: importedFrom,
      notes: null,
    });
  }
  return { rows, errors };
}

export const __TEST__ = {
  parseTally,
  parsePct,
  normalizeLabel,
  LABEL_MAP,
};
