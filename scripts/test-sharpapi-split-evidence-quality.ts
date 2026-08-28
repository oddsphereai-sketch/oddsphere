import { __TEST__ as sharpApiTest } from "../lib/providers/real_api/SharpAPISignalProvider";

const failures: string[] = [];
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

const valid = {
  home_team: "Milwaukee Brewers",
  away_team: "Texas Rangers",
  moneyline: {
    bets_pct: { home: 0.58, away: 0.42 },
    handle_pct: { home: 0.63, away: 0.37 },
  },
};
check(
  "valid SharpAPI split remains unchanged",
  JSON.stringify(sharpApiTest.publicPctsFromSplits("moneyline", "home", valid)) === JSON.stringify({ betting: 57.99999999999999, money: 63 }),
);

const saturated = {
  ...valid,
  moneyline: {
    bets_pct: { home: 1, away: 0 },
    handle_pct: { home: 1, away: 0 },
  },
};
const home = sharpApiTest.publicPctsFromSplits("moneyline", "home", saturated);
const away = sharpApiTest.publicPctsFromSplits("moneyline", "away", saturated);
check("100/100 SharpAPI side is unavailable", home.betting === null && home.money === null);
check("0/0 SharpAPI side is unavailable", away.betting === null && away.money === null);

const partial = {
  ...valid,
  total: {
    bets_pct: { over: 0.58, under: 0.42 },
    handle_pct: { over: 1, under: 0 },
  },
};
const over = sharpApiTest.publicPctsFromSplits("total", "over", partial);
check("valid tickets remain when money endpoint is unavailable", Math.abs((over.betting ?? 0) - 58) < 1e-9 && over.money === null);

if (failures.length > 0) process.exitCode = 1;
else console.log("\nSharpAPI split evidence quality tests passed.");
