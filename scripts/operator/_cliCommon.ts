/**
 * Phase 4B — shared CLI helpers for operator scripts.
 *
 * Underscore prefix follows the repo convention (lib/services/_idMaps.ts,
 * lib/providers/mlb/_bdlClient.ts) for "internal — not a public surface".
 *
 * Centralizes the `--write` rejection so all 6 Phase 4B scripts emit
 * an IDENTICAL error message pointing operators to Phase 4C. Also
 * provides minimal arg parsing for the flags every script accepts:
 *   --date YYYY-MM-DD   (default: today UTC)
 *   --sport mlb         (default: mlb; V1 MLB-only)
 *   --json              (default: text output)
 *   --verbose           (default: false; per-game detail)
 *
 * NOT a CLI parsing library — intentionally tiny. Each script parses
 * its OWN unique flags inline; this module covers only the universal
 * ones plus the write-rejection guard.
 *
 * Phase 4B scope only. Phase 4C scripts will REPLACE the write-
 * rejection helper with a proper two-key gate (--write + env flag).
 */

import type { Sport } from "../../lib/types/domain/Sport";

export type CommonCliOptions = {
  date: string;
  sport: Sport;
  json: boolean;
  verbose: boolean;
};

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl", "ucl", "cfb", "cbb"];

/**
 * Reject --write for scripts that are READ-ONLY by design (status,
 * show-deltas). Call FIRST in those scripts' main(), before any other
 * parsing or I/O.
 *
 * Phase 4C-write-capable scripts use `validateWriteGate` instead.
 */
export function rejectWriteFlag(argv: string[]): void {
  if (argv.includes("--write")) {
    console.error(
      "✗ --write is not supported by this script.\n" +
        "  This script is READ-ONLY by design. Use\n" +
        "  automodel-morning-card.ts / -t60-refresh.ts / -rerun-game.ts /\n" +
        "  -rerun-held.ts for write-capable operator flows."
    );
    process.exit(1);
  }
}

/**
 * Phase 4C — three-key write gate for the 4 write-capable scripts
 * (morning-card / t60-refresh / rerun-game / rerun-held).
 *
 * Returns:
 *   { writeMode: false } — operator omitted --write; script runs dry-run
 *   { writeMode: true }  — --write present AND env flag set; script writes
 *
 * Exits process with code 1 when:
 *   --write present AND AUTOMODEL_DB_WRITES_ENABLED !== "true"
 *
 * Defense in depth: the orchestrator service also enforces the env
 * check internally (Phase 3C two-key gate). This script-level check
 * gives the operator a clearer error message at the CLI surface
 * BEFORE any DB I/O.
 */
export function validateWriteGate(argv: string[]): {
  writeMode: boolean;
} {
  const writeFlag = argv.includes("--write");
  if (!writeFlag) return { writeMode: false };
  const envEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  if (!envEnabled) {
    console.error(
      "✗ --write requires AUTOMODEL_DB_WRITES_ENABLED=true in the\n" +
        "  environment. Defense in depth: both opt-ins must be present\n" +
        "  before any DB write. To opt in for this command:\n\n" +
        "    AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n" +
        "      scripts/operator/<script>.ts --write [...other flags]\n"
    );
    process.exit(1);
  }
  return { writeMode: true };
}

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse a string flag like `--date 2026-05-22` or `--date=2026-05-22`. */
export function readStringFlag(
  argv: readonly string[],
  flagName: string
): string | undefined {
  const eqPrefix = `${flagName}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === flagName) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      return next;
    }
    if (a.startsWith(eqPrefix)) {
      return a.slice(eqPrefix.length);
    }
  }
  return undefined;
}

/** Parse a number flag (e.g. --window-minutes 75). NaN → undefined. */
export function readNumberFlag(
  argv: readonly string[],
  flagName: string
): number | undefined {
  const s = readStringFlag(argv, flagName);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** True when --flag (with or without value-less form) appears in argv. */
export function readBoolFlag(
  argv: readonly string[],
  flagName: string
): boolean {
  return argv.includes(flagName);
}

/**
 * Parse the 4 universal flags every operator script accepts. Validates
 * basic shape; defaults date to today UTC and sport to mlb.
 *
 * Returns the parsed options, OR throws with a clear message if the
 * caller-supplied values are invalid (bad date format, unknown sport).
 */
export function parseCommonCliOptions(
  argv: readonly string[]
): CommonCliOptions {
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `Invalid --date "${date}". Expected YYYY-MM-DD (e.g. 2026-05-22).`
    );
  }
  const sportRaw = readStringFlag(argv, "--sport") ?? "mlb";
  if (!VALID_SPORTS.includes(sportRaw as Sport)) {
    throw new Error(
      `Invalid --sport "${sportRaw}". Expected one of: ${VALID_SPORTS.join(", ")}.`
    );
  }
  const sport = sportRaw as Sport;
  const json = readBoolFlag(argv, "--json");
  const verbose = readBoolFlag(argv, "--verbose");
  return { date, sport, json, verbose };
}

/**
 * Validate and parse a ModelStage flag. Throws on unknown stage. Used
 * by the rerun scripts which accept --stage morning_draft|t60_locked.
 */
export function parseStageFlag(
  argv: readonly string[],
  defaultStage: "morning_draft" | "t60_locked"
): "morning_draft" | "t60_locked" {
  const raw = readStringFlag(argv, "--stage") ?? defaultStage;
  if (raw !== "morning_draft" && raw !== "t60_locked") {
    throw new Error(
      `Invalid --stage "${raw}". Expected morning_draft or t60_locked.`
    );
  }
  return raw;
}

/**
 * Print the script's startup banner. Standardized format makes it
 * obvious when an operator is running dry-run vs (future Phase 4C)
 * write mode.
 */
export function printBanner(
  scriptName: string,
  opts: CommonCliOptions,
  extras: Record<string, unknown> = {}
): void {
  const kvPairs = [
    "mode=DRY-RUN",
    `sport=${opts.sport}`,
    `date=${opts.date}`,
    `json=${opts.json}`,
    `verbose=${opts.verbose}`,
    ...Object.entries(extras).map(([k, v]) => `${k}=${v}`),
  ];
  console.log(`[${scriptName}] ${kvPairs.join(" ")}`);
}

/**
 * Print a report as JSON when --json, else call the text-formatter
 * callback. Wrapper so each script doesn't repeat the if/else.
 */
export function emitReport(
  report: unknown,
  opts: CommonCliOptions,
  formatText: () => void
): void {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    formatText();
  }
}
