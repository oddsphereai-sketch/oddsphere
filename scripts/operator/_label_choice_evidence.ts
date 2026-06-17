/**
 * Read-only: dump the locked v2_2_audit + framework grade + market metrics
 * for rec=120 (CLE@TEX ML) and rec=129 (LAA@LAD ML) so we can decide
 * whether `provisional` or `market_aligned` more honestly represents what
 * the customer-facing pill conveyed.
 */
import { createClient } from "@supabase/supabase-js";
import { VERDICT_LABEL } from "../../lib/services/verdictDerivation";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Framework grade → verdict (matches slate-card derivation; see
// lib/services/verdictDerivation.ts deriveVerdict switch)
function frameworkGradeToVerdict(g: string | null): string {
  if (g === null) return "no_play";
  switch (g) {
    case "best_signal":
    case "sharp_confirmed": return "best_angle";
    case "market_led":
    case "model_only": return "lean";
    case "market_watch":
    case "public_smoke": return "watchlist";
    case "sharp_conflict": return "caution";
    default: return g;
  }
}

async function main() {
  for (const id of [120, 129]) {
    const { data: r } = await sb
      .from("prediction_records")
      .select("id, game_id, game_prediction_id, market, pick, side, no_bet, play_grade, best_angle, confidence, snapshot_json")
      .eq("id", id).maybeSingle();
    if (!r) continue;
    const { data: p } = await sb.from("game_predictions").select("ml_grade, ou_grade, ml_confidence, ou_confidence").eq("id", r.game_prediction_id).maybeSingle();
    const sp = (r.snapshot_json ?? {}) as Record<string, any>;
    const v22 = (sp.v2_2_audit ?? {}) as Record<string, any>;
    const fg = r.market === "moneyline" ? p?.ml_grade : p?.ou_grade;
    const verdict = frameworkGradeToVerdict(fg ?? null);

    console.log(`\n═══ rec=${r.id} game=${r.game_id} ${r.market} pick=${r.pick} ═══`);
    console.log(`  record.play_grade            = ${r.play_grade}        (← the column under scrutiny)`);
    console.log(`  record.no_bet                = ${r.no_bet}`);
    console.log(`  record.best_angle            = ${r.best_angle}`);
    console.log(`  record.confidence            = ${r.confidence}`);
    console.log(`  game_predictions.${r.market === "moneyline" ? "ml" : "ou"}_grade = ${fg}      (V2.1 framework — drives the slate-card GradeBadge)`);
    console.log(`  → customer-facing verdict    = ${verdict} → "${VERDICT_LABEL[verdict as keyof typeof VERDICT_LABEL] ?? verdict}"`);
    console.log(`\n  V2.2 audit (raw, from snapshot.v2_2_audit):`);
    const showKeys = [
      "ml_play_grade", "ml_prediction_type", "ml_best_angle_eligible", "ml_no_bet_reason", "ml_market_aligned", "ml_best_angle_reason",
      "ml_model_prob", "ml_market_prob", "ml_edge_pct",
      "data_quality_tier", "provisional", "feature_present_count", "feature_missing_count",
      "feature_neutral_fallback_count", "feature_proxy_count",
      "trust_independent",
    ];
    for (const k of showKeys) {
      if (k in v22) console.log(`    ${k.padEnd(34)} = ${JSON.stringify(v22[k])}`);
    }
    if (Array.isArray(v22.model_integrity_notes) && v22.model_integrity_notes.length > 0) {
      console.log(`    model_integrity_notes:`);
      for (const n of v22.model_integrity_notes) console.log(`      • ${n}`);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
