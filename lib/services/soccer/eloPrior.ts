/**
 * Elo team-strength prior loader — WC-3.
 *
 * Loads a snapshot CSV of Elo ratings for all 48 FIFA WC 2026 teams.
 * Pure module — reads from the filesystem at startup, then serves
 * synchronous lookups. No HTTP, no DB.
 *
 * The snapshot is committed in `data/wc2026_elo_snapshot_*.csv` with
 * source URL, retrieval date, and operator-verifiable values. Any update
 * is a new file + a calibration_version bump (per
 * project-wc-model-standard).
 *
 * Lookup interface:
 *   • lookupByCountryCode(code) — primary path; BDL teams expose
 *     country_code.
 *   • lookupByTeamName(name) — fallback with asciiFold for accent
 *     tolerance ("São Tomé and Príncipe" matches "Sao Tome and Principe").
 *   • zScore(elo) — for converting raw Elo to the unit-normal scale
 *     used by attack/defense parameters in dixonColes.ts.
 *
 * If a team is missing from the snapshot, callers MUST hold the fixture
 * (NOT silently substitute a confederation median) — the model standard
 * requires source-backed strength. The auto-model orchestrator handles
 * this with a hold_reason.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export type EloRow = {
  team_name: string;
  country_code: string;
  elo_rating: number;
  confederation: string;
  source_url: string;
  retrieval_date: string;
  notes: string;
};

/** Snapshot metadata exposed for provenance fields in every prediction. */
export type EloSnapshotMeta = {
  /** Filename of the loaded snapshot. */
  snapshot_filename: string;
  /** Source URL string from the CSV. */
  source_url: string;
  /** Date the data was retrieved (per the CSV). */
  retrieval_date: string;
  /** Number of teams in the snapshot. */
  team_count: number;
  /** Mean Elo across the snapshot — used for z-scoring. */
  mean_elo: number;
  /** Population standard deviation of Elo — used for z-scoring. */
  stddev_elo: number;
};

const DEFAULT_SNAPSHOT_PATH = "data/wc2026_elo_snapshot_2026-06-11.csv";

function asciiFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(raw: string): EloRow[] {
  const rows: EloRow[] = [];
  const lines = raw.split(/\r?\n/);
  // First non-comment, non-empty line is the header.
  let header: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    const fields = trimmed.split(",");
    if (header === null) {
      header = fields.map((f) => f.trim());
      continue;
    }
    // Pad missing trailing fields with empty strings.
    while (fields.length < header.length) fields.push("");
    const get = (col: string): string => fields[header!.indexOf(col)]?.trim() ?? "";
    const elo = Number(get("elo_rating"));
    if (!Number.isFinite(elo)) continue;
    rows.push({
      team_name: get("team_name"),
      country_code: get("country_code"),
      elo_rating: elo,
      confederation: get("confederation"),
      source_url: get("source_url"),
      retrieval_date: get("retrieval_date"),
      notes: get("notes"),
    });
  }
  return rows;
}

function computeMeta(rows: EloRow[], filename: string): EloSnapshotMeta {
  const elos = rows.map((r) => r.elo_rating);
  const mean = elos.reduce((s, v) => s + v, 0) / elos.length;
  const variance = elos.reduce((s, v) => s + (v - mean) ** 2, 0) / elos.length;
  const stddev = Math.sqrt(variance);
  const first = rows[0];
  return {
    snapshot_filename: filename,
    source_url: first?.source_url ?? "(unknown)",
    retrieval_date: first?.retrieval_date ?? "(unknown)",
    team_count: rows.length,
    mean_elo: mean,
    stddev_elo: stddev,
  };
}

export class EloPriorTable {
  private readonly byCountryCode: Map<string, EloRow>;
  private readonly byTeamNameFolded: Map<string, EloRow>;
  public readonly meta: EloSnapshotMeta;

  constructor(rows: EloRow[], filename: string) {
    this.byCountryCode = new Map();
    this.byTeamNameFolded = new Map();
    for (const r of rows) {
      if (r.country_code.length > 0) this.byCountryCode.set(r.country_code.toUpperCase(), r);
      if (r.team_name.length > 0) this.byTeamNameFolded.set(asciiFold(r.team_name), r);
    }
    this.meta = computeMeta(rows, filename);
  }

  lookupByCountryCode(code: string): EloRow | null {
    if (typeof code !== "string" || code.length === 0) return null;
    return this.byCountryCode.get(code.toUpperCase()) ?? null;
  }

  lookupByTeamName(name: string): EloRow | null {
    if (typeof name !== "string" || name.length === 0) return null;
    return this.byTeamNameFolded.get(asciiFold(name)) ?? null;
  }

  /** Convert raw Elo to z-score against the snapshot's mean and stddev. */
  zScore(elo: number): number {
    if (this.meta.stddev_elo === 0) return 0;
    return (elo - this.meta.mean_elo) / this.meta.stddev_elo;
  }
}

/** Default loader — reads the committed snapshot from disk. Memoized. */
let _defaultTable: EloPriorTable | null = null;

export function loadDefaultEloPrior(): EloPriorTable {
  if (_defaultTable !== null) return _defaultTable;
  const absPath = path.resolve(process.cwd(), DEFAULT_SNAPSHOT_PATH);
  if (!existsSync(absPath)) {
    throw new Error(
      `Elo snapshot not found at ${absPath}. Soccer model requires a committed snapshot before producing predictions (project-wc-model-standard §1).`,
    );
  }
  const raw = readFileSync(absPath, "utf-8");
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    throw new Error(`Elo snapshot at ${absPath} parsed to 0 rows`);
  }
  _defaultTable = new EloPriorTable(rows, DEFAULT_SNAPSHOT_PATH);
  return _defaultTable;
}

/** Build a table from a raw CSV string. Useful for tests. */
export function buildEloPriorFromCsv(csvContents: string, filename = "<test>"): EloPriorTable {
  const rows = parseCsv(csvContents);
  return new EloPriorTable(rows, filename);
}
