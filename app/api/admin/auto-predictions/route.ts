/**
 * R-19 Phase 5f — admin-only read-only preview of auto-model predictions.
 *
 * GET /api/admin/auto-predictions?sport=mlb&date=YYYY-MM-DD
 *
 * Returns per-game ML / O-U / NRFI picks + confidences + hold state for a
 * draft (or any-state) slate, so an operator can visually verify what the
 * orchestrator wrote BEFORE publishing. Member-facing Daily Edge correctly
 * hides draft slates (`slateState: today_draft_only`, R-19 Phase 1 C7);
 * this route gives the operator the only safe path to inspect the data
 * the publish workflow would promote.
 *
 * READ-ONLY. One SELECT join on `games` + `game_predictions`. No model
 * invocation, no service-layer calls, no DB writes. Admin auth: same
 * `validateAdminAuth` (email + token in headers) as /admin/scores-model,
 * /admin/slate, /admin/cron-status.
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";

type RawGameRow = {
  id: number;
  external_id: number;
  game_date: string;
  status: string | null;
  slate_status: string | null;
  home_team: { abbreviation: string; display_name: string } | null;
  away_team: { abbreviation: string; display_name: string } | null;
  // Supabase returns this as a single object when the FK relation is
  // one-to-one (game_predictions has one row per game), null when none,
  // or array when multiple. Normalize in buildRow().
  game_predictions:
    | Array<PredJoin>
    | PredJoin
    | null;
};

type PredJoin = {
  prediction_source: string | null;
  is_override: boolean | null;
  computed_at: string | null;
  locked_at: string | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  ml_grade: string | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  ou_grade: string | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  nrfi_grade: string | null;
  sport_specific: Record<string, unknown> | null;
};

type MarketDto = {
  pick: string | null;
  confidence_pct: number | null;
  grade: string | null;
  held: boolean;
  hold_reason: string | null;
};

type AdminGameRow = {
  external_id: number;
  game_date: string;
  matchup: string;
  away_code: string | null;
  home_code: string | null;
  game_status: string | null;
  slate_status: string | null;
  has_prediction: boolean;
  excluded_inferred_reason: string | null;
  prediction: null | {
    prediction_source: string | null;
    is_override: boolean;
    computed_at: string | null;
    locked_at: string | null;
    fully_held: boolean;
    held_count: number;
    model_breakdown: string | null;
    ml: MarketDto;
    ou: MarketDto;
    nrfi: MarketDto;
  };
};

export type AdminAutoPredictionsResponse = {
  as_of: string;
  sport: "mlb";
  slate_date: string;
  totals: {
    games_count: number;
    predictions_count: number;
    excluded_count: number;
    fully_held_count: number;
    partial_held_count: number;
    no_hold_count: number;
  };
  slate_status_summary: {
    draft: number;
    published: number;
    final: number;
    hidden: number;
    null_or_other: number;
  };
  games: AdminGameRow[];
};

function extractModelBreakdown(
  sportSpecific: Record<string, unknown> | null | undefined
): string | null {
  if (!sportSpecific) return null;
  const v2 = sportSpecific.breakdown_v2;
  if (v2 && typeof v2 === "object" && v2 !== null) {
    const mb = (v2 as Record<string, unknown>).model_breakdown;
    if (typeof mb === "string" && mb.length > 0) return mb;
  }
  const legacy = sportSpecific.member_summary;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  return null;
}

function isHeldByJson(
  sportSpecific: Record<string, unknown> | null | undefined,
  marketKey: "ml" | "ou" | "nrfi"
): boolean {
  if (!sportSpecific) return false;
  if (sportSpecific.held === true) return true;
  const holdPicks = sportSpecific.hold_picks;
  if (Array.isArray(holdPicks) && holdPicks.includes(marketKey)) return true;
  return false;
}

function buildMarket(
  pick: string | null,
  confidence: number | null,
  grade: string | null,
  jsonHeld: boolean
): MarketDto {
  const noPickWritten = pick === null && confidence === null && grade === null;
  const held = jsonHeld || noPickWritten;
  let hold_reason: string | null = null;
  if (held) {
    if (jsonHeld && noPickWritten) hold_reason = "held (no pick)";
    else if (jsonHeld) hold_reason = "held (sport_specific)";
    else hold_reason = "no pick (model declined market)";
  }
  return { pick, confidence_pct: confidence, grade, held, hold_reason };
}

function inferExcludedReason(g: RawGameRow): string | null {
  // No prediction row but game is on the slate. We can't know with 100%
  // certainty which gate excluded it — orchestrator doesn't persist a
  // per-game "excluded by" field. Best-effort interpretation from
  // observable signals:
  //
  //   • games.status indicates "in_progress" / "final" / etc. → likely
  //     Phase 5d G3 in-progress exclusion
  //   • game_date in the past with games.status still "scheduled" →
  //     likely Phase 5c lock_miss exclusion (cron fired too late)
  //   • otherwise → "no prediction written (cause unknown; check
  //     automation report)"
  const status = (g.status ?? "").toLowerCase();
  if (
    status.includes("progress") ||
    status === "final" ||
    status.includes("live") ||
    status.includes("post")
  ) {
    return "G3 intraday exclusion (game in progress / final per BDL)";
  }
  const startMs = Date.parse(g.game_date);
  if (!Number.isNaN(startMs) && startMs < Date.now()) {
    return "lock_miss exclusion (game_date in the past, status=scheduled)";
  }
  return "no prediction written (cause unknown; consult automation report)";
}

function buildRow(g: RawGameRow): AdminGameRow {
  const away = g.away_team?.abbreviation ?? "?";
  const home = g.home_team?.abbreviation ?? "?";
  const matchup = `${away} @ ${home}`;

  // Normalize: Supabase may return the joined predictions as a single
  // object (one-to-one shape), array (one-to-many), or null (no row).
  const predRowsRaw = g.game_predictions;
  const predRows: PredJoin[] =
    predRowsRaw === null
      ? []
      : Array.isArray(predRowsRaw)
        ? predRowsRaw
        : [predRowsRaw];

  // Slate is unique on (game_id) for the auto row; if there are multiple,
  // prefer the most recent computed_at. Manual override rows would also
  // appear here but we surface whichever is current.
  let pred: PredJoin | null = predRows[0] ?? null;
  for (const p of predRows) {
    if (
      pred === null ||
      (p.computed_at &&
        (!pred.computed_at || p.computed_at > pred.computed_at))
    ) {
      pred = p;
    }
  }

  if (pred === null) {
    return {
      external_id: g.external_id,
      game_date: g.game_date,
      matchup,
      away_code: g.away_team?.abbreviation ?? null,
      home_code: g.home_team?.abbreviation ?? null,
      game_status: g.status,
      slate_status: g.slate_status,
      has_prediction: false,
      excluded_inferred_reason: inferExcludedReason(g),
      prediction: null,
    };
  }

  const ml = buildMarket(
    pred.predicted_ml_winner,
    pred.ml_confidence,
    pred.ml_grade,
    isHeldByJson(pred.sport_specific, "ml")
  );
  const ou = buildMarket(
    pred.predicted_ou_side,
    pred.ou_confidence,
    pred.ou_grade,
    isHeldByJson(pred.sport_specific, "ou")
  );
  const nrfiPick =
    pred.predicted_nrfi === null
      ? null
      : pred.predicted_nrfi
        ? "NRFI"
        : "YRFI";
  const nrfi = buildMarket(
    nrfiPick,
    pred.nrfi_confidence,
    pred.nrfi_grade,
    isHeldByJson(pred.sport_specific, "nrfi")
  );

  const heldCount = (ml.held ? 1 : 0) + (ou.held ? 1 : 0) + (nrfi.held ? 1 : 0);
  const fullyHeld = heldCount === 3;

  return {
    external_id: g.external_id,
    game_date: g.game_date,
    matchup,
    away_code: g.away_team?.abbreviation ?? null,
    home_code: g.home_team?.abbreviation ?? null,
    game_status: g.status,
    slate_status: g.slate_status,
    has_prediction: true,
    excluded_inferred_reason: null,
    prediction: {
      prediction_source: pred.prediction_source,
      is_override: pred.is_override === true,
      computed_at: pred.computed_at,
      locked_at: pred.locked_at,
      fully_held: fullyHeld,
      held_count: heldCount,
      model_breakdown: extractModelBreakdown(pred.sport_specific),
      ml,
      ou,
      nrfi,
    },
  };
}

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sport = url.searchParams.get("sport");
  const date = url.searchParams.get("date");

  if (sport !== "mlb") {
    return Response.json(
      { error: "sport must be 'mlb' (V1 launch scope; sport-aware in a future phase)" },
      { status: 400 }
    );
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "Required query param: date=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, status, slate_status, " +
        "home_team:home_team_id (abbreviation, display_name), " +
        "away_team:away_team_id (abbreviation, display_name), " +
        "game_predictions (" +
        "prediction_source, is_override, computed_at, locked_at, " +
        "predicted_ml_winner, ml_confidence, ml_grade, " +
        "predicted_ou_side, ou_confidence, ou_grade, " +
        "predicted_nrfi, nrfi_confidence, nrfi_grade, " +
        "sport_specific" +
        ")"
    )
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("game_date", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rawRows = (data ?? []) as unknown as RawGameRow[];
  const games = rawRows.map(buildRow);

  const slate_status_summary = {
    draft: 0,
    published: 0,
    final: 0,
    hidden: 0,
    null_or_other: 0,
  };
  for (const g of games) {
    const s = g.slate_status;
    if (s === "draft") slate_status_summary.draft++;
    else if (s === "published") slate_status_summary.published++;
    else if (s === "final") slate_status_summary.final++;
    else if (s === "hidden") slate_status_summary.hidden++;
    else slate_status_summary.null_or_other++;
  }

  let predictions_count = 0;
  let excluded_count = 0;
  let fully_held_count = 0;
  let no_hold_count = 0;
  for (const g of games) {
    if (g.prediction === null) {
      excluded_count++;
    } else {
      predictions_count++;
      if (g.prediction.fully_held) fully_held_count++;
      else if (g.prediction.held_count === 0) no_hold_count++;
    }
  }
  const partial_held_count =
    predictions_count - fully_held_count - no_hold_count;

  const body: AdminAutoPredictionsResponse = {
    as_of: new Date().toISOString(),
    sport: "mlb",
    slate_date: date,
    totals: {
      games_count: games.length,
      predictions_count,
      excluded_count,
      fully_held_count,
      partial_held_count,
      no_hold_count,
    },
    slate_status_summary,
    games,
  };

  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
