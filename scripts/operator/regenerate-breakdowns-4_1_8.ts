/**
 * Phase 4.1.8.B — controlled v2 breakdown regeneration smoke.
 *
 * ⚠ IMPORTANT — THIS IS NOT A BREAKDOWN-ONLY PATCH SCRIPT.
 *
 * The script calls `generatePredictionsForSlate(writeToDb=true)`, which
 * runs the entire current model pipeline end-to-end for the targeted
 * slate. That includes:
 *   • Re-running mlbAutoModelV1 → fresh predicted_ml_winner, predicted_ou_side,
 *     predicted_nrfi, predicted_home_score, predicted_away_score,
 *     predicted_total, and per-market confidence values.
 *   • Ingest UPDATEs of the game_predictions row (12 fields per market).
 *   • marketSignalDerivationService re-deriving per-pick market_signal.
 *   • gradeDerivationService re-deriving per-pick ml_grade / ou_grade /
 *     nrfi_grade.
 *   • THEN the breakdown step writes sport_specific.breakdown_v2 +
 *     operator_detail + breakdown_version + breakdown_generated_at.
 *
 * Side effect verified during Phase 4.1.8.B controlled smoke on 2026-05-22:
 * 98 field-level changes occurred across grade/confidence/pick columns
 * on the 12-row slate, none of them caused by the breakdown step. The
 * source of the changes is the modern pipeline producing different
 * outputs than the slate's last-persisted state (FI ERA integration,
 * threshold recalibration from Phase 3.x, etc.).
 *
 * Treat this script as a FULL CONTROLLED REGENERATION + write smoke, not
 * a surgical breakdown patch. If you need to patch ONLY breakdown JSONB
 * without touching grades or predictions, write a different operator
 * script that bypasses generatePredictionsForSlate.
 *
 * Two-key write gate (fail-closed):
 *   1. ENV: process.env.PICK_BREAKDOWN_GEN_ENABLED === "true"
 *      Required for the generator to fire inside automodelService at all.
 *   2. CLI: --write flag explicitly passed
 *      Without --write the script runs in dry-run mode (writeToDb=false).
 *   3. (Inherited from automodelService) process.env.AUTOMODEL_DB_WRITES_ENABLED
 *      === "true" — defense-in-depth check inside the orchestrator. The
 *      script does not set this; the operator must pass it on the command
 *      line for any write to actually happen.
 *
 * Slate guard: the script refuses to run against any slate_date other than
 * 2026-05-22 unless --allow-other-date is also passed. The 5/22 slate is
 * the only one approved for the controlled smoke per Phase 4.1.8.B plan.
 *
 * Usage:
 *
 *   # DRY-RUN (always safe — no DB writes regardless of env flag)
 *   PICK_BREAKDOWN_GEN_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *     scripts/operator/regenerate-breakdowns-4_1_8.ts \
 *     --sport mlb --date 2026-05-22
 *
 *   # WRITE-ENABLED (requires explicit operator approval each invocation)
 *   PICK_BREAKDOWN_GEN_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *     scripts/operator/regenerate-breakdowns-4_1_8.ts \
 *     --sport mlb --date 2026-05-22 --write
 *
 * Behavior:
 *   1. Pre-flight: validate both gate keys; abort with clear error if missing.
 *   2. Pre-write snapshot: query game_predictions for the slate; count rows
 *      with breakdown_v2.model_breakdown (expect 0 pre-regen on 5/22), count
 *      rows with legacy member_summary, count total rows (expect 12 on 5/22).
 *   3. Run generatePredictionsForSlate with writeToDb = (mode === "write").
 *   4. Post-write verification (when --write): re-query the same shapes,
 *      confirm v2 count = total, legacy count = 0, version = "v2.0",
 *      breakdown_generated_at recent.
 *   5. Per-game printout: model_breakdown text + verdict + sharpRead.
 *
 * Safety:
 *   • Cannot write without --write AND PICK_BREAKDOWN_GEN_ENABLED=true.
 *   • Slate date hard-coded to 2026-05-22 unless --allow-other-date.
 *   • No new providers, no LLM, no third-party calls beyond what
 *     generatePredictionsForSlate already does.
 *   • Per-game try/catch in automodelService (already present) prevents
 *     a single game failure from poisoning the batch.
 */
