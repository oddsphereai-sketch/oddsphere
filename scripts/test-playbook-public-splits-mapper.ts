/**
 * Pure tests for Playbook public-splits mapper.
 *
 * No network, no DB, no production writes.
 */

import { mapPlaybookSplitsToSharpSignalRecords } from "../lib/providers/playbook/playbookPublicSplitsMapper";
import type { PlaybookSplitGame } from "../lib/providers/playbook/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(label);
  }
}

const mlbRow: PlaybookSplitGame = {
  gameId: "pb1",
  awayTeamName: "New York Yankees",
  homeTeamName: "Boston Red Sox",
  splits: {
    moneyline: {
      bets: { awayPercent: 61, homePercent: 39 },
      money: { awayPercent: 57, homePercent: 43 },
      source: { booksUsed: 11 },
    },
    total: {
      bets: { overPercent: 64, underPercent: 36 },
      money: { overPercent: 67, underPercent: 33 },
      source: { booksUsed: 11 },
    },
    spread: {
      bets: { awayPercent: 55, homePercent: 45 },
      money: { awayPercent: 52, homePercent: 48 },
      source: { booksUsed: 11 },
    },
  },
};

const mapped = mapPlaybookSplitsToSharpSignalRecords({
  sport: "mlb",
  rows: [mlbRow],
  gameExternalIdByKey: new Map([["NYY@BOS", 1001]]),
  computedAt: "2026-06-24T12:00:00.000Z",
});

check("emits six split-only records", mapped.records.length === 6);
check("maps one row", mapped.stats.rowsMapped === 1);
check("moneyline away pct maps", mapped.records.some((r) =>
  r.game_external_id === 1001 &&
  r.market_type === "moneyline" &&
  r.side === "away" &&
  r.public_betting_pct === 61 &&
  r.public_money_pct === 57
));
check("total over pct maps", mapped.records.some((r) =>
  r.market_type === "total" &&
  r.side === "over" &&
  r.public_betting_pct === 64 &&
  r.public_money_pct === 67
));
check("does not invent EV", mapped.records.every((r) => r.is_plus_ev === false && r.ev_pct === null));
check("does not invent steam", mapped.records.every((r) => r.has_steam_move === false && r.steam_books_count === null));
check("does not invent RLM", mapped.records.every((r) => r.has_reverse_line_movement === false && r.rlm_direction === null));
check("does not invent Pinnacle", mapped.records.every((r) => r.pinnacle_fair_probability === null));

const wnbaRow: PlaybookSplitGame = {
  gameId: "pb2",
  awayTeamName: "Phoenix Mercury",
  homeTeamName: "Indiana Fever",
  splits: {
    moneyline: {
      bets: { awayPercent: 27, homePercent: 73 },
      money: { awayPercent: 31, homePercent: 69 },
      source: { booksUsed: 10 },
    },
  },
};

const wnbaMapped = mapPlaybookSplitsToSharpSignalRecords({
  sport: "wnba",
  rows: [wnbaRow],
  gameExternalIdByKey: new Map([["PHX@IND", 2002]]),
  computedAt: "2026-06-24T12:00:00.000Z",
});
check("WNBA registry maps PHX@IND", wnbaMapped.records.length === 2);
check("WNBA home pct maps", wnbaMapped.records.some((r) =>
  r.game_external_id === 2002 &&
  r.market_type === "moneyline" &&
  r.side === "home" &&
  r.public_betting_pct === 73 &&
  r.public_money_pct === 69
));

const unresolved = mapPlaybookSplitsToSharpSignalRecords({
  sport: "wnba",
  rows: [{ gameId: "x", awayTeamName: "Team Unknown", homeTeamName: "Indiana Fever", splits: wnbaRow.splits }],
  gameExternalIdByKey: new Map([["UNK@IND", 1]]),
  computedAt: "2026-06-24T12:00:00.000Z",
});
check("unresolved team is skipped", unresolved.stats.skippedUnresolvedTeam === 1 && unresolved.records.length === 0);

const noGameId = mapPlaybookSplitsToSharpSignalRecords({
  sport: "mlb",
  rows: [mlbRow],
  gameExternalIdByKey: new Map(),
  computedAt: "2026-06-24T12:00:00.000Z",
});
check("missing gameExternalId is skipped", noGameId.stats.skippedNoGameExternalId === 1 && noGameId.records.length === 0);

console.log(`\nplaybook-public-splits-mapper: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✓ all assertions passed");
