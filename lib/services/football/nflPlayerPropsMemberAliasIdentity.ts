/** Display-only suppression of an unlocked unresolved duplicate when the same
 * exact scope already has a fully resolved member prediction. Raw decisions
 * and source evidence remain stored. No locked row is eligible. */
export function withoutUnresolvedNflPlayerAliasDuplicates<T extends {
  gameId: string; playerName: string; providerPlayerId: string | null; team: string;
  market: string; line: number; side: string; state: string; grade: string;
  projection: number | null; healthHolds: string[]; provider?: string;
}>(rows: readonly T[]): T[] {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return rows.filter(row => {
    if (row.state === "locked" || !["Held", "No Play"].includes(row.grade)
      || key(row.playerName) !== "chigoziemokonkwo" || row.team
      || !row.healthHolds.includes("team_game_identity_unmatched")) return true;
    const resolved = rows.filter(other => other.gameId === row.gameId
      && key(other.playerName) === "chigokonkwo" && other.team === "WAS"
      && Number.isFinite(other.projection) && other.projection !== null
      && other.grade !== "Held" && other.healthHolds.length === 0);
    const ids = new Set(resolved.map(other => other.providerPlayerId).filter(Boolean));
    if (ids.size !== 1 || !ids.has("734")
      || !resolved.some(other => other.provider === "balldontlie" && other.providerPlayerId === "734")) return true;
    return !resolved.some(other => other.market === row.market && other.line === row.line && other.side === row.side);
  });
}
