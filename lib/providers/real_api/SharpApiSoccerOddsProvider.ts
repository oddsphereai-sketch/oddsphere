/**
 * SharpAPI Soccer / World Cup odds provider — WC-2.
 *
 * Secondary market overlay + sharp-read substrate. Pulls from three
 * endpoints scoped to the `fifa_world_cup_matches` league per the
 * binding WC-2 contract:
 *
 *   • /odds?league=fifa_world_cup_matches            — full market catalog
 *   • /opportunities/ev?league=fifa_world_cup_matches — EV/Kelly fields
 *   • /splits?league=fifa_world_cup_matches           — public splits
 *
 * The `fifa_-_world_cup` league bucket is INTENTIONALLY NOT used — that
 * bucket is polymarket-novelty heavy (championship_winner =
 * "Will Ronaldo Cry?", etc.) per the WC market inventory probe (see
 * [[project-wc-launch-contract]]).
 *
 * Discipline:
 *   • Reuses the existing `SharpApiClient` (general-purpose; no MLB
 *     coupling).
 *   • Unsupported markets dropped via the soccer market normalizer
 *     whitelist. Point spread, draw_no_bet, team_total_*, props, etc.
 *     never become public-tracking-shaped rows. They MAY flow into
 *     the snapshot as model-context (separate path, WC-3+).
 *   • Splits classification matches the binding "empty_as_of_probe"
 *     contract — returns a status object even when no rows exist.
 */

import {
  SharpApiClient,
  SharpApiNotFoundError,
} from "./_sharpApiClient";
import {
  type NormalizedSoccerOddsRecord,
  normalizeSharpApiMarketType,
  normalizeMatchResultSelection,
  normalizeDoubleChanceSelection,
  normalizeTotalSelection,
  normalizeBttsSelection,
  validateNormalizedRecord,
} from "./_soccerMarketNormalizer";

// ─── SharpAPI WC league constants ─────────────────────────────────────

/** Primary league key — actual match odds. */
export const SHARP_WC_PRIMARY_LEAGUE = "fifa_world_cup_matches" as const;

/** Endpoints used for WC. */
export const SHARP_WC_PATHS = {
  odds: "/odds",
  opportunitiesEv: "/opportunities/ev",
  splits: "/splits",
} as const;

// ─── Raw row shapes ────────────────────────────────────────────────────

export type SharpApiOddsRow = {
  id?: string;
  sportsbook?: string;
  event_id?: string;
  event_uuid?: string;
  sport?: string;
  league?: string;
  home_team?: string;
  away_team?: string;
  market_type?: string;
  selection?: string;
  selection_type?: string;
  odds_american?: number | null;
  odds_decimal?: number | null;
  odds_probability?: number | null;
  line?: number | null;
  event_start_time?: string;
  is_live?: boolean;
  is_active?: boolean;
  is_alternate_line?: boolean;
  is_main_line?: boolean;
  is_stale_pregame_price?: boolean;
  timestamp?: string;
};

export type SharpApiOpportunityRow = {
  id?: string;
  sportsbook?: string;
  event_id?: string;
  event_uuid?: string;
  league?: string;
  market_type?: string;
  selection?: string;
  selection_id?: string;
  market_id?: string;
  line?: number | null;
  odds_american?: number | null;
  odds_decimal?: number | null;
  odds_probability?: number | null;
  fair_probability?: number | null;
  no_vig_odds?: number | null;
  ev_percentage?: number | null;
  kelly_percent?: number | null;
  book_count?: number | null;
  cross_ref_count?: number | null;
  market_width?: number | null;
  is_player_prop?: boolean;
  sharp_book?: string | null;
  is_alternate_line?: boolean;
  is_main_line?: boolean;
  warnings?: string[] | null;
  start_time?: string;
  detected_at?: string;
  home_team?: string;
  away_team?: string;
};

// ─── Splits status types (binding contract) ──────────────────────────

export type SoccerSplitsClassification =
  | "SPLITS_PRESENT"
  | "SPLITS_ENDPOINT_EXISTS_EMPTY"
  | "SPLITS_PROVIDER_ERROR";

