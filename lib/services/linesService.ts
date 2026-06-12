/**
 * linesService — pull game lines, player props, and sharp signals from the
 * betting provider and write them to lines / line_history / sharp_signals.
 *
 * `lines` has no UNIQUE constraint — strategy is per-(game, market_type,
 * sportsbook) DELETE-then-INSERT (2026-06-10 phantom-thinning fix). A book
 * absent from the latest poll is PRESERVED in `lines` rather than wiped;
 * a book present in the latest poll has its prior rows for that
 * (game, market) replaced atomically.
 *
 * `line_history` is append-only (the change-log archive). `sharp_signals`
 * also gets DELETE-then-INSERT scoped to tonight to handle stale signals
 * being removed when the underlying market normalizes.
 *
 * Skips rows where FK resolution fails — surfaces the skip count in details.
 */

import { supabase } from "../db/supabase";
import { getOddsProvider, getSharpSignalProvider } from "../providers/factory";
import { mergePublicSplitsCarryForward } from "./publicSplitsCarryForward";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { loadGameIdMap, loadPlayerIdMap } from "./_idMaps";
import { SharpAPIOddsProvider } from "../providers/real_api/SharpAPIOddsProvider";
import type { V2DiscoveryReport } from "../providers/real_api/SharpAPIOddsProvider";
import { flagOpenersInHistoryPayload } from "./_lineHistoryOpenerHelper";

/**
 * 2026-06-10 phantom-thinning fix — per-(game, market_type, sportsbook)
 * delete-key derivation. Given the rows we're ABOUT TO INSERT, build the
 * minimal set of (game, market, book) tuples we must clear first so the
 * insert is idempotent.
 *
 * Pure helper, exported so unit tests can assert behavior without a DB.
 *
 * Product rule: "lines should not become thinner just because a later
 * poll is partial. A book absent from this poll persists; a book present
 * has its prior rows for that (game, market) replaced atomically."
 */
export type PerBookDeleteKey = { game_id: number; market_type: string; sportsbook: string };

export function derivePerBookDeleteKeys(
  rows: ReadonlyArray<Record<string, unknown>>,
): PerBookDeleteKey[] {
  const seen = new Set<string>();
  const out: PerBookDeleteKey[] = [];
  for (const r of rows) {
    const gameId = r.game_id;
    const marketType = r.market_type;
    const sportsbook = r.sportsbook;
    if (typeof gameId !== "number") continue;
    if (typeof marketType !== "string") continue;
    if (typeof sportsbook !== "string") continue;
    const k = `${gameId}::${marketType}::${sportsbook}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ game_id: gameId, market_type: marketType, sportsbook });
  }
  return out;
}

/**
 * 2026-06-10 sharp-signals preservation fix — sibling of
 * `derivePerBookDeleteKeys`. `sharp_signals` has no sportsbook column
 * (signals are aggregated/consensus per game/market/side), so the
 * preservation identity is (game_id, market_type, side).
 *
 * Pure helper, exported so unit tests can assert behavior without a DB.
 *
 * Product rule: "Public splits should not disappear just because a
 * later poll is thin. A signal for (game, market, side) absent from
 * this poll persists; a signal present has its prior row replaced
 * atomically."
 */
export type PerSignalDeleteKey = { game_id: number; market_type: string; side: string };

export function derivePerSignalDeleteKeys(
  rows: ReadonlyArray<Record<string, unknown>>,
): PerSignalDeleteKey[] {
  const seen = new Set<string>();
  const out: PerSignalDeleteKey[] = [];
  for (const r of rows) {
    const gameId = r.game_id;
    const marketType = r.market_type;
    const side = r.side;
    if (typeof gameId !== "number") continue;
    if (typeof marketType !== "string") continue;
    if (typeof side !== "string") continue;
    const k = `${gameId}::${marketType}::${side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ game_id: gameId, market_type: marketType, side });
  }
  return out;
}

/**
 * 2026-06-10 phantom-thinning fix — execute per-(game, market, sportsbook)
 * DELETEs against `lines`. Skips the loop entirely when rows is empty
 * (no book got an update → preserve everything as-is).
 */
async function deletePerSportsbook(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: string,
): Promise<void> {
  const keys = derivePerBookDeleteKeys(rows);
  for (const k of keys) {
    const { error } = await supabase
      .from("lines")
      .delete()
      .eq("game_id", k.game_id)
      .eq("market_type", k.market_type)
      .eq("sportsbook", k.sportsbook)
      .is("player_id", null);
    if (error) {
      throw new Error(
        `${context} per-(game,market,sportsbook) delete failed for game_id=${k.game_id} market=${k.market_type} sportsbook=${k.sportsbook}: ${error.message}`,
      );
    }
  }
}

