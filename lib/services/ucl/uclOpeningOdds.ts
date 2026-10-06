import type { BdlUclOdds } from "@/lib/providers/real_api/BallDontLieUclProvider";

export type UclOpeningResultSide = "home" | "draw" | "away";
export type CompleteUclOpening = {
  id: number;
  matchId: number;
  vendor: string;
  openedAt: string | null;
  updatedAt: string | null;
  prices: Record<UclOpeningResultSide, number>;
  noVig: Record<UclOpeningResultSide, number>;
};

function validAmerican(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 100;
}

function decimalOdds(value: number): number {
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}

function implied(value: number): number {
  return 1 / decimalOdds(value);
}

function openingTime(row: CompleteUclOpening): number {
  const value = Date.parse(row.openedAt ?? row.updatedAt ?? "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function canonicalUclOpeningOdds(rows: BdlUclOdds[]): Map<number, CompleteUclOpening[]> {
  const byId = new Map<number, BdlUclOdds>();
  for (const row of rows) {
    const prior = byId.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) {
      throw new Error(`conflicting duplicate UCL opening-odds provider ID ${row.id}`);
    }
    if (!prior) byId.set(row.id, row);
  }
  const byMatchVendor = new Map<string, CompleteUclOpening>();
  for (const row of byId.values()) {
    const vendor = row.vendor.trim();
    if (!vendor || !validAmerican(row.moneyline_home_odds) || !validAmerican(row.moneyline_draw_odds) || !validAmerican(row.moneyline_away_odds)) continue;
    const prices = { home: row.moneyline_home_odds, draw: row.moneyline_draw_odds, away: row.moneyline_away_odds };
    const raw = { home: implied(prices.home), draw: implied(prices.draw), away: implied(prices.away) };
    const total = raw.home + raw.draw + raw.away;
    const candidate: CompleteUclOpening = {
      id: row.id,
      matchId: row.match_id,
      vendor,
      openedAt: row.opened_at ?? null,
      updatedAt: row.updated_at,
      prices,
      noVig: { home: raw.home / total, draw: raw.draw / total, away: raw.away / total },
    };
    const key = `${row.match_id}:${vendor.toLowerCase()}`;
    const prior = byMatchVendor.get(key);
    if (!prior || openingTime(candidate) < openingTime(prior) || (openingTime(candidate) === openingTime(prior) && candidate.id < prior.id)) {
      byMatchVendor.set(key, candidate);
    }
  }
  const byMatch = new Map<number, CompleteUclOpening[]>();
  for (const row of byMatchVendor.values()) byMatch.set(row.matchId, [...(byMatch.get(row.matchId) ?? []), row]);
  return byMatch;
}
