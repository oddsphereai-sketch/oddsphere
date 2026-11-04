import type { NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsMemberDecision } from "./nbaPlayerPropsProductContract";

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Display only. Reuse the runtime's retail-primary/Owls-reference distinction;
 * historical/opening quotes cannot advertise an offer as currently available.
 * The exact evaluated target always owns its own book/side slot. */
export function buildNbaPlayerPropsMemberPrices(input: {
  current: readonly NbaPlayerPropPriceObservation[];
  target: NbaPlayerPropPriceObservation;
}): NbaPlayerPropsMemberDecision["priceLadder"] {
  const target = input.target;
  if (!target.canonicalGameId || !target.canonicalPlayerId) return [];
  const rows = input.current.filter(row => !row.isOpening && !row.isLive
    && (row.side === "over" || row.side === "under")
    && row.canonicalGameId === target.canonicalGameId
    && row.canonicalPlayerId === target.canonicalPlayerId
    && row.market === target.market && row.line === target.line);
  const selected = new Map<string, NbaPlayerPropPriceObservation>();
  for (const row of rows) {
    const key = `${normalized(row.sportsbook)}|${row.side}`;
    const previous = selected.get(key);
    const priority = Number(row.provider !== "owls");
    const previousPriority = Number(previous?.provider !== "owls");
    if (!previous || priority > previousPriority || (priority === previousPriority
      && Date.parse(row.observedAt) > Date.parse(previous.observedAt))) selected.set(key, row);
  }
  const exact = rows.find(row => row.provider === target.provider
    && normalized(row.sportsbook) === normalized(target.sportsbook)
    && row.side === target.side && row.americanPrice === target.americanPrice
    && row.observedAt === target.observedAt);
  if (exact) selected.set(`${normalized(target.sportsbook)}|${target.side}`, exact);
  return [...selected.values()].map(row => ({
    sportsbook: row.sportsbook, side: row.side as "over" | "under", line: row.line,
    americanPrice: row.americanPrice, observedAt: row.observedAt,
  }));
}
