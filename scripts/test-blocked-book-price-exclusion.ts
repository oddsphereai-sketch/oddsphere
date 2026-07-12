/**
 * #39 regression — blocked books (fliff, kalshi) must never be selected as a
 * price source. Exercises the MLB lock-price choke point `buildGameOddsSnapshot`
 * (which delegates to pickOddsWithFallback) and the central BLOCKED_SPORTSBOOKS.
 */
import { buildGameOddsSnapshot } from "../lib/services/predictionRecordService";
import { isBlockedSportsbook, BLOCKED_SPORTSBOOKS } from "../lib/config/blockedSportsbooks";
import { NO_VIG_BOOK_PRIORITY } from "../lib/services/aiReviewerWiring";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; }
  else { fail++; console.error(`❌ ${name}`); }
}

function ml(side: "home" | "away", book: string, odds: number) {
  return { game_id: 1, market_type: "moneyline", side, sportsbook: book, odds_american: odds, line_value: null, fetched_at: "2026-06-15T12:00:00Z" };
}

function total(side: "over" | "under", book: string, odds: number) {
  return { game_id: 1, market_type: "total", side, sportsbook: book, odds_american: odds, line_value: 8.5, fetched_at: "2026-06-15T12:00:00Z" };
}

// 1. central set contains both blocked books
check("BLOCKED_SPORTSBOOKS has fliff", BLOCKED_SPORTSBOOKS.has("fliff"));
check("BLOCKED_SPORTSBOOKS has kalshi", BLOCKED_SPORTSBOOKS.has("kalshi"));
check("isBlockedSportsbook case-insensitive", isBlockedSportsbook("Fliff") && isBlockedSportsbook("KALSHI"));

// 2. only-fliff → unavailable (null), never the fliff price
{
  const snap = buildGameOddsSnapshot([ml("home", "fliff", 385)]);
  check("only-fliff home → null odds", snap.mlHomeOdds === null);
}

// 3. only-kalshi → unavailable (null)
{
  const snap = buildGameOddsSnapshot([ml("away", "kalshi", 300)]);
  check("only-kalshi away → null odds", snap.mlAwayOdds === null);
}

// 4. fliff + a real book → the real book wins (blocked skipped)
{
  const snap = buildGameOddsSnapshot([ml("home", "fliff", 385), ml("home", "draftkings", -150)]);
  check("fliff+draftkings → draftkings price", snap.mlHomeOdds === -150);
}

// 5. fliff appears earlier than a real book in array order → still the real book
{
  const snap = buildGameOddsSnapshot([ml("away", "kalshi", 999), ml("away", "fanduel", 120)]);
  check("kalshi-first + fanduel → fanduel price", snap.mlAwayOdds === 120);
}

// 5b. newly trusted real books must be usable by cron/writer paths too
{
  const snap = buildGameOddsSnapshot([
    total("over", "fanatics", -105),
    total("under", "betrivers", -115),
  ]);
  check("newly trusted total over book selected", snap.ouOverOdds === -105);
  check("newly trusted total under book selected", snap.ouUnderOdds === -115);
}

// 6. #39 fix — AI reviewer no-vig book priority must NOT contain blocked books.
//    (Previously NO_VIG_BOOK_PRIORITY listed kalshi + fliff, leaking corrupted
//    no-vig into reviewer confidence caps / holds / score adjustments.)
{
  const leaked = NO_VIG_BOOK_PRIORITY.filter((b) => isBlockedSportsbook(b));
  check("aiReviewer NO_VIG_BOOK_PRIORITY excludes all blocked books", leaked.length === 0);
  check("aiReviewer NO_VIG list has no 'fliff'", !NO_VIG_BOOK_PRIORITY.includes("fliff"));
  check("aiReviewer NO_VIG list has no 'kalshi'", !NO_VIG_BOOK_PRIORITY.includes("kalshi"));
}

console.log(`\n${pass} passed · ${fail} failed · ${pass + fail} total`);
if (fail > 0) process.exit(1);
console.log("✅ All blocked-book price-exclusion tests passed.");
