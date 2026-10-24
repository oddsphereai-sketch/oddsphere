import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase credentials are required.");
const client = createClient(url, key, { auth: { persistSession: false } });

function settledResult(row: Json): "win" | "loss" | "push" | null {
  const value = Array.isArray(row.prediction_grades) ? row.prediction_grades[0] : row.prediction_grades;
  return value?.result === "win" || value?.result === "loss" || value?.result === "push" ? value.result : null;
}

function qualifiesSignal(decision: Json, probabilityMin = 0.75, priceMin = -400): boolean {
  const adjustment = decision?.gradeAdjustment ?? {};
  return decision?.market === "moneyline" &&
    decision?.grade === "Watchlist" &&
    decision?.probabilityGrade === "Best Angle" &&
    Number(decision?.modelProbability) >= probabilityMin &&
    Number(decision?.evaluatedQuote?.price) >= priceMin &&
    Number(decision?.evaluatedQuote?.price) <= -200 &&
    adjustment?.movementDirection === "support" &&
    adjustment?.sharpDirection !== "resistance" &&
    adjustment?.publicDirection !== "resistance";
}

function qualifies(decision: Json, coverage: Json, probabilityMin = 0.75, priceMin = -400): boolean {
  return coverage?.injuries === true &&
    Array.isArray(coverage?.healthHolds) &&
    coverage.healthHolds.length === 0 &&
    qualifiesSignal(decision, probabilityMin, priceMin);
}

function summarize(rows: Array<{ result: string; price: number; probability: number }>) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const pushes = rows.filter((row) => row.result === "push").length;
  const units = rows.reduce((sum, row) => sum + (row.result === "loss" ? -1 : row.result === "push" ? 0 : 100 / Math.abs(row.price)), 0);
  return {
    rows: rows.length,
    wins,
    losses,
    pushes,
    hitRatePct: wins + losses === 0 ? null : 100 * wins / (wins + losses),
    averageProbabilityPct: rows.length === 0 ? null : 100 * rows.reduce((sum, row) => sum + row.probability, 0) / rows.length,
    units,
    roiPct: rows.length === 0 ? null : 100 * units / rows.length,
  };
}

async function main(): Promise<void> {
  const stored: Json[] = [];
  for (let from = 0; from < 10_000; from += 500) {
    const { data, error } = await client.from("prediction_records")
      .select("id,external_id,slate_date,locked_at,model_version,snapshot_json,prediction_grades(result)")
      .eq("sport", "cfb")
      .eq("market", "moneyline")
      .not("locked_at", "is", null)
      .gte("slate_date", "2026-08-01")
      .order("id", { ascending: true })
      .range(from, from + 499);
    if (error) throw error;
    stored.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }

  const superseded = new Set(stored.flatMap((row) =>
    Number.isFinite(row.snapshot_json?.supersedes_prediction_record_id)
      ? [row.snapshot_json.supersedes_prediction_record_id]
      : []));
  const settled = stored.filter((row) => !superseded.has(row.id)).flatMap((row) => {
    const decision = row.snapshot_json?.decision_tuple;
    const result = settledResult(row);
    if (!decision || !result) return [];
    return [{
      date: row.slate_date,
      gameId: String(row.external_id),
      release: String(decision.decisionRelease ?? row.model_version ?? "unknown"),
      side: String(decision.side),
      price: Number(decision.evaluatedQuote.price),
      probability: Number(decision.modelProbability),
      result,
      decision,
      coverage: row.snapshot_json?.coverage_at_lock ?? {},
    }];
  });
  const selected = settled.filter((row) => qualifies(row.decision, row.coverage));
  const signalOnly = settled.filter((row) => qualifiesSignal(row.decision));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    writes: 0,
    rule: { probabilityMin: 0.75, priceMin: -400, priceMax: -200, movement: "support", resistanceAllowed: false },
    fullyEligibleResult: summarize(selected),
    signalOnlyResult: summarize(signalOnly),
    evidenceLimitation: "Signal-only rows without verified injury coverage at lock are not complete-rule qualifiers.",
    sensitivity: [0.75, 0.78, 0.80].flatMap((probabilityMin) => [-300, -350, -400, -450].map((priceMin) => {
      const fullRows = settled.filter((row) => qualifies(row.decision, row.coverage, probabilityMin, priceMin));
      const signalRows = settled.filter((row) => qualifiesSignal(row.decision, probabilityMin, priceMin));
      return {
        probabilityMin,
        priceMin,
        fullyEligible: summarize(fullRows),
        signalOnly: summarize(signalRows),
      };
    })),
    fullyEligibleRows: selected.map(({ decision: _decision, coverage: _coverage, ...row }) => row),
    signalOnlyRows: signalOnly.map(({ decision: _decision, coverage: _coverage, ...row }) => row),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
