/**
 * P1B 2026-06-12 regression tests — public splits carry-forward + independence.
 *
 * Pinpoint contract for the splits write path inside linesService:
 *   1. bet% and money% are persisted INDEPENDENTLY.
 *   2. carry-forward fills a missing field from prior known-good.
 *   3. neither side is ever fabricated when both new and prior are null.
 *
 * The reviewer noticed in the 2026-06-12 audit that 12/15 MLB games today
 * have bet% but 0/15 have money% — a vendor coverage situation on SharpAPI
 * /splits, NOT a writer bug. These tests lock in that the writer correctly
 * preserves each side independently so future refreshes can fill the gap
 * without overwriting fresh data.
 */
import { mergePublicSplitsCarryForward } from "../lib/services/publicSplitsCarryForward";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main() {
  section("Both new values present (fresh poll)");
  {
    const r = mergePublicSplitsCarryForward(55, 60, {
      public_betting_pct: 40,
      public_money_pct: 35,
    });
    check("[P1B] fresh bet% wins over prior", r.betting === 55);
    check("[P1B] fresh money% wins over prior", r.money === 60);
    check("[P1B] carried=false (no fallback used)", r.carried === false);
  }

  section("Bet% present + money% null + prior money% known → carry-forward money%");
  {
    const r = mergePublicSplitsCarryForward(55, null, {
      public_betting_pct: 40,
      public_money_pct: 35,
    });
    check("[P1B] fresh bet% wins", r.betting === 55);
    check("[P1B] money% carried from prior", r.money === 35);
    check("[P1B] carried=true", r.carried === true);
  }

  section("Bet% null + money% present + prior bet% known → carry-forward bet%");
  {
    const r = mergePublicSplitsCarryForward(null, 60, {
      public_betting_pct: 40,
      public_money_pct: 35,
    });
    check("[P1B] bet% carried from prior", r.betting === 40);
    check("[P1B] fresh money% wins", r.money === 60);
    check("[P1B] carried=true", r.carried === true);
  }

  section("Independence — bet% null with NO prior bet% does not affect money%");
  {
    // This is the exact 2026-06-12 MLB scenario: provider returns bet%
    // but money% null. No prior money% recorded. The persisted bet%
    // MUST stay populated; the money% MUST stay null (honest).
    const r = mergePublicSplitsCarryForward(55, null, undefined);
    check("[P1B] bet% persists when money% null and no prior", r.betting === 55);
    check("[P1B] money% stays null (no fabrication)", r.money === null);
    check("[P1B] carried=false (nothing to fall back to)", r.carried === false);
  }

  section("Independence — money% null + prior bet% known, prior money% null");
  {
    const r = mergePublicSplitsCarryForward(55, null, {
      public_betting_pct: 40,
      public_money_pct: null,
    });
    check("[P1B] fresh bet% wins", r.betting === 55);
    check("[P1B] money% stays null (prior also null)", r.money === null);
    check("[P1B] carried=false (neither flipped)", r.carried === false);
  }

  section("Both new null + prior has both → carry-forward both");
  {
    const r = mergePublicSplitsCarryForward(null, null, {
      public_betting_pct: 40,
      public_money_pct: 35,
    });
    check("[P1B] bet% carried from prior", r.betting === 40);
    check("[P1B] money% carried from prior", r.money === 35);
    check("[P1B] carried=true (two flips)", r.carried === true);
  }

  section("Both new null + no prior → both null (honest absence)");
  {
    const r = mergePublicSplitsCarryForward(null, null, undefined);
    check("[P1B] bet% stays null", r.betting === null);
    check("[P1B] money% stays null", r.money === null);
    check("[P1B] carried=false", r.carried === false);
  }

  section("Refresh-merge sequence — money% appears in T+1 poll without losing T0 bet%");
  {
    // T0 — bet% only
    const t0 = mergePublicSplitsCarryForward(55, null, undefined);
    check("[P1B] T0: bet% only", t0.betting === 55 && t0.money === null);
    // T+1 — provider now returns money% too. Prior row in DB has bet%=55, money%=null.
    const t1 = mergePublicSplitsCarryForward(55, 60, {
      public_betting_pct: 55,
      public_money_pct: null,
    });
    check("[P1B] T+1: money% now persists", t1.money === 60);
    check("[P1B] T+1: bet% still 55", t1.betting === 55);
    check("[P1B] T+1: carried=false (fresh values everywhere)", t1.carried === false);
  }

  section("Refresh-merge sequence — bet% drops to null at T+1 but prior carried");
  {
    // T0 — provider returns both. T+1 — provider gap on bet%. Prior carry-forward keeps it.
    const t1 = mergePublicSplitsCarryForward(null, 60, {
      public_betting_pct: 55,
      public_money_pct: 50,
    });
    check("[P1B] T+1: bet% carried", t1.betting === 55);
    check("[P1B] T+1: money% fresh wins", t1.money === 60);
    check("[P1B] T+1: carried=true", t1.carried === true);
  }

  // Summary
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All P1B public-splits carry-forward tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