import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";
import type { Grade } from "../../lib/types/domain/Grade";
import {
  deriveVerdict,
  VERDICT_LABEL,
  type Verdict,
} from "../../lib/services/verdictDerivation";
import {
  selectSharpReadKey,
  SHARP_READ_SENTENCES,
  type SharpReadMarket,
  type SharpSignalProjection,
} from "../../lib/services/sharpReadSelector";

// ─── CLI args ────────────────────────────────────────────────────────

type ParsedArgs = {
  sport: Sport;
  date: string;
  write: boolean;
  allowOtherDate: boolean;
};

const APPROVED_SLATE_DATE = "2026-05-22";

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let sport: Sport = "mlb";
  let date = APPROVED_SLATE_DATE;
  let write = false;
  let allowOtherDate = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sport" && args[i + 1]) {
      sport = args[i + 1] as Sport;
      i++;
    } else if (args[i] === "--date" && args[i + 1]) {
      date = args[i + 1]!;
      i++;
    } else if (args[i] === "--write") {
      write = true;
    } else if (args[i] === "--allow-other-date") {
      allowOtherDate = true;
    }
  }
  return { sport, date, write, allowOtherDate };
}

// ─── Pre-flight gate validation ──────────────────────────────────────

function preflight(args: ParsedArgs): "dry-run" | "write" {
  if (process.env.PICK_BREAKDOWN_GEN_ENABLED !== "true") {
    console.error(
      "✗ ABORT — PICK_BREAKDOWN_GEN_ENABLED env flag is not set to 'true'."
    );
    console.error(
      "  Even dry-run requires this flag because automodelService gates the"
    );
    console.error(
      "  generator call on it. Run with: PICK_BREAKDOWN_GEN_ENABLED=true npx tsx ..."
    );
    process.exit(1);
  }
  if (args.sport !== "mlb") {
    console.error(
      `✗ ABORT — sport '${args.sport}' not supported in V1 (MLB only).`
    );
    process.exit(1);
  }
  if (args.date !== APPROVED_SLATE_DATE && !args.allowOtherDate) {
    console.error(
      `✗ ABORT — slate_date '${args.date}' is not the approved 4.1.8.B smoke target.`
    );
    console.error(
      `  Approved slate: ${APPROVED_SLATE_DATE}. To override, pass --allow-other-date.`
    );
    process.exit(1);
  }
  return args.write ? "write" : "dry-run";
}

// ─── DB helpers (read-only) ──────────────────────────────────────────

type SnapshotRow = {
  game_external_id: number;
  has_v2: boolean;
  v2_text: string | null;
  legacy_text: string | null;
  version: string | null;
  generated_at: string | null;
  ml_grade: Grade | null;
  ou_grade: Grade | null;
  nrfi_grade: Grade | null;
  ml_confidence: number | null;
  ou_confidence: number | null;
  nrfi_confidence: number | null;
  game_id: number;
};

