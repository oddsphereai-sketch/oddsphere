/**
 * Ops dashboard (LOCAL TOOL) — live data layer.
 *
 * Self-contained: creates its own Supabase client from your local env
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, loaded via
 * `--env-file=.env.local`). Read-only. Not part of the OddSphere app.
 */

import { createClient } from "@supabase/supabase-js";
import { MODEL_RULES, CHANGELOG, PRINCIPLES } from "./content";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with `npm run ops` (which loads .env.local).");
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

export type Bucket = { label: string; wins: number; losses: number; pushes: number; units: number; winPct: number | null };

type Row = {
  sport: string; market: string; odds_american: number | null;
  play_grade: string | null; best_angle: boolean | null; no_bet: boolean | null;
  slate_date: string | null;
  prediction_grades: { result: string | null }[] | { result: string | null } | null;
};

const norm = (s: unknown) => String(s ?? "").toLowerCase();
const american = (oa: number | null, won: boolean) => oa === null || !Number.isFinite(oa) ? 0 : won ? (oa > 0 ? oa / 100 : 100 / Math.abs(oa)) : -1;
const gradeOf = (r: Row) => (Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades)?.result ?? null;
const emptyAcc = () => ({ wins: 0, losses: 0, pushes: 0, units: 0 });
function addAcc(a: ReturnType<typeof emptyAcc>, res: string, odds: number | null) {
  // Callers only pass PRICED bets (odds known) — see the loop's odds filter.
  if (res === "push") { a.pushes++; return; }
  if (res === "win") { a.wins++; a.units += american(odds, true); }
  else if (res === "loss") { a.losses++; a.units += american(odds, false); }
}
function toBucket(label: string, a: ReturnType<typeof emptyAcc>): Bucket {
  const n = a.wins + a.losses;
  return { label, wins: a.wins, losses: a.losses, pushes: a.pushes, units: Math.round(a.units * 10) / 10, winPct: n ? Math.round((a.wins / n) * 1000) / 10 : null };
}
function category(r: Row): string {
  if (r.no_bet === true) return "No Play";
  const pg = norm(r.play_grade);
  if (pg === "toss_up") return "Toss-Up";
  if (r.best_angle === true || pg === "best_angle") return "Best Angle";
  if (pg === "lean") return "Lean";
  return "Watch (no grade)";
}
const safe = async <T,>(p: PromiseLike<T>, fb: T): Promise<T> => { try { return await p; } catch { return fb; } };

export async function computeDashboard(since: string) {
  const { data, error } = await supabase
    .from("prediction_records")
    .select(`sport, market, odds_american, play_grade, best_angle, no_bet, slate_date, prediction_grades:prediction_grades!prediction_record_id ( result )`)
    .gte("slate_date", since).limit(20000);
  if (error) throw new Error(`perf query: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];

  const overall = emptyAcc();
  const bySport = new Map<string, ReturnType<typeof emptyAcc>>();
  const byMarketMlb = new Map<string, ReturnType<typeof emptyAcc>>();
  const byGradeMlb = new Map<string, ReturnType<typeof emptyAcc>>();
  const nonBet = { noPlay: 0, tossUp: 0 };
  const dates: string[] = [];
  let excludedNoOdds = 0;

  for (const r of rows) {
    const res = gradeOf(r);
    if (res !== "win" && res !== "loss" && res !== "push") continue;
    const cat = category(r);
    if (cat === "No Play") { nonBet.noPlay++; continue; }
    if (cat === "Toss-Up") { nonBet.tossUp++; continue; }
    // LOCAL VIEW: only count bets where we saved the odds, so win% and units
    // always cover the exact same bets. (OddSphere's own tracking is unaffected.)
    if (r.odds_american === null || !Number.isFinite(r.odds_american)) { excludedNoOdds++; continue; }
    if (r.slate_date) dates.push(r.slate_date);
    addAcc(overall, res, r.odds_american);
    const sp = bySport.get(r.sport) ?? emptyAcc(); addAcc(sp, res, r.odds_american); bySport.set(r.sport, sp);
    if (r.sport === "mlb") {
      const m = byMarketMlb.get(r.market) ?? emptyAcc(); addAcc(m, res, r.odds_american); byMarketMlb.set(r.market, m);
      const g = byGradeMlb.get(cat) ?? emptyAcc(); addAcc(g, res, r.odds_american); byGradeMlb.set(cat, g);
    }
  }
  dates.sort();
  const marketLabel: Record<string, string> = { moneyline: "Moneyline", total: "Totals", first_inning: "First-inning" };

  return {
    since, windowFrom: dates[0] ?? null, windowTo: dates[dates.length - 1] ?? null,
    overall: toBucket("Overall", overall),
    bySport: [...bySport.entries()].map(([s, a]) => toBucket(s.toUpperCase(), a)).sort((x, y) => y.units - x.units),
    byMarketMlb: ["moneyline", "total", "first_inning"].filter((m) => byMarketMlb.has(m)).map((m) => toBucket(marketLabel[m] ?? m, byMarketMlb.get(m)!)),
    byPlayGradeMlb: ["Best Angle", "Lean", "Watch (no grade)"].filter((g) => byGradeMlb.has(g)).map((g) => toBucket(g, byGradeMlb.get(g)!)),
    nonBet,
    excludedNoOdds,
    health: await computeHealth(),
    content: { modelRules: MODEL_RULES, changelog: CHANGELOG, principles: PRINCIPLES },
    generatedAt: new Date().toISOString(),
  };
}

async function computeHealth() {
  const lastSlate = await safe(supabase.from("prediction_records").select("slate_date").order("slate_date", { ascending: false }).limit(1).then((r) => r.data?.[0]?.slate_date ?? null), null);
  const lastLock = await safe(supabase.from("prediction_records").select("locked_at").not("locked_at", "is", null).order("locked_at", { ascending: false }).limit(1).then((r) => r.data?.[0]?.locked_at ?? null), null);
  const lastLines = await safe(supabase.from("lines").select("fetched_at").not("fetched_at", "is", null).order("fetched_at", { ascending: false }).limit(1).then((r) => r.data?.[0]?.fetched_at ?? null), null);

  let todayGraded = 0, todayPending = 0;
  if (lastSlate) {
    const { data } = await safe(supabase.from("prediction_records").select(`no_bet, prediction_grades:prediction_grades!prediction_record_id ( result )`).eq("slate_date", lastSlate).limit(5000), { data: [] as any[] } as any);
    for (const r of (data ?? []) as Row[]) {
      if (r.no_bet === true) continue;
      const res = gradeOf(r);
      if (res === "win" || res === "loss" || res === "push") todayGraded++; else todayPending++;
    }
  }
  const counts = new Map<string, number>();
  const { data: cov } = await safe(supabase.from("prediction_records").select(`sport, prediction_grades:prediction_grades!prediction_record_id ( result )`).gte("slate_date", "2026-06-15").limit(20000), { data: [] as any[] } as any);
  for (const r of (cov ?? []) as Row[]) { const res = gradeOf(r); if (res === "win" || res === "loss" || res === "push") counts.set(r.sport, (counts.get(r.sport) ?? 0) + 1); }
  const gradedRowsBySport = [...counts.entries()].map(([sport, graded]) => ({ sport, graded })).sort((a, b) => b.graded - a.graded);

  return { lastSlateDate: lastSlate, lastLockAt: lastLock, lastLinesAt: lastLines, todayGraded, todayPending, gradedRowsBySport };
}
