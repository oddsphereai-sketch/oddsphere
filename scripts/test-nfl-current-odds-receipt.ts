import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE,
  fetchBalldontlieNflRegularSlate,
} from "../lib/services/football/balldontlieNflPreviewSlate";

const currentFinishedAt = "2026-11-02T14:00:00.000Z";
const firstRequestStartedAt = "2026-11-02T13:58:30.000Z";
const earlyPageFinishedAt = "2026-11-02T13:59:00.000Z";
const delayedOpeningFinishedAt = "2026-11-02T14:10:00.000Z";
const providerQuoteAt = "2026-11-02T13:55:17.123Z";
const providerOpeningAt = "2026-11-01T12:00:00.000Z";
const schedule = {
  id: 1392336, season: 2026, week: 8, date: "2026-11-03T01:15:00.000Z", status_state: "scheduled",
  visitor_team: { id: 1, abbreviation: "CHI", full_name: "Chicago Bears" },
  home_team: { id: 2, abbreviation: "SEA", full_name: "Seattle Seahawks" },
};
const quote = {
  game_id: 1392336, vendor: "DraftKings", updated_at: providerQuoteAt,
  moneyline_away_odds: 145, moneyline_home_odds: -170,
  spread_away_value: 3, spread_home_value: -3, spread_away_odds: -110, spread_home_odds: -110,
  total_value: 46.5, total_over_odds: -110, total_under_odds: -110,
};

