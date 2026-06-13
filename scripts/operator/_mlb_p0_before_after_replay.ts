/**
 * MLB-P0 READ-ONLY before/after replay.
 *
 * Pulls recent MLB prediction_records that were Best Angle (grade or
 * boolean) and replays the NEW pipeline over their locked inputs:
 *   raw model prob + market prob → regularize → grade → confirmation gate.
 *
 * "Before" = what was stored (raw edge, old grade/boolean).
 * "After"  = what the new code (imported live) would produce.
 *
 * No writes. No locked-snapshot mutation. Pure replay for the pre-push table.
 */
import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { regularizeProbability } = await import("../../lib/automodel/mlbProbabilityRegularization");
  const { computePlayGrade } = await import("../../lib/automodel/playGrade");
  const { resolveMlbBestAngle } = await import("../../lib/services/predictionRecordService");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data } = await sb
    .from("prediction_records")
    .select("matchup, market, pick, odds_american, model_probability, market_probability, edge, play_grade, best_angle, data_quality_tier, provisional, snapshot_json")
    .eq("sport", "mlb")
    .or("play_grade.eq.best_angle,best_angle.eq.true")
    .gte("slate_date", "2026-06-06")
    .order("slate_date", { ascending: false })
    .limit(40);

  const rows = data ?? [];
  let baBefore = 0, baAfter = 0, mlPreserved = 0, totalPreserved = 0;
  let lineAgainstStillBA = 0, hugeUnconfirmedStillBA = 0;
  const table: string[] = [];
  table.push(
    "matchup | mkt | pick | rawP | mktP | regP | rawEdge | regEdge | before | after | reason | lineDir | confirm? | capped",
  );

  for (const r of rows) {
    const sp = (r.snapshot_json ?? {}) as Record<string, unknown>;
    const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
    const lm = (sp.line_movement ?? null) as Record<string, unknown> | null;
    const isML = r.market === "moneyline";
    const k = isML ? 0.6 : 0.5;
    const cap = isML ? 10.0 : 9.0;
    const rawProb = typeof r.model_probability === "number" ? r.model_probability : null;
    const marketProb = typeof r.market_probability === "number" ? r.market_probability : null;

    const reg = regularizeProbability({ rawProb, marketProb, k, maxDistancePp: cap });

    // Fallback / hard-block reconstruction from the locked audit.
    const overOdds = (v22.over_odds_american ?? null) as number | null;
    const underOdds = (v22.under_odds_american ?? null) as number | null;
    const ouOddsMissing = !isML && (overOdds === null || underOdds === null || marketProb === null);
    const mlFallback = isML && marketProb === null;
    const tier = (r.data_quality_tier ?? v22.data_quality_tier ?? "high") as
      "high" | "medium" | "low" | "fallback";

    const grade = computePlayGrade({
      modelProb: reg.regularizedProb,
      marketProb,
      americanOdds: typeof r.odds_american === "number" ? r.odds_american : null,
      dataQualityTier: tier,
      provisional: r.provisional === true,
      isHeld: false,
      minBestAngleEdgePct: isML ? 3.0 : 3.5,
      minBestAngleConfidencePct: 56,
      marketProbIsFallback: mlFallback || ouOddsMissing,
      bestAngleHardBlockReason: ouOddsMissing
        ? "total requires real O/U odds (no fallback) for Best Angle"
        : null,
    });
    const baseEligible = grade.grade === "best_angle";
    const requiresConfirmation = baseEligible && reg.capApplied;
    const lineDir = (lm?.direction ?? null) as
      "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
    const resolved = resolveMlbBestAngle({
      baseEligible,
      requiresConfirmation,
      lineDirection: lineDir,
      opposingPublicMoney: false, // unchanged guard; already reflected pre-patch
    });

    const wasBA = r.best_angle === true || r.play_grade === "best_angle";
    if (wasBA) baBefore++;
    if (resolved.bestAngle) {
      baAfter++;
      if (isML) mlPreserved++; else totalPreserved++;
      if (lineDir === "against_pick") lineAgainstStillBA++;
      if (requiresConfirmation && lineDir !== "toward_pick") hugeUnconfirmedStillBA++;
    }

    table.push(
      [
        r.matchup, r.market, r.pick,
        rawProb?.toFixed(3) ?? "—",
        marketProb?.toFixed(3) ?? "—",
        reg.regularizedProb?.toFixed(3) ?? "—",
        (reg.rawEdgePct ?? r.edge)?.toFixed?.(1) ?? "—",
        reg.regularizedEdgePct?.toFixed(1) ?? "—",
        wasBA ? "BA" : (r.play_grade ?? "—"),
        resolved.bestAngle ? "BA" : (baseEligible ? "Lean(demoted)" : grade.grade),
        resolved.demoteReason ?? grade.bestAngleBlockReason ?? "—",
        lineDir ?? "—",
        requiresConfirmation ? (lineDir === "toward_pick" ? "yes" : "needed") : "n/a",
        reg.capApplied ? "yes" : "no",
      ].join(" | "),
    );
  }

  console.log(table.join("\n"));
  console.log("\n──────── SUMMARY ────────");
  console.log(`rows scanned (recent MLB BA): ${rows.length}`);
  console.log(`Best Angles BEFORE: ${baBefore}`);
  console.log(`Best Angles AFTER:  ${baAfter}`);
  console.log(`  ML Best Angles preserved:    ${mlPreserved}`);
  console.log(`  Total Best Angles preserved: ${totalPreserved}`);
  console.log(`line-movement-against still BA (must be 0):     ${lineAgainstStillBA}`);
  console.log(`huge unconfirmed edge still BA (must be 0):     ${hugeUnconfirmedStillBA}`);
})();
