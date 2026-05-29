/**
 * POST /api/admin/upload-slate — Fix 7.2 manual slate ingestion.
 *
 * Body: { sport, slate_date, games: [{home_team_abbrev, away_team_abbrev,
 *   game_date, season, season_type?, venue?, notes?}, ...] }
 *
 * Flow:
 *   1. Validate admin auth (email allowlist + token).
 *   2. Validate body shape + sport + date format.
 *   3. Validate every team abbreviation exists in `teams` for the chosen
 *      sport — Flag B1 (no auto-create). Unknown abbrevs return 400 with
 *      a structured `unknown_teams` list so the UI can highlight them.
 *   4. INSERT one row into manual_slate_staging (status='pending').
 *   5. Instantiate `new ManualSlateProvider({ stagingRowId })` and pass it
 *      as the providerOverride to `slateService.refreshGames` — concurrent-
 *      request safe; never touches process.env (Flag E1 / Option 2).
 *   6. UPDATE the staging row with status='ingested' (or 'failed') and
 *      the ingest_result JSON.
 *   7. Return { staging_id, records_updated, skipped, source_type? },
 *      mirroring the scores-model upload route's audit-friendly envelope.
 *
 * Out of scope (intentionally): scores-model predictions (still go through
 * /api/admin/upload-scores-model), player props (auto-generated from
 * propModelOrchestrator when inputs land), sharp signals (Phase 8).
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import { slateService } from "@/lib/services/slateService";
import { publishSlate } from "@/lib/services/slatePublishService";
import {
  ManualSlateProvider,
  type ManualSlateGameInput,
} from "@/lib/providers/manual/ManualSlateProvider";
import { computeSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";

// Fix 7.2.2: defensive validation patterns used to reject malformed inputs
// before they reach the deterministic-hash code path. Keeping the regex
// strict prevents "2030-1-15" vs "2030-01-15" from hashing differently
// and producing two game rows for the same logical matchup.
const STRICT_ABBREV_RE = /^[A-Z0-9]{2,5}$/;

const VALID_SPORTS: ReadonlySet<Sport> = new Set([
  "mlb",
  "nba",
  "nfl",
  "cbb",
  "cfb",
  "nhl",
  "ucl",
]);

type RequestBody = {
  sport?: string;
  slate_date?: string;
  games?: ManualSlateGameInput[];
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isIsoTimestamp(s: string): boolean {
  // Accept ISO 8601 with milliseconds or seconds, with Z or offset.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s);
}

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ─── 1. Body shape validation ──────────────────────────────────────────
  // Fix 7.2.2: normalize sport upfront (trim + lowercase) so case-variant
  // operator input ("MLB" vs "mlb") reaches the same canonical branch and
  // produces the same downstream hash. The VALID_SPORTS check then runs
  // against the normalized form.
  const sportRaw = body.sport;
  const sport =
    typeof sportRaw === "string" ? sportRaw.trim().toLowerCase() : sportRaw;
  const slate_date = body.slate_date;
  const games = body.games;

  if (!sport || !slate_date || !Array.isArray(games)) {
    return Response.json(
      {
        error:
          "Required body fields: sport (one of mlb/nba/nfl/cbb/cfb/nhl/ucl), slate_date (YYYY-MM-DD), games[] (array)",
      },
      { status: 400 }
    );
  }
  if (!VALID_SPORTS.has(sport as Sport)) {
    return Response.json(
      {
        error: `Unknown sport '${sportRaw}'. Valid: mlb, nba, nfl, cbb, cfb, nhl, ucl`,
      },
      { status: 400 }
    );
  }
  if (!isIsoDate(slate_date)) {
    return Response.json(
      { error: `slate_date must be YYYY-MM-DD (got '${slate_date}')` },
      { status: 400 }
    );
  }
  if (games.length === 0) {
    return Response.json(
      { error: "games[] must contain at least one game" },
      { status: 400 }
    );
  }

  // Per-game shape validation + Fix 7.2.2 defensive normalization. We
  // uppercase + trim every abbreviation in place so the staging payload
  // stores already-normalized values; downstream consumers (provider,
  // hash, team lookup) trust the staging row and don't re-normalize.
  // Malformed inputs are rejected at this gate with helpful error text
  // before any DB write happens.
  const shapeErrors: Array<{ index: number; errors: string[] }> = [];
  const normalizedGames: ManualSlateGameInput[] = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i]!;
    const errs: string[] = [];

    const homeRaw = typeof g.home_team_abbrev === "string" ? g.home_team_abbrev : "";
    const awayRaw = typeof g.away_team_abbrev === "string" ? g.away_team_abbrev : "";
    const home = homeRaw.trim().toUpperCase();
    const away = awayRaw.trim().toUpperCase();

    if (!home) {
      errs.push("home_team_abbrev is required (non-empty string)");
    } else if (!STRICT_ABBREV_RE.test(home)) {
      errs.push(
        `home_team_abbrev '${homeRaw}' is invalid (expected 2-5 uppercase alphanumeric characters after trim)`
      );
    }
    if (!away) {
      errs.push("away_team_abbrev is required (non-empty string)");
    } else if (!STRICT_ABBREV_RE.test(away)) {
      errs.push(
        `away_team_abbrev '${awayRaw}' is invalid (expected 2-5 uppercase alphanumeric characters after trim)`
      );
    }
    if (typeof g.game_date !== "string" || !isIsoTimestamp(g.game_date)) {
      errs.push("game_date must be an ISO 8601 timestamp");
    }
    if (typeof g.season !== "number" || !Number.isInteger(g.season)) {
      errs.push("season must be an integer");
    }
    if (home && away && home === away) {
      errs.push("home_team_abbrev and away_team_abbrev must differ");
    }

    // Fix 7.2.4: slate-date consistency guard. The operator-selected
    // slate_date drives staging row identity + manual provider keys +
    // the auto-publish target; games.slate_date is independently derived
    // from game_date via computeSlateDate. If the two disagree, the
    // published-slate auto-publish step targets the wrong date and
    // promotes 0 rows — leaving the actual game stuck in draft.
    //
    // We compute the canonical slate_date from game_date here (same
    // function slateService.refreshGames uses) and reject if it doesn't
    // match the operator's selected slate_date. All-or-nothing: even
    // one mismatch rejects the whole upload BEFORE any DB write,
    // because partial success would re-create the same bug for the
    // bad games.
    //
    // Requires game_date already valid + sport already validated.
    if (
      typeof g.game_date === "string" &&
      isIsoTimestamp(g.game_date) &&
      errs.length === 0
    ) {
      try {
        const computed = computeSlateDate(sport as Sport, g.game_date);
        if (computed !== slate_date) {
          errs.push(
            `game_date '${g.game_date}' rolls into slate '${computed}' but the upload is targeting slate '${slate_date}'. ` +
              `Either change the start time/date to match the selected slate, or change the slate-date selector.`
          );
        }
      } catch (computeErr) {
        // computeSlateDate throws on invalid input; should be caught by
        // isIsoTimestamp above, but defensive guard so we don't 500.
        errs.push(
          `Failed to compute slate date from game_date '${g.game_date}': ${(computeErr as Error).message}`
        );
      }
    }

    if (errs.length > 0) {
      shapeErrors.push({ index: i, errors: errs });
    } else {
      normalizedGames.push({
        ...g,
        home_team_abbrev: home,
        away_team_abbrev: away,
      });
    }
  }
  if (shapeErrors.length > 0) {
    return Response.json(
      { error: "Invalid game(s)", details: shapeErrors },
      { status: 400 }
    );
  }
  // Sport already normalized upfront; re-cast to the Sport union for type
  // narrowing on downstream consumers.
  const normalizedSport = sport as Sport;

  // ─── 2. Team abbreviation resolution (Flag B1) ─────────────────────────
  // Fix 7.2.2: use the normalizedGames list (uppercase abbrevs) so the
  // lookup against teams.abbreviation matches the seed convention.
  const requestedAbbrevs = new Set<string>();
  for (const g of normalizedGames) {
    requestedAbbrevs.add(g.home_team_abbrev);
    requestedAbbrevs.add(g.away_team_abbrev);
  }
  const { data: teamRows, error: teamErr } = await supabase
    .from("teams")
    .select("abbreviation")
    .eq("sport", normalizedSport)
    .in("abbreviation", Array.from(requestedAbbrevs));
  if (teamErr) {
    return Response.json(
      { error: `Team lookup failed: ${teamErr.message}` },
      { status: 500 }
    );
  }
  const foundAbbrevs = new Set(
    ((teamRows ?? []) as Array<{ abbreviation: string }>).map(
      (r) => r.abbreviation
    )
  );
  const unknownAbbrevs = Array.from(requestedAbbrevs).filter(
    (a) => !foundAbbrevs.has(a)
  );
  if (unknownAbbrevs.length > 0) {
    // Multi-sport empty state (Flag H1): if zero teams are seeded for this
    // sport, surface that distinctly so the UI can render the right hint.
    const { count: totalForSport } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true })
      .eq("sport", normalizedSport);
    const hint =
      (totalForSport ?? 0) === 0
        ? `No teams seeded for sport='${normalizedSport}'. Manual slate uploads require teams to exist first (Fix 7.2.1 will seed the remaining sports).`
        : `Unknown team abbreviation(s) for sport='${normalizedSport}'.`;
    return Response.json(
      {
        error: hint,
        unknown_teams: unknownAbbrevs,
        sport: normalizedSport,
        teams_seeded_for_sport: totalForSport ?? 0,
      },
      { status: 400 }
    );
  }

  // ─── 3. INSERT staging row ─────────────────────────────────────────────
  // Fix 7.2.2: stash the already-normalized sport + games payload so any
  // downstream re-read (manual provider's cron path) operates on the same
  // canonical form. The hash and the natural-key string land in lockstep.
  const { data: stagingInsert, error: stagingErr } = await supabase
    .from("manual_slate_staging")
    .insert({
      sport: normalizedSport,
      slate_date,
      payload: { games: normalizedGames },
      status: "pending",
      created_by: auth.email,
    })
    .select("id")
    .single();
  if (stagingErr || !stagingInsert) {
    return Response.json(
      {
        error: `Failed to record staging row: ${stagingErr?.message ?? "unknown"}`,
      },
      { status: 500 }
    );
  }
  const stagingRowId = (stagingInsert as { id: number }).id;

  // ─── 4. Inline refresh via explicit provider override ──────────────────
  // Concurrent-request safe: each request constructs its own provider
  // bound to its own staging row (no shared singleton, no env mutation).
  const provider = new ManualSlateProvider({ stagingRowId });

  type PublishPayload = {
    promoted: number;
    status: "published" | "draft";
    error?: string;
  };

  try {
    const result = await slateService.refreshGames(
      normalizedSport,
      slate_date,
      provider
    );

    // ─── 5. Auto-publish (Fix 7.2.2 — Flag A1) ──────────────────────────
    // After the slate refresh succeeds we promote the games from 'draft'
    // to 'published' so they appear in /lab/daily-edge immediately. The
    // smoke test's manual `UPDATE games SET slate_status='published'` SQL
    // workaround is no longer needed. Structured partial success: if
    // publishSlate throws we do NOT roll back the slate ingest — the
    // games are valid as draft and can be promoted later by re-uploading
    // or via a follow-up admin action.
    let publish: PublishPayload;
    try {
      const promoted = await publishSlate(normalizedSport, slate_date);
      publish = { promoted: promoted.promoted, status: "published" };
    } catch (publishErr) {
      const message = publishErr instanceof Error ? publishErr.message : String(publishErr);
      publish = { promoted: 0, status: "draft", error: message };
    }

    await supabase
      .from("manual_slate_staging")
      .update({
        status: "ingested",
        ingested_at: new Date().toISOString(),
        ingest_result: { ...result, publish },
      })
      .eq("id", stagingRowId);

    return Response.json({
      sport: normalizedSport,
      slate_date,
      staging_id: stagingRowId,
      records_updated: result.records_updated,
      api_calls_made: result.api_calls_made,
      details: result.details ?? null,
      publish,
      source: "manual_slate_upload",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("manual_slate_staging")
      .update({
        status: "failed",
        ingested_at: new Date().toISOString(),
        ingest_result: { error: message },
      })
      .eq("id", stagingRowId);

    return Response.json(
      {
        error: `Slate refresh failed: ${message}`,
        staging_id: stagingRowId,
      },
      { status: 500 }
    );
  }
}
