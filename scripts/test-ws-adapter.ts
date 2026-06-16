/**
 * Unit tests for lib/providers/real_api/ws/sharpApiWsAdapter.ts.
 * Synthetic frames against the documented SharpAPI WS message types. The exact
 * odds:update field shape is verified against real frames at go-live; these
 * pin the normalization contract + control-message handling.
 * Run: npx tsx scripts/test-ws-adapter.ts
 */
import {
  adaptSharpWsMessage,
  classifyWsMessage,
  readGlobalSeq,
} from "../lib/providers/real_api/ws/sharpApiWsAdapter";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// Control / lifecycle frames → no odds events.
for (const t of ["connected", "subscribed", "snapshot:complete", "heartbeat", "ev:detected", "ev:expired"]) {
  check(`control '${t}' → [] events`, adaptSharpWsMessage({ type: t }).length === 0);
}
check("classify heartbeat", classifyWsMessage({ type: "heartbeat" }).kind === "heartbeat");
check("classify unknown", classifyWsMessage({ type: "weird_thing" }).kind === "unknown");
check("classify non-object → unknown", classifyWsMessage("nope").kind === "unknown");

// global_seq read (accepts global_seq / seq).
check("readGlobalSeq global_seq", readGlobalSeq({ type: "odds:update", global_seq: 42 }) === 42);
check("readGlobalSeq seq fallback", readGlobalSeq({ type: "odds:update", seq: 7 }) === 7);
check("readGlobalSeq missing → null", readGlobalSeq({ type: "odds:update" }) === null);

// odds:update with one MLB moneyline row under `data`.
{
  const frame = {
    type: "odds:update",
    sport: "baseball",
    league: "mlb",
    global_seq: 100,
    data: [{
      event_id: "mlb_yankees_redsox_2026-06-16_b0",
      sportsbook: "draftkings",
      market_type: "moneyline",
      selection_type: "home",
      odds_american: -120,
      home_team: "New York Yankees",
      away_team: "Boston Red Sox",
      timestamp: "2026-06-16T18:00:00Z",
    }],
  };
  const out = adaptSharpWsMessage(frame);
  check("odds:update → 1 event", out.length === 1);
  const e = out[0];
  check("kind=update", e.kind === "update");
  check("marketType=moneyline", e.marketType === "moneyline");
  check("side=home", e.side === "home");
  check("sportsbook lowercased", e.sportsbook === "draftkings");
  check("not blocked book", e.isBlockedBook === false);
  check("oddsAmerican parsed", e.oddsAmerican === -120);
  check("MLB home team normalized (non-null)", typeof e.homeAbbrev === "string" && e.homeAbbrev !== null);
  check("globalSeq propagated", e.globalSeq === 100);
  check("providerEventId carried", e.providerEventId === "mlb_yankees_redsox_2026-06-16_b0");
  check("providerTs from timestamp", e.providerTs === "2026-06-16T18:00:00Z");
  check("isAlternate defaults false when absent", e.isAlternate === false);
}

// Alternate flag parsing (is_alternate_line / is_alt / alternate, bool or "true"/1).
{
  const alt = adaptSharpWsMessage({
    type: "odds:update", sport: "baseball", league: "mlb",
    data: [{ sportsbook: "pinnacle", market_type: "total", selection_type: "under", line: 11.0, odds_american: -110, is_alternate_line: true }],
  });
  check("is_alternate_line=true → isAlternate true", alt[0]?.isAlternate === true);
  const altStr = adaptSharpWsMessage({
    type: "odds:update", sport: "baseball",
    data: [{ sportsbook: "pinnacle", market_type: "total", selection_type: "over", line: 12.5, odds_american: -110, alternate: "true" }],
  });
  check("alternate='true' → isAlternate true", altStr[0]?.isAlternate === true);
  const main = adaptSharpWsMessage({
    type: "odds:update", sport: "baseball",
    data: [{ sportsbook: "pinnacle", market_type: "total", selection_type: "over", line: 8.5, odds_american: -110 }],
  });
  check("no alt flag → isAlternate false", main[0]?.isAlternate === false);
}

// Blocked book is flagged (not silently dropped — caller decides).
{
  const out = adaptSharpWsMessage({
    type: "odds:update", sport: "baseball", league: "mlb",
    data: [{ sportsbook: "fliff", market_type: "moneyline", selection_type: "away", odds_american: 130 }],
  });
  check("blocked book event present", out.length === 1);
  check("isBlockedBook=true for fliff", out[0].isBlockedBook === true);
}

// Unsupported market (team_total) → dropped.
check(
  "unsupported market dropped",
  adaptSharpWsMessage({
    type: "odds:update", sport: "baseball",
    data: [{ sportsbook: "betmgm", market_type: "team_total", selection_type: "over", odds_american: -110 }],
  }).length === 0,
);

// Unrecognized side → dropped.
check(
  "unrecognized side dropped",
  adaptSharpWsMessage({
    type: "odds:update", sport: "baseball",
    data: [{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "tie", odds_american: -110 }],
  }).length === 0,
);

// odds:removed → kind=removed.
{
  const out = adaptSharpWsMessage({
    type: "odds:removed", sport: "baseball", league: "mlb",
    data: [{ sportsbook: "pinnacle", market_type: "total", selection_type: "over", line: 8.5 }],
  });
  check("odds:removed → 1 event", out.length === 1);
  check("kind=removed", out[0].kind === "removed");
  check("line_value parsed on removed", out[0].lineValue === 8.5);
}

// Soccer: homeAbbrev stays null (no MLB normalization), event still produced.
{
  const out = adaptSharpWsMessage({
    type: "odds:update", sport: "soccer", league: "fifa_world_cup",
    data: [{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "home", odds_american: 150, home_team: "Austria", away_team: "Jordan" }],
  });
  check("soccer event produced", out.length === 1);
  check("soccer homeAbbrev null (not MLB-normalized)", out[0].homeAbbrev === null);
  check("soccer homeRaw preserved", out[0].homeRaw === "Austria");
}

// Message-as-row (no data wrapper) still parses defensively.
{
  const out = adaptSharpWsMessage({
    type: "odds:update", sport: "baseball", league: "mlb",
    sportsbook: "caesars", market_type: "moneyline", selection_type: "away", odds_american: 105,
  });
  check("message-as-row parses", out.length === 1 && out[0].side === "away");
}

// Garbage → [].
check("null frame → []", adaptSharpWsMessage(null).length === 0);
check("string frame → []", adaptSharpWsMessage("garbage").length === 0);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
