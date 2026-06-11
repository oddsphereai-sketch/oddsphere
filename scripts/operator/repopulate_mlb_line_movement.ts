/**
 * Phase 2 — Repopulate snapshot_json.line_movement on tonight's locked
 * MLB ML/Total rows. Uses the same Phase 1 fallback logic
 * (oldest line_history row per (game, market, side, book)) but writes
 * directly into the existing locked snapshot to restore the line-move
 * UI section without unlocking.
 *
 * The writer's normal Phase 1 path skips locked rows entirely — by design,
 * locked decisions are immutable. This script is the ONE surgical patch
 * for the regression introduced by the broken `is_opener` flagging.
 * After Phase 3 (fixing the is_opener writer) lands, this script becomes
 * a one-off and is not needed again.
 *
 * Safe to re-run. Read-only by default. Requires --apply to mutate.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/repopulate_mlb_line_movement.ts \
 *     [--date YYYY-MM-DD] [--apply]
 */
import { supabase } from "../../lib/db/supabase";
import { buildLineMovementSnapshot } from "../../lib/services/predictionRecordService";

type Pred = {
  id: number;
  game_id: number;
  market: "moneyline" | "total";
  side: string | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

type LineHistoryRow = {
  game_id: number;
  market_type: "moneyline" | "total";
  side: string;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string;
};

type CurrentLine = {
  game_id: number;
  market_type: "moneyline" | "total";
  side: string;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
};

type Signal = {
  game_id: number;
  market_type: string;
  side: string;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  has_steam_move: boolean | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  signal_strength: string | null;
  computed_at: string | null;
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  steam_detected_at: string | null;
  steam_books_count: number | null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().split("T")[0];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--apply") apply = true;
  }
  console.log(`\n═══ MLB line_movement repopulation — ${new Date().toISOString()} ═══`);
  console.log(`  date=${date}  mode=${apply ? "APPLY (write)" : "DRY-RUN"}\n`);

  // Load locked MLB ML/Total prediction_records for the slate.
  const { data: predsRaw } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, side, locked_at, snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .in("market", ["moneyline", "total"])
    .not("locked_at", "is", null);
  const preds = (predsRaw ?? []) as Pred[];
  console.log(`Locked MLB ML+Total rows: ${preds.length}`);
  if (preds.length === 0) return;

  const gameIds = Array.from(new Set(preds.map((p) => p.game_id)));

  // Load line_history for these games (ML + Total).
  const { data: lhRaw } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null)
    .order("recorded_at", { ascending: true });
  const lh = (lhRaw ?? []) as LineHistoryRow[];
  console.log(`line_history rows loaded: ${lh.length}`);

  // Build oldest-per-(game, market, side, book) opener map.
  const oldestByKey = new Map<string, LineHistoryRow>();
  for (const r of lh) {
    const k = `${r.game_id}|${r.market_type}|${r.side}|${r.sportsbook}`;
    if (!oldestByKey.has(k)) oldestByKey.set(k, r); // ASC → first seen is oldest
  }
  const openersByGame = new Map<number, LineHistoryRow[]>();
  for (const r of oldestByKey.values()) {
    const arr = openersByGame.get(r.game_id) ?? [];
    arr.push(r);
    openersByGame.set(r.game_id, arr);
  }

  // Load current lines + signals for the games (drives current_odds + rlm/steam).
  const { data: curRaw } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null);
  const currentLines = (curRaw ?? []) as CurrentLine[];
  const currentByGame = new Map<number, CurrentLine[]>();
  for (const r of currentLines) {
    const arr = currentByGame.get(r.game_id) ?? [];
    arr.push(r);
    currentByGame.set(r.game_id, arr);
  }

  const { data: sigRaw } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, public_money_pct, public_betting_pct, has_steam_move, has_reverse_line_movement, rlm_direction, signal_strength, computed_at, pinnacle_fair_probability, is_plus_ev, ev_pct, steam_detected_at, steam_books_count",
    )
    .in("game_id", gameIds);
  const signals = (sigRaw ?? []) as Signal[];
  const sigByGame = new Map<number, Signal[]>();
  for (const s of signals) {
    const arr = sigByGame.get(s.game_id) ?? [];
    arr.push(s);
    sigByGame.set(s.game_id, arr);
  }

  // Compute per-row updates.
  let updates = 0;
  let skipped = 0;
  let errors = 0;
  for (const p of preds) {
    if (p.side === null) {
      skipped += 1;
      continue;
    }
    const openersForGame = openersByGame.get(p.game_id) ?? [];
    const currentForGame = currentByGame.get(p.game_id) ?? [];
    const sigsForGame = sigByGame.get(p.game_id) ?? [];

    const newLm = buildLineMovementSnapshot(
      openersForGame,
      currentForGame as unknown as Parameters<typeof buildLineMovementSnapshot>[1],
      sigsForGame as unknown as Parameters<typeof buildLineMovementSnapshot>[2],
      p.market,
      p.side,
    );
    if (newLm === null) {
      skipped += 1;
      continue;
    }
    const oldLm =
      (p.snapshot_json as { line_movement?: Record<string, unknown> } | null)?.line_movement ?? null;
    const newOpen = (newLm as { open_odds_american: number | null }).open_odds_american;
    const oldOpen = (oldLm as { open_odds_american?: number | null } | null)?.open_odds_american ?? null;

    console.log(
      `  pr.id=${p.id} game=${p.game_id} ${p.market}/${p.side}  open: ${oldOpen} → ${newOpen}  direction=${(newLm as { direction: string }).direction}  magnitude=${(newLm as { magnitude_pp: number | null }).magnitude_pp}`,
    );

    if (!apply) continue;

    const nextSnapshot = {
      ...(p.snapshot_json as Record<string, unknown> | null ?? {}),
      line_movement: newLm,
    };
    const { error: upErr } = await supabase
      .from("prediction_records")
      .update({ snapshot_json: nextSnapshot })
      .eq("id", p.id);
    if (upErr !== null) {
      console.log(`    ✗ update failed: ${upErr.message}`);
      errors += 1;
    } else {
      updates += 1;
    }
  }

  console.log(`\nSummary: rows=${preds.length}  updates=${updates}  skipped=${skipped}  errors=${errors}`);
  if (!apply) console.log(`(dry-run: re-run with --apply to mutate)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
