import "server-only";

import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { loadMlbPropsMemberBoardSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";
import { supabase } from "@/lib/db/supabase";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";
import { readNflPlayerPropsMemberSnapshot } from "@/lib/services/football/nflPlayerPropsSnapshotStore";
import { nbaPlayerPropsSlateDate } from "@/lib/services/nba/nbaPlayerPropsLifecycle";
import { readNbaPlayerPropsPrivateSnapshot } from "@/lib/services/nba/nbaPlayerPropsPrivateStore";
import type {
  PlayerPropsLeagueActivity,
  PlayerPropsLeagueActivityMap,
} from "@/app/player-props/lib/playerPropsLeagues";

function bounded(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function activity(gameCount: number, propCount: number, checkedAt: string): PlayerPropsLeagueActivity {
  return { gameCount, propCount, checkedAt };
}

async function readMlbActivity(checkedAt: string): Promise<PlayerPropsLeagueActivity> {
  if (getPublicPicksMode().mode !== "display_enabled") return activity(0, 0, checkedAt);
  const slateDate = easternSlateDate();
  const member = await loadMlbPropsMemberBoardSnapshot(slateDate).catch(() => null);
  if (member) {
    return activity(member.data.summary.gamesWithProps, member.data.props.length, checkedAt);
  }
  const display = await loadCachedLatestMlbPropsDisplaySnapshot(slateDate).catch(() => null);
  return display && mlbPropsSnapshotIsFresh(display)
    ? activity(display.data.summary.gamesWithProps, display.data.props.length, checkedAt)
    : activity(0, 0, checkedAt);
}

async function readNflActivity(checkedAt: string): Promise<PlayerPropsLeagueActivity> {
  if (process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED !== "true") return activity(0, 0, checkedAt);
  const season = bounded(process.env.NFL_FORWARD_SEASON, 2026);
  const configuredWeek = bounded(process.env.NFL_FORWARD_WEEK, 1);
  const week = resolveNflForwardWeek({ season, configuredWeek });
  const current = await readNflPlayerPropsMemberSnapshot({ client: supabase, season, week }).catch(() => null);
  const snapshot = (current?.memberDecisions.length ?? 0) > 0 || week >= 18
    ? current
    : await readNflPlayerPropsMemberSnapshot({ client: supabase, season, week: week + 1 }).catch(() => current);
  return activity(
    new Set(snapshot?.memberDecisions.map((row) => row.gameId) ?? []).size,
    snapshot?.memberDecisions.length ?? 0,
    checkedAt,
  );
}

async function readNbaActivity(checkedAt: string): Promise<PlayerPropsLeagueActivity> {
  if (process.env.NBA_PLAYER_PROPS_MEMBER_ENABLED !== "true") return activity(0, 0, checkedAt);
  const snapshot = await readNbaPlayerPropsPrivateSnapshot({
    client: supabase,
    slateDate: nbaPlayerPropsSlateDate(),
  }).catch(() => null);
  return activity(snapshot?.games.length ?? 0, snapshot?.decisions.length ?? 0, checkedAt);
}

/** Reads stored member snapshots only. This never invokes an odds/stats provider. */
export async function readPlayerPropsLeagueActivity(): Promise<PlayerPropsLeagueActivityMap> {
  const checkedAt = new Date().toISOString();
  const [mlb, nfl, nba] = await Promise.all([
    readMlbActivity(checkedAt),
    readNflActivity(checkedAt),
    readNbaActivity(checkedAt),
  ]);
  return { mlb, nfl, nba };
}
