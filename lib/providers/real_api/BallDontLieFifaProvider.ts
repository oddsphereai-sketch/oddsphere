/**
 * BallDontLie FIFA World Cup provider — WC-2.
 *
 * Read-only provider that fetches and normalizes BDL FIFA WC GOAT-tier
 * data into the canonical shapes the WC-3 model writer (and WC-4 odds
 * snapshot) will consume.
 *
 * Three endpoints (per the binding WC-2 ingestion contract):
 *   • /fifa/worldcup/v1/teams    — 48 team catalogue
 *   • /fifa/worldcup/v1/matches  — slate + match metadata
 *   • /fifa/worldcup/v1/odds     — per-vendor odds with nested markets[]
 *
 * Discipline:
 *   • No DB imports — pure HTTP + transform layer
 *   • Single client injected (constructor) — testable in isolation
 *   • Unsupported markets are silently DROPPED, never coerced; the
 *     normalizer is the single source of truth for "official market"
 *   • Raw provenance preserved on every emitted record
 *     (provider_endpoint, fetched_at, provider_event_id)
 */

import {
  BdlFifaClient,
  BDL_FIFA_PATHS,
  type BdlFifaResponse,
} from "./_bdlFifaClient";
import {
  type NormalizedSoccerOddsRecord,
  type BdlMarketShape,
  normalizeBdlMarket,
  normalizeMatchResultSelection,
  normalizeDoubleChanceSelection,
  normalizeTotalSelection,
  normalizeBttsSelection,
  validateNormalizedRecord,
} from "./_soccerMarketNormalizer";

// ─── Raw row shapes (subset of BDL response fields we consume) ────────

export type BdlFifaTeam = {
  id: number;
  name: string;
  abbreviation: string;
  country_code: string;
  confederation: string;
};

export type BdlFifaMatch = {
  id: number;
  match_number?: number;
  datetime: string;
  status: string;
  season?: { id: number; year: number } | null;
  stage?: { id: number; name: string; order: number } | null;
  group?: { id: number; name: string } | null;
  stadium?: {
    id: number;
    name: string;
    city: string;
    country: string;
    capacity?: number;
    latitude?: number;
    longitude?: number;
  } | null;
  home_team: BdlFifaTeam;
  away_team: BdlFifaTeam;
  home_score: number | null;
  away_score: number | null;
  home_score_penalties: number | null;
  away_score_penalties: number | null;
  first_half_home_score: number | null;
  first_half_away_score: number | null;
  second_half_home_score: number | null;
  second_half_away_score: number | null;
  extra_time_home_score: number | null;
  extra_time_away_score: number | null;
  has_extra_time: boolean;
  has_penalty_shootout: boolean;
  round_number?: number | null;
  round_name?: string | null;
  home_formation?: string | null;
  away_formation?: string | null;
  referee?: string | null;
  home_manager?: string | null;
  away_manager?: string | null;
};

export type BdlFifaOddsOutcome = {
  id?: number;
  key?: string;
  name?: string;
  type?: string; // "over" | "under" | "yes" | "no" | "other" | ...
  side?: string | null;
  line_value?: string | null;
  handicap?: string | null;
  american_odds: number | null;
  decimal_odds: number | null;
  updated_at?: string | null;
};

export type BdlFifaOddsMarket = {
  id?: number;
  key?: string;
  name?: string;
  type: string;
  period?: string | null;
  scope?: string | null;
  team_side?: string | null;
  line_value?: string | number | null;
  updated_at?: string | null;
  outcomes?: BdlFifaOddsOutcome[];
};

export type BdlFifaOddsRow = {
  id: number;
  match_id: number;
  vendor: string;
  // Flat 3-way moneyline fields (top-level, observed in BDL response).
  moneyline_home_odds?: number | null;
  moneyline_away_odds?: number | null;
  moneyline_draw_odds?: number | null;
  spread_home_value?: number | null;
  spread_home_odds?: number | null;
  spread_away_value?: number | null;
  spread_away_odds?: number | null;
  total_value?: number | null;
  total_over_odds?: number | null;
  total_under_odds?: number | null;
  updated_at?: string | null;
  markets?: BdlFifaOddsMarket[];
};

// ─── Normalized exports ───────────────────────────────────────────────

export type NormalizedBdlMatch = {
  provider_match_id: number;
  match_number: number | null;
  datetime: string;
  status: string;
  stage_name: string | null;
  group_name: string | null;
  stadium_name: string | null;
  stadium_city: string | null;
  stadium_country: string | null;
  home_team_id: number;
  home_team_name: string;
  home_team_abbr: string;
  home_team_country_code: string;
  away_team_id: number;
  away_team_name: string;
  away_team_abbr: string;
  away_team_country_code: string;
  ft_home_score: number | null;
  ft_away_score: number | null;
  has_extra_time: boolean;
  has_penalty_shootout: boolean;
  raw_row: BdlFifaMatch;
};

