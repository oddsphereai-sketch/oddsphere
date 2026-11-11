import "server-only";
import type { NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE =
  "nba_player_props_member_transport_2026_11_11_r1_public_allowlist" as const;

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
  const diagnostics = snapshot.diagnostics;
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
    decisions: snapshot.decisions,
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
