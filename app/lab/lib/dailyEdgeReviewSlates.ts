import type { Sport } from "@/lib/types/domain/Sport";

const currentEasternSlateDate = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/New_York",
});

export const DAILY_EDGE_REVIEW_SLATES: Partial<
  Record<Sport, { date: string; note: string; freshContractRead?: boolean }>
> = {
  mlb: { date: currentEasternSlateDate, note: "Current MLB slate", freshContractRead: true },
  wnba: { date: currentEasternSlateDate, note: "Current WNBA slate", freshContractRead: true },
  soccer: { date: "2026-06-13", note: "World Cup representative slate" },
  nba: { date: "2026-06-10", note: "Stored NBA representative slate" },
  nhl: { date: "2026-06-09", note: "Stored NHL representative slate" },
};
