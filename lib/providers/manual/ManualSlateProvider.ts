/**
 * ManualSlateProvider — reads slate from `manual_slate_staging` (Fix 7.2).
 *
 * Two call patterns:
 *
 * 1. **Cron path** (SLATE_PROVIDER=manual, no constructor arg):
 *    On `getGames(date, sport)`, reads the *latest non-failed* staging row
 *    matching `(sport, slate_date=date)`. Lets the morning-slate cron
 *    auto-pick up the most recent admin upload for that slate.
 *
 * 2. **Admin upload route** (constructor with `stagingRowId`):
 *    The route inserts a staging row, then constructs
 *    `new ManualSlateProvider({ stagingRowId })` so the inline
 *    `slateService.refreshGames(sport, date, this)` reads exactly THAT
 *    row's payload. Race-safe under concurrent uploads: each request
 *    operates on its own staging row id.
 *
 * Game identity (Flag D1 — deterministic external_id):
 *   external_id = 1_000_000_000 + (sha256(natural_key) & 0x3FFFFFFF)
 *   where natural_key = "<sport>:<date>:<home_abbrev>:<away_abbrev>"
 *
 *   • Range [1B, ~2.07B] sits well above BALLDONTLIE's small positive ids,
 *     so manual rows are visually distinguishable.
 *   • Re-upload idempotency: same tuple → same external_id → UPSERT in
 *     slateService merges instead of duplicating.
 *
 * provider_ids attachment (Flag F1 — natural-key string):
 *   provider_ids.manual = "<sport>:<date>:<home_abbrev>:<away_abbrev>"
 *
 *   Human-readable in Supabase queries; matches the tuple a future
 *   SharpAPI / OddsAPI ingestion will use for cross-provider
 *   reconciliation.
 */

import { createHash } from "node:crypto";
import { supabase } from "../../db/supabase";
import type { Sport } from "../../types/domain/Sport";
import type {
  ISlateProvider,
  SlateGameRecord,
  SlateTeamRecord,
} from "../interfaces/ISlateProvider";

/**
 * Compute the deterministic external_id for a manually-uploaded game.
 * Exported for tests + the upload route's payload-preview path.
 */
export function manualGameExternalId(
  sport: string,
  slateDate: string,
  homeAbbrev: string,
  awayAbbrev: string
): number {
  const naturalKey = `${sport}:${slateDate}:${homeAbbrev}:${awayAbbrev}`;
  const hash = createHash("sha256").update(naturalKey).digest();
  const u32 = hash.readUInt32BE(0);
  return 1_000_000_000 + (u32 & 0x3fffffff);
}

/**
 * Build the natural-key string used as the `provider_ids.manual` value.
 * Exported for tests + reconciliation-by-tuple code paths.
 */
export function manualProviderIdKey(
  sport: string,
  slateDate: string,
  homeAbbrev: string,
  awayAbbrev: string
): string {
  return `${sport}:${slateDate}:${homeAbbrev}:${awayAbbrev}`;
}

/**
 * Shape of one game inside `manual_slate_staging.payload.games`.
 * Validated by the upload route before insert; re-validated by the
 * provider when constructing SlateGameRecord output.
 */
export type ManualSlateGameInput = {
  home_team_abbrev: string;
  away_team_abbrev: string;
  game_date: string; // ISO timestamp
  season: number;
  season_type?: string;
  venue?: string;
  notes?: string;
};

type ManualSlateStagingRow = {
  id: number;
  sport: string;
  slate_date: string;
  payload: { games: ManualSlateGameInput[] };
  status: "pending" | "ingested" | "failed";
};

export type ManualSlateProviderOpts = {
  /**
   * When set, getGames reads this specific staging row regardless of
   * status. Used by the admin upload route immediately after INSERT so
   * the inline refresh always operates on its own row (concurrent-request
   * safe). When omitted (cron path), getGames falls back to "latest
   * non-failed row for (sport, slate_date)".
   */
  stagingRowId?: number;
};

export class ManualSlateProvider implements ISlateProvider {
  private readonly opts: ManualSlateProviderOpts;

  constructor(opts: ManualSlateProviderOpts = {}) {
    this.opts = opts;
  }

