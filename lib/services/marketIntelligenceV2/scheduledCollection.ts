import type { SupabaseClient } from "@supabase/supabase-js";
import { currentSlateDate } from "../../dates/slateDate";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import type { Sport } from "../../types/domain/Sport";
import type { NbaPrelockCaptureScope } from "../nba/nbaPrelockMarketCapture";
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
  phase: "slate_cycle" | "pregame_sweep" | "wnba_daily_refresh" | "public_splits_refresh" | "manual";
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
  includeSharpApiHistory?: boolean;
  slateDateThrough?: string;
  nbaPrelockScope?: NbaPrelockCaptureScope;
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
      includeSharpApiHistory: opts.includeSharpApiHistory,
      slateDateThrough: opts.slateDateThrough,
      nbaPrelockScope: opts.nbaPrelockScope,
    });
    result.shadow = shadow;
    result.recordsUpdated += shadow.splitObservationsWritten + shadow.priceObservationsWritten;
    result.apiCallsMade += shadow.playbookSplitRowsFetched > 0 ? 1 : 0;
    result.apiCallsMade += shadow.owlsSplitRowsFetched > 0 ? 1 : 0;
    result.apiCallsMade += shadow.owlsPriceRowsFetched > 0 ? 1 : 0;
    result.apiCallsMade += shadow.sharpapiSplitRowsFetched > 0 ? 1 : 0;
    result.errors.push(...shadow.errors);
  } catch (e) {
    result.errors.push(`shadow: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The lock owner needs only fresh scoped observations. A full-slate v2
  // snapshot rebuild would duplicate unrelated work inside a minute sweep.
  if (opts.nbaPrelockScope) return result;

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