export type NormalizedBdlTeam = {
  provider_team_id: number;
  name: string;
  abbreviation: string;
  country_code: string;
  confederation: string;
};

// ─── Provider ─────────────────────────────────────────────────────────

export class BallDontLieFifaProvider {
  constructor(private readonly client: BdlFifaClient) {}

  /** Pull all WC teams. Cursor-paginates to handle the 48-team payload. */
  async listTeams(): Promise<NormalizedBdlTeam[]> {
    const rows = await this.client.fetchAll<BdlFifaTeam>({
      path: BDL_FIFA_PATHS.teams,
      maxPages: 5,
    });
    return rows.map((t) => ({
      provider_team_id: t.id,
      name: t.name,
      abbreviation: t.abbreviation,
      country_code: t.country_code,
      confederation: t.confederation,
    }));
  }

  /**
   * Pull WC matches. Optional date range filters via query — BDL accepts
   * `start_date` / `end_date` on the matches endpoint per the standard
   * BDL convention.
   */
  async listMatches(opts?: { start_date?: string; end_date?: string; per_page?: number }): Promise<NormalizedBdlMatch[]> {
    const query: Record<string, string | number> = {};
    if (opts?.start_date) query.start_date = opts.start_date;
    if (opts?.end_date) query.end_date = opts.end_date;
    if (opts?.per_page) query.per_page = opts.per_page;
    const rows = await this.client.fetchAll<BdlFifaMatch>({
      path: BDL_FIFA_PATHS.matches,
      query,
      maxPages: 10,
    });
    return rows.map((m) => this.normalizeMatch(m));
  }

  /** Pull a single page of WC matches (raw). Useful for tests + smoke. */
  async fetchMatchesPage(query: Record<string, string | number> = {}): Promise<BdlFifaResponse<BdlFifaMatch[]>> {
    return this.client.fetch<BdlFifaMatch[]>({
      path: BDL_FIFA_PATHS.matches,
      query,
    });
  }

  /** Pull WC odds rows. Returns the BDL raw shape — callers normalize via `normalizeOdds`. */
  async listRawOdds(opts?: { match_id?: number; per_page?: number }): Promise<BdlFifaOddsRow[]> {
    const query: Record<string, string | number> = {};
    if (opts?.match_id !== undefined) query.match_id = opts.match_id;
    if (opts?.per_page) query.per_page = opts.per_page;
    return this.client.fetchAll<BdlFifaOddsRow>({
      path: BDL_FIFA_PATHS.odds,
      query,
      maxPages: 30,
    });
  }

  /** Normalize a raw BDL match into the canonical shape. Pure. */
  normalizeMatch(m: BdlFifaMatch): NormalizedBdlMatch {
    return {
      provider_match_id: m.id,
      match_number: m.match_number ?? null,
      datetime: m.datetime,
      status: m.status,
      stage_name: m.stage?.name ?? null,
      group_name: m.group?.name ?? null,
      stadium_name: m.stadium?.name ?? null,
      stadium_city: m.stadium?.city ?? null,
      stadium_country: m.stadium?.country ?? null,
      home_team_id: m.home_team.id,
      home_team_name: m.home_team.name,
      home_team_abbr: m.home_team.abbreviation,
      home_team_country_code: m.home_team.country_code,
      away_team_id: m.away_team.id,
      away_team_name: m.away_team.name,
      away_team_abbr: m.away_team.abbreviation,
      away_team_country_code: m.away_team.country_code,
      ft_home_score: m.home_score,
      ft_away_score: m.away_score,
      has_extra_time: m.has_extra_time,
      has_penalty_shootout: m.has_penalty_shootout,
      raw_row: m,
    };
  }