  /**
   * Teams come from the pre-seeded `teams` table — manual slate uploads
   * never create teams (Flag B1). This implementation reads directly
   * from the table so behavior is consistent with MockSlateProvider's
   * fixture-backed getTeams.
   */
  async getTeams(sport: Sport): Promise<SlateTeamRecord[]> {
    const { data, error } = await supabase
      .from("teams")
      .select(
        "external_id, sport, slug, abbreviation, display_name, short_display_name, name, location, league, division, logo_url, primary_color, provider_ids"
      )
      .eq("sport", sport);
    if (error) {
      throw new Error(
        `ManualSlateProvider.getTeams(${sport}) failed: ${error.message}`
      );
    }
    return (data ?? []) as unknown as SlateTeamRecord[];
  }

  async getGames(date: string, sport?: Sport): Promise<SlateGameRecord[]> {
    const row = await this.loadStagingRow(date, sport);
    if (row === null) return [];

    // Pre-load the teams map so we can resolve abbreviation → external_id
    // for the chosen sport. Manual uploads reference teams by abbreviation
    // per Flag B1; the route validates these before insert, but we
    // re-validate at ingest time as a defense-in-depth check.
    const teamsBySport = new Map<string, Map<string, number>>(); // sport → (abbrev → external_id)
    async function teamMapFor(sportKey: string) {
      let m = teamsBySport.get(sportKey);
      if (m !== undefined) return m;
      const { data } = await supabase
        .from("teams")
        .select("abbreviation, external_id")
        .eq("sport", sportKey);
      m = new Map();
      for (const t of (data ?? []) as Array<{
        abbreviation: string;
        external_id: number;
      }>) {
        m.set(t.abbreviation, t.external_id);
      }
      teamsBySport.set(sportKey, m);
      return m;
    }

    const rowSport = row.sport;
    const abbrevMap = await teamMapFor(rowSport);

    const out: SlateGameRecord[] = [];
    for (const g of row.payload.games ?? []) {
      const homeExt = abbrevMap.get(g.home_team_abbrev);
      const awayExt = abbrevMap.get(g.away_team_abbrev);
      if (homeExt === undefined || awayExt === undefined) {
        // Skip the row — slateService.refreshGames will record the skip
        // via its existing missing-FK behavior. Should never happen
        // because the route validates abbrevs before insert.
        continue;
      }
      const extId = manualGameExternalId(
        rowSport,
        row.slate_date,
        g.home_team_abbrev,
        g.away_team_abbrev
      );
      const providerKey = manualProviderIdKey(
        rowSport,
        row.slate_date,
        g.home_team_abbrev,
        g.away_team_abbrev
      );
      out.push({
        external_id: extId,
        sport: rowSport as Sport,
        home_team_external_id: homeExt,
        away_team_external_id: awayExt,
        home_pitcher_external_id: null,
        away_pitcher_external_id: null,
        game_date: g.game_date,
        season: g.season,
        season_type: g.season_type ?? null,
        postseason: false,
        status: "STATUS_SCHEDULED",
        period: null,
        clock: null,
        home_score: null,
        away_score: null,
        home_hits: null,
        away_hits: null,
        home_errors: null,
        away_errors: null,
        total_runs: null,
        inning_scores: null,
        first_inning_runs: null,
        venue: g.venue ?? null,
        attendance: null,
        slate_status: "draft",
        provider_ids: { manual: providerKey },
      });
    }

    if (sport !== undefined) {
      return out.filter((g) => g.sport === sport);
    }
    return out;
  }

  private async loadStagingRow(
    date: string,
    sport?: Sport
  ): Promise<ManualSlateStagingRow | null> {
    if (this.opts.stagingRowId !== undefined) {
      const { data, error } = await supabase
        .from("manual_slate_staging")
        .select("id, sport, slate_date, payload, status")
        .eq("id", this.opts.stagingRowId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `ManualSlateProvider: failed to load staging row ${this.opts.stagingRowId}: ${error.message}`
        );
      }
      return (data as ManualSlateStagingRow | null) ?? null;
    }

    // Cron path: latest non-failed row for (sport, slate_date).
    let q = supabase
      .from("manual_slate_staging")
      .select("id, sport, slate_date, payload, status")
      .eq("slate_date", date)
      .neq("status", "failed")
      .order("id", { ascending: false })
      .limit(1);
    if (sport !== undefined) {
      q = q.eq("sport", sport);
    }
    const { data, error } = await q.maybeSingle();
    if (error) {
      throw new Error(
        `ManualSlateProvider: latest staging row lookup failed for (${sport ?? "*"}, ${date}): ${error.message}`
      );
    }
    return (data as ManualSlateStagingRow | null) ?? null;
  }
}
