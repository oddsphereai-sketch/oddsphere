/**
 * Unit tests for lib/streaming/marketInterpretation.ts — the derived market
 * chip + interpretation. Run: npx tsx scripts/test-market-interpretation.ts
 */
import { interpretMarket, type MarketInterpretationInput } from "../lib/streaming/marketInterpretation";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}
const NOW = Date.parse("2026-06-16T18:00:00Z");
function base(over: Partial<MarketInterpretationInput> = {}): MarketInterpretationInput {
  return {
    pickSide: "home", openAmerican: -120, postedAmerican: -120, currentAmerican: -120,
    lastMove: null, splits: null, nowMs: NOW, ...over,
  };
}

// 1. Market moved toward us (picked side shortened → implied prob up).
{
  const r = interpretMarket(base({ openAmerican: -150, currentAmerican: -170 }));
  check("toward → chip", r.chipLabel === "Market moved toward our side" && r.chipTone === "emerald");
  check("toward → flag", r.flags.includes("moved_toward"));
}
// 2. Market moved against us.
{
  const r = interpretMarket(base({ openAmerican: -170, currentAmerican: -150 }));
  check("against → chip", r.chipLabel === "Market moved against our side" && r.chipTone === "amber");
  check("against → flag", r.flags.includes("moved_against"));
}
// 3. Reverse movement in our FAVOR: public light on pick, line moved toward us.
{
  const r = interpretMarket(base({
    openAmerican: 120, currentAmerican: -110,
    splits: { pickBetsPct: 35, pickMoneyPct: 40, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("RLM favor → chip", r.chipLabel === "Sharp reverse move our way" && r.chipTone === "emerald");
  check("RLM favor → flag", r.flags.includes("reverse_line_movement"));
}
// 4. Reverse movement AGAINST us: public heavy on pick, line moved away.
{
  const r = interpretMarket(base({
    openAmerican: -170, currentAmerican: -150,
    splits: { pickBetsPct: 72, pickMoneyPct: 68, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("RLM against → chip", r.chipLabel === "Reverse move against our side" && r.chipTone === "amber");
  check("RLM against → flag", r.flags.includes("reverse_line_movement"));
}
// 5. Public-heavy but unconfirmed by the line (overall flat).
{
  const r = interpretMarket(base({
    openAmerican: -120, currentAmerican: -120,
    splits: { pickBetsPct: 70, pickMoneyPct: 70, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("public-heavy unconfirmed → chip", r.chipLabel === "Public-heavy, sharp unconfirmed" && r.chipTone === "amber");
  check("public-heavy unconfirmed → flag", r.flags.includes("public_heavy_unconfirmed"));
}
// 5b. Sharp money AGAINST our pick (17192-like: 82% tickets, 38% money on us →
//     money piled on the OTHER side). Must NOT read as "unconfirmed".
{
  const r = interpretMarket(base({
    openAmerican: -120, currentAmerican: -120,
    splits: { pickBetsPct: 82, pickMoneyPct: 38, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("sharp money against → chip", r.chipLabel === "Sharp money against our side" && r.chipTone === "amber");
  check("sharp money against → flag", r.flags.includes("sharp_money_against"));
  check("sharp money against → NOT mislabeled unconfirmed", !r.flags.includes("public_heavy_unconfirmed"));
}
// 5c. Sharp money WITH our pick (17179-like: money heavier than tickets on us).
{
  const r = interpretMarket(base({
    openAmerican: -120, currentAmerican: -120,
    splits: { pickBetsPct: 75, pickMoneyPct: 97, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("sharp money with → chip", r.chipLabel === "Sharp money on our side" && r.chipTone === "emerald");
  check("sharp money with → flag", r.flags.includes("sharp_money_with"));
}
// 5d. Public-heavy but money still MAJORITY on us (17181-like: bets 81, money 65)
//     → no strong sharp read either way → still honestly "unconfirmed".
{
  const r = interpretMarket(base({
    openAmerican: -120, currentAmerican: -120,
    splits: { pickBetsPct: 81, pickMoneyPct: 65, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("public-heavy, money-majority → unconfirmed (not false sharp)", r.chipLabel === "Public-heavy, sharp unconfirmed");
  check("public-heavy, money-majority → no sharp flags", !r.flags.includes("sharp_money_against") && !r.flags.includes("sharp_money_with"));
}
// 6. Splits stale (otherwise quiet).
{
  const r = interpretMarket(base({
    openAmerican: -120, currentAmerican: -120,
    splits: { pickBetsPct: 52, pickMoneyPct: 51, observedAtIso: "2026-06-16T12:00:00Z", isStale: true },
  }));
  check("stale → flag", r.flags.includes("splits_stale"));
  check("stale → chip notes stale", r.chipLabel.includes("splits stale"));
  check("stale → detail mentions refreshed", r.detail.some((d) => d.includes("splits last refreshed")));
}
// 7. Money/public divergence.
{
  const r = interpretMarket(base({
    splits: { pickBetsPct: 45, pickMoneyPct: 65, observedAtIso: "2026-06-16T17:55:00Z", isStale: false },
  }));
  check("money/public divergence → flag", r.flags.includes("money_public_divergence"));
  check("divergence detail present", r.detail.some((d) => d.includes("diverge")));
}
// 8. Consensus vs isolated last move.
{
  const consensus = interpretMarket(base({
    openAmerican: null, currentAmerican: null,
    lastMove: { prevAmerican: -150, nextAmerican: -165, movedAtIso: "2026-06-16T17:50:00Z", booksMoved: 8, totalBooks: 10 },
  }));
  check("consensus move → flag", consensus.flags.includes("consensus_move"));
  const isolated = interpretMarket(base({
    openAmerican: null, currentAmerican: null,
    lastMove: { prevAmerican: -150, nextAmerican: -165, movedAtIso: "2026-06-16T17:50:00Z", booksMoved: 1, totalBooks: 10 },
  }));
  check("isolated move → flag", isolated.flags.includes("isolated_move"));
}
// 9. Last-move chip when no overall open→current signal.
{
  const r = interpretMarket(base({
    openAmerican: null, currentAmerican: null,
    lastMove: { prevAmerican: -150, nextAmerican: -135, movedAtIso: "2026-06-16T17:50:00Z", booksMoved: null, totalBooks: null },
  }));
  check("last move against → chip", r.chipLabel === "Last move against our side");
}
// 10. Quiet market.
{
  const r = interpretMarket(base());
  check("quiet → Market steady gray", r.chipLabel === "Market steady" && r.chipTone === "gray");
}
// 11. CLV direction since post (Model Posted → Current).
{
  const gaining = interpretMarket(base({ postedAmerican: -130, currentAmerican: -150, openAmerican: -130 }));
  check("posted→current gaining detail", gaining.detail.some((d) => d.includes("gaining value")));
  const slipping = interpretMarket(base({ postedAmerican: -150, currentAmerican: -130, openAmerican: -150 }));
  check("posted→current slipping detail", slipping.detail.some((d) => d.includes("value slipping")));
}
// 12. No splits / no movement → no crash, steady.
{
  const r = interpretMarket(base({ openAmerican: null, currentAmerican: null, postedAmerican: null }));
  check("empty inputs → steady, no flags", r.chipLabel === "Market steady" && r.flags.length === 0);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
