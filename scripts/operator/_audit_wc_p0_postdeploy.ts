/**
 * READ-ONLY — P0 post-deploy diagnostic for WC card.
 *
 * Answers Daniel's exact 16-point ask: did the merge actually flow
 * into the WC snapshot path, what is BIH/CAN Total's true DB state,
 * what is the grade/no-play distribution, and where is the pipeline
 * stuck. No mutations.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type PredictionRow = {
  id: number;
  game_id: number;
  market: string;
  pick: string | null;
  confidence: number | null;
  grade: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  snapshot_json: Record<string, unknown> | null;
};

type GameRow = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
  status: string | null;
};

type TeamRow = { id: number; abbreviation: string };

function readPath<T>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as T;
}

async function main(): Promise<void> {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(" WC P0 POST-DEPLOY DIAGNOSTIC — read-only");
  console.log("══════════════════════════════════════════════════════════════════════");

  // ─── 1. Find the WC slate (today + tomorrow) ───────────────────────
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const isoTomorrow = tomorrow.toISOString().slice(0, 10);

  const { data: gamesData } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date, status, sport")
    .eq("sport", "soccer")
    .in("slate_date", [isoToday, isoTomorrow])
    .order("game_date", { ascending: true });
  const games = (gamesData as GameRow[] | null) ?? [];

  if (games.length === 0) {
    console.log("\nNo WC games on today/tomorrow slate. Aborting.");
    return;
  }

  const gameIds = games.map((g) => g.id);
  const teamIds = Array.from(
    new Set(
      games
        .flatMap((g) => [g.home_team_id, g.away_team_id])
        .filter((id): id is number => id !== null),
    ),
  );
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const teamMap = new Map(
    ((teamsData as TeamRow[] | null) ?? []).map((t) => [t.id, t.abbreviation]),
  );
  const matchupOf = (g: GameRow): string => {
    const home = g.home_team_id !== null ? teamMap.get(g.home_team_id) ?? "?" : "?";
    const away = g.away_team_id !== null ? teamMap.get(g.away_team_id) ?? "?" : "?";
    return `${away} vs ${home}`;
  };

  // ─── 2. Fetch prediction_records for these games ───────────────────
  const { data: predsData } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, market, pick, confidence, grade, locked_at, created_at, updated_at, snapshot_json",
    )
    .in("game_id", gameIds);
  const allPreds = (predsData as PredictionRow[] | null) ?? [];
  const wcPreds = allPreds.filter((p) => {
    const comp = readPath<string>(p.snapshot_json, ["competition"]);
    return comp === "fifa_world_cup";
  });

  // ─── 3. Per-game per-market summary ───────────────────────────────
  console.log("\n── 1) WC slate prediction_records (model_version + write timestamps)");
  const modelVersions = new Set<string>();
  for (const g of games) {
    const rows = wcPreds.filter((p) => p.game_id === g.id);
    console.log(`\n  g${g.id} ${matchupOf(g)} (kickoff ${g.game_date}):`);
    if (rows.length === 0) {
      console.log("    (no WC prediction_records)");
      continue;
    }
    for (const r of rows.sort((a, b) => a.market.localeCompare(b.market))) {
      const mv = readPath<string>(r.snapshot_json, ["model_version"]) ?? "?";
      modelVersions.add(mv);
      console.log(
        `    ${r.market.padEnd(15)} pick=${(r.pick ?? "null").padEnd(15)} grade=${(r.grade ?? "?").padEnd(15)} locked=${r.locked_at !== null ? "Y" : "n"} updated=${r.updated_at}`,
      );
    }
  }
  console.log(`\n  model_versions seen: ${Array.from(modelVersions).join(", ") || "(none)"}`);

  // ─── 4. Inspect Total rows specifically + reconciliation blob presence ─
  console.log("\n── 2) Total row snapshot — does the new reconciler blob exist?");
  const totalRows = wcPreds.filter((p) => p.market === "total");
  for (const t of totalRows) {
    const g = games.find((gg) => gg.id === t.game_id);
    if (g === undefined) continue;
    console.log(`\n  g${g.id} ${matchupOf(g)}:`);
    console.log(`    prediction.pick                 = ${t.pick}`);
    console.log(`    prediction.confidence           = ${t.confidence}`);
    console.log(`    prediction.grade                = ${t.grade}`);
    console.log(`    prediction.locked_at            = ${t.locked_at}`);
    console.log(`    prediction.updated_at           = ${t.updated_at}`);
    const snap = t.snapshot_json;
    const decisionPick = readPath<string>(snap, ["decision", "pick"]);
    const decisionDisplayed = readPath<string>(snap, ["decision", "displayed_side"]);
    const decisionMeanDir = readPath<string>(snap, ["decision", "mean_direction_side"]);
    const decisionSideReason = readPath<string>(snap, ["decision", "side_selection_reason"]);
    const noBet = readPath<boolean>(snap, ["decision", "no_bet"]);
    const noBetReason = readPath<string>(snap, ["decision", "no_bet_reason"]);
    const lambdaH = readPath<number>(snap, ["model", "lambda_home"]);
    const lambdaA = readPath<number>(snap, ["model", "lambda_away"]);
    const expectedTotal = readPath<number>(snap, ["model", "expected_total"]);
    const probOver = readPath<number>(snap, ["model", "raw_probabilities", "total_at_canonical", "over"]);
    const line = readPath<number>(snap, ["model", "raw_probabilities", "total_at_canonical", "line"]);
    const reconcile = readPath<Record<string, unknown>>(snap, ["decision", "total_projection_reconciliation"]);

    console.log(`    snapshot.decision.pick                          = ${decisionPick}`);
    console.log(`    snapshot.decision.displayed_side                = ${decisionDisplayed}`);
    console.log(`    snapshot.decision.mean_direction_side           = ${decisionMeanDir}`);
    console.log(`    snapshot.decision.side_selection_reason         = ${decisionSideReason}`);
    console.log(`    snapshot.decision.no_bet / reason               = ${noBet} / ${noBetReason}`);
    console.log(`    snapshot.model.lambda_home / lambda_away        = ${lambdaH} / ${lambdaA}`);
    console.log(`    snapshot.model.expected_total                   = ${expectedTotal}`);
    console.log(`    snapshot.model.total_at_canonical.line / over   = ${line} / ${probOver}`);
    console.log(`    snapshot.decision.total_projection_reconciliation present? ${reconcile !== undefined ? "YES" : "NO"}`);
    if (reconcile !== undefined) {
      const fields = [
        "raw_projected_total",
        "raw_probability_side",
        "raw_value_side",
        "mean_direction_side",
        "holistic_side",
        "reconciled_total_side",
        "displayed_total_side",
        "reconciled_confidence_pct",
        "side_selection_reason",
        "invariant_side_matches_total",
        "grade_cap",
        "hold",
      ];
      for (const f of fields) {
        const v = (reconcile as Record<string, unknown>)[f];
        console.log(`      ${f.padEnd(38)} = ${JSON.stringify(v)}`);
      }
    }
  }

  // ─── 5. Inspect Match Result + DC + BTTS rows for reader fields the adapter needs ─
  console.log("\n── 3) Match Result / DC / BTTS snapshots — do they carry the reader paths?");
  for (const market of ["match_result", "double_chance", "btts"]) {
    const rows = wcPreds.filter((p) => p.market === market);
    for (const r of rows) {
      const g = games.find((gg) => gg.id === r.game_id);
      if (g === undefined) continue;
      const probs = readPath<Record<string, number>>(r.snapshot_json, [
        "model",
        "raw_probabilities",
        market === "match_result" ? "match_result" : market === "double_chance" ? "double_chance" : "btts",
      ]);
      const devig = readPath<Record<string, number>>(r.snapshot_json, ["market", "devigged_probabilities"]);
      const edgeMap = readPath<Record<string, unknown>>(r.snapshot_json, ["market", "edge_pp"]);
      const sampleDevigKey =
        market === "match_result"
          ? "match_result|home"
          : market === "double_chance"
            ? "double_chance|home_or_draw"
            : "btts|yes";
      console.log(
        `  g${g.id} ${matchupOf(g)} ${market.padEnd(15)} probs? ${probs !== undefined ? "Y" : "n"}  devig? ${devig !== undefined ? "Y" : "n"} (sample [${sampleDevigKey}]=${devig?.[sampleDevigKey] ?? "n/a"})  edge_pp keys=${edgeMap !== undefined ? Object.keys(edgeMap).length : 0}`,
      );
    }
  }

  // ─── 6. Grade / no_bet distribution ─────────────────────────────────
  console.log("\n── 4) Grade / no_bet distribution");
  console.log("  game           market         pick           grade           no_bet  no_bet_reason / side_selection_reason");
  for (const g of games) {
    const rows = wcPreds.filter((p) => p.game_id === g.id);
    for (const r of rows.sort((a, b) => a.market.localeCompare(b.market))) {
      const noBet = readPath<boolean>(r.snapshot_json, ["decision", "no_bet"]) ?? false;
      const reason = readPath<string>(r.snapshot_json, ["decision", "no_bet_reason"]) ?? "";
      const sideReason = readPath<string>(r.snapshot_json, ["decision", "side_selection_reason"]) ?? "";
      const codeOnly = reason.split(":")[0];
      console.log(
        `  g${g.id}  ${r.market.padEnd(14)} ${(r.pick ?? "null").padEnd(14)} ${(r.grade ?? "?").padEnd(15)} ${String(noBet).padStart(6)}  ${codeOnly} / ${sideReason}`,
      );
    }
  }

  // ─── 7. Final verdict ──────────────────────────────────────────────
  console.log("\n── 5) VERDICT");
  const hasReconcile = totalRows.some((t) => readPath(t.snapshot_json, ["decision", "total_projection_reconciliation"]) !== undefined);
  const hasNewModelVersion = Array.from(modelVersions).some((v) => v.includes("v1"));
  console.log(`  reconciler blob present on any Total row? ${hasReconcile ? "YES" : "NO"}`);
  console.log(`  any locked Total rows?                    ${totalRows.some((t) => t.locked_at !== null) ? "YES" : "NO"}`);
  console.log(`  most recent Total updated_at:             ${totalRows.map((t) => t.updated_at).sort().reverse()[0] ?? "n/a"}`);
  console.log(`  current time UTC:                         ${new Date().toISOString()}`);

  console.log("\n  Read-only audit — no DB writes occurred.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
