/**
 * Phase 4.1.8.A — operator-run live v1↔v2 comparison for the new
 * pickBreakdownGenerator + verdictDerivation + sharpReadSelector.
 *
 * Reads the persisted 5/22 slate (or the slate passed via --date) and
 * produces a side-by-side comparison per game:
 *
 *   V1 (persisted member_summary)
 *   V2 (new model_breakdown from generator)
 *   V2 derived verdict     (from headline grade + per-market confidence)
 *   V2 derived sharp read  (from headline grade + sharp signals)
 *
 * Plus end-of-run summary stats: verdict distribution, char counts,
 * forbidden-phrase scan.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-pick-breakdown-generator-live.ts --sport mlb --date 2026-05-22
 *
 * Read-only. No DB writes. No env flags set. No prediction writes.
 * generatePredictionsForSlate runs with writeToDb=false purely to get
 * fresh AutoModelOutput objects for v2 generation — v1 copy comes from
 * the persisted sport_specific.member_summary.
 */
import { generatePredictionsForSlate } from "../lib/services/automodelService";
import {
  generatePickBreakdown,
  BREAKDOWN_VERSION,
  MODEL_BREAKDOWN_CAP,
  __TEST__ as PBG_TEST,
} from "../lib/services/pickBreakdownGenerator";
import { buildFeatureSnapshots } from "../lib/automodel/featureSnapshot";
import {
  deriveVerdict,
  VERDICT_LABEL,
  PLAYABLE_CONFIDENCE_FLOOR,
  type Verdict,
} from "../lib/services/verdictDerivation";
import {
  selectSharpRead,
  SHARP_READ_CAP,
  type SharpReadInput,
  type SharpReadMarket,
} from "../lib/services/sharpReadSelector";
import { supabase } from "../lib/db/supabase";
import type { Grade } from "../lib/types/domain/Grade";
import type { Sport } from "../lib/types/domain/Sport";

const { FORBIDDEN_MEMBER_PATTERNS } = PBG_TEST;

// ─── CLI args ────────────────────────────────────────────────────────

function parseArgs(): { sport: Sport; date: string } {
  const args = process.argv.slice(2);
  let sport: Sport = "mlb";
  let date = "2026-05-22";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sport" && args[i + 1]) {
      sport = args[i + 1] as Sport;
      i++;
    } else if (args[i] === "--date" && args[i + 1]) {
      date = args[i + 1];
      i++;
    }
  }
  return { sport, date };
}

// ─── Direction derivation mirrors app/api/lab/daily-edge/route.ts ────

function deriveDirection(grade: Grade | null): "positive" | "negative" | "neutral" {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "positive";
  if (grade === "sharp_conflict") return "negative";
  return "neutral";
}

// ─── Headline grade + market derivation mirrors perPickHeadline.ts ───

const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

type PersistedRow = {
  game_id: number;
  external_id: number;
  away_abbr: string;
  home_abbr: string;
  ml_grade: Grade | null;
  ou_grade: Grade | null;
  nrfi_grade: Grade | null;
  ml_confidence: number | null; // 0..100 (DB scale)
  ou_confidence: number | null;
  nrfi_confidence: number | null;
  member_summary_v1: string | null;
};

type PersistedSharpRow = {
  game_id: number;
  market_type: "moneyline" | "total" | "first_inning_total";
};

function pickHeadline(
  row: PersistedRow
): { grade: Grade | null; market: SharpReadMarket | null } {
  const candidates: Array<{
    grade: Grade;
    market: SharpReadMarket;
    precedence: number;
  }> = [];
  if (row.ml_grade !== null) {
    candidates.push({ grade: row.ml_grade, market: "ml", precedence: 0 });
  }
  if (row.ou_grade !== null) {
    candidates.push({ grade: row.ou_grade, market: "total", precedence: 1 });
  }
  if (row.nrfi_grade !== null) {
    candidates.push({ grade: row.nrfi_grade, market: "nrfi", precedence: 2 });
  }
  if (candidates.length === 0) {
    return { grade: null, market: null };
  }
  candidates.sort((a, b) => {
    const r = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });
  return { grade: candidates[0]!.grade, market: candidates[0]!.market };
}