export const linesService = {
  /**
   * Refresh game lines (ML / Total / NRFI etc.) for the slate.
   * DELETE existing rows for tonight's games then INSERT fresh.
   * Also writes an append-only row to line_history per line.
   *
   * `opts.dryRun` (default false) — Phase 4.2.C.1.R-3 operator-script
   * affordance mirroring `refreshSharpSignals`. When true the provider
   * fetch + payload build still run normally so the operator can report
   * exactly what would land, but the DELETE / INSERT against `lines`
   * and `line_history` is skipped. Behavior for existing callers
   * (crons, tests, services) is unchanged when opts is omitted.
   */
  async refreshGameLines(
    sport: Sport,
    date: string,
    opts?: { dryRun?: boolean }
  ): Promise<CronHandlerResult> {
    const dryRun = opts?.dryRun === true;
    const odds = getOddsProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const lines = await odds.getGameLines(date, sport);
    const apiCalls = 1;
    const skipped: number[] = [];

    const linesPayload: Array<Record<string, unknown>> = [];
    const historyPayload: Array<Record<string, unknown>> = [];

    for (const l of lines) {
      const gameId = gameIdByExternal.get(l.game_external_id);
      if (gameId === undefined) {
        skipped.push(l.game_external_id);
        continue;
      }
      const lineRow = {
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        odds_decimal: l.odds_decimal,
        implied_probability: l.implied_probability,
        ev_percent: l.ev_percent,
        fair_odds: l.fair_odds,
        is_ev_positive: l.is_ev_positive,
        fetched_at: l.fetched_at,
      };
      linesPayload.push(lineRow);
      historyPayload.push({
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        is_opener: false,
        recorded_at: l.fetched_at,
      });
    }

    if (!dryRun) {
      // 2026-06-10 phantom-thinning fix — per-(game, market_type, sportsbook)
      // DELETE scope. A book present in this payload gets its prior rows
      // for that (game, market) replaced atomically; a book absent from
      // this payload is preserved. Replaces the prior full-slate wipe
      // that turned every partial poll into a thinning event.
      await deletePerSportsbook(linesPayload, "linesService.refreshGameLines");

      if (linesPayload.length > 0) {
        const { error } = await supabase.from("lines").insert(linesPayload);
        if (error) {
          throw new Error(`linesService.refreshGameLines insert failed: ${error.message}`);
        }
      }
      if (historyPayload.length > 0) {
        const flagged = await flagOpenersInHistoryPayload(
          historyPayload as unknown as Parameters<typeof flagOpenersInHistoryPayload>[0],
        );
        const { error: histErr } = await supabase
          .from("line_history")
          .insert(flagged);
        if (histErr) {
          throw new Error(`linesService.refreshGameLines history insert failed: ${histErr.message}`);
        }
      }
    }

    return {
      records_updated: linesPayload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_game_external_ids: skipped } : undefined,
    };
  },

  /**
   * Phase 4.2.C.1.R-16D — full-slate-safe line refresh.
   *
   * Differences from V1 (refreshGameLines above):
   *
   *  1. Event discovery uses `/splits` (one row per slate game, regardless
   *     of opportunity status) instead of `/opportunities/ev` (only games
   *     with active +EV rows at this minute). Eliminates the silent
   *     coverage shrink observed on 2026-06-04 where V1 dropped from 8/9
   *     to 5/9 games because `/opportunities/ev` returned 5 events at
   *     refresh time.
   *
   *  2. DELETE scope is per-game, not full-slate. Games where the provider
   *     returned at least one valid line row get DELETE-then-INSERT for
   *     that game's game-level rows. Games where the provider returned
   *     nothing (empty / not_found / call-cap-skipped) PRESERVE their
   *     existing rows and surface a warning in the coverage report.
   *     Per-game scope: `lines WHERE game_id = X AND player_id IS NULL`.
   *
   *  3. Returns a rich coverage report so the operator script can print
   *     per-game decisions and the future market-coverage gate can fail
   *     closed when slate-wide coverage falls below a threshold.
   *
   * `opts.dryRun` (default false) — when true, the provider fetch +
   * payload build + coverage assessment still run normally so the
   * operator can report exactly what would land, but DELETE / INSERT
   * are skipped entirely.
   *
   * V2 is real_api-only by design — mock provider doesn't implement the
   * V2 entry point. The factory's `ODDS_PROVIDER` gate stays the
   * authoritative routing knob: when `ODDS_PROVIDER !== "real_api"`,
   * V2 throws with a clear message. Caller (the operator script) is
   * expected to enforce the real_api gate before invoking V2.
   */
  async refreshGameLinesV2(
    sport: Sport,
    date: string,
    opts?: { dryRun?: boolean }
  ): Promise<CronHandlerResult> {
    const dryRun = opts?.dryRun === true;
    const odds = getOddsProvider();
    if (!(odds instanceof SharpAPIOddsProvider)) {
      throw new Error(
        "linesService.refreshGameLinesV2 requires ODDS_PROVIDER=real_api. " +
          `Current odds provider is ${odds.constructor.name}.`
      );
    }

    const gameIdByExternal = await loadGameIdMap(sport, date);
    const slateGameIds = [...gameIdByExternal.values()];
    if (slateGameIds.length === 0) {
      return {
        records_updated: 0,
        api_calls_made: 0,
        details: {
          v2: true,
          slate_empty: true,
          discovery: null,
          per_game_decisions: [],
        },
      };
    }

    // Pre-state — counts BEFORE this run, used for the coverage delta
    // we surface to the operator + the future gate.
    const preSnap = await collectCoverageSnapshot(slateGameIds);
    const preCoverage = preSnap.aggregate;
    const preCoveragePerGame = preSnap.perGame;

    const { records, discovery } = await odds.getGameLinesV2(date, sport);

    // Partition provider rows by (game_id, market_type). This is the
    // unit of preservation: a market the provider didn't return for a
    // game stays untouched (no DELETE), even if other markets for the
    // same game ARE getting refreshed.
    type MarketGroup = {
      gameId: number;
      externalId: number;
      marketType: string;
      lineRows: Array<Record<string, unknown>>;
      historyRows: Array<Record<string, unknown>>;
    };
    const groupKey = (gameId: number, market: string) => `${gameId}::${market}`;
    const groups = new Map<string, MarketGroup>();
    const skippedExternalIds = new Set<number>();

    for (const l of records) {
      const gameId = gameIdByExternal.get(l.game_external_id);
      if (gameId === undefined) {
        skippedExternalIds.add(l.game_external_id);
        continue;
      }
      const key = groupKey(gameId, l.market_type);
      let g = groups.get(key);
      if (g === undefined) {
        g = {
          gameId,
          externalId: l.game_external_id,
          marketType: l.market_type,
          lineRows: [],
          historyRows: [],
        };
        groups.set(key, g);
      }
      g.lineRows.push({
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        odds_decimal: l.odds_decimal,
        implied_probability: l.implied_probability,
        ev_percent: l.ev_percent,
        fair_odds: l.fair_odds,
        is_ev_positive: l.is_ev_positive,
        fetched_at: l.fetched_at,
      });
      g.historyRows.push({
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        is_opener: false,
        recorded_at: l.fetched_at,
      });
    }

    // Per-game decisions. The market-level breakdown lives in
    // `market_decisions` so the operator can see, per game, which
    // markets are being refreshed vs preserved. Game-level `decision`
    // is the high-level summary used by the operator script.
    type MarketDecision = "refreshed" | "preserved";
    type PerGameDecision = {
      game_id: number;
      external_id: number;
      decision:
        | "replaced"
        | "partial"
        | "preserved_no_data"
        | "preserved_unresolved_event"
        | "preserved_call_cap_skip";
      ml_rows: number;
      total_rows: number;
      spread_rows: number;
      books_count: number;
      market_decisions: {
        moneyline: MarketDecision;
        total: MarketDecision;
        spread: MarketDecision;
      };
    };
    const decisions: PerGameDecision[] = [];

    let totalLineRowsWritten = 0;
    let totalHistoryRowsWritten = 0;
    type ReplaceTarget = { gameId: number; marketType: string };
    const replaceTargets: ReplaceTarget[] = [];

    for (const [externalId, gameId] of gameIdByExternal.entries()) {
      const perGameInfo = discovery.perGame.find(
        (g) => g.gameExternalId === externalId
      );

      const mlGroup = groups.get(groupKey(gameId, "moneyline"));
      const totalGroup = groups.get(groupKey(gameId, "total"));
      const spreadGroup = groups.get(groupKey(gameId, "spread"));
      const mlCount = mlGroup?.lineRows.length ?? 0;
      const totalCount = totalGroup?.lineRows.length ?? 0;
      const spreadCount = spreadGroup?.lineRows.length ?? 0;
      const anyCount = mlCount + totalCount + spreadCount;

      const markets: MarketDecision[] = [];
      const mlDecision: MarketDecision = mlCount > 0 ? "refreshed" : "preserved";
      const totalDecision: MarketDecision = totalCount > 0 ? "refreshed" : "preserved";
      const spreadDecision: MarketDecision = spreadCount > 0 ? "refreshed" : "preserved";
      markets.push(mlDecision, totalDecision, spreadDecision);
      if (mlCount > 0) {
        replaceTargets.push({ gameId, marketType: "moneyline" });
        totalLineRowsWritten += mlCount;
        totalHistoryRowsWritten += mlCount;
      }
      if (totalCount > 0) {
        replaceTargets.push({ gameId, marketType: "total" });
        totalLineRowsWritten += totalCount;
        totalHistoryRowsWritten += totalCount;
      }
      if (spreadCount > 0) {
        replaceTargets.push({ gameId, marketType: "spread" });
        totalLineRowsWritten += spreadCount;
        totalHistoryRowsWritten += spreadCount;
      }
      // Also queue any other game-level markets the provider returned
      // (e.g. first_inning_total when SharpAPI starts emitting it).
      for (const g of groups.values()) {
        if (g.gameId !== gameId) continue;
        if (g.marketType === "moneyline" || g.marketType === "total" || g.marketType === "spread") {
          continue;
        }
        replaceTargets.push({ gameId, marketType: g.marketType });
        totalLineRowsWritten += g.lineRows.length;
        totalHistoryRowsWritten += g.lineRows.length;
      }

      const refreshedMarketsCount = markets.filter((m) => m === "refreshed").length;
      let overall: PerGameDecision["decision"];
      if (refreshedMarketsCount === 3) {
        overall = "replaced";
      } else if (refreshedMarketsCount > 0) {
        overall = "partial";
      } else if (perGameInfo !== undefined) {
        overall =
          perGameInfo.oddsCallStatus === "skipped_call_cap"
            ? "preserved_call_cap_skip"
            : "preserved_no_data";
      } else {
        overall = "preserved_unresolved_event";
      }

      decisions.push({
        game_id: gameId,
        external_id: externalId,
        decision: overall,
        ml_rows: mlCount,
        total_rows: totalCount,
        spread_rows: spreadCount,
        books_count: perGameInfo?.books.length ?? 0,
        market_decisions: {
          moneyline: mlDecision,
          total: totalDecision,
          spread: spreadDecision,
        },
      });
      void anyCount;
    }

    // Build the payload first (independent of dry-run + delete-scope decisions).
    // Market-level `replaceTargets` is preserved for the per-game coverage
    // report (decisions.market_decisions = "refreshed" | "preserved"), but the
    // actual DELETE scope is per-(game, market, sportsbook) below.
    const linesPayload: Array<Record<string, unknown>> = [];
    const historyPayload: Array<Record<string, unknown>> = [];
    for (const t of replaceTargets) {
      const g = groups.get(groupKey(t.gameId, t.marketType));
      if (g === undefined) continue;
      linesPayload.push(...g.lineRows);
      historyPayload.push(...g.historyRows);
    }

    if (!dryRun && linesPayload.length > 0) {
      // 2026-06-10 phantom-thinning fix — per-(game, market_type, sportsbook)
      // DELETE scope, derived from the actual rows being inserted. A book
      // present in this payload gets its prior rows for that (game, market)
      // atomically replaced; a book absent from this payload (because
      // SharpAPI's later poll was thinner) is PRESERVED. Replaces the
      // R-16D per-(game, market) wipe that turned every partial poll into
      // a thinning event by deleting all books for a market when only one
      // book reported.
      //
      // splits_consensus is a sportsbook like any other under this scope:
      // it can only delete prior splits_consensus rows, never real books.
      // The R-16E /splits fallback therefore augments instead of replaces.
      await deletePerSportsbook(linesPayload, "linesService.refreshGameLinesV2");

      const { error } = await supabase.from("lines").insert(linesPayload);
      if (error) {
        throw new Error(
          `linesService.refreshGameLinesV2 insert failed: ${error.message}`
        );
      }
      if (historyPayload.length > 0) {
        const flagged = await flagOpenersInHistoryPayload(
          historyPayload as unknown as Parameters<typeof flagOpenersInHistoryPayload>[0],
        );
        const { error: histErr } = await supabase
          .from("line_history")
          .insert(flagged);
        if (histErr) {
          throw new Error(
            `linesService.refreshGameLinesV2 history insert failed: ${histErr.message}`
          );
        }
      }
    }

    // Post-state snapshot — in dry-run this equals preCoverage exactly
    // (no writes happened) plus the projection of what WOULD land. In
    // apply mode it reflects the actual table state after the writes.
    const postCoverage = dryRun
      ? projectPostCoverage(preCoverage, preCoveragePerGame, decisions)
      : (await collectCoverageSnapshot(slateGameIds)).aggregate;

    const details: V2RefreshDetails = {
      v2: true,
      slate_empty: false,
      dry_run: dryRun,
      discovery,
      per_game_decisions: decisions,
      coverage_before: preCoverage,
      coverage_after: postCoverage,
      skipped_game_external_ids:
        skippedExternalIds.size > 0
          ? [...skippedExternalIds]
          : [],
      replace_targets_count: replaceTargets.length,
      games_fully_replaced: decisions.filter((d) => d.decision === "replaced").length,
      games_partially_refreshed: decisions.filter((d) => d.decision === "partial").length,
      preserved_no_data_count: decisions.filter(
        (d) => d.decision === "preserved_no_data"
      ).length,
      preserved_unresolved_count: decisions.filter(
        (d) => d.decision === "preserved_unresolved_event"
      ).length,
      preserved_call_cap_count: decisions.filter(
        (d) => d.decision === "preserved_call_cap_skip"
      ).length,
      total_history_rows_appended: dryRun ? 0 : totalHistoryRowsWritten,
    };

    return {
      records_updated: dryRun ? totalLineRowsWritten : totalLineRowsWritten,
      api_calls_made: discovery.apiCallsMade,
      details: details as unknown as Record<string, unknown>,
    };
  },

  /**
   * Refresh player props for the slate. DELETE existing prop rows
   * (player_id IS NOT NULL) for tonight's games, then INSERT fresh.
   */
  async refreshPlayerProps(sport: Sport, date: string): Promise<CronHandlerResult> {
    const odds = getOddsProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];
    const playerIdByExternal = await loadPlayerIdMap(sport);

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const props = await odds.getPlayerProps(date, sport);
    const apiCalls = 1;
    const skipped: number[] = [];

    const payload: Array<Record<string, unknown>> = [];
    for (const p of props) {
      const gameId = gameIdByExternal.get(p.game_external_id);
      const playerId =
        p.player_external_id !== null
          ? playerIdByExternal.get(p.player_external_id) ?? null
          : null;
      if (gameId === undefined || playerId === null) {
        skipped.push(p.player_external_id ?? p.game_external_id);
        continue;
      }
      payload.push({
        game_id: gameId,
        market_type: p.market_type,
        player_id: playerId,
        sportsbook: p.sportsbook,
        side: p.side,
        line_value: p.line_value,
        odds_american: p.odds_american,
        odds_decimal: p.odds_decimal,
        implied_probability: p.implied_probability,
        ev_percent: p.ev_percent,
        fair_odds: p.fair_odds,
        is_ev_positive: p.is_ev_positive,
        fetched_at: p.fetched_at,
      });
    }

    const { error: delErr } = await supabase
      .from("lines")
      .delete()
      .in("game_id", gameIds)
      .not("player_id", "is", null);
    if (delErr) {
      throw new Error(`linesService.refreshPlayerProps delete failed: ${delErr.message}`);
    }

    if (payload.length > 0) {
      const { error } = await supabase.from("lines").insert(payload);
      if (error) {
        throw new Error(`linesService.refreshPlayerProps insert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_external_ids: skipped } : undefined,
    };
  },

  /**
   * Refresh sharp signals for the slate. DELETE-then-INSERT scoped to
   * tonight's games, with a public-money carry-forward merge: if the
   * new payload row has a null public_money_pct or public_betting_pct
   * and the prior row (same game+market+side) had non-null values,
   * carry the non-null values forward. All other fields (EV, steam,
   * RLM, computed_at) take the new values; if the new payload has no
   * row for a (game, market, side) the row is dropped (signals can
   * disappear).
   *
   * Why: Phase 6B.12 — SharpAPI /splits can return thinner rows on
   * subsequent refreshes (some buckets miss money/bets fields). Pre-
   * 6B.12 the DELETE-then-INSERT clobbered last cycle's rich
   * public_money_pct + public_betting_pct with nulls, which made the
   * Daily Edge public-money conflict guard go neutral and silently
   * un-suppressed Best Angles that should have stayed Watchlist.
   *
   * `opts.dryRun` (default false) is a Phase 4.1.9.C operator-script
   * affordance: when true, the provider fetch + mapping still run normally,
   * but the DELETE / INSERT against `sharp_signals` is skipped. Behavior
   * for existing callers (crons, tests, services) is unchanged.
   */
  async refreshSharpSignals(
    sport: Sport,
    date: string,
    opts?: { dryRun?: boolean }
  ): Promise<CronHandlerResult> {
    const dryRun = opts?.dryRun === true;
    const sharp = getSharpSignalProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const signals = await sharp.getSharpSignals(date);
    const apiCalls = 1;
    const skipped: number[] = [];

    // Phase 6B.12 — load the prior public-money/bets values BEFORE the
    // DELETE so we can carry them forward when the new payload has nulls.
    const priorPublicSplits = new Map<
      string,
      { public_money_pct: number | null; public_betting_pct: number | null }
    >();
    {
      const { data: priorRows, error: priorErr } = await supabase
        .from("sharp_signals")
        .select("game_id, market_type, side, public_money_pct, public_betting_pct")
        .in("game_id", gameIds);
      if (priorErr) {
        throw new Error(
          `linesService.refreshSharpSignals prior-row read failed: ${priorErr.message}`,
        );
      }
      for (const r of (priorRows ?? []) as Array<{
        game_id: number;
        market_type: string;
        side: string;
        public_money_pct: number | null;
        public_betting_pct: number | null;
      }>) {
        priorPublicSplits.set(`${r.game_id}::${r.market_type}::${r.side}`, {
          public_money_pct: r.public_money_pct,
          public_betting_pct: r.public_betting_pct,
        });
      }
    }

    const payload: Array<Record<string, unknown>> = [];
    let publicSplitsCarriedForward = 0;
    for (const s of signals) {
      const gameId = gameIdByExternal.get(s.game_external_id);
      if (gameId === undefined) {
        skipped.push(s.game_external_id);
        continue;
      }

      // Carry forward last-known-good public money/bets when the new
      // row has nulls but the prior row had values. Honest source label
      // is preserved via computed_at (new) — we are not claiming the
      // money% is fresh, only that it represents the latest known
      // value for that side.
      //
      // P1B 2026-06-12 — extracted to pure helper `mergePublicSplitsCarryForward`
      // so the carry-forward + independence contract has unit-test
      // coverage. The helper is the single source of truth for:
      //   • bet% and money% are MERGED INDEPENDENTLY (one being null
      //     never wipes the other);
      //   • a non-null new value overrides prior;
      //   • a null new value falls back to prior when prior had value;
      //   • neither side is FABRICATED — when both new and prior are
      //     null, the persisted column stays null.
      const merged = mergePublicSplitsCarryForward(
        s.public_betting_pct,
        s.public_money_pct,
        priorPublicSplits.get(`${gameId}::${s.market_type}::${s.side}`),
      );
      const publicBetting = merged.betting;
      const publicMoney = merged.money;
      if (merged.carried) publicSplitsCarriedForward++;

      payload.push({
        game_id: gameId,
        market_type: s.market_type,
        side: s.side,
        pinnacle_fair_probability: s.pinnacle_fair_probability,
        is_plus_ev: s.is_plus_ev,
        ev_pct: s.ev_pct,
        has_steam_move: s.has_steam_move,
        steam_detected_at: s.steam_detected_at,
        steam_books_count: s.steam_books_count,
        has_reverse_line_movement: s.has_reverse_line_movement,
        rlm_direction: s.rlm_direction,
        public_betting_pct: publicBetting,
        public_money_pct: publicMoney,
        // Fix 4.1 (Gap-18+19, Flag E1): signal_strength + signal_summary
        // no longer written. DB columns orphaned post-Fix-4.1; V15 future
        // migration drops them. Member-facing text now derives at API
        // response time via signalSummaryGenerator.
        computed_at: s.computed_at,
      });
    }

    if (!dryRun) {
      // Phase 7I — append every observation to sharp_signals_history
      // BEFORE the DELETE on sharp_signals. The history table is the
      // backbone of the Last Known Good reader: when a future refresh
      // overwrites a non-null value with null and the carry-forward
      // guard misses (rare), the reader can still recover the prior
      // valid value from history. Defensive write — if the table
      // doesn't exist (pre-v22 env), the catch keeps the cron alive.
      if (payload.length > 0) {
        const historyPayload = payload.map((p) => ({
          game_id: p.game_id,
          market_type: p.market_type,
          side: p.side,
          public_money_pct: p.public_money_pct,
          public_betting_pct: p.public_betting_pct,
          rlm_detected: p.has_reverse_line_movement,
          steam_detected: p.has_steam_move,
          reverse_line_movement: p.has_reverse_line_movement,
          recorded_at: p.computed_at,
          source: "sharpapi_splits",
        }));
        const { error: histErr } = await supabase
          .from("sharp_signals_history")
          .insert(historyPayload);
        if (histErr) {
          // Never block the live refresh on history-table issues. Log
          // and continue — current sharp_signals still gets the update,
          // so member UI is unaffected.
          console.warn(`sharp_signals_history insert failed (continuing): ${histErr.message}`);
        }
      }

      // 2026-06-10 sharp-signals preservation fix — per-(game, market_type,
      // side) DELETE derived from the actual payload. A signal row for
      // (game, market, side) absent from this poll is PRESERVED in
      // sharp_signals so the public-splits snapshot taken at lock time
      // still has it. Previously this DELETE wiped every signal for the
      // slate's games on every refresh, so any later thin SharpAPI
      // /splits response would erase morning data (and downstream
      // buildPublicSplitsSnapshot would see null where it should have
      // found a value). Mirrors today's per-(game, market, sportsbook)
      // fix on the `lines` table.
      const signalDeleteKeys = derivePerSignalDeleteKeys(payload);
      for (const k of signalDeleteKeys) {
        const { error: delErr } = await supabase
          .from("sharp_signals")
          .delete()
          .eq("game_id", k.game_id)
          .eq("market_type", k.market_type)
          .eq("side", k.side);
        if (delErr) {
          throw new Error(
            `linesService.refreshSharpSignals per-(game,market,side) delete failed for game_id=${k.game_id} market=${k.market_type} side=${k.side}: ${delErr.message}`,
          );
        }
      }

      if (payload.length > 0) {
        const { error } = await supabase.from("sharp_signals").insert(payload);
        if (error) {
          throw new Error(`linesService.refreshSharpSignals insert failed: ${error.message}`);
        }
      }
    }

    const details: Record<string, unknown> = {};
    if (skipped.length > 0) details.skipped_game_external_ids = skipped;
    if (publicSplitsCarriedForward > 0) {
      details.public_splits_carried_forward = publicSplitsCarriedForward;
    }
    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Phase 4.2.C.1.R-16D — V2 coverage helpers
// ─────────────────────────────────────────────────────────────

/**
 * Counts of existing `lines` rows for the slate (game-level only) by
 * market. Used as the V2 "pre/post" snapshot the operator script prints
 * so coverage shrink is impossible to miss.
 */
export type V2CoverageSnapshot = {
  total_game_rows: number;
  games_with_any_line: number;
  games_with_ml: number;
  games_with_total: number;
  games_with_spread: number;
  oldest_fetched_at: string | null;
  newest_fetched_at: string | null;
};

export type V2MarketDecision = "refreshed" | "preserved";

export type V2PerGameDecision = {
  game_id: number;
  external_id: number;
  decision:
    | "replaced"
    | "partial"
    | "preserved_no_data"
    | "preserved_unresolved_event"
    | "preserved_call_cap_skip";
  ml_rows: number;
  total_rows: number;
  spread_rows: number;
  books_count: number;
  market_decisions: {
    moneyline: V2MarketDecision;
    total: V2MarketDecision;
    spread: V2MarketDecision;
  };
};

export type V2RefreshDetails = {
  v2: true;
  slate_empty: boolean;
  dry_run: boolean;
  discovery: V2DiscoveryReport;
  per_game_decisions: V2PerGameDecision[];
  coverage_before: V2CoverageSnapshot;
  coverage_after: V2CoverageSnapshot;
  skipped_game_external_ids: number[];
  /** Total (game, market) DELETE-INSERT pairs the run would write. */
  replace_targets_count: number;
  /** Games where ML + Total + Spread all got fresh provider data. */
  games_fully_replaced: number;
  /** Games where some markets refreshed, others preserved. */
  games_partially_refreshed: number;
  preserved_no_data_count: number;
  preserved_unresolved_count: number;
  preserved_call_cap_count: number;
  total_history_rows_appended: number;
};

/**
 * Per-game pre-state used by `projectPostCoverage` to compute an accurate
 * post-state without re-querying after a hypothetical apply. Keyed by
 * `game_id`. Built inside `collectCoverageSnapshot` so callers don't need
 * to re-walk the rows.
 */
type PerGamePreState = Map<
  number,
  { ml: boolean; total: boolean; spread: boolean }
>;

async function collectCoverageSnapshot(
  gameIds: number[]
): Promise<{ aggregate: V2CoverageSnapshot; perGame: PerGamePreState }> {
  if (gameIds.length === 0) {
    return {
      aggregate: {
        total_game_rows: 0,
        games_with_any_line: 0,
        games_with_ml: 0,
        games_with_total: 0,
        games_with_spread: 0,
        oldest_fetched_at: null,
        newest_fetched_at: null,
      },
      perGame: new Map(),
    };
  }
  const { data, error } = await supabase
    .from("lines")
    .select("game_id, market_type, fetched_at")
    .in("game_id", gameIds)
    .is("player_id", null);
  if (error) {
    throw new Error(
      `linesService coverage snapshot read failed: ${error.message}`
    );
  }
  const rows = (data ?? []) as Array<{
    game_id: number;
    market_type: string;
    fetched_at: string | null;
  }>;
  const gamesAny = new Set<number>();
  const gamesMl = new Set<number>();
  const gamesTotal = new Set<number>();
  const gamesSpread = new Set<number>();
  let oldest: string | null = null;
  let newest: string | null = null;
  const perGame: PerGamePreState = new Map();
  for (const id of gameIds) {
    perGame.set(id, { ml: false, total: false, spread: false });
  }
  for (const r of rows) {
    gamesAny.add(r.game_id);
    const pg = perGame.get(r.game_id);
    if (r.market_type === "moneyline") {
      gamesMl.add(r.game_id);
      if (pg) pg.ml = true;
    } else if (r.market_type === "total") {
      gamesTotal.add(r.game_id);
      if (pg) pg.total = true;
    } else if (r.market_type === "spread") {
      gamesSpread.add(r.game_id);
      if (pg) pg.spread = true;
    }
    const ts = r.fetched_at;
    if (ts !== null) {
      if (oldest === null || ts < oldest) oldest = ts;
      if (newest === null || ts > newest) newest = ts;
    }
  }
  return {
    aggregate: {
      total_game_rows: rows.length,
      games_with_any_line: gamesAny.size,
      games_with_ml: gamesMl.size,
      games_with_total: gamesTotal.size,
      games_with_spread: gamesSpread.size,
      oldest_fetched_at: oldest,
      newest_fetched_at: newest,
    },
    perGame,
  };
}

/**
 * Dry-run projection: take pre-state per-game and overlay the would-be
 * decisions to produce an accurate post snapshot. "Replaced" games take
 * on the new market counts; "preserved_*" games keep their pre-coverage
 * state intact.
 */
function projectPostCoverage(
  pre: V2CoverageSnapshot,
  perGamePre: PerGamePreState,
  decisions: V2PerGameDecision[]
): V2CoverageSnapshot {
  const postPerGame = new Map<
    number,
    { ml: boolean; total: boolean; spread: boolean }
  >();
  for (const [id, state] of perGamePre.entries()) {
    postPerGame.set(id, { ...state });
  }
  let projectedNewRows = 0;
  for (const d of decisions) {
    if (d.decision !== "replaced" && d.decision !== "partial") continue;
    // Per-(game, market) overlay. A market refreshed by the provider
    // gains coverage; a preserved market keeps whatever it had in pre.
    const cur = postPerGame.get(d.game_id) ?? {
      ml: false,
      total: false,
      spread: false,
    };
    postPerGame.set(d.game_id, {
      ml: d.ml_rows > 0 ? true : cur.ml,
      total: d.total_rows > 0 ? true : cur.total,
      spread: d.spread_rows > 0 ? true : cur.spread,
    });
    projectedNewRows += d.ml_rows + d.total_rows + d.spread_rows;
  }
  let any = 0,
    ml = 0,
    tot = 0,
    spr = 0;
  for (const state of postPerGame.values()) {
    if (state.ml || state.total || state.spread) any++;
    if (state.ml) ml++;
    if (state.total) tot++;
    if (state.spread) spr++;
  }
  // Best-effort total_game_rows projection: replaced games contribute
  // projectedNewRows; preserved games keep an unknown share of pre rows.
  // The accurate breakdown only matters on apply runs (where we re-read
  // the table); for the dry-run preview we surface the delta as the
  // projected new rows so operators can see the size of the planned
  // write.
  return {
    total_game_rows: projectedNewRows,
    games_with_any_line: any,
    games_with_ml: ml,
    games_with_total: tot,
    games_with_spread: spr,
    oldest_fetched_at: pre.oldest_fetched_at,
    newest_fetched_at: pre.newest_fetched_at,
  };
}