async function snapshotSlate(sport: Sport, date: string): Promise<SnapshotRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select(
      `id, external_id,
       game_predictions (
         ml_grade, ou_grade, nrfi_grade,
         ml_confidence, ou_confidence, nrfi_confidence,
         sport_specific
       )`
    )
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("external_id", { ascending: true });
  if (error) {
    console.error(`✗ DB query failed: ${error.message}`);
    process.exit(1);
  }
  type Row = {
    id: number;
    external_id: number;
    game_predictions: {
      ml_grade: Grade | null;
      ou_grade: Grade | null;
      nrfi_grade: Grade | null;
      ml_confidence: number | null;
      ou_confidence: number | null;
      nrfi_confidence: number | null;
      sport_specific: Record<string, unknown> | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter((r) => r.game_predictions !== null)
    .map((r) => {
      const ss = (r.game_predictions!.sport_specific ?? {}) as Record<string, unknown>;
      const v2Obj = ss.breakdown_v2 as Record<string, unknown> | undefined;
      const v2Text =
        v2Obj &&
        typeof v2Obj === "object" &&
        typeof v2Obj.model_breakdown === "string"
          ? (v2Obj.model_breakdown as string)
          : null;
      const legacy =
        typeof ss.member_summary === "string"
          ? (ss.member_summary as string)
          : null;
      return {
        game_external_id: r.external_id,
        game_id: r.id,
        has_v2: v2Text !== null,
        v2_text: v2Text,
        legacy_text: legacy,
        version: typeof ss.breakdown_version === "string" ? (ss.breakdown_version as string) : null,
        generated_at:
          typeof ss.breakdown_generated_at === "string"
            ? (ss.breakdown_generated_at as string)
            : null,
        ml_grade: r.game_predictions!.ml_grade,
        ou_grade: r.game_predictions!.ou_grade,
        nrfi_grade: r.game_predictions!.nrfi_grade,
        ml_confidence: r.game_predictions!.ml_confidence,
        ou_confidence: r.game_predictions!.ou_confidence,
        nrfi_confidence: r.game_predictions!.nrfi_confidence,
      };
    });
}

function printSnapshot(label: string, snap: SnapshotRow[]): void {
  const v2Count = snap.filter((r) => r.has_v2).length;
  const legacyCount = snap.filter((r) => r.legacy_text !== null).length;
  console.log("");
  console.log(`${label}:`);
  console.log(`  total rows:                ${snap.length}`);
  console.log(`  rows with breakdown_v2:    ${v2Count}`);
  console.log(`  rows with member_summary:  ${legacyCount}`);
}

// ─── Sharp signal projection (mirrors route.ts) ──────────────────────

function deriveDirection(grade: Grade | null): "positive" | "negative" | "neutral" {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "positive";
  if (grade === "sharp_conflict") return "negative";
  return "neutral";
}

async function loadSharpProjection(
  gameIds: number[]
): Promise<Map<number, Array<{ market_type: string }>>> {
  const { data, error } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type")
    .in("game_id", gameIds);
  if (error) {
    console.error(`✗ sharp_signals query failed: ${error.message}`);
    process.exit(1);
  }
  const out = new Map<number, Array<{ market_type: string }>>();
  for (const row of (data ?? []) as Array<{ game_id: number; market_type: string }>) {
    const arr = out.get(row.game_id) ?? [];
    arr.push({ market_type: row.market_type });
    out.set(row.game_id, arr);
  }
  return out;
}

// ─── Per-row verdict + sharpRead derivation (mirrors route.ts) ───────

const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

function headlineFor(
  row: SnapshotRow
): { grade: Grade | null; market: SharpReadMarket | null } {
  const candidates: Array<{ grade: Grade; market: SharpReadMarket; precedence: number }> = [];
  if (row.ml_grade !== null)
    candidates.push({ grade: row.ml_grade, market: "ml", precedence: 0 });
  if (row.ou_grade !== null)
    candidates.push({ grade: row.ou_grade, market: "total", precedence: 1 });
  if (row.nrfi_grade !== null)
    candidates.push({ grade: row.nrfi_grade, market: "nrfi", precedence: 2 });
  candidates.sort((a, b) => {
    const r = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });
  return {
    grade: candidates[0]?.grade ?? null,
    market: candidates[0]?.market ?? null,
  };
}

function projectFor(
  signals: Array<{ market_type: string }>,
  row: SnapshotRow
): SharpSignalProjection[] {
  return signals.map((s) => {
    let market: SharpReadMarket;
    let grade: Grade | null;
    if (s.market_type === "moneyline") {
      market = "ml";
      grade = row.ml_grade;
    } else if (s.market_type === "total") {
      market = "total";
      grade = row.ou_grade;
    } else {
      market = "nrfi";
      grade = row.nrfi_grade;
    }
    return { market, direction: deriveDirection(grade) };
  });
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const mode = preflight(args);

  console.log("");
  console.log("═".repeat(96));
  console.log(
    `Phase 4.1.8.B v2 breakdown regen smoke — sport=${args.sport} · slate_date=${args.date} · MODE=${mode === "write" ? "WRITE ENABLED" : "DRY-RUN"}`
  );
  console.log(
    `Two-key gate: env PICK_BREAKDOWN_GEN_ENABLED=true ✓ · --write ${mode === "write" ? "✓" : "✗ (dry-run only)"}`
  );
  console.log("═".repeat(96));

  // ─── Pre-write snapshot ─────────────────────────────────────────────
  const pre = await snapshotSlate(args.sport, args.date);
  if (pre.length === 0) {
    console.error(`✗ No predictions found for ${args.sport} / ${args.date}`);
    process.exit(1);
  }
  printSnapshot("Pre-write snapshot", pre);

  // ─── Run generator (write=mode-dependent) ───────────────────────────
  console.log("");
  console.log(`Running generatePredictionsForSlate(writeToDb=${mode === "write"})...`);
  const result = await generatePredictionsForSlate(
    args.sport,
    args.date,
    "morning_draft",
    { writeToDb: mode === "write" }
  );
  console.log(
    `  predictions: ${result.predictions.length}  ·  errors: ${result.errors.length}`
  );
  if (result.errors.length > 0) {
    console.log("  Errors:");
    for (const e of result.errors) {
      console.log(`    ext=${e.game_external_id}: ${e.error}`);
    }
  }
  if (mode === "write" && result.db_writes !== null) {
    console.log("  db_writes:");
    console.log(`    ingest:         ${JSON.stringify(result.db_writes.ingest)}`);
    console.log(`    market_signals: ${JSON.stringify(result.db_writes.market_signals)}`);
    console.log(`    grades:         ${JSON.stringify(result.db_writes.grades)}`);
  }

  // ─── Post-write verification (when --write) ─────────────────────────
  let post: SnapshotRow[] | null = null;
  if (mode === "write") {
    post = await snapshotSlate(args.sport, args.date);
    printSnapshot("Post-write snapshot", post);

    const expectedTotal = pre.length;
    const v2Count = post.filter((r) => r.has_v2).length;
    const legacyCount = post.filter((r) => r.legacy_text !== null).length;
    const versionAll = post.every((r) => r.version === "v2.0");
    const generatedAtFresh = post.every((r) => {
      if (!r.generated_at) return false;
      const ts = Date.parse(r.generated_at);
      return Date.now() - ts < 5 * 60 * 1000; // within 5 minutes
    });

    console.log("");
    console.log("Post-write checks:");
    console.log(
      `  v2 count = total rows:        ${v2Count === expectedTotal ? "✓" : "✗"} (${v2Count}/${expectedTotal})`
    );
    console.log(
      `  legacy member_summary count:  ${legacyCount === 0 ? "✓ (0)" : `✗ (${legacyCount} — expected 0 per Sub-D1)`}`
    );
    console.log(
      `  all rows have version="v2.0": ${versionAll ? "✓" : "✗"}`
    );
    console.log(
      `  breakdown_generated_at fresh: ${generatedAtFresh ? "✓ (within 5min)" : "✗"}`
    );
  }

  // ─── Per-game printout with derived verdict + sharpRead ─────────────
  const snapshotForPrint = post ?? pre;
  const gameIds = snapshotForPrint.map((r) => r.game_id);
  const sharpByGameId = await loadSharpProjection(gameIds);

  console.log("");
  console.log("─".repeat(96));
  console.log("Per-game v2 breakdown + derived verdict + derived sharpRead:");
  console.log("─".repeat(96));
  for (const row of snapshotForPrint) {
    const { grade, market } = headlineFor(row);
    const verdict: Verdict = deriveVerdict({
      headlineGrade: grade,
      perMarketConfidence: {
        ml: row.ml_confidence !== null ? row.ml_confidence / 100 : null,
        total: row.ou_confidence !== null ? row.ou_confidence / 100 : null,
        nrfi: row.nrfi_confidence !== null ? row.nrfi_confidence / 100 : null,
      },
    });
    const signals = sharpByGameId.get(row.game_id) ?? [];
    const sharpReadKey = selectSharpReadKey({
      headlineGrade: grade,
      headlineMarket: market,
      sharpSignals: projectFor(signals, row),
    });
    const sharpReadSentence = SHARP_READ_SENTENCES[sharpReadKey];
    const text =
      row.v2_text ?? row.legacy_text ?? "(no breakdown text on row)";
    console.log("");
    console.log(`ext=${row.game_external_id}`);
    console.log(
      `  headline:        grade=${grade ?? "—"}  market=${market ?? "—"}`
    );
    console.log(`  verdict:         ${VERDICT_LABEL[verdict]}`);
    console.log(`  sharp_read:      ${sharpReadSentence}`);
    console.log(
      `  model_breakdown: ${text}  (${text.length} chars, ${row.has_v2 ? "v2" : row.legacy_text ? "legacy v1" : "none"})`
    );
  }

  console.log("");
  console.log("═".repeat(96));
  if (mode === "write") {
    console.log("WRITE smoke complete. Rerun verification SQL V-B1 through V-B5 if desired.");
  } else {
    console.log("DRY-RUN complete. No DB writes performed.");
    console.log("To run the write smoke, re-invoke with --write and explicit approval.");
  }
  console.log("═".repeat(96));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
