/** Offline envelope only. Does not authorize or debit the production wallet. */
import { invariant } from "../../lib/playerPropsAi/evidence";

export type CostSlot = { key: string; stage: "early" | "final"; standardMicro: number; flexMicro?: number; strongerMicro?: number };
export function forecastCostPlan(slots: CostSlot[], options: { ceilingMicro?: number; fallbackFraction?: number; earlyFlex?: boolean } = {}) {
  const ceilingMicro = options.ceilingMicro ?? 50_000_000;
  const fallbackFraction = options.fallbackFraction ?? .1;
  const earlyFlex = options.earlyFlex ?? true;
  invariant(Number.isSafeInteger(ceilingMicro) && ceilingMicro >= 0 && Number.isFinite(fallbackFraction) && fallbackFraction >= 0 && fallbackFraction <= 1, "Invalid budget policy");
  invariant(new Set(slots.map(s => s.key)).size === slots.length && slots.every(s => Number.isSafeInteger(s.standardMicro) && s.standardMicro >= 0 && (s.flexMicro === undefined || Number.isSafeInteger(s.flexMicro) && s.flexMicro >= 0 && s.flexMicro <= s.standardMicro) && (s.strongerMicro === undefined || Number.isSafeInteger(s.strongerMicro) && s.strongerMicro >= s.standardMicro) && ["early", "final"].includes(s.stage)), "Invalid/duplicate review cost slot");
  const early = slots.filter(s => s.stage === "early"), finals = slots.filter(s => s.stage === "final");
  const primaryMicro = slots.reduce((sum, s) => sum + (earlyFlex && s.stage === "early" ? s.flexMicro ?? Math.ceil(s.standardMicro / 2) : s.standardMicro), 0);
  // Additional Standard attempts, assuming even the preceding Flex attempt was charged.
  // Unknown completions remain held; this allowance is not permission for blind retries.
  const fallbackSlots = earlyFlex ? Math.ceil(early.length * fallbackFraction) : 0;
  const fallbackMicro = early.slice().sort((a, b) => b.standardMicro - a.standardMicro).slice(0, fallbackSlots).reduce((sum, s) => sum + s.standardMicro, 0);
  const recoveryMicro = 3_000_000, coreMicro = primaryMicro + fallbackMicro + recoveryMicro;
  const maximumStrongerFinals = Math.floor(finals.length * .1);
  // Expensive-first is an adverse cost envelope, not the product's review selection rule.
  const upgrades = finals.map(s => (s.strongerMicro ?? 10 * s.standardMicro) - s.standardMicro).sort((a, b) => b - a).slice(0, maximumStrongerFinals);
  let upgradeMicro = 0, affordableStrongerFinals = 0;
  if (coreMicro <= ceilingMicro) for (const upgrade of upgrades) {
    if (coreMicro + upgradeMicro + upgrade > ceilingMicro) break;
    upgradeMicro += upgrade; affordableStrongerFinals++;
  }
  return { logicalReviews: slots.length, earlyReviews: early.length, finalReviews: finals.length, primaryMicro, fallbackSlots, fallbackMicro, recoveryMicro,
    coreMicro, primaryFits: coreMicro <= ceilingMicro, maximumStrongerFinals, affordableStrongerFinals,
    affordableStrongerFraction: finals.length ? affordableStrongerFinals / finals.length : 0,
    upgradeMicro, adaptiveMicro: coreMicro + upgradeMicro, fixedTenPercentMicro: coreMicro + upgrades.reduce((a, b) => a + b, 0), ceilingMicro };
}
