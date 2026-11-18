import {nbaVisiblePublicationRows} from './nbaPlayerPropsPublicationContinuity';
import "server-only";
import type { NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE =
  "nba_player_props_member_transport_2026_11_18_r2_pending_display_expiry" as const;

type MemberDiagnostics = Pick<NbaPlayerPropsMemberSnapshot["diagnostics"],
  "inputRows" | "canonicalMarkets" | "actionable" | "bestAngles" | "leans"
  | "watchlists" | "noPlays" | "sportsbooks">;
export type NbaPlayerPropsMemberClientSnapshot = Omit<NbaPlayerPropsMemberSnapshot, "diagnostics"> & {
  memberTransportRelease: typeof NBA_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE;
  diagnostics: MemberDiagnostics;
};

/** Explicit server boundary: private operational metadata never enters RSC.
 * Decisions and games retain their exact stored values and legacy precedence.
 * Do not run a newer builder, grade policy or lock reconstruction here. */
export function buildNbaPlayerPropsMemberClientSnapshot(
  snapshot: NbaPlayerPropsMemberSnapshot,
): NbaPlayerPropsMemberClientSnapshot {
  const rows=nbaVisiblePublicationRows(snapshot,new Date().toISOString());
  const diagnostics=rows===snapshot.decisions?snapshot.diagnostics:{...snapshot.diagnostics,canonicalMarkets:rows.length,bestAngles:rows.filter(r=>r.grade==='Best Angle').length,leans:rows.filter(r=>r.grade==='Lean').length,actionable:rows.filter(r=>r.grade==='Best Angle'||r.grade==='Lean').length,watchlists:rows.filter(r=>r.grade==='Watchlist').length,noPlays:rows.filter(r=>r.grade==='No Play').length,sportsbooks:[...new Set(rows.map(r=>r.sportsbook))].sort()};
  return {
    memberTransportRelease: NBA_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE,
    productRelease: snapshot.productRelease,
    snapshotRelease: snapshot.snapshotRelease,
    lockRelease: snapshot.lockRelease,
    mode: snapshot.mode,
    publicEnabled: snapshot.publicEnabled,
    generatedAt: snapshot.generatedAt,
    slateDate: snapshot.slateDate,
    games: snapshot.games,
    decisions: rows,
    diagnostics: {
      inputRows: diagnostics.inputRows,
      canonicalMarkets: diagnostics.canonicalMarkets,
      actionable: diagnostics.actionable,
      bestAngles: diagnostics.bestAngles,
      leans: diagnostics.leans,
      watchlists: diagnostics.watchlists,
      noPlays: diagnostics.noPlays,
      sportsbooks: diagnostics.sportsbooks,
    },
  };
}
