import { supabase } from "../../lib/db/supabase";

const START = process.env.START_DATE ?? "2026-06-07";

type Row = {
  date: string;
  matchup: string;
  pick: string | null;
  odds: number | null;
  p: number | null;
  edge: number | null;
  grade: string;
  ba: boolean;
  res: string;
  dir: string | null;
  rawEdge: number | null;
  demote: string | null;
};

function profit(odds: number, win: boolean): number {
  return win ? (odds > 0 ? odds / 100 : 100 / -odds) : -1;
}

function ev(p: number | null, odds: number | null): number | null {
  if (p === null || odds === null) return null;
  const decimalProfit = odds > 0 ? odds / 100 : 100 / -odds;
  return p * decimalProfit - (1 - p);
}

function settled(rows: Row[]): Row[] {
  return rows.filter((row) => row.res === "win" || row.res === "loss");
}

function stat(label: string, rows: Row[]): void {
  const graded = settled(rows);
  const wins = graded.filter((row) => row.res === "win").length;
  let units = 0;
  let priced = 0;
  for (const row of graded) {
    if (typeof row.odds !== "number") continue;
    priced += 1;
    units += profit(row.odds, row.res === "win");
  }
  const losses = graded.length - wins;
  const winPct = graded.length ? `${(100 * wins / graded.length).toFixed(1)}%` : "--";
  const roi = priced ? `${(100 * units / priced).toFixed(1)}%` : "--";
  console.log(`${label.padEnd(46)} ${`${wins}-${losses}`.padEnd(8)} ${winPct.padEnd(8)} units ${units.toFixed(2).padStart(7)} roi ${String(roi).padStart(8)} n=${graded.length}`);
}

function lineDirection(snapshot: Record<string, unknown> | null): string | null {
  const movement = snapshot?.line_movement;
  if (!movement || typeof movement !== "object") return null;
  const direction = (movement as Record<string, unknown>).direction;
  return typeof direction === "string" ? direction : null;
}

function auditValue(row: Row, minP: number, minEdge: number): boolean {
  return (
    typeof row.odds === "number" &&
    row.odds > -151 &&
    row.odds <= 120 &&
    typeof row.p === "number" &&
    row.p >= minP &&
    Math.abs(row.edge ?? 0) >= minEdge &&
    (ev(row.p, row.odds) ?? -1) >= 0
  );
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("slate_date,matchup,market,pick,odds_american,model_probability,edge,play_grade,best_angle,no_bet,launch_day,snapshot_json,prediction_grades(result)")
    .eq("sport", "mlb")
    .gte("slate_date", START);
  if (error) throw error;

  const rows: Row[] = (data ?? [])
    .filter((raw: any) => raw.launch_day !== true && raw.no_bet !== true && raw.market === "moneyline")
    .map((raw: any) => {
      const grade = Array.isArray(raw.prediction_grades) ? raw.prediction_grades[0] : raw.prediction_grades;
      const snapshot = raw.snapshot_json ?? null;
      const audit = snapshot?.v2_2_audit ?? {};
      const resolution = snapshot?.ml_best_angle_resolution ?? {};
      return {
        date: String(raw.slate_date),
        matchup: String(raw.matchup),
        pick: raw.pick ?? null,
        odds: raw.odds_american,
        p: raw.model_probability,
        edge: raw.edge,
        grade: String(raw.play_grade ?? "").toLowerCase(),
        ba: raw.best_angle === true,
        res: String(grade?.result ?? "").toLowerCase(),
        dir: lineDirection(snapshot),
        rawEdge: typeof audit.ml_raw_edge_pct === "number" ? audit.ml_raw_edge_pct : null,
        demote: typeof resolution.ml_restoration_profile_demote_reason === "string"
          ? resolution.ml_restoration_profile_demote_reason
          : typeof resolution.demote_reason === "string" ? resolution.demote_reason : null,
      };
    });

  const band = rows.filter((row) => typeof row.odds === "number" && row.odds > -151 && row.odds <= 120);
  console.log(`ML short-favorite/small-dog audit from ${START}`);
  console.log(`Rows: all ML=${rows.length}, band=${band.length}, settled band=${settled(band).length}`);
  console.log("");
  stat("All ML", rows);
  stat("Current ML Best Angle", rows.filter((row) => row.ba));
  stat("Current ML Lean", rows.filter((row) => row.grade === "lean" && !row.ba));
  stat("Band all", band);
  stat("Band current BA", band.filter((row) => row.ba));
  stat("Band current Lean", band.filter((row) => row.grade === "lean" && !row.ba));
  console.log("");
  stat("Band p>=.55 edge>=2 EV>=0", band.filter((row) => auditValue(row, 0.55, 2)));
  stat("Band p>=.58 edge>=3 EV>=0", band.filter((row) => auditValue(row, 0.58, 3)));
  stat("Band p>=.60 edge>=4 EV>=0", band.filter((row) => auditValue(row, 0.60, 4)));
  stat("Band p>=.62 edge>=5.5 EV>=0", band.filter((row) => auditValue(row, 0.62, 5.5)));
  console.log("");
  const valueBand = band.filter((row) => auditValue(row, 0.58, 3));
  stat("Value band + movement toward", valueBand.filter((row) => row.dir === "toward_pick"));
  stat("Value band + movement neutral/unknown", valueBand.filter((row) => row.dir === "neutral" || row.dir === "unknown" || row.dir === null));
  stat("Value band + movement against", valueBand.filter((row) => row.dir === "against_pick"));
  console.log("");
  console.log("Settled p>=.58 edge>=3 EV>=0 band examples:");
  for (const row of settled(valueBand).slice(0, 120)) {
    console.log([
      row.date,
      row.matchup.padEnd(12),
      String(row.pick).padEnd(5),
      `odds=${String(row.odds).padStart(4)}`,
      `p=${row.p?.toFixed(3) ?? "--"}`,
      `edge=${row.edge?.toFixed(1) ?? "--"}`,
      `dir=${row.dir ?? "--"}`,
      `grade=${row.grade || "--"}`,
      `ba=${row.ba}`,
      `res=${row.res}`,
      `demote=${row.demote ?? "--"}`,
    ].join(" "));
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
