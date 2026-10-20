/* eslint-disable @typescript-eslint/no-explicit-any -- immutable release snapshots span historical DTO shapes */
import { createClient } from "@supabase/supabase-js";
import { UCL_MEMBER_SNAPSHOT_KEY } from "../../lib/services/ucl/uclMemberSnapshotStore";

type Market = "match_result" | "double_chance" | "total" | "btts";
type Movement = "toward" | "against" | "flat" | "unknown";

const MARKETS: Market[] = ["match_result", "double_chance", "total", "btts"];
const ACTIONABLE = new Set(["Best Angle", "Lean"]);

function decimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function implied(american: number): number {
  return 1 / decimal(american);
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function selectedMovement(snapshot: any, selectedSide: string | null): { direction: Movement; pp: number | null } {
  const rows = snapshot?.complete_price_board?.rows ?? snapshot?.member_market_at_capture?.soccerPriceBoard?.rows ?? [];
  if (!selectedSide || !Array.isArray(rows) || rows.length < 2) return { direction: "unknown", pp: null };
  const selected = rows.find((row: any) => row.side === selectedSide);
  const selectedBook = String(snapshot?.current_sportsbook ?? selected?.odds_trail?.at(-1)?.sportsbook ?? "").toLowerCase();
  if (!selectedBook) return { direction: "unknown", pp: null };
  const vectors = rows.map((row: any) => {
    const trail = (row?.odds_trail ?? []).filter((stop: any) => String(stop.sportsbook ?? "").toLowerCase() === selectedBook);
    const opening = trail.find((stop: any) => stop.label === "open" || stop.label === "first") ?? trail[0];
    const current = typeof row?.price_american === "number" ? row.price_american : trail.at(-1)?.american;
    return { side: row.side, opening: opening?.american, current };
  });
  if (vectors.some((row: any) => !Number.isFinite(row.opening) || !Number.isFinite(row.current))) {
    return { direction: "unknown", pp: null };
  }
  const openingTotal = vectors.reduce((sum: number, row: any) => sum + implied(row.opening), 0);
  const currentTotal = vectors.reduce((sum: number, row: any) => sum + implied(row.current), 0);
  const row = vectors.find((candidate: any) => candidate.side === selectedSide);
  if (!row || openingTotal <= 0 || currentTotal <= 0) return { direction: "unknown", pp: null };
  const pp = (implied(row.current) / currentTotal - implied(row.opening) / openingTotal) * 100;
  return { direction: pp >= 0.5 ? "toward" : pp <= -0.5 ? "against" : "flat", pp };
}

function compact(row: any) {
  const snapshot = row.snapshot_json ?? {};
  const grade = first(row.prediction_grades);
  const actionable = row.no_bet !== true && ACTIONABLE.has(row.play_grade);
  const result = grade?.result ?? (grade?.win ? "win" : grade?.loss ? "loss" : grade?.push ? "push" : grade?.void ? "void" : "pending");
  const price = typeof row.odds_american === "number" ? row.odds_american : null;
  const probability = typeof row.model_probability === "number" ? row.model_probability : null;
  const ev = price === null || probability === null ? null : probability * decimal(price) - 1;
  const movement = selectedMovement(snapshot, row.side);
  const member = snapshot.member_market_at_capture ?? {};
  const splits = snapshot.splits ?? member.publicSplits ?? [];
  const bttsShadow = row.market === "btts" ? snapshot?.model_provenance?.bttsShadow ?? null : null;
  return {
    id: row.id,
    date: row.slate_date,
    matchup: row.matchup,
    market: row.market as Market,
    pick: row.pick,
    side: row.side,
    grade: row.play_grade,
    actionable,
    result,
    price,
    probability,
    exactEv: ev,
    source: snapshot.current_sportsbook ?? member.currentPriceSportsbook ?? null,
    movement: movement.direction,
    movementPp: movement.pp,
    splitsState: Array.isArray(splits) && splits.length > 0 ? "present" : "unavailable",
    stage: snapshot.competition_context?.stage ?? null,
    modelRelease: row.model_version,
    calibrationRelease: row.calibration_version,
    bttsShadow,
  };
}

function binaryMetrics(probabilities: Array<{ probability: number; actual: 0 | 1 }>) {
  if (!probabilities.length) return { rows: 0, brier: null, logLoss: null };
  return {
    rows: probabilities.length,
    brier: probabilities.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / probabilities.length,
    logLoss: probabilities.reduce((sum, row) => {
      const probability = Math.max(1e-8, Math.min(1 - 1e-8, row.probability));
      return sum - (row.actual * Math.log(probability) + (1 - row.actual) * Math.log(1 - probability));
    }, 0) / probabilities.length,
  };
}

function summarizeBttsShadow(rows: ReturnType<typeof compact>[]) {
  const settled = rows.flatMap((row) => {
    if (row.market !== "btts" || !row.bttsShadow || !["win", "loss"].includes(row.result)) return [];
    const lockedSide = String(row.side ?? "").toLowerCase();
    if (lockedSide !== "yes" && lockedSide !== "no") return [];
    const actualSide = row.result === "win" ? lockedSide : lockedSide === "yes" ? "no" : "yes";
    const modelYes = Number(row.bttsShadow.modelYes);
    const candidateYes = Number(row.bttsShadow.candidateYes);
    if (![modelYes, candidateYes].every(Number.isFinite)) return [];
    return [{
      release: String(row.bttsShadow.release ?? "unknown"),
      actualSide,
      modelYes,
      candidateYes,
      modelSide: modelYes >= 0.5 ? "yes" : "no",
      candidateSide: candidateYes >= 0.5 ? "yes" : "no",
      lane: row.bttsShadow.lane ?? "unavailable",
      gradeEffect: row.bttsShadow.gradeEffect ?? "unavailable",
    }];
  });
  return Object.fromEntries([...new Set(settled.map((row) => row.release))].map((release) => {
    const cohort = settled.filter((row) => row.release === release);
    const actualNo = cohort.filter((row) => row.actualSide === "no");
    const model = binaryMetrics(cohort.map((row) => ({ probability: row.modelYes, actual: row.actualSide === "yes" ? 1 as const : 0 as const })));
    const candidate = binaryMetrics(cohort.map((row) => ({ probability: row.candidateYes, actual: row.actualSide === "yes" ? 1 as const : 0 as const })));
    return [release, {
      rows: cohort.length,
      lanes: Object.fromEntries(["aligned", "conflicted", "corrected", "unavailable"].map((lane) => [lane, cohort.filter((row) => row.lane === lane).length])),
      gradeEffects: Object.fromEntries(["promotion", "demotion", "unchanged", "unavailable"].map((effect) => [effect, cohort.filter((row) => row.gradeEffect === effect).length])),
      model: {
        accuracy: cohort.length ? cohort.filter((row) => row.modelSide === row.actualSide).length / cohort.length : null,
        noRecall: actualNo.length ? actualNo.filter((row) => row.modelSide === "no").length / actualNo.length : null,
        ...model,
      },
      candidate: {
        accuracy: cohort.length ? cohort.filter((row) => row.candidateSide === row.actualSide).length / cohort.length : null,
        noRecall: actualNo.length ? actualNo.filter((row) => row.candidateSide === "no").length / actualNo.length : null,
        ...candidate,
      },
    }];
  }));
}

function summarize(rows: ReturnType<typeof compact>[]) {
  const settled = rows.filter((row) => ["win", "loss", "push", "void"].includes(row.result));
  const actionables = settled.filter((row) => row.actionable && ["win", "loss", "push"].includes(row.result));
  const units = actionables.reduce((sum, row) => sum + (row.result === "win" && row.price !== null ? decimal(row.price) - 1 : row.result === "loss" ? -1 : 0), 0);
  return {
    rows: rows.length,
    settled: settled.length,
    actionables: actionables.length,
    record: `${actionables.filter((row) => row.result === "win").length}-${actionables.filter((row) => row.result === "loss").length}-${actionables.filter((row) => row.result === "push").length}`,
    units,
    nonpositiveExactEvActionables: actionables.filter((row) => row.exactEv !== null && row.exactEv <= 0).length,
    splitRows: rows.filter((row) => row.splitsState === "present").length,
    movement: Object.fromEntries((["toward", "against", "flat", "unknown"] as Movement[]).map((direction) => {
      const cohort = actionables.filter((row) => row.movement === direction);
      return [direction, { rows: cohort.length, wins: cohort.filter((row) => row.result === "win").length, losses: cohort.filter((row) => row.result === "loss").length }];
    })),
  };
}

function currentMarkets(games: any[]) {
  return games.flatMap((game) => ([
    ["match_result", game.markets?.moneyline],
    ["double_chance", game.soccerDoubleChanceMarket],
    ["total", game.markets?.total],
    ["btts", game.markets?.first_inning],
  ] as const).map(([market, dto]) => ({
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    market,
    pick: dto?.pick ?? null,
    grade: dto?.verdict?.label ?? "No Play",
    actionable: ACTIONABLE.has(dto?.verdict?.label),
    price: dto?.currentPriceAmerican ?? null,
    exactEv: typeof dto?.modelProb === "number" && typeof dto?.currentPriceAmerican === "number"
      ? dto.modelProb * decimal(dto.currentPriceAmerican) - 1
      : null,
    splitsState: Array.isArray(dto?.publicSplits) && dto.publicSplits.length > 0 ? "present" : "unavailable",
    source: dto?.currentPriceSportsbook ?? null,
  })));
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: locked, error: lockedError } = await client.from("prediction_records")
    .select("id,slate_date,matchup,market,pick,side,odds_american,model_probability,play_grade,no_bet,model_version,calibration_version,snapshot_json,prediction_grades(result,win,loss,push,void)")
    .eq("sport", "soccer")
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true })
    .limit(5_000);
  if (lockedError) throw lockedError;
  const uclRows = (locked ?? []).filter((row: any) => row.snapshot_json?.competition === "uefa_champions_league").map(compact);

  const { data: snapshot, error: snapshotError } = await client.from("lab_response_snapshots")
    .select("payload,generated_at,payload_version")
    .eq("snapshot_key", UCL_MEMBER_SNAPSHOT_KEY)
    .single();
  if (snapshotError) throw snapshotError;
  const board = currentMarkets((snapshot?.payload as any)?.games ?? []);
  const actionableLosses = uclRows.filter((row) => row.actionable && row.result === "loss");
  const movementPromotionCandidates = uclRows.filter((row) =>
    !row.actionable
    && ["win", "loss", "push"].includes(row.result)
    && row.exactEv !== null
    && row.exactEv > 0
    && row.movement === "toward"
    && row.price !== null,
  );
  const movementResistanceActionables = uclRows.filter((row) =>
    row.actionable
    && ["win", "loss", "push"].includes(row.result)
    && row.movement === "against",
  );

  console.log(JSON.stringify({
    mode: "read_only_zero_write",
    locked: {
      all: summarize(uclRows),
      byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(uclRows.filter((row) => row.market === market))])),
      actionableLosses,
      movementCounterfactual: {
        pairedRule: "promote positive-EV movement-toward nonactionables; demote movement-against actionables",
        promotions: movementPromotionCandidates,
        demotions: movementResistanceActionables,
        promotionRecord: `${movementPromotionCandidates.filter((row) => row.result === "win").length}-${movementPromotionCandidates.filter((row) => row.result === "loss").length}-${movementPromotionCandidates.filter((row) => row.result === "push").length}`,
        demotionRecord: `${movementResistanceActionables.filter((row) => row.result === "win").length}-${movementResistanceActionables.filter((row) => row.result === "loss").length}-${movementResistanceActionables.filter((row) => row.result === "push").length}`,
      },
      bttsShadowByRelease: summarizeBttsShadow(uclRows),
    },
    current: {
      generatedAt: snapshot.generated_at,
      payloadVersion: snapshot.payload_version,
      games: new Set(board.map((row) => row.matchup)).size,
      markets: board.length,
      actionables: board.filter((row) => row.actionable).length,
      nonpositiveExactEvActionables: board.filter((row) => row.actionable && row.exactEv !== null && row.exactEv <= 0).length,
      splitRows: board.filter((row) => row.splitsState === "present").length,
      byMarket: Object.fromEntries(MARKETS.map((market) => {
        const rows = board.filter((row) => row.market === market);
        return [market, { rows: rows.length, actionables: rows.filter((row) => row.actionable).length }];
      })),
      rows: board,
    },
    interpretationBoundary: {
      missingSplits: "neutral_not_negative",
      movement: "audit_only_pending_ucl_specific_out_of_sample_validation",
      openingMatchResult: "target_excluded_two_book_corroboration_only",
      regulationTime: true,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
