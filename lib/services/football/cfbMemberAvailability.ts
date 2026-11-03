import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import type { DailyEdgeGameAvailability } from "../dailyEdge/gameAvailability";
import { sanitizeCfbEspnInjuryNewsReport } from "./cfbEspnInjuryNewsAvailability";

export const CFB_MEMBER_AVAILABILITY_RELEASE = "cfb_member_availability_2026_11_03_r1_retained_news_identity" as const;

/** Requalify legacy partial-news rows only for explicitly unlocked members.
 * Existing locked reports and any uncertain/locking state retain exact payload
 * precedence. Raw evidence is never mutated or replaced in storage. */
export function cfbMemberAvailabilityReport(report: DailyEdgeGameAvailability | null,
  game: Pick<DailyEdgeGameDto, "lockState" | "lockedAt"> | undefined): DailyEdgeGameAvailability | null {
  if (game?.lockState !== "open" || game.lockedAt !== null) return report;
  return sanitizeCfbEspnInjuryNewsReport(report);
}