  /**
   * Normalize one BDL odds row into zero-or-more canonical
   * NormalizedSoccerOddsRecord rows. Drops unsupported markets silently.
   *
   * Pure. Takes the home/away team names from a NormalizedBdlMatch (or
   * any TeamNameCtx-compatible object) so selection strings can be
   * mapped to home/away/draw correctly.
   */
  normalizeOdds(
    row: BdlFifaOddsRow,
    ctx: { home_team: string; away_team: string },
  ): NormalizedSoccerOddsRecord[] {
    const fetched_at = row.updated_at ?? new Date().toISOString();
    const out: NormalizedSoccerOddsRecord[] = [];
    const eventId = `bdl_match_${row.match_id}`;

    // (1) Flat 3-way moneyline → match_result (one row per outcome).
    //     BDL exposes home/away/draw odds at the top level for soccer.
    if (row.moneyline_home_odds !== null && row.moneyline_home_odds !== undefined) {
      const rec = validateNormalizedRecord({
        market: "match_result",
        selection: "home",
        line: null,
        odds_american: row.moneyline_home_odds,
        odds_decimal: null,
        sportsbook: row.vendor,
        provider: "bdl",
        provider_endpoint: BDL_FIFA_PATHS.odds,
        fetched_at,
        provider_event_id: eventId,
      });
      if (rec) out.push(rec);
    }
    if (row.moneyline_away_odds !== null && row.moneyline_away_odds !== undefined) {
      const rec = validateNormalizedRecord({
        market: "match_result",
        selection: "away",
        line: null,
        odds_american: row.moneyline_away_odds,
        odds_decimal: null,
        sportsbook: row.vendor,
        provider: "bdl",
        provider_endpoint: BDL_FIFA_PATHS.odds,
        fetched_at,
        provider_event_id: eventId,
      });
      if (rec) out.push(rec);
    }
    if (row.moneyline_draw_odds !== null && row.moneyline_draw_odds !== undefined) {
      const rec = validateNormalizedRecord({
        market: "match_result",
        selection: "draw",
        line: null,
        odds_american: row.moneyline_draw_odds,
        odds_decimal: null,
        sportsbook: row.vendor,
        provider: "bdl",
        provider_endpoint: BDL_FIFA_PATHS.odds,
        fetched_at,
        provider_event_id: eventId,
      });
      if (rec) out.push(rec);
    }

    // (2) Flat top-level total (BDL exposes total_value + over/under odds).
    if (
      row.total_value !== null &&
      row.total_value !== undefined &&
      row.total_over_odds !== null &&
      row.total_over_odds !== undefined
    ) {
      const rec = validateNormalizedRecord({
        market: "total",
        selection: "over",
        line: Number(row.total_value),
        odds_american: row.total_over_odds,
        odds_decimal: null,
        sportsbook: row.vendor,
        provider: "bdl",
        provider_endpoint: BDL_FIFA_PATHS.odds,
        fetched_at,
        provider_event_id: eventId,
      });
      if (rec) out.push(rec);
    }
    if (
      row.total_value !== null &&
      row.total_value !== undefined &&
      row.total_under_odds !== null &&
      row.total_under_odds !== undefined
    ) {
      const rec = validateNormalizedRecord({
        market: "total",
        selection: "under",
        line: Number(row.total_value),
        odds_american: row.total_under_odds,
        odds_decimal: null,
        sportsbook: row.vendor,
        provider: "bdl",
        provider_endpoint: BDL_FIFA_PATHS.odds,
        fetched_at,
        provider_event_id: eventId,
      });
      if (rec) out.push(rec);
    }

    // (3) Nested markets[] — iterate, normalize, drop unsupported.
    for (const market of row.markets ?? []) {
      const canonicalMarket = normalizeBdlMarket(market satisfies BdlMarketShape);
      if (canonicalMarket === null) continue; // dropped by whitelist

      for (const outcome of market.outcomes ?? []) {
        const american = outcome.american_odds ?? null;
        const decimal = outcome.decimal_odds ?? null;
        if (american === null && decimal === null) continue;

        // Selection extraction depends on the market.
        let selection: NormalizedSoccerOddsRecord["selection"] | null = null;
        let line: number | null = null;

        switch (canonicalMarket) {
          case "match_result": {
            // BDL also exposes match_result via nested moneyline market;
            // outcome.name is the team name or "Draw".
            selection = normalizeMatchResultSelection(
              String(outcome.name ?? outcome.key ?? outcome.type ?? ""),
              ctx,
            );
            break;
          }
          case "double_chance": {
            selection = normalizeDoubleChanceSelection(
              String(outcome.name ?? outcome.key ?? ""),
              ctx,
            );
            break;
          }
          case "total": {
            // Pull line from market.line_value (string in BDL), fallback to outcome.line_value.
            const rawLine = market.line_value ?? outcome.line_value ?? null;
            const parsedLine = rawLine === null ? NaN : Number(rawLine);
            if (!Number.isFinite(parsedLine)) break;
            line = parsedLine;
            const t = String(outcome.type ?? "").toLowerCase();
            if (t === "over") selection = "over";
            else if (t === "under") selection = "under";
            else selection = normalizeTotalSelection(String(outcome.name ?? ""));
            break;
          }
          case "btts": {
            const t = String(outcome.type ?? "").toLowerCase();
            if (t === "yes") selection = "yes";
            else if (t === "no") selection = "no";
            else selection = normalizeBttsSelection(String(outcome.name ?? ""));
            break;
          }
        }

        if (selection === null) continue;

        const rec = validateNormalizedRecord({
          market: canonicalMarket,
          selection,
          line: canonicalMarket === "total" ? line : null,
          odds_american: american,
          odds_decimal: decimal,
          sportsbook: row.vendor,
          provider: "bdl",
          provider_endpoint: BDL_FIFA_PATHS.odds,
          fetched_at: outcome.updated_at ?? fetched_at,
          provider_event_id: eventId,
        });
        if (rec) out.push(rec);
      }
    }

    return out;
  }
}
