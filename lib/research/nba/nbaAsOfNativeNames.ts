export const NBA_ASOF_NATIVE_NAME_RELEASE = "nba_asof_native_name_2026_11_23_r2_printed_generation_order" as const;
type Source = { gameId: string; startAt: string; sourceAvailableAt: string; fetchedAt: string; sha256: string;
  teams: readonly { players: readonly { playerId: number; sourceNames: readonly string[] }[] }[] };
type Match = { playerId: number; sha256: string; fetchedAt: string; sourceAvailableAt: string };
export const nbaNativeNameKey = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function nbaMedicalNativeNameKey(sourceName: string) {
  const parts = sourceName.split(",").map(s => s.trim());
  if (parts.length === 2 && parts.every(Boolean)) return nbaNativeNameKey(`${parts[1]} ${parts[0]}`);
  if (parts.length === 3 && parts.every(Boolean) && /^(?:Jr|Sr|II|III|IV)\.?$/i.test(parts[1]!)) return nbaNativeNameKey(`${parts[2]} ${parts[0]} ${parts[1]}`);
  throw Error("invalid_native_medical_name");
}
/** Native ID aliases only; no fuzzy name, current-team or target participation
 * lookup. Cache requested names instead of a complete graph for every target. */
export function createNbaAsOfNativeNameLookup(sources: readonly Source[]) {
  if (sources.length > 10_000) throw Error("native_identity_source_budget");
  const cache = new Map<string, readonly Match[]>(), keys = new WeakMap<object, string[]>();
  return (target: { gameId: string; cutoff: string }, sourceName: string): readonly Match[] => {
    const cutoff = Date.parse(target.cutoff);
    if (!Number.isFinite(cutoff) || !/^002\d{7}$/.test(target.gameId) || sourceName.length > 160) throw Error("invalid_native_medical_lookup");
    const key = nbaMedicalNativeNameKey(sourceName), cacheKey = `${target.gameId}:${target.cutoff}:${key}`;
    const prior = cache.get(cacheKey); if (prior) return prior;
    if (cache.size >= 30_000) throw Error("native_identity_lookup_budget");
    const found = new Map<number, Match>();
    for (const s of sources) {
      if (s.gameId === target.gameId || Date.parse(s.startAt) >= cutoff || Date.parse(s.sourceAvailableAt) > cutoff) continue;
      if (![Date.parse(s.startAt), Date.parse(s.sourceAvailableAt)].every(Number.isFinite)) throw Error("invalid_native_identity_clock");
      for (const team of s.teams) for (const p of team.players) {
        let names = keys.get(p); if (!names) { names = p.sourceNames.map(nbaNativeNameKey); keys.set(p, names); }
        if (!names.includes(key)) continue;
        if (!Number.isSafeInteger(p.playerId) || p.playerId <= 0 || !/^[a-f0-9]{64}$/.test(s.sha256) || Date.parse(s.fetchedAt) < Date.parse(s.sourceAvailableAt)) throw Error("unverified_native_identity_receipt");
        const old = found.get(p.playerId);
        if (!old || Date.parse(s.sourceAvailableAt) < Date.parse(old.sourceAvailableAt)) found.set(p.playerId, { playerId: p.playerId, sha256: s.sha256, fetchedAt: s.fetchedAt, sourceAvailableAt: s.sourceAvailableAt });
      }
    }
    const result = [...found.values()].sort((a, b) => a.playerId - b.playerId); cache.set(cacheKey, result); return result;
  };
}
