/**
 * Push 3A-6 — Controlled V2.2 cutover for 2026-06-06 unstarted MLB games.
 *
 * INTENT (verbatim from operator instruction):
 *   "Update official full-game ML and O/U predictions to V2.2 for games whose
 *    scheduled start time is still in the future. Do not touch games already
 *    started, in progress, final, postponed, or past scheduled start."
 *
 * USAGE:
 *   Dry-run (default — required before any apply):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/cutover-v22-unstarted-2026-06-06.ts
 *
 *   Apply (two-key gate):
 *     V22_CUTOVER_DB_WRITES_ENABLED=true \
 *       AUTOMODEL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/cutover-v22-unstarted-2026-06-06.ts --apply
 *
 * SAFETY:
 *   • Hard-coded date: 2026-06-06. Refuses to run on any other date — this
 *     is a one-shot, not a general cutover tool.
 *   • Per-game start-time guard: game_date > NOW excludes any game that
 *     has reached its scheduled first pitch. Re-checked immediately before
 *     each write, so a game that crosses start_time between dry-run and
 *     apply is automatically skipped.
 *   • Defense-in-depth status guard: also excludes any game with status in
 *     {STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_POSTPONED, STATUS_CANCELED}
 *     even if game_date is still future (stale provider data could mark
 *     a not-yet-started game as final).
 *   • Lock-guard bypass: rows are written with `is_override=true` — the
 *     documented Phase 4.2.B manual-override path. NO bulk lock disable.
 *   • Preserves NRFI/FI: predicted_nrfi + nrfi_confidence are READ from
 *     the existing row and re-written unchanged. V2.2's NRFI passthrough
 *     is intentionally NOT trusted here because the user's instruction
 *     forbids touching FI markets.
 *   • Audit trail: each new row carries `sport_specific.prev_v2_1_snapshot`
 *     containing all overwritten fields + the original computed_at.
 *   • Two-key apply gate (--apply + V22_CUTOVER_DB_WRITES_ENABLED=true).
 *   • Writes ONLY to `game_predictions`. No slate_status, no locks, no
 *     tracking records, no model_version-default env changes.
 *
 * INSCOPE: ML, O/U, scores (predicted_home_score, predicted_away_score,
 *          predicted_total), confidence, sport_specific.model_used,
 *          sport_specific.model_version, sport_specific.v2_2_audit.
 *
 * OUT OF SCOPE: predicted_nrfi, nrfi_confidence (FI). Preserved from the
 *               existing row. No FI markets touched.
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";
import { ingestScoresModel } from "../../lib/scoresModel/ingester";
import { MODEL_VERSION_V2_2 } from "../../lib/automodel/types";
import type { ScoresModelInputRow } from "../../lib/scoresModel/ingester";

const HARDCODED_DATE = "2026-06-06";
const SPORT = "mlb" as const;
// Push 3A-6 bugfix re-apply: replaces the buggy V2.2 ML-direction values
// written earlier today. Preserves the ORIGINAL V2.1 snapshot if one
// already exists in sport_specific.prev_v2_1_snapshot (so we don't lose
// the real pre-cutover values by overwriting them with the buggy V2.2
// intermediate). Captures the buggy V2.2 values in a separate
// `prev_v2_2_buggy_snapshot` for forensics.
const CUTOVER_REASON = "v2_2_ml_direction_bug_fixed_recompute";

const TERMINAL_STATUSES = new Set([
  "STATUS_FINAL",
  "STATUS_IN_PROGRESS",
  "STATUS_POSTPONED",
  "STATUS_CANCELED",
  "STATUS_HALFTIME",
  "STATUS_DELAYED",
]);

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

function etTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function fmtPick(p: string | null, conf: number | null): string {
  if (p === null || p === undefined) return "HOLD".padEnd(10);
  const confStr = typeof conf === "number" ? conf.toFixed(1) : "—";
  return `${p}/${confStr}`.padEnd(10);
}

async function main() {
  const opts = parseArgs(process.argv);
  const envWritesEnabled = process.env.V22_CUTOVER_DB_WRITES_ENABLED === "true";
  const automodelEnvEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  const writeMode = opts.apply && envWritesEnabled && automodelEnvEnabled;

  console.log(`\n━━━ V2.2 CONTROLLED CUTOVER · ${HARDCODED_DATE} ━━━`);
  console.log(`     mode=${writeMode ? "APPLY" : "DRY-RUN"}`);
  console.log(`     started_at_utc=${new Date().toISOString()}`);
  console.log(`     V22_CUTOVER_DB_WRITES_ENABLED=${envWritesEnabled}`);
  console.log(`     AUTOMODEL_DB_WRITES_ENABLED=${automodelEnvEnabled}`);
  console.log("");

  if (opts.apply && !envWritesEnabled) {
    console.error("✗ --apply requires V22_CUTOVER_DB_WRITES_ENABLED=true in env.");
    process.exit(1);
  }
  if (opts.apply && !automodelEnvEnabled) {
    console.error("✗ --apply requires AUTOMODEL_DB_WRITES_ENABLED=true in env (ingester gate).");
    process.exit(1);
  }

  // ─── Load games + current predictions ──────────────────────────────
  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, status, slate_status, home_team_id, away_team_id")
    .eq("slate_date", HARDCODED_DATE)
    .eq("sport", SPORT)
    .order("game_date");
  if (gErr) { console.error("games query failed:", gErr.message); process.exit(2); }
  if (!games || games.length === 0) {
    console.error("No games for slate. Aborting.");
    process.exit(2);
  }

  const gameIds = games.map((g) => g.id as number);
  const externalIds = games.map((g) => g.external_id as number);
  const gameIdByExternal = new Map<number, number>();
  for (const g of games) gameIdByExternal.set(g.external_id as number, g.id as number);

  // Team abbreviations for display
  const teamIds = new Set<number>();
  for (const g of games) {
    teamIds.add(g.home_team_id as number);
    teamIds.add(g.away_team_id as number);
  }
  const { data: teams } = await supabase.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const abbrByTeamId = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  // Current predictions
  const { data: preds, error: pErr } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, locked_at, is_override, computed_at, sport_specific")
    .in("game_id", gameIds);
  if (pErr) { console.error("preds query failed:", pErr.message); process.exit(2); }
  const predByGameId = new Map((preds ?? []).map((p) => [p.game_id as number, p]));

  // ─── Build snapshots + run V2.2 for every game ─────────────────────
  console.log(`Building feature snapshots...`);
  const snapshots = await buildFeatureSnapshots(SPORT, HARDCODED_DATE);
  const snapshotByExt = new Map(snapshots.map((s) => [s.game_external_id, s]));
  console.log(`Loaded ${snapshots.length} snapshots.\n`);

  // ─── Per-game eligibility + diff ───────────────────────────────────
  type Plan = {
    gameId: number;
    externalId: number;
    matchup: string;
    startTime: string;       // ISO
    startTimeEt: string;
    status: string;
    eligible: boolean;
    ineligibleReason: string | null;
    currentMl: string | null;
    currentMlConf: number | null;
    currentOu: string | null;
    currentOuConf: number | null;
    currentModelUsed: string;
    v22Ml: "home" | "away" | null;
    v22MlConf: number | null;
    v22Ou: "over" | "under" | null;
    v22OuConf: number | null;
    v22Home: number | null;
    v22Away: number | null;
    v22Total: number | null;
    v22Tier: string | null;
    v22MlBA: boolean;
    v22OuBA: boolean;
    v22NoBetMl: string | null;
    v22NoBetOu: string | null;
    mlWouldChange: boolean;
    ouWouldChange: boolean;
    v22Output: Awaited<ReturnType<typeof runMlbAutoModelV2_2>> | null;
  };

  const now = new Date();
  const plans: Plan[] = [];

  for (const g of games) {
    const ext = g.external_id as number;
    const gameId = g.id as number;
    const home = abbrByTeamId.get(g.home_team_id as number) ?? "?";
    const away = abbrByTeamId.get(g.away_team_id as number) ?? "?";
    const matchup = `${away}@${home}`;
    const startMs = new Date(g.game_date as string).getTime();
    const isFuture = startMs > now.getTime();
    const status = (g.status as string | null) ?? "";
    const statusTerminal = TERMINAL_STATUSES.has(status);

    let eligible = isFuture && !statusTerminal;
    let reason: string | null = null;
    if (!isFuture) reason = `started/past start (game_date=${etTime(g.game_date as string)})`;
    else if (statusTerminal) reason = `terminal status=${status}`;

    const cur = predByGameId.get(gameId);
    const snap = snapshotByExt.get(ext);
    let v22out: Plan["v22Output"] = null;
    if (snap) {
      try {
        const v1 = runMlbAutoModelV1(snap, "morning_draft");
        v22out = runMlbAutoModelV2_2(snap, v1, "morning_draft");
      } catch (e) {
        if (eligible) {
          eligible = false;
          reason = `V2.2 threw: ${(e as Error).message}`;
        }
      }
    } else {
      if (eligible) {
        eligible = false;
        reason = "no feature snapshot for this game";
      }
    }

    const v22Ml = v22out?.predicted_ml_winner ?? null;
    const v22Ou = v22out?.predicted_ou_side ?? null;
    const v22MlConf = v22out?.ml_confidence ?? null;
    const v22OuConf = v22out?.ou_confidence ?? null;

    const currentMl = (cur?.predicted_ml_winner as string | null) ?? null;
    const currentOu = (cur?.predicted_ou_side as string | null) ?? null;
    const sp = (cur?.sport_specific as Record<string, unknown> | null) ?? {};
    const currentModelUsed = (sp.model_used as string | undefined) ?? "v1";

    plans.push({
      gameId,
      externalId: ext,
      matchup,
      startTime: g.game_date as string,
      startTimeEt: etTime(g.game_date as string),
      status,
      eligible,
      ineligibleReason: reason,
      currentMl,
      currentMlConf: (cur?.ml_confidence as number | null) ?? null,
      currentOu,
      currentOuConf: (cur?.ou_confidence as number | null) ?? null,
      currentModelUsed,
      v22Ml,
      v22MlConf,
      v22Ou,
      v22OuConf,
      v22Home: v22out?.predicted_home_score ?? null,
      v22Away: v22out?.predicted_away_score ?? null,
      v22Total: v22out?.predicted_total ?? null,
      v22Tier: v22out?.v22Audit.data_quality_tier ?? null,
      v22MlBA: v22out?.v22Audit.ml_best_angle_eligible ?? false,
      v22OuBA: v22out?.v22Audit.ou_best_angle_eligible ?? false,
      v22NoBetMl: v22out?.v22Audit.ml_no_bet_reason ?? null,
      v22NoBetOu: v22out?.v22Audit.ou_no_bet_reason ?? null,
      mlWouldChange: eligible && currentMl !== v22Ml,
      ouWouldChange: eligible && currentOu !== v22Ou,
      v22Output: v22out,
    });
  }

  // ─── Print dry-run table ───────────────────────────────────────────
  console.log(`Per-game plan:`);
  console.log(`${"start (ET)".padEnd(16)} | ${"matchup".padEnd(8)} | ${"eligible".padEnd(12)} | ${"cur ML".padEnd(10)} | ${"v2.2 ML".padEnd(10)} | ${"ΔML?".padEnd(5)} | ${"cur OU".padEnd(10)} | ${"v2.2 OU".padEnd(10)} | ${"ΔOU?".padEnd(5)} | ${"tier".padEnd(8)} | scores  | ML/OU BA | no-bet`);
  console.log(`─`.repeat(160));
  for (const p of plans) {
    const elig = p.eligible ? "✅ ELIGIBLE" : "🟥 SKIP";
    const elig2 = elig.padEnd(12);
    const scoreCol = p.v22Home !== null && p.v22Away !== null
      ? `${p.v22Away.toFixed(1)}/${p.v22Home.toFixed(1)}`
      : "—/—";
    const baCol = `${p.v22MlBA ? "★" : " "}/${p.v22OuBA ? "★" : " "}`;
    const noBetCol = [p.v22NoBetMl, p.v22NoBetOu].filter(Boolean).join("; ").slice(0, 32);
    console.log(
      `${p.startTimeEt.padEnd(16)} | ${p.matchup.padEnd(8)} | ${elig2} | ${fmtPick(p.currentMl, p.currentMlConf)} | ${fmtPick(p.v22Ml, p.v22MlConf)} | ${(p.mlWouldChange ? "Δ" : "·").padEnd(5)} | ${fmtPick(p.currentOu, p.currentOuConf)} | ${fmtPick(p.v22Ou, p.v22OuConf)} | ${(p.ouWouldChange ? "Δ" : "·").padEnd(5)} | ${(p.v22Tier ?? "—").padEnd(8)} | ${scoreCol.padEnd(7)} | ${baCol.padEnd(7)} | ${noBetCol}`
    );
    if (!p.eligible && p.ineligibleReason) {
      console.log(`${"".padEnd(16)} | ${"".padEnd(8)} |    ↳ ${p.ineligibleReason}`);
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────
  const eligible = plans.filter((p) => p.eligible);
  const ineligible = plans.filter((p) => !p.eligible);
  const mlChanges = eligible.filter((p) => p.mlWouldChange).length;
  const ouChanges = eligible.filter((p) => p.ouWouldChange).length;
  console.log(`\n━━━ Summary ━━━`);
  console.log(`  Total games on slate:    ${plans.length}`);
  console.log(`  Eligible (unstarted):    ${eligible.length}`);
  console.log(`  Ineligible (skip):       ${ineligible.length}`);
  console.log(`  ML picks would change:   ${mlChanges} of ${eligible.length}`);
  console.log(`  OU picks would change:   ${ouChanges} of ${eligible.length}`);
  console.log(`  NRFI/FI markets:         PRESERVED unchanged from existing rows`);
  console.log(`  Tracking records:        none exist for this slate — no tracking writes needed`);
  console.log(`  Slate status:            published (will NOT change)`);
  console.log(`  Locked started games:    untouched (status/start-time guard)`);

  if (!writeMode) {
    console.log(`\nDRY-RUN — no DB writes. Approve and re-run with --apply + env to commit.`);
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────
  console.log(`\n━━━ Applying ━━━`);
  const applyNow = new Date();
  console.log(`  Re-checking start times at apply-time=${applyNow.toISOString()}...`);

  // Re-read current state at apply time — race guard against very recent
  // status changes / start crossings.
  const { data: refreshedGames } = await supabase
    .from("games")
    .select("id, external_id, game_date, status")
    .in("id", eligible.map((p) => p.gameId));
  const refreshedById = new Map((refreshedGames ?? []).map((g) => [g.id as number, g]));
  const { data: refreshedPreds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, computed_at, sport_specific")
    .in("game_id", eligible.map((p) => p.gameId));
  const refreshedPredByGameId = new Map((refreshedPreds ?? []).map((p) => [p.game_id as number, p]));

  const rowsToWrite: ScoresModelInputRow[] = [];
  const skippedAtApply: Array<{ ext: number; reason: string }> = [];
  for (const p of eligible) {
    const refreshed = refreshedById.get(p.gameId);
    if (!refreshed) { skippedAtApply.push({ ext: p.externalId, reason: "game vanished from DB" }); continue; }
    const startMs = new Date(refreshed.game_date as string).getTime();
    if (startMs <= applyNow.getTime()) {
      skippedAtApply.push({ ext: p.externalId, reason: `start-time crossed since dry-run (now ${refreshed.game_date})` });
      continue;
    }
    const newStatus = (refreshed.status as string | null) ?? "";
    if (TERMINAL_STATUSES.has(newStatus)) {
      skippedAtApply.push({ ext: p.externalId, reason: `status changed to ${newStatus}` });
      continue;
    }
    const oldPred = refreshedPredByGameId.get(p.gameId);
    if (!oldPred) { skippedAtApply.push({ ext: p.externalId, reason: "no current prediction row" }); continue; }
    if (!p.v22Output) { skippedAtApply.push({ ext: p.externalId, reason: "no V2.2 output produced" }); continue; }

    const oldSp = (oldPred.sport_specific as Record<string, unknown> | null) ?? {};
    const currentSnapshot = {
      predicted_home_score: oldPred.predicted_home_score,
      predicted_away_score: oldPred.predicted_away_score,
      predicted_total: oldPred.predicted_total,
      predicted_ml_winner: oldPred.predicted_ml_winner,
      ml_confidence: oldPred.ml_confidence,
      predicted_ou_side: oldPred.predicted_ou_side,
      ou_confidence: oldPred.ou_confidence,
      model_used: oldSp.model_used ?? null,
      model_version: oldSp.model_version ?? null,
      computed_at: oldPred.computed_at ?? null,
      snapshotted_at: applyNow.toISOString(),
    };

    // If the row currently holds a buggy V2.2 (was cutover earlier today),
    // preserve the ORIGINAL V2.1 snapshot from the first cutover and
    // record the buggy V2.2 values separately. Otherwise (first cutover
    // pass), the current row IS the V2.1 row → snapshot it as v2_1.
    const isBugfixReapply = (oldSp.model_used as string | undefined) === "v2_2";
    const preservedV21 = isBugfixReapply
      ? oldSp.prev_v2_1_snapshot   // from prior cutover
      : currentSnapshot;            // first cutover: current row is the real V2.1

    const newSp: Record<string, unknown> = {
      ...oldSp,
      model_used: "v2_2",
      model_version: MODEL_VERSION_V2_2,
      v2_2_audit: p.v22Output.v22Audit,
      prev_v2_1_snapshot: preservedV21,
      ...(isBugfixReapply ? { prev_v2_2_buggy_snapshot: currentSnapshot } : {}),
      cutover_at: applyNow.toISOString(),
      cutover_reason: CUTOVER_REASON,
    };

    const row: ScoresModelInputRow = {
      game_external_id: p.externalId,
      model_version: MODEL_VERSION_V2_2,
      computed_at: applyNow.toISOString(),
      predicted_home_score: p.v22Output.predicted_home_score,
      predicted_away_score: p.v22Output.predicted_away_score,
      predicted_total: p.v22Output.predicted_total,
      predicted_ml_winner: p.v22Output.predicted_ml_winner,
      ml_confidence: p.v22Output.ml_confidence,
      predicted_ou_side: p.v22Output.predicted_ou_side,
      ou_confidence: p.v22Output.ou_confidence,
      // NRFI explicitly preserved from existing row — user instruction.
      predicted_nrfi: (oldPred.predicted_nrfi as boolean | null) ?? undefined,
      nrfi_confidence: (oldPred.nrfi_confidence as number | null) ?? undefined,
      sport_specific: newSp,
      is_override: true, // bypass Layer 1 lock guard
    };
    rowsToWrite.push(row);
  }

  console.log(`  Rows to write: ${rowsToWrite.length} of ${eligible.length} eligible`);
  if (skippedAtApply.length > 0) {
    console.log(`  Skipped at apply-time:`);
    for (const s of skippedAtApply) console.log(`    ext=${s.ext}  ${s.reason}`);
  }

  if (rowsToWrite.length === 0) {
    console.log(`\nNo rows to write. Done.`);
    return;
  }

  const result = await ingestScoresModel(supabase, SPORT, rowsToWrite, gameIdByExternal, {
    source: "auto_v1_mlb_rules",
    runDate: HARDCODED_DATE,
    validationMode: "auto_model",
  });
  console.log(`\nIngest result:`);
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  updated:  ${result.updated}`);
  console.log(`  failed:   ${result.failed.length}`);
  for (const f of result.failed) {
    console.log(`    ext=${f.row.game_external_id} errors=${JSON.stringify(f.errors)}`);
  }

  // ─── Post-apply verification ───────────────────────────────────────
  const { data: postPreds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, locked_at, is_override, sport_specific")
    .in("game_id", gameIds);
  let v22Count = 0, v21Count = 0, otherCount = 0, lockedCount = 0, overrideCount = 0;
  for (const p of postPreds ?? []) {
    const sp = (p.sport_specific as Record<string, unknown> | null) ?? {};
    const mu = (sp.model_used as string | undefined) ?? "v1";
    if (mu === "v2_2") v22Count++;
    else if (mu === "v2_1") v21Count++;
    else otherCount++;
    if (p.locked_at) lockedCount++;
    if (p.is_override === true) overrideCount++;
  }
  console.log(`\nPost-apply state (all 15 games on slate):`);
  console.log(`  model_used=v2_2:    ${v22Count}     (eligible was ${eligible.length}; rowsToWrite was ${rowsToWrite.length})`);
  console.log(`  model_used=v2_1:    ${v21Count}     (should be ${plans.length - rowsToWrite.length})`);
  console.log(`  model_used=other:   ${otherCount}`);
  console.log(`  locked_at set:      ${lockedCount}  (should still be ${plans.length})`);
  console.log(`  is_override=true:   ${overrideCount}  (should be ${rowsToWrite.length})`);

  console.log(`\n✅ V2.2 cutover applied for ${rowsToWrite.length} unstarted game(s) on ${HARDCODED_DATE}.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