export type SoccerSplitsStatus = {
  /**
   * High-level classification. Matches the binding contract from
   * [[project-wc-launch-contract]].
   */
  classification: SoccerSplitsClassification;
  /**
   * Human-readable status. For SPLITS_ENDPOINT_EXISTS_EMPTY this is
   * always "empty_as_of_probe" per contract.
   */
  status: "present" | "empty_as_of_probe" | "error";
  /** ISO timestamp of the most recent probe. */
  last_checked_at: string;
  /** Number of rows returned by this probe (0 when empty). */
  row_count: number;
  /** Endpoint hit for the probe. */
  endpoint: string;
  /** Error message when classification = SPLITS_PROVIDER_ERROR. */
  error: string | null;
};

// ─── Provider ─────────────────────────────────────────────────────────

export class SharpApiSoccerOddsProvider {
  constructor(private readonly client: SharpApiClient) {}

  /**
   * Pull all WC odds rows from /odds for the primary league. The caller
   * passes `event_id` when narrowing to a single match.
   */
  async listRawOdds(opts?: { event_id?: string; limit?: number; maxPages?: number }): Promise<SharpApiOddsRow[]> {
    const query: Record<string, string | number> = { league: SHARP_WC_PRIMARY_LEAGUE };
    if (opts?.event_id) query.event_id = opts.event_id;
    if (opts?.limit) query.limit = opts.limit;
    return this.client.fetchAll<SharpApiOddsRow>({
      path: SHARP_WC_PATHS.odds,
      query,
      maxPages: opts?.maxPages ?? 20,
    });
  }

  /** Pull /opportunities/ev rows. EV/Kelly fields for the sharp-read substrate. */
  async listOpportunities(opts?: { limit?: number; maxPages?: number }): Promise<SharpApiOpportunityRow[]> {
    const query: Record<string, string | number> = { league: SHARP_WC_PRIMARY_LEAGUE };
    if (opts?.limit) query.limit = opts.limit;
    return this.client.fetchAll<SharpApiOpportunityRow>({
      path: SHARP_WC_PATHS.opportunitiesEv,
      query,
      maxPages: opts?.maxPages ?? 10,
    });
  }

  /**
   * Probe SharpAPI `/splits` for WC and return the binding-contract
   * status object. Never throws on 404 / network — returns a status with
   * the appropriate classification so the caller can persist + re-check.
   */
  async probeSplits(): Promise<{ status: SoccerSplitsStatus; rows: unknown[] }> {
    const endpoint = `${SHARP_WC_PATHS.splits}?league=${SHARP_WC_PRIMARY_LEAGUE}`;
    const now = new Date().toISOString();
    try {
      const rows = await this.client.fetchAll<unknown>({
        path: SHARP_WC_PATHS.splits,
        query: { league: SHARP_WC_PRIMARY_LEAGUE },
        maxPages: 5,
      });
      if (rows.length === 0) {
        return {
          status: {
            classification: "SPLITS_ENDPOINT_EXISTS_EMPTY",
            status: "empty_as_of_probe",
            last_checked_at: now,
            row_count: 0,
            endpoint,
            error: null,
          },
          rows: [],
        };
      }
      return {
        status: {
          classification: "SPLITS_PRESENT",
          status: "present",
          last_checked_at: now,
          row_count: rows.length,
          endpoint,
          error: null,
        },
        rows,
      };
    } catch (e) {
      if (e instanceof SharpApiNotFoundError) {
        // 404 means the endpoint shape itself is missing — should not
        // happen in production (probed alive 2026-06-10) but handle it
        // honestly rather than fail the slate.
        return {
          status: {
            classification: "SPLITS_PROVIDER_ERROR",
            status: "error",
            last_checked_at: now,
            row_count: 0,
            endpoint,
            error: "404 on /splits",
          },
          rows: [],
        };
      }
      return {
        status: {
          classification: "SPLITS_PROVIDER_ERROR",
          status: "error",
          last_checked_at: now,
          row_count: 0,
          endpoint,
          error: e instanceof Error ? e.message : String(e),
        },
        rows: [],
      };
    }
  }

