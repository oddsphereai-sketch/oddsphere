import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";

export const CBB_MEMBER_BOARD_SCOPE_RELEASE="cbb_member_scope_2026_11_02_r1_owner_approved_incomplete_lock" as const;

/** Owner approved removing this incomplete card on Nov 2. The original stored
 * lock remains unchanged; this exception cannot hide another game or a valid
 * evaluation merely because its school, grade or model release differs. */
export function isOwnerApprovedCbbMemberExclusion(game:DailyEdgeGameDto):boolean {
  return game.sport==="cbb"&&game.external_id===10882480&&game.lockedAt==="2026-11-02T10:02:10.038Z"&&
    Object.values(game.markets).length===3&&Object.values(game.markets).every(market=>
      market.held===true&&market.priceAmerican===null&&market.modelProb===null);
}
