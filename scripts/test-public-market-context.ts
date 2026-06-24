import { applyPublicMarketContext } from "../lib/services/publicMarketContext";

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const support = applyPublicMarketContext({
  grade: "Watchlist",
  picked: { public_betting_pct: 49, public_money_pct: 62 },
  opposite: { public_betting_pct: 51, public_money_pct: 38 },
});
check("money support upgrades Watchlist to Lean", support.gradeAfter === "Lean", JSON.stringify(support));
check("money support is audited", support.support === "money_support", JSON.stringify(support));

const capped = applyPublicMarketContext({
  grade: "Best Angle",
  picked: { public_betting_pct: 74, public_money_pct: 76 },
  opposite: { public_betting_pct: 26, public_money_pct: 24 },
});
check("public smoke caps Best Angle to Lean", capped.gradeAfter === "Lean", JSON.stringify(capped));
check("public smoke is not called sharp", capped.conflict === "public_smoke", JSON.stringify(capped));

const opposingMoney = applyPublicMarketContext({
  grade: "Best Angle",
  picked: { public_betting_pct: 62, public_money_pct: 38 },
  opposite: { public_betting_pct: 38, public_money_pct: 62 },
});
check("opposing money caps Best Angle to Lean", opposingMoney.gradeAfter === "Lean", JSON.stringify(opposingMoney));
check("opposing money is audited", opposingMoney.conflict === "opposing_money", JSON.stringify(opposingMoney));

const quiet = applyPublicMarketContext({
  grade: "Lean",
  picked: { public_betting_pct: 52, public_money_pct: 54 },
  opposite: { public_betting_pct: 48, public_money_pct: 46 },
});
check("quiet split leaves grade alone", quiet.gradeAfter === "Lean", JSON.stringify(quiet));

if (failed > 0) {
  console.error(`\n${failed} public-market-context checks failed.`);
  process.exit(1);
}
console.log("\npublic-market-context checks passed.");
