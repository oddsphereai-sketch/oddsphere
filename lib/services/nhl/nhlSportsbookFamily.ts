/** Canonical physical sportsbook identity for NHL price, exclusion and reader
 * evidence. Aliases must never count as independent books or escape target
 * exclusion. */
export function canonicalNhlSportsbookFamily(value: string): string {
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact === "circa" || compact === "circasports" || compact === "circasportsbook") return "circa";
  if (compact === "pinnacle" || compact === "pinnaclesports" || compact === "pinnaclesportsbook") return "pinnacle";
  if (compact === "bookmaker" || compact === "bookmakersports" || compact === "bookmakersportsbook" || compact === "bookmakerus") return "bookmaker";
  return compact;
}