// ─── Forbidden-phrase scan ───────────────────────────────────────────

function scanForbidden(text: string): string[] {
  const hits: string[] = [];
  for (const re of FORBIDDEN_MEMBER_PATTERNS) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sport, date } = parseArgs();

  console.log("");
  console.log("═".repeat(96));
  console.log(
    `Phase 4.1.8.A — v1↔v2 pick breakdown comparison · sport=${sport} · slate_date=${date}`
  );
  console.log(`breakdown_version (new) = ${BREAKDOWN_VERSION}`);
  console.log(
    `caps: MODEL_BREAKDOWN_CAP=${MODEL_BREAKDOWN_CAP}, SHARP_READ_CAP=${SHARP_READ_CAP}, PLAYABLE_CONFIDENCE_FLOOR=${PLAYABLE_CONFIDENCE_FLOOR}`
  );
  console.log("═".repeat(96));

  // ─── Pull persisted predictions + sharp signals from DB ────────────
  const { data: persistedRows, error: predErr } = await supabase
    .from("games")
    .select(
      `id, external_id, sport, slate_date,
       home_team:home_team_id (abbreviation),
       away_team:away_team_id (abbreviation),
       game_predictions (
         ml_grade, ou_grade, nrfi_grade,
         ml_confidence, ou_confidence, nrfi_confidence,
         sport_specific
       )`
    )
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("game_date", { ascending: true });

  if (predErr) {
    console.error(`[db] games query failed: ${predErr.message}`);
    process.exit(1);
  }
  if (!persistedRows || persistedRows.length === 0) {
    console.error(`[db] no games found for ${sport} / ${date}`);
    process.exit(1);
  }

  type GameRowShape = {
    id: number;
    external_id: number;
    home_team: { abbreviation: string };
    away_team: { abbreviation: string };
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
  const rawGames = persistedRows as unknown as GameRowShape[];

  const persistedByExt = new Map<number, PersistedRow>();
  const gameIdByExt = new Map<number, number>();
  for (const g of rawGames) {
    const pred = g.game_predictions;
    if (!pred) continue;
    const ss = (pred.sport_specific ?? {}) as Record<string, unknown>;
    const ms = typeof ss.member_summary === "string" ? ss.member_summary : null;
    persistedByExt.set(g.external_id, {
      game_id: g.id,
      external_id: g.external_id,
      away_abbr: g.away_team.abbreviation,
      home_abbr: g.home_team.abbreviation,
      ml_grade: pred.ml_grade,
      ou_grade: pred.ou_grade,
      nrfi_grade: pred.nrfi_grade,
      ml_confidence: pred.ml_confidence,
      ou_confidence: pred.ou_confidence,
      nrfi_confidence: pred.nrfi_confidence,
      member_summary_v1: ms,
    });
    gameIdByExt.set(g.external_id, g.id);
  }

  // ─── Pull sharp_signals for those games (batched) ──────────────────
  const gameIds = Array.from(gameIdByExt.values());
  const { data: sigData, error: sigErr } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type")
    .in("game_id", gameIds);
  if (sigErr) {
    console.error(`[db] sharp_signals query failed: ${sigErr.message}`);
    process.exit(1);
  }
  const sharpByGameId = new Map<number, PersistedSharpRow[]>();
  for (const row of (sigData ?? []) as PersistedSharpRow[]) {
    const arr = sharpByGameId.get(row.game_id) ?? [];
    arr.push(row);
    sharpByGameId.set(row.game_id, arr);
  }

  // ─── Build feature snapshots + run model (writeToDb=false) ─────────
  const snapshots = await buildFeatureSnapshots(sport, date);
  const snapByExt = new Map<number, typeof snapshots[number]>();
  for (const s of snapshots) snapByExt.set(s.game_external_id, s);

  const result = await generatePredictionsForSlate(
    sport,
    date,
    "morning_draft",
    { writeToDb: false }
  );

  // ─── Comparison output + stats ─────────────────────────────────────
  const verdictCounts: Record<Verdict, number> = {
    best_angle: 0,
    lean: 0,
    watchlist: 0,
    caution: 0,
    no_play: 0,
  };
  const modelBreakdownLengths: number[] = [];
  const sharpReadLengths: number[] = [];
  const v1Lengths: number[] = [];
  const forbiddenHits: Array<{ ext: number; pattern: string; text: string }> = [];
  let gamesProcessed = 0;
  let gamesSkipped = 0;

  for (const pred of result.predictions) {
    const ext = pred.game_external_id;
    const persisted = persistedByExt.get(ext);
    const snap = snapByExt.get(ext);
    if (!persisted || !snap) {
      console.log(`\n--- ext=${ext}: missing persisted row or snapshot, skipping`);
      gamesSkipped++;
      continue;
    }

    // v1 from DB
    const v1 = persisted.member_summary_v1 ?? "(no v1 member_summary persisted)";
    v1Lengths.push(v1.length);

    // v2 model_breakdown from new generator
    const breakdown = generatePickBreakdown(pred, {
      sport,
      home_pitcher_name: snap.home_starter?.player_name ?? null,
      away_pitcher_name: snap.away_starter?.player_name ?? null,
      home_team_abbr: snap.home_team.abbreviation,
      away_team_abbr: snap.away_team.abbreviation,
      home_first_inning_starts: snap.home_starter?.first_inning_starts ?? null,
      away_first_inning_starts: snap.away_starter?.first_inning_starts ?? null,
      home_first_inning_era: snap.home_starter?.first_inning_era ?? null,
      away_first_inning_era: snap.away_starter?.first_inning_era ?? null,
      home_season_era: snap.home_starter?.season_era ?? null,
      away_season_era: snap.away_starter?.season_era ?? null,
    });
    const v2 = breakdown.model_breakdown;
    modelBreakdownLengths.push(v2.length);

    // Forbidden-phrase scan on v2
    const hits = scanForbidden(v2);
    for (const p of hits) {
      forbiddenHits.push({ ext, pattern: p, text: v2 });
    }

    // Headline grade + market from persisted per-pick grades
    const { grade: headlineGrade, market: headlineMarket } =
      pickHeadline(persisted);

    // Derive verdict (normalize confidences from 0..100 → 0..1)
    const verdict = deriveVerdict({
      headlineGrade,
      perMarketConfidence: {
        ml: persisted.ml_confidence !== null ? persisted.ml_confidence / 100 : null,
        total:
          persisted.ou_confidence !== null ? persisted.ou_confidence / 100 : null,
        nrfi:
          persisted.nrfi_confidence !== null
            ? persisted.nrfi_confidence / 100
            : null,
      },
    });
    verdictCounts[verdict]++;

    // Project sharp signals: market_type → my keys, direction from grade
    const persistedSigs = sharpByGameId.get(persisted.game_id) ?? [];
    const projected: SharpReadInput["sharpSignals"] = [];
    for (const s of persistedSigs) {
      let market: SharpReadMarket;
      let gradeForMarket: Grade | null;
      if (s.market_type === "moneyline") {
        market = "ml";
        gradeForMarket = persisted.ml_grade;
      } else if (s.market_type === "total") {
        market = "total";
        gradeForMarket = persisted.ou_grade;
      } else {
        market = "nrfi";
        gradeForMarket = persisted.nrfi_grade;
      }
      projected.push({
        market,
        direction: deriveDirection(gradeForMarket),
      });
    }
    const sharpRead = selectSharpRead({
      headlineGrade,
      headlineMarket,
      sharpSignals: projected,
    });
    sharpReadLengths.push(sharpRead.length);

    // ─── Per-game output ────────────────────────────────────────────
    console.log("");
    console.log("─".repeat(96));
    console.log(
      `ext=${ext}  ${persisted.away_abbr} @ ${persisted.home_abbr}  ` +
        `(${snap.away_starter?.player_name ?? "?"} vs ${snap.home_starter?.player_name ?? "?"})`
    );
    console.log(
      `  per-pick grades: ml=${persisted.ml_grade ?? "—"}  ` +
        `total=${persisted.ou_grade ?? "—"}  nrfi=${persisted.nrfi_grade ?? "—"}`
    );
    console.log(
      `  per-pick conf:   ml=${persisted.ml_confidence ?? "—"}  ` +
        `total=${persisted.ou_confidence ?? "—"}  nrfi=${persisted.nrfi_confidence ?? "—"}`
    );
    console.log(
      `  headline:        grade=${headlineGrade ?? "—"}  market=${headlineMarket ?? "—"}`
    );
    console.log("");
    console.log(`V1 (persisted, ${v1.length} chars):`);
    console.log(`  ${v1}`);
    console.log("");
    console.log(`V2 verdict:        ${VERDICT_LABEL[verdict]}`);
    console.log(`V2 sharp_read     (${sharpRead.length} chars):`);
    console.log(`  ${sharpRead}`);
    console.log(`V2 model_breakdown (${v2.length} chars):`);
    console.log(`  ${v2}`);
    if (hits.length > 0) {
      console.log(`  ⚠ FORBIDDEN PHRASE HITS: ${hits.join(", ")}`);
    }
    gamesProcessed++;
  }

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("");
  console.log("═".repeat(96));
  console.log(`SUMMARY — ${gamesProcessed} games processed, ${gamesSkipped} skipped`);
  console.log("═".repeat(96));

  console.log("");
  console.log("Verdict distribution (v2):");
  for (const v of Object.keys(verdictCounts) as Verdict[]) {
    console.log(`  ${VERDICT_LABEL[v].padEnd(12)} ${verdictCounts[v]}`);
  }

  const summarize = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...arr),
      max: Math.max(...arr),
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    };
  };
  const mb = summarize(modelBreakdownLengths);
  const sr = summarize(sharpReadLengths);
  const v1s = summarize(v1Lengths);

  console.log("");
  console.log("Char counts — v2 model_breakdown:");
  console.log(`  min ${mb.min}  ·  max ${mb.max}  ·  avg ${mb.avg}  (cap ${MODEL_BREAKDOWN_CAP})`);
  const mbViolations = modelBreakdownLengths.filter((n) => n > MODEL_BREAKDOWN_CAP).length;
  console.log(`  cap violations: ${mbViolations}`);

  console.log("");
  console.log("Char counts — v2 sharp_read:");
  console.log(`  min ${sr.min}  ·  max ${sr.max}  ·  avg ${sr.avg}  (cap ${SHARP_READ_CAP})`);
  const srViolations = sharpReadLengths.filter((n) => n > SHARP_READ_CAP).length;
  console.log(`  cap violations: ${srViolations}`);

  console.log("");
  console.log("Char counts — v1 persisted member_summary:");
  console.log(`  min ${v1s.min}  ·  max ${v1s.max}  ·  avg ${v1s.avg}`);

  console.log("");
  const v2Combined = mb.avg + sr.avg;
  const delta = v1s.avg > 0 ? Math.round(((v2Combined - v1s.avg) / v1s.avg) * 100) : 0;
  console.log(
    `v1 avg → v2 combined avg (model_breakdown + sharp_read): ${v1s.avg} → ${v2Combined}  (${delta >= 0 ? "+" : ""}${delta}%)`
  );

  console.log("");
  console.log(`Forbidden-phrase scan: ${forbiddenHits.length} hits across ${gamesProcessed} v2 model_breakdowns`);
  if (forbiddenHits.length > 0) {
    for (const h of forbiddenHits) {
      console.log(`  ✗ ext=${h.ext}: ${h.pattern}  in:  "${h.text}"`);
    }
  }

  console.log("");
  console.log("═".repeat(96));
  console.log("Done. No DB writes. No env flags set. No prediction writes.");
  console.log("═".repeat(96));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
