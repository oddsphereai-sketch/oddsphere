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

// ─── Soccer / World Cup (sport-aware normalization) ────────────────────
// SharpAPI reuses "moneyline" for soccer 1X2 → must map to match_result,
// NOT MLB-style moneyline. Side normalization reuses the REST soccer
// normalizer (canonical home/draw/away · home_or_draw/… · over/under · yes/no).
const soccerFrame = (rows: Record<string, unknown>[]) =>
  adaptSharpWsMessage({ type: "odds:update", sport: "soccer", league: "fifa_world_cup_matches", data: rows });

// 1X2 / match_result — soccer "moneyline" → match_result, sides home/draw/away.
{
  const home = soccerFrame([{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "home", odds_american: 150, home_team: "Austria", away_team: "Jordan" }]);
  check("soccer moneyline → match_result", home[0]?.marketType === "match_result");
  check("soccer match_result side=home", home[0]?.side === "home");
  check("soccer homeAbbrev null (not MLB-normalized)", home[0]?.homeAbbrev === null);
  check("soccer homeRaw preserved", home[0]?.homeRaw === "Austria");

  const draw = soccerFrame([{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "draw", odds_american: 220, home_team: "Austria", away_team: "Jordan" }]);
  check("soccer match_result side=draw", draw[0]?.side === "draw");

  // selection carrying the team NAME maps to away.
  const byName = soccerFrame([{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "Jordan", odds_american: 500, home_team: "Austria", away_team: "Jordan" }]);
  check("soccer match_result team-name → away", byName[0]?.side === "away");
}

// Totals — soccer "total_goals" → total, over/under.
{
  const over = soccerFrame([{ sportsbook: "pinnacle", market_type: "total_goals", selection_type: "over", line: 2.5, odds_american: -110, home_team: "Argentina", away_team: "Algeria" }]);
  check("soccer total_goals → total", over[0]?.marketType === "total");
  check("soccer total side=over", over[0]?.side === "over");
  check("soccer total line parsed", over[0]?.lineValue === 2.5);
}

// BTTS — "both_teams_to_score" → btts, yes/no.
{
  const yes = soccerFrame([{ sportsbook: "pinnacle", market_type: "both_teams_to_score", selection_type: "yes", odds_american: 120, home_team: "England", away_team: "Croatia" }]);
  check("soccer both_teams_to_score → btts", yes[0]?.marketType === "btts");
  check("soccer btts side=yes", yes[0]?.side === "yes");
  const no = soccerFrame([{ sportsbook: "pinnacle", market_type: "both_teams_to_score", selection_type: "no", odds_american: -140, home_team: "England", away_team: "Croatia" }]);
  check("soccer btts side=no", no[0]?.side === "no");
}

// Double chance — "double_chance" → double_chance, canonical combo sides.
{
  const dc = soccerFrame([{ sportsbook: "pinnacle", market_type: "double_chance", selection_type: "1X", odds_american: -200, home_team: "Portugal", away_team: "DR Congo" }]);
  check("soccer double_chance → double_chance", dc[0]?.marketType === "double_chance");
  check("soccer double_chance 1X → home_or_draw", dc[0]?.side === "home_or_draw");
  const dc2 = soccerFrame([{ sportsbook: "pinnacle", market_type: "double_chance", selection_type: "12", odds_american: -300, home_team: "Portugal", away_team: "DR Congo" }]);
  check("soccer double_chance 12 → home_or_away", dc2[0]?.side === "home_or_away");
}

// Unknown soccer market → dropped (not misclassified).
check(
  "soccer unknown market dropped",
  soccerFrame([{ sportsbook: "pinnacle", market_type: "correct_score", selection_type: "2-1", odds_american: 800, home_team: "Spain", away_team: "Japan" }]).length === 0,
);

// Soccer alternate total → flagged (no alt-line pollution downstream).
{
  const alt = soccerFrame([{ sportsbook: "pinnacle", market_type: "total_goals", selection_type: "over", line: 3.5, odds_american: 140, is_alternate_line: true, home_team: "Argentina", away_team: "Algeria" }]);
  check("soccer alt total → isAlternate true", alt[0]?.isAlternate === true);
}

// Soccer event missing team names → dropped (can't resolve, can't safely map sides).
check(
  "soccer without team names dropped",
  soccerFrame([{ sportsbook: "pinnacle", market_type: "moneyline", selection_type: "home", odds_american: 150 }]).length === 0,
);

// Soccer detected via league even if sport vocab differs.
{
  const out = adaptSharpWsMessage({ type: "odds:update", sport: "football", league: "fifa_world_cup_matches",
    data: [{ sportsbook: "betmgm", market_type: "moneyline", selection_type: "home", odds_american: 150, home_team: "Mexico", away_team: "Canada" }] });
  check("football sport vocab → soccer match_result", out[0]?.marketType === "match_result");
}

// REGRESSION GUARD: MLB "moneyline" must STILL be moneyline (not match_result).
{
  const mlb = adaptSharpWsMessage({ type: "odds:update", sport: "baseball", league: "mlb",
    data: [{ sportsbook: "draftkings", market_type: "moneyline", selection_type: "home", odds_american: -120, home_team: "New York Yankees", away_team: "Boston Red Sox" }] });
  check("MLB moneyline stays moneyline (not match_result)", mlb[0]?.marketType === "moneyline");
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
