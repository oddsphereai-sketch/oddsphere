/** Partition whole players within ONE logical game review; never omit markets or add review times. */
import type { GamePacket, Json } from "./catalog";
import { digest, invariant, validatePacket } from "./core";
import { readableRequest } from "./readable";
import { countInput } from "./api-eval";
import type { Model } from "./validation";
export const SHORT_INPUT_TARGET = 220_000;
export const PARTITION_SCOPE_TARGET = 150;
export const PARTITION_PLAYER_TARGET = 16;
export const PARTITION_EVIDENCE_TARGET = 800;
export function subsetPacket(packet: GamePacket, playerIds: string[]): GamePacket {
  const ids = new Set(playerIds);
  const context: Json = packet.players.map(p => ({ id: p.id, name: p.name, team: p.team, opponent: p.opponent,
    baselineHeads: p.evidence.filter(e => e.kind === "independent_model").map(e => {
      const v = e.value as Record<string, Json>; return { market: v.market ?? null, mean: v.independentProjection ?? null, availableAt: e.availableAt };
    }) }));
  return { ...packet, players: packet.players.filter(p => ids.has(p.id)), quotes: packet.quotes.filter(q => ids.has(q.playerId)), sharedGameContext: context,
    sourceLimitations: [...packet.sourceLimitations, "one player-preserving partition of the same logical game review; shared all-player baseline context retained"] };
}
export async function planPartitions(packet: GamePacket, model: Model, maxOutput: number, count = countInput) {
  validatePacket(packet);
  const scopes = packet.players.reduce((n, p) => n + p.markets.length, 0);
  if (scopes <= PARTITION_SCOPE_TARGET && packet.players.length <= PARTITION_PLAYER_TARGET && packet.players.reduce((n, p) => n + p.evidence.length, 0) <= PARTITION_EVIDENCE_TARGET) {
    const fullCount = await count(readableRequest(packet, model, maxOutput));
    if (fullCount <= SHORT_INPUT_TARGET) return [{ packet, inputTokens: fullCount }];
  }
  const parts: { packet: GamePacket; inputTokens: number }[] = [];
  const split = async (ids: string[]) => {
    const sub = subsetPacket(packet, ids);
    const countScopes = sub.players.reduce((n, p) => n + p.markets.length, 0);
    if (countScopes <= PARTITION_SCOPE_TARGET && sub.players.length <= PARTITION_PLAYER_TARGET && sub.players.reduce((n, p) => n + p.evidence.length, 0) <= PARTITION_EVIDENCE_TARGET) {
      const tokens = await count(readableRequest(sub, model, maxOutput));
      if (tokens <= SHORT_INPUT_TARGET) { parts.push({ packet: sub, inputTokens: tokens }); return; }
    }
    invariant(ids.length > 1, "One player exceeds the safe request size; evidence compiler needs redesign, not silent truncation");
    const middle = Math.ceil(ids.length / 2); await split(ids.slice(0, middle)); await split(ids.slice(middle));
  };
  for (const team of new Set(packet.players.map(p => p.team))) await split(packet.players.filter(p => p.team === team).map(p => p.id));
  invariant(parts.length <= 8, "Partition request bound exceeded");
  const delivered = parts.flatMap(p => p.packet.players.map(p => p.id));
  invariant(delivered.length === packet.players.length && new Set(delivered).size === packet.players.length, "Partition coverage failed");
  invariant(digest(delivered.slice().sort()) === digest(packet.players.map(p => p.id).sort()), "Partition changed player identities");
  return parts;
}
