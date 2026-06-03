/**
 * /api/cron/daily-refresh — INTENTIONALLY DISABLED (Phase 4.2.A tripwire).
 *
 * THE BDL STATS PIPELINE IS CURRENTLY BROKEN. Activating this cron without
 * first completing Phase 4.3 (BDL stats rebuild) would corrupt the existing
 * seeded stats tables. The pre-flight audit run during Phase 4.2.A planning
 * established the following:
 *
 *   • Our `players.external_id` values are MLB.com Stats API IDs
 *     (e.g. 592450 for Aaron Judge). BDL uses its own native namespace
 *     (e.g. 569 for Aaron Judge). ZERO overlap between the two ID
 *     namespaces in the verified probe.
 *
 *   • `statsService.refreshPlayers`
 *       UPSERTs on (sport, external_id). With zero ID overlap, every BDL
 *       player would INSERT as a new row alongside the existing 90 seeded
 *       MLB players, duplicating the roster across two namespaces.
 *       → DANGEROUS to run.
 *
 *   • `statsService.refreshSeasonStats`
 *       BDL's /season_stats endpoint IGNORES the `player_id` query
 *       parameter and returns the league-wide paginated set instead.
 *       Verified by querying both our DB IDs and BDL's native IDs and
 *       observing identical responses ("Will Smith" as the first row in
 *       both cases). After 5 pages × 100 per_page = 500 rows, the
 *       provider UPSERTs all 500 with player_id=<our DB id>, leaving
 *       one randomly-chosen row per (player_id, season). Existing seeded
 *       stats would be overwritten with random data.
 *       → DANGEROUS to run.
 *
 *   • `statsService.refreshSplits`
 *       `BallDontLieProvider.getPlayerSplits` parses `response.data` as
 *       a flat array, but BDL returns a NESTED OBJECT keyed by split
 *       category (`data.byBreakdown`, `data.byArena`, `data.byOpponent`,
 *       …). The fetchAll helper sees a non-array and returns []. Compounded
 *       by the same ID-namespace mismatch as above.
 *       → Returns 0 rows; not dangerous but wasted API quota.
 *
 *   • `statsService.refreshPitchStats`
 *       Almost certainly the same shape-mismatch + ID-namespace pattern.
 *       Not independently verified during the audit.
 *       → Presumed broken.
 *
 *   • `statsService.refreshInjuries`
 *       BDL `/player_injuries` is a global endpoint and works fine. But
 *       each record's `player_external_id` is in BDL's namespace, so
 *       loadPlayerIdMap → 0 matches → 0 injuries linked to our players.
 *       → Returns 0 useful rows.
 *
 * PHASE 4.3 will fix this by:
 *   • Building a BDL-id resolver for the existing seeded players table
 *     (match by full_name + team + position + bats/throws)
 *   • Fixing `BallDontLieProvider.getPlayerSplits` to read nested
 *     `data.byBreakdown` + filter on split_name = "vs. Left"/"vs. Right"
 *   • Investigating an alternate BDL endpoint (or query strategy) for
 *     per-player season stats — current `/season_stats` is unfiltered
 *   • Truncating + re-ingesting player_splits, player_season_stats,
 *     pitcher_pitch_stats, hitter_pitch_stats from real BDL data
 *   • Re-validating auto-model output against the re-ingested data
 *   • Activating this cron only after the full re-ingest succeeds
 *
 * UNTIL PHASE 4.3 IS COMPLETE this route IS A NO-OP. The Vercel cron
 * schedule does not list this route (vercel.json has no crons array for
 * Phase 4.2 — only morning-slate is scheduled). If someone schedules it
 * manually or curls the endpoint directly, the tripwire guard below
 * returns a clear refusal message instead of running the broken services.
 *
 * The original orchestration code is preserved in git history at commit
 * 09446e4 if a future operator needs to reference it. Re-enabling
 * requires Phase 4.3 work AND removing the tripwire below.
 */

export async function GET(_request: Request) {
  return Response.json(
    {
      ok: false,
      disabled: true,
      reason:
        "daily-refresh is intentionally disabled — see Phase 4.3 (BDL stats pipeline rebuild). " +
        "Activating this cron would corrupt seeded stats tables. " +
        "See route file header for the full audit.",
      phase: "4.3",
      tripwire: "DAILY_REFRESH_DANGEROUS_ENABLE",
    },
    { status: 503 }
  );
}

// Vercel cron uses GET; POST mirrored to GET for parity with other cron
// routes (every other /api/cron/*/route.ts exports POST = GET).
export const POST = GET;
