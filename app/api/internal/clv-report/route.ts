/**
 * GET /api/internal/clv-report?days=14[&sport=mlb]
 *
 * Read-only CLV research report. Aggregates per-pick CLV (written by the
 * clv-reconcile cron into game_predictions) across grade / market / side /
 * price-bucket / movement-bucket / source-quality / sport. This is the proof
 * artifact that gates promoting any projection/prediction change from SHADOW
 * to live. No writes.
 *
 * Auth: CRON_SECRET Bearer.
 */

import { supabase } from "@/lib/db/supabase";
import { validateCronAuth } from "@/lib/cron/auth";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";
import { aggregateClv, type ClvReportRow } from "@/lib/streaming/clvReport";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(120, Number(url.searchParams.get("days") ?? "14")));
  const sportParam = url.searchParams.get("sport");
  // Anchor the lookback on MLB's slate clock; soccer/NBA share the ET anchor.
  const today = currentSlateDate((sportParam as Sport) ?? "mlb");
  const start = addDaysToSlate(today, -days);

  let q = supabase
    .from("prediction_records")
    .select(
      "game_prediction_id, market, side, pick, odds_american, play_grade, best_angle, sport, slate_date, prediction_grades ( result )",
    )
    .gte("slate_date", start)
    .not("locked_at", "is", null);
  if (sportParam) q = q.eq("sport", sportParam);
  const { data: recsData, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  type Rec = {
    game_prediction_id: number; market: string; side: string | null; pick: string | null;
    odds_american: number | null; play_grade: string | null; best_angle: boolean | null;
    sport: string; prediction_grades: { result: string | null }[] | { result: string | null } | null;
  };
  const recs = (recsData ?? []) as unknown as Rec[];
  if (recs.length === 0) {
    return Response.json({ ok: true, days, start, today, count: 0, report: aggregateClv([]) });
  }

  // CLV values live on game_predictions (written by clv-reconcile).
  const gpIds = [...new Set(recs.map((r) => r.game_prediction_id))];
  const clvById = new Map<number, { clvPct: number | null; beatClosing: boolean | null }>();
  for (let i = 0; i < gpIds.length; i += 200) {
    const { data: gp } = await supabase
      .from("game_predictions")
      .select("id, clv_pct, beat_closing_line")
      .in("id", gpIds.slice(i, i + 200));
    for (const g of ((gp ?? []) as Array<{ id: number; clv_pct: number | null; beat_closing_line: boolean | null }>)) {
      clvById.set(g.id, { clvPct: g.clv_pct, beatClosing: g.beat_closing_line });
    }
  }

  const rows: ClvReportRow[] = recs.map((r) => {
    const grade = r.best_angle === true ? "best_angle" : r.play_grade;
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const clv = clvById.get(r.game_prediction_id);
    return {
      sport: r.sport,
      market: r.market,
      side: r.side ?? r.pick,
      grade,
      oddsAmerican: r.odds_american,
      clvPct: clv?.clvPct ?? null,
      beatClosing: clv?.beatClosing ?? null,
      movementBucket: null, // wired once line_movements is populated by the worker
      sourceQuality: null,
      result: (g?.result ?? null)?.toString().toLowerCase() ?? null,
    };
  });

  return Response.json({ ok: true, days, start, today, count: rows.length, report: aggregateClv(rows) });
}