  /**
   * Normalize SharpAPI odds rows to canonical records. Drops unsupported
   * markets + player-prop rows. Caller supplies the (home_team, away_team)
   * to map selections to home/draw/away.
   */
  normalizeOdds(rows: SharpApiOddsRow[]): NormalizedSoccerOddsRecord[] {
    const out: NormalizedSoccerOddsRecord[] = [];
    for (const row of rows) {
      const canonical = normalizeSharpApiMarketType(String(row.market_type ?? ""));
      if (canonical === null) continue;
      const homeTeam = String(row.home_team ?? "");
      const awayTeam = String(row.away_team ?? "");
      if (homeTeam.length === 0 || awayTeam.length === 0) continue;

      let selection: NormalizedSoccerOddsRecord["selection"] | null = null;
      let line: number | null = null;

      const rawSelection = String(row.selection ?? row.selection_type ?? "");

      switch (canonical) {
        case "match_result": {
          selection = normalizeMatchResultSelection(rawSelection, {
            home_team: homeTeam,
            away_team: awayTeam,
          });
          break;
        }
        case "double_chance": {
          selection = normalizeDoubleChanceSelection(rawSelection, {
            home_team: homeTeam,
            away_team: awayTeam,
          });
          break;
        }
        case "total": {
          line = typeof row.line === "number" ? row.line : null;
          if (line === null || !Number.isFinite(line)) break;
          selection = normalizeTotalSelection(rawSelection);
          break;
        }
        case "btts": {
          selection = normalizeBttsSelection(rawSelection);
          break;
        }
      }

      if (selection === null) continue;

      const rec = validateNormalizedRecord({
        market: canonical,
        selection,
        line: canonical === "total" ? line : null,
        odds_american: row.odds_american ?? null,
        odds_decimal: row.odds_decimal ?? null,
        sportsbook: row.sportsbook ?? null,
        provider: "sharpapi",
        provider_endpoint: `${SHARP_WC_PATHS.odds}?league=${SHARP_WC_PRIMARY_LEAGUE}`,
        fetched_at: row.timestamp ?? new Date().toISOString(),
        provider_event_id: row.event_id ?? null,
      });
      if (rec) out.push(rec);
    }
    return out;
  }

  /**
   * Extract sharp-read EV/Kelly substrate from /opportunities/ev rows.
   * NOT a tracked-market emission — these are model context. Caller
   * decides whether to snapshot them.
   */
  normalizeOpportunities(rows: SharpApiOpportunityRow[]): SharpReadOpportunityRecord[] {
    const out: SharpReadOpportunityRecord[] = [];
    for (const row of rows) {
      if (row.is_player_prop === true) continue;
      const canonical = normalizeSharpApiMarketType(String(row.market_type ?? ""));
      if (canonical === null) continue;
      out.push({
        market: canonical,
        line: row.line ?? null,
        ev_percentage: row.ev_percentage ?? null,
        kelly_percent: row.kelly_percent ?? null,
        fair_probability: row.fair_probability ?? null,
        no_vig_odds: row.no_vig_odds ?? null,
        odds_american: row.odds_american ?? null,
        odds_decimal: row.odds_decimal ?? null,
        sportsbook: row.sportsbook ?? null,
        sharp_book: row.sharp_book ?? null,
        provider_event_id: row.event_id ?? null,
        warnings: row.warnings ?? null,
        detected_at: row.detected_at ?? null,
      });
    }
    return out;
  }
}

export type SharpReadOpportunityRecord = {
  market: "match_result" | "double_chance" | "total" | "btts";
  line: number | null;
  ev_percentage: number | null;
  kelly_percent: number | null;
  fair_probability: number | null;
  no_vig_odds: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  sportsbook: string | null;
  sharp_book: string | null;
  provider_event_id: string | null;
  warnings: string[] | null;
  detected_at: string | null;
};