async function capture(openingFinishedAt: string, paginatedCurrent = false, captureRawPriceManifest = false) {
  let virtualNow = firstRequestStartedAt;
  const requests: string[] = [];
  const clockReads: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requests.push(`${url.pathname}${url.searchParams.has("cursor") ? `?cursor=${url.searchParams.get("cursor")}` : ""}`);
    let data: unknown[];
    let nextCursor: string | null = null;
    if (url.pathname.endsWith("/games")) {
      data = [schedule];
    } else if (url.pathname.endsWith("/odds/opening")) {
      assert.equal(virtualNow, currentFinishedAt, "opening history starts after all current odds pages finish");
      virtualNow = openingFinishedAt;
      const { updated_at: _providerCurrentAt, ...openingQuote } = quote;
      data = [{ ...openingQuote, opened_at: providerOpeningAt }];
    } else if (url.pathname.endsWith("/odds")) {
      const firstPage = paginatedCurrent && !url.searchParams.has("cursor");
      virtualNow = firstPage ? earlyPageFinishedAt : currentFinishedAt;
      data = [{ ...quote, vendor: firstPage ? "FanDuel" : "DraftKings" }];
      nextCursor = firstPage ? "current-page-2" : null;
    } else {
      throw new Error(`Unexpected mocked provider endpoint: ${url.pathname}`);
    }
    return new Response(JSON.stringify({ data, meta: { next_cursor: nextCursor } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const slate = await fetchBalldontlieNflRegularSlate({
    season: 2026, week: 8, apiKey: "receipt-test", fetchImpl, captureRawPriceManifest,
    clock: () => { clockReads.push(virtualNow); return virtualNow; },
  });
  return { slate, requests, clockReads };
}

async function main() {
  assert.equal(BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE,
    "balldontlie_nfl_regular_slate_2026_11_02_r5_current_quote_receipt");
  for (const paginated of [false, true]) {
    const delayed = await capture(delayedOpeningFinishedAt, paginated);
    const immediate = await capture(currentFinishedAt, paginated);
    assert.equal(delayed.slate.currentOddsFetchedAt, currentFinishedAt,
      "a slow opening-history response cannot move the current quote's receipt forward");
    assert.equal(delayed.slate.fetchedAt, delayedOpeningFinishedAt,
      "the aggregate slate receipt still truthfully records completion of the entire collection");
    assert.deepEqual(delayed.clockReads, paginated
      ? [firstRequestStartedAt, earlyPageFinishedAt, earlyPageFinishedAt, currentFinishedAt, delayedOpeningFinishedAt]
      : [firstRequestStartedAt, currentFinishedAt, delayedOpeningFinishedAt]);
    assert.equal(delayed.slate.providerRequests, paginated ? 4 : 3);
    assert.equal(immediate.slate.providerRequests, delayed.slate.providerRequests,
      "recording the receipt adds no provider fetch or synthetic reobservation");
    assert.deepEqual(immediate.requests, delayed.requests);
    assert.deepEqual(delayed.slate.currentOddsAllBooksByGame, immediate.slate.currentOddsAllBooksByGame,
      "opening latency cannot mutate any original current quote, price, line, book or provider timestamp");
    assert.equal(immediate.slate.currentOddsFetchedAt, currentFinishedAt);
    for (const book of delayed.slate.currentOddsAllBooksByGame["1392336"] ?? []) {
      assert.equal(book.observedAt, providerQuoteAt,
        "source updated_at remains the provider observation, distinct from both receipt clocks");
      assert.notEqual(book.observedAt, delayed.slate.currentOddsFetchedAt);
      assert.notEqual(book.observedAt, delayed.slate.fetchedAt);
      assert.equal(book.availableAt, paginated && book.sportsbook === "FanDuel" ? earlyPageFinishedAt : currentFinishedAt,
        "each executable book retains its own exact page receipt, not the later page or opening-history completion");
      assert.equal(book.requestedAt, paginated && book.sportsbook === "DraftKings" ? earlyPageFinishedAt : firstRequestStartedAt,
        "each executable book retains when its own provider request began");
      assert.ok(Date.parse(book.requestedAt!) <= Date.parse(book.availableAt!),
        "request windows cannot end before they begin");
    }
    if (paginated) {
      assert.equal(delayed.slate.currentOddsByGame["1392336"]?.sportsbook, "FanDuel");
      assert.equal(delayed.slate.currentOddsByGame["1392336"]?.availableAt, earlyPageFinishedAt,
        "representative selection cannot refresh an early page's execution availability");
      assert.equal(delayed.slate.currentOddsByGame["1392336"]?.requestedAt, firstRequestStartedAt,
        "representative selection cannot relabel the earlier page's request start");
      assert.deepEqual(Object.fromEntries(delayed.slate.currentOddsComparableBooksByGame["1392336"]!
        .map((book) => [book.sportsbook, book.availableAt])),
      { FanDuel: earlyPageFinishedAt, DraftKings: currentFinishedAt },
      "both executable comparison books retain separate page receipts");
      assert.deepEqual(Object.fromEntries(delayed.slate.currentOddsComparableBooksByGame["1392336"]!
        .map((book) => [book.sportsbook, { requestedAt: book.requestedAt, availableAt: book.availableAt }])),
      { FanDuel: { requestedAt: firstRequestStartedAt, availableAt: earlyPageFinishedAt },
        DraftKings: { requestedAt: earlyPageFinishedAt, availableAt: currentFinishedAt } },
      "later pages and opening history cannot overwrite an earlier quote's actual request window");
      const secondPage = delayed.slate.currentOddsComparableBooksByGame["1392336"]!
        .find((book) => book.sportsbook === "DraftKings")!;
      const interveningMoveAt = Date.parse("2026-11-02T13:59:30.000Z");
      assert.ok(Date.parse(secondPage.requestedAt!) < interveningMoveAt &&
        Date.parse(secondPage.availableAt!) > interveningMoveAt,
      "a response arriving after a move still truthfully records a request that began before it");
    }
    assert.equal(delayed.slate.openingOddsByGame["1392336"]?.observedAt, providerOpeningAt,
      "the original opening timestamp is not replaced by collection completion");
  }
  const manifested = await capture(delayedOpeningFinishedAt, true, true);
  const manifestless = await capture(delayedOpeningFinishedAt, true, false);
  const manifests = manifested.slate.rawPriceResponseManifests;
  assert.ok(manifests, "explicit raw-manifest capture must return its bounded source evidence");
  assert.equal(manifests.current.providerFetchedAt, currentFinishedAt,
    "the optional current manifest uses current completion, not the later opening-history clock");
  assert.equal(manifests.opening.providerFetchedAt, delayedOpeningFinishedAt,
    "the opening manifest retains its own completion clock");
  for (const observation of manifests.current.observationsByGame["1392336"] ?? []) {
    assert.equal(observation.providerObservedAt, providerQuoteAt,
      "adding receipt provenance cannot replace provider observation timestamps in raw evidence");
    assert.equal(observation.providerFetchedAt, currentFinishedAt);
  }
  assert.deepEqual(manifested.requests, manifestless.requests,
    "optional receipt manifests add no provider request");
  assert.deepEqual(manifested.slate.currentOddsAllBooksByGame, manifestless.slate.currentOddsAllBooksByGame,
    "enabling raw provenance cannot change executable quotes or their per-page availability");
  const writer = readFileSync("lib/services/football/nflForwardEvidenceWriter.ts", "utf8");
  assert.match(writer, /executionAvailableAt:\s*slate\.currentOddsFetchedAt/,
    "the market runtime must receive the current-only receipt rather than aggregate slate completion");
  assert.doesNotMatch(writer, /executionAvailableAt:\s*slate\.fetchedAt/,
    "later opening-history completion cannot authorize a nonexistent later execution observation");
  console.log("NFL current odds receipt: exact page request/response windows, opening14:10, source clocks, request parity and writer binding passed");
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
