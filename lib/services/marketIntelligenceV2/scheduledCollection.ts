import type { SupabaseClient } from "@supabase/supabase-js";
import { currentSlateDate } from "../../dates/slateDate";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import type { Sport } from "../../types/domain/Sport";
import {
  syncMarketIntelligenceV2Shadow,
  type MarketIntelligenceV2ShadowSyncResult,
} from "./shadowSync";
import {
  syncMarketIntelligenceV2Snapshots,
  type MarketIntelligenceV2SnapshotSyncResult,
} from "./snapshotSync";

export type ScheduledMarketIntelligenceV2Result = {
  enabled: boolean;
  sport: Sport;
  slateDate: string;
  phase: "slate_cycle" | "pregame_sweep" | "wnba_daily_refresh" | "manual";
  shadow: MarketIntelligenceV2ShadowSyncResult | null;
  snapshots: MarketIntelligenceV2SnapshotSyncResult | null;
  recordsUpdated: number;
  apiCallsMade: number;
  errors: string[];
};

export async function runScheduledMarketIntelligenceV2Collection(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate?: string;
  phase: ScheduledMarketIntelligenceV2Result["phase"];
  now?: Date;
}): Promise<ScheduledMarketIntelligenceV2Result> {
  const config = readMarketIntelligenceV2Config();
  const slateDate = opts.slateDate ?? currentSlateDate(opts.sport);
  const result: ScheduledMarketIntelligenceV2Result = {
    enabled: config.enabled,
    sport: opts.sport,
    slateDate,
    phase: opts.phase,
    shadow: null,
    snapshots: null,
    recordsUpdated: 0,
    apiCallsMade: 0,
    errors: [],
  };
  if (!config.enabled) return result;

  const now = opts.now ?? new Date();
  try {
    const shadow = await syncMarketIntelligenceV2Shadow({
      supabase: opts.supabase,
      sport: opts.sport,
      slateDate,
      apply: true,
      todayUtc: currentSlateDate(opts.sport),
      now,
    });
    result.shadow = shadow;
    result.recordsUpdated += shadow.splitObservationsWritten + shadow.priceObservationsWritten;
    result.apiCallsMade += shadow.playbookSplitRowsFetched > 0 ? 1 : 0;
    result.apiCallsMade += shadow.sharpapiSplitRowsFetched > 0 ? 1 : 0;
    result.errors.push(...shadow.errors);
  } catch (e) {
    result.errors.push(`shadow: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const snapshots = await syncMarketIntelligenceV2Snapshots({
      supabase: opts.supabase,
      sport: opts.sport,
      slateDate,
      apply: true,
    });
    result.snapshots = snapshots;
    result.recordsUpdated += snapshots.snapshotsWritten;
    result.errors.push(...snapshots.errors);
  } catch (e) {
    result.errors.push(`snapshots: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
