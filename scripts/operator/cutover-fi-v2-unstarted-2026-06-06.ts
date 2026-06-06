/**
 * Push 3B-7 — Controlled FI V2 cutover for 2026-06-06 unstarted MLB games.
 *
 * INTENT (verbatim from operator instruction):
 *   "Make FI V2 visible in the Daily Edge/admin first-inning pill for
 *    games that have not started yet, without touching already-started
 *    games and without corrupting tracking/audit history."
 *
 * USAGE:
 *   Dry-run (default — required before any apply):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/cutover-fi-v2-unstarted-2026-06-06.ts
 *
 *   Apply (two-key gate):
 *     FI_V2_CUTOVER_DB_WRITES_ENABLED=true \
 *       AUTOMODEL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/cutover-fi-v2-unstarted-2026-06-06.ts --apply
 *
 * SAFETY:
 *   • Hard-coded date: 2026-06-06. Refuses to run on any other date.
 *   • Per-game start-time guard: game_date > NOW excludes any game that
 *     has reached its scheduled first pitch. RE-CHECKED immediately
 *     before each write — a game that crosses start_time between
 *     dry-run and apply is automatically skipped.
 *   • Defense-in-depth status guard: also excludes any game with
 *     terminal provider status.
 *   • UPDATE-only (no INSERT, no upsert) — uses direct supabase
 *     UPDATE on `game_predictions`. Eliminates risk of duplicate rows.
 *   • Field whitelist for the UPDATE payload — only the four columns
 *     this cutover is allowed to touch:
 *         predicted_nrfi
 *         nrfi_confidence
 *         sport_specific  (merged, never replaced wholesale)
 *         updated_at
 *     ML/OU/score columns, tracking_* columns, locked_at, is_override,
 *     computed_at, model_version, slate_status are all UNTOUCHED.
 *   • Audit trail: each updated row carries
 *         sport_specific.prev_fi_v1_snapshot
 *     containing all overwritten FI fields + the original computed_at.
 *   • FI V2 audit recorded in sport_specific.fi_v2_audit.
 *   • Two-key apply gate (--apply + FI_V2_CUTOVER_DB_WRITES_ENABLED=true).
 *   • Writes ONLY to `game_predictions`. No slate_status, no locks,
 *     no tracking rows, no model_version env changes.
 *
 * DISPLAY CONTRACT (verified against app/api/lab/daily-edge/route.ts):
 *   The route renders the FI pill from:
 *     1. sport_specific.held === true OR "nrfi" in
 *        sport_specific.hold_picks → "Held" (null pick)
 *     2. sport_specific.nrfi_decision_kind === "toss_up" → "Toss-Up"
 *     3. predicted_nrfi === true → "NRFI"
 *     4. predicted_nrfi === false → "YRFI"
 *
 *   So this script writes:
 *     • NRFI pick     →  predicted_nrfi=true,  nrfi_confidence=round(P*100),
 *                        nrfi_decision_kind="nrfi"
 *     • YRFI pick     →  predicted_nrfi=false, nrfi_confidence=round((1-P)*100),
 *                        nrfi_decision_kind="yrfi"
 *     • Toss-Up       →  predicted_nrfi=(P>0.5),  nrfi_confidence=52
 *                        (the sentinel), nrfi_decision_kind="toss_up"
 *                        ← guarantees pill renders "Toss-Up", NOT "-"
 *     • Held          →  predicted_nrfi=null, nrfi_confidence=null,
 *                        hold_picks merged to include "nrfi",
 *                        hold_reason recorded
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbFirstInningModelV2 } from "../../lib/automodel/mlbFirstInningModelV2";
import type { FiLineRow } from "../../lib/automodel/mlbFirstInningMarketBaseline";

const HARDCODED_DATE = "2026-06-06";
const SPORT = "mlb" as const;
const CUTOVER_REASON = "controlled_fi_v2_cutover";

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

function fmtPct(x: number | null): string {
  return x === null ? "—" : (x * 100).toFixed(1) + "%";
}

async function main() {
  const opts = parseArgs(process.argv);
  const envWritesEnabled = process.env.FI_V2_CUTOVER_DB_WRITES_ENABLED === "true";
  const automodelEnvEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  const writeMode = opts.apply && envWritesEnabled && automodelEnvEnabled;

  console.log(`\n━━━ FI V2 CONTROLLED CUTOVER · ${HARDCODED_DATE} ━━━`);
  console.log(`     mode=${writeMode ? "APPLY" : "DRY-RUN"}`);
  console.log(`     started_at_utc=${new Date().toISOString()}`);
  console.log(`     FI_V2_CUTOVER_DB_WRITES_ENABLED=${envWritesEnabled}`);
  console.log(`     AUTOMODEL_DB_WRITES_ENABLED=${automodelEnvEnabled}`);
  console.log("");

  if (opts.apply && !envWritesEnabled) {
    console.error("✗ --apply requires FI_V2_CUTOVER_DB_WRITES_ENABLED=true in env.");
    process.exit(1);
  }
  if (opts.apply && !automodelEnvEnabled) {
    console.error("✗ --apply requires AUTOMODEL_DB_WRITES_ENABLED=true in env.");
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
  const teamIds = new Set<number>();
  for (const g of games) {
    teamIds.add(g.home_team_id as number);
    teamIds.add(g.away_team_id as number);
  }
  const { data: teams } = await supabase.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const abbrByTeamId = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  const { data: preds, error: pErr } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_nrfi, nrfi_confidence, computed_at, sport_specific")
    .in("game_id", gameIds);
  if (pErr) { console.error("preds query failed:", pErr.message); process.exit(2); }
  const predByGameId = new Map((preds ?? []).map((p) => [p.game_id as number, p]));

  // ─── FI lines (for market read inside FI V2) ───────────────────────
  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .eq("market_type", "first_inning_total");
  const linesByGameId = new Map<number, FiLineRow[]>();
  for (const r of lineRows ?? []) {
    const arr = linesByGameId.get(r.game_id as number) ?? [];
    arr.push({
      market_type: "first_inning_total",
      sportsbook: r.sportsbook as string,
      side: (r.side as string | null) ?? null,
      line_value: (r.line_value as number | null) ?? null,
      odds_american: (r.odds_american as number | null) ?? null,
      fetched_at: (r.fetched_at as string | null) ?? null,
    });
    linesByGameId.set(r.game_id as number, arr);
  }

  // ─── Feature snapshots + run FI V2 ─────────────────────────────────
  console.log(`Building feature snapshots...`);
  const snapshots = await buildFeatureSnapshots(SPORT, HARDCODED_DATE);
  const snapshotByExt = new Map(snapshots.map((s) => [s.game_external_id, s]));
  console.log(`Loaded ${snapshots.length} snapshots.\n`);

  type Plan = {
    gameId: number;
    externalId: number;
    matchup: string;
    startTime: string;
    startTimeEt: string;
    status: string;
    eligible: boolean;
    ineligibleReason: string | null;
    // Current member-facing FI state
    curPredictedNrfi: boolean | null;
    curNrfiConfidence: number | null;
    curDecisionKind: string | null;
    curDisplayPill: string;
    // FI V2 output
    fiV2Pick: "NRFI" | "YRFI" | "Toss-Up" | "Held" | null;
    fiV2Confidence: number | null;
    fiV2PlayGrade: string | null;
    fiV2BestAngle: boolean;
    fiV2PosteriorNrfi: number | null;
    fiV2PosteriorYrfi: number | null;
    fiV2MarketNrfi: number | null;
    fiV2MarketYrfi: number | null;
    fiV2Edge: number | null;
    fiV2Tier: string | null;
    fiV2ReasonCodes: string[];
    fiV2NewDisplayPill: string;
    pickWouldChange: boolean;
    pillWouldChange: boolean;
    fiV2Output: ReturnType<typeof runMlbFirstInningModelV2> | null;
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
    if (!isFuture) reason = `started/past start (${etTime(g.game_date as string)})`;
    else if (statusTerminal) reason = `terminal status=${status}`;

    const cur = predByGameId.get(gameId);
    const curPredictedNrfi = (cur?.predicted_nrfi as boolean | null) ?? null;
    const curNrfiConfidence = (cur?.nrfi_confidence as number | null) ?? null;
    const curSp = (cur?.sport_specific as Record<string, unknown> | null) ?? {};
    const curDecisionKind = typeof curSp.nrfi_decision_kind === "string" ? (curSp.nrfi_decision_kind as string) : null;
    const curHoldPicks = Array.isArray(curSp.hold_picks) ? (curSp.hold_picks as unknown[]).filter((x) => typeof x === "string") as string[] : [];
    const curIsHeld = curSp.held === true || curHoldPicks.includes("nrfi");
    const curDisplayPill = curIsHeld ? "Held" : curDecisionKind === "toss_up" ? "Toss-Up" : curPredictedNrfi === true ? "NRFI" : curPredictedNrfi === false ? "YRFI" : "—";

    const snap = snapshotByExt.get(ext);
    let fiOut: ReturnType<typeof runMlbFirstInningModelV2> | null = null;
    if (snap) {
      try {
        fiOut = runMlbFirstInningModelV2(snap, linesByGameId.get(gameId) ?? []);
      } catch (e) {
        if (eligible) {
          eligible = false;
          reason = `FI V2 threw: ${(e as Error).message}`;
        }
      }
    } else if (eligible) {
      eligible = false;
      reason = "no feature snapshot for this game";
    }

    const fiPick = fiOut?.fiV2Audit.fi_pick ?? null;
    const newDisplayPill = fiPick === null ? "—" : fiPick;
    const pickWouldChange = eligible && (curDisplayPill !== newDisplayPill);
    const pillWouldChange = pickWouldChange;

    plans.push({
      gameId,
      externalId: ext,
      matchup,
      startTime: g.game_date as string,
      startTimeEt: etTime(g.game_date as string),
      status,
      eligible,
      ineligibleReason: reason,
      curPredictedNrfi,
      curNrfiConfidence,
      curDecisionKind,
      curDisplayPill,
      fiV2Pick: fiPick,
      fiV2Confidence: fiOut?.fiV2Audit.fi_confidence ?? null,
      fiV2PlayGrade: fiOut?.fiV2Audit.fi_play_grade ?? null,
      fiV2BestAngle: fiOut?.fiV2Audit.fi_play_grade === "best_angle",
      fiV2PosteriorNrfi: fiOut?.fiV2Audit.posterior_p_nrfi ?? null,
      fiV2PosteriorYrfi: fiOut ? (1 - fiOut.fiV2Audit.posterior_p_nrfi) : null,
      fiV2MarketNrfi: fiOut?.fiV2Audit.market_nrfi_no_vig ?? null,
      fiV2MarketYrfi: fiOut?.fiV2Audit.market_yrfi_no_vig ?? null,
      fiV2Edge: fiOut?.fiV2Audit.fi_edge_pct ?? null,
      fiV2Tier: fiOut?.fiV2Audit.data_quality_tier ?? null,
      fiV2ReasonCodes: fiOut?.fiV2Audit.feature_audit.reason_codes ?? [],
      fiV2NewDisplayPill: newDisplayPill,
      pickWouldChange,
      pillWouldChange,
      fiV2Output: fiOut,
    });
  }

  // ─── Per-game dry-run table ─────────────────────────────────────────
  console.log(`Per-game plan:`);
  console.log(`${"start (ET)".padEnd(16)} | ${"matchup".padEnd(8)} | ${"elig".padEnd(13)} | ${"cur pill".padEnd(8)} | ${"fi-v2".padEnd(8)} | Δpill | ${"post-N".padEnd(7)} | ${"mkt-N".padEnd(7)} | ${"edge".padEnd(7)} | ${"tier".padEnd(7)} | ${"play_grade".padEnd(11)} | reason`);
  console.log("─".repeat(180));
  for (const p of plans) {
    const elig = p.eligible ? "✅ ELIGIBLE" : "🟥 SKIP";
    const elig2 = elig.padEnd(13);
    const dchg = p.pillWouldChange ? "yes" : "no";
    const ineligReason = p.ineligibleReason ?? "";
    const reasonShort = p.eligible
      ? (p.fiV2ReasonCodes.length > 0 ? p.fiV2ReasonCodes.slice(0, 2).join(",") : "")
      : ineligReason;
    console.log(
      `${p.startTimeEt.padEnd(16)} | ${p.matchup.padEnd(8)} | ${elig2} | ${p.curDisplayPill.padEnd(8)} | ${(p.fiV2NewDisplayPill ?? "—").padEnd(8)} | ${dchg.padEnd(5)} | ${fmtPct(p.fiV2PosteriorNrfi).padEnd(7)} | ${fmtPct(p.fiV2MarketNrfi).padEnd(7)} | ${(p.fiV2Edge !== null ? (p.fiV2Edge >= 0 ? "+" : "") + p.fiV2Edge.toFixed(1) + "%" : "—").padEnd(7)} | ${(p.fiV2Tier ?? "—").padEnd(7)} | ${(p.fiV2PlayGrade ?? "—").padEnd(11)} | ${reasonShort}`,
    );
  }

  const eligible = plans.filter((p) => p.eligible);
  const ineligible = plans.filter((p) => !p.eligible);
  const wouldChange = eligible.filter((p) => p.pickWouldChange);
  const tossUpCount = eligible.filter((p) => p.fiV2Pick === "Toss-Up").length;
  const heldCount = eligible.filter((p) => p.fiV2Pick === "Held").length;
  const baCount = eligible.filter((p) => p.fiV2BestAngle).length;
  const tierLow = eligible.filter((p) => p.fiV2Tier === "low" || p.fiV2Tier === "fallback").length;

  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Total games on slate:                 ${plans.length}`);
  console.log(`  Eligible (unstarted, healthy status): ${eligible.length}`);
  console.log(`  Skipped (already started or invalid): ${ineligible.length}`);
  console.log(`  FI pick that would change:            ${wouldChange.length}`);
  console.log(`  Display pill that would change:       ${wouldChange.length}`);
  console.log(`  Toss-Up count in cutover set:         ${tossUpCount}`);
  console.log(`  Held count in cutover set:            ${heldCount}`);
  console.log(`  Best Angle count in cutover set:      ${baCount}`);
  console.log(`  Low/fallback tier in cutover set:     ${tierLow}`);

  if (ineligible.length > 0) {
    console.log(`\n  Skipped games:`);
    for (const p of ineligible) {
      console.log(`    ${p.startTimeEt.padEnd(16)} ${p.matchup.padEnd(8)} — ${p.ineligibleReason}`);
    }
  }

  if (!writeMode) {
    console.log(`\nDRY-RUN — no DB writes performed.`);
    console.log(`To apply: set FI_V2_CUTOVER_DB_WRITES_ENABLED=true and AUTOMODEL_DB_WRITES_ENABLED=true, then re-run with --apply.`);
    return;
  }

  // ─── Apply: re-check time per game, UPDATE only the FI columns ─────
  const applyNow = new Date();
  console.log(`\n━━━ Apply ━━━`);
  console.log(`  applyNow=${applyNow.toISOString()}`);

  const { data: refreshedGames } = await supabase
    .from("games")
    .select("id, external_id, game_date, status")
    .in("id", eligible.map((p) => p.gameId));
  const refreshedById = new Map((refreshedGames ?? []).map((g) => [g.id as number, g]));

  const { data: refreshedPreds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_nrfi, nrfi_confidence, computed_at, sport_specific")
    .in("game_id", eligible.map((p) => p.gameId));
  const refreshedPredById = new Map((refreshedPreds ?? []).map((p) => [p.game_id as number, p]));

  const skippedAtApply: Array<{ ext: number; reason: string }> = [];
  let wrote = 0, failed = 0;

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
    const oldPred = refreshedPredById.get(p.gameId);
    if (!oldPred) { skippedAtApply.push({ ext: p.externalId, reason: "no current prediction row" }); continue; }
    if (!p.fiV2Output) { skippedAtApply.push({ ext: p.externalId, reason: "no FI V2 output produced" }); continue; }

    const oldSp = (oldPred.sport_specific as Record<string, unknown> | null) ?? {};
    const oldHoldPicks = Array.isArray(oldSp.hold_picks) ? (oldSp.hold_picks as unknown[]).filter((x) => typeof x === "string") as string[] : [];

    const prevFiSnapshot = {
      predicted_nrfi: oldPred.predicted_nrfi,
      nrfi_confidence: oldPred.nrfi_confidence,
      nrfi_decision_kind: oldSp.nrfi_decision_kind ?? null,
      hold_picks_included_nrfi: oldHoldPicks.includes("nrfi"),
      held_flag: oldSp.held === true,
      computed_at: oldPred.computed_at ?? null,
      snapshotted_at: applyNow.toISOString(),
    };

    const fiPick = p.fiV2Output.fiV2Audit.fi_pick;
    const post = p.fiV2Output.fiV2Audit.posterior_p_nrfi;

    let newPredictedNrfi: boolean | null;
    let newNrfiConfidence: number | null;
    let newDecisionKind: string;
    let newHoldPicks = oldHoldPicks.filter((x) => x !== "nrfi");

    if (fiPick === "NRFI") {
      newPredictedNrfi = true;
      newNrfiConfidence = Math.round(post * 100);
      newDecisionKind = "nrfi";
    } else if (fiPick === "YRFI") {
      newPredictedNrfi = false;
      newNrfiConfidence = Math.round((1 - post) * 100);
      newDecisionKind = "yrfi";
    } else if (fiPick === "Toss-Up") {
      // Toss-Up: lean direction in boolean, but UI reads decision_kind
      // for the literal "Toss-Up" label. nrfi_confidence=52 also
      // triggers the pre-4D.1 heuristic fallback path.
      newPredictedNrfi = post >= 0.5;
      newNrfiConfidence = 52;
      newDecisionKind = "toss_up";
    } else {
      // Held — null pick, push "nrfi" into hold_picks, do NOT fake NRFI
      newPredictedNrfi = null;
      newNrfiConfidence = null;
      newDecisionKind = "held";
      newHoldPicks = Array.from(new Set([...newHoldPicks, "nrfi"]));
    }

    const newSp: Record<string, unknown> = {
      ...oldSp,
      nrfi_decision_kind: newDecisionKind,
      hold_picks: newHoldPicks,
      fi_model_used: "fi_v2",
      fi_v2_audit: {
        ...p.fiV2Output.fiV2Audit,
        model_version: "fi_v2",
        generated_at: applyNow.toISOString(),
        cutover_reason: CUTOVER_REASON,
      },
      prev_fi_v1_snapshot: prevFiSnapshot,
    };

    // FI V2 Held may also need to clear `held` if it was set ONLY for FI.
    // Defensive: do NOT touch `held` here — leave whatever it was. Only
    // hold_picks gets the FI-scoped update.
    // (If the game was held for ML/OU reasons, that's independent.)

    const { error } = await supabase
      .from("game_predictions")
      .update({
        predicted_nrfi: newPredictedNrfi,
        nrfi_confidence: newNrfiConfidence,
        sport_specific: newSp,
        // Note: game_predictions has no updated_at column. The when-was-
        // this-FI-V2-cutover stamp lives inside sport_specific.fi_v2_audit
        // .generated_at (set above). computed_at is left untouched — it
        // still represents when the ML/OU/score values in this row were
        // computed by the upstream model run.
      })
      .eq("game_id", p.gameId);
    if (error) {
      console.error(`  ✗ ext=${p.externalId} update failed: ${error.message}`);
      failed++;
    } else {
      wrote++;
    }
  }

  console.log(`  Wrote: ${wrote}  Failed: ${failed}  Skipped@apply: ${skippedAtApply.length}`);
  if (skippedAtApply.length > 0) {
    for (const s of skippedAtApply) console.log(`    ext=${s.ext}  ${s.reason}`);
  }

  // ─── Post-apply verification ───────────────────────────────────────
  console.log(`\n━━━ Post-apply verification ━━━`);
  const { data: postPreds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_nrfi, nrfi_confidence, sport_specific")
    .in("game_id", gameIds);
  let fiV2Count = 0, tossUpCountPost = 0, heldNrfiCount = 0, nrfiCount = 0, yrfiCount = 0;
  for (const p of postPreds ?? []) {
    const sp = (p.sport_specific as Record<string, unknown> | null) ?? {};
    if (sp.fi_model_used === "fi_v2") fiV2Count++;
    if (sp.nrfi_decision_kind === "toss_up") tossUpCountPost++;
    if (Array.isArray(sp.hold_picks) && (sp.hold_picks as string[]).includes("nrfi")) heldNrfiCount++;
    if (p.predicted_nrfi === true && sp.nrfi_decision_kind !== "toss_up") nrfiCount++;
    if (p.predicted_nrfi === false && sp.nrfi_decision_kind !== "toss_up") yrfiCount++;
  }
  console.log(`  fi_model_used=fi_v2 rows:   ${fiV2Count}  (expected ${wrote})`);
  console.log(`  Toss-Up display rows:       ${tossUpCountPost}`);
  console.log(`  Held NRFI rows:             ${heldNrfiCount}`);
  console.log(`  NRFI display rows:          ${nrfiCount}`);
  console.log(`  YRFI display rows:          ${yrfiCount}`);
  console.log(`\n✅ FI V2 cutover applied for ${wrote} unstarted game(s) on ${HARDCODED_DATE}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
