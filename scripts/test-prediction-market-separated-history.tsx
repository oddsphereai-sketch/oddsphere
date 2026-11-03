import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PredictionMarketUnavailable, RecordedSportsbookHistory } from "../app/lab/components/daily-edge/PredictionMarketPanel";
import { predictionMarketVisibleComparison, type PredictionMarketBookTrail } from "../app/lab/lib/predictionMarketDisplay";

// Realistic non-overlap: sportsbook last observed at 5:14; Kalshi starts
// at 5:25. Earlier -9.5 prices must never become prices for the -10 contract.
const at = (time: string) => Date.parse(`2026-10-31T${time}:00Z`);
const book: PredictionMarketBookTrail = {
  sportsbook: "betmgm", line: -10, locked: false,
  points: [[at("21:14"), 105 / 205, -105]],
  marketHistory: [[at("20:00"), -112, -9.5], [at("21:14"), -105, -10]],
};
const row = {
  asOf: new Date(at("21:55")).toISOString(),
  history: [[at("21:25"), .484, 1], [at("21:55"), .489, 2]] as [number, number, number][],
};
const original = JSON.stringify({ book, row });
const visible = predictionMarketVisibleComparison(row, book, undefined, true);
assert.equal(visible.standalone, true);
assert.equal(visible.shared, false);
assert.equal(visible.book, null, "the Kalshi plot cannot manufacture a shared book window");
const html = renderToStaticMarkup(<RecordedSportsbookHistory book={book} label="OKST −10" />);
assert.match(html, /data-recorded-sportsbook-history="betmgm"/);
assert.match(html, /data-sportsbook-line="betmgm"/);
assert.match(html, new RegExp(`data-observed-at="${at("21:14")}"`));
assert.doesNotMatch(html, /data-kalshi-line|data-book-odds="-112"|Shared chart window|NaN|Infinity/);
assert.match(html, /single quote/);
assert.equal(JSON.stringify({ book, row }), original);
const earlier = renderToStaticMarkup(<RecordedSportsbookHistory book={{...book,sportsbook:"draftkings"}} label="NAU +21.5" referenceFor="fanduel" />);
assert.match(earlier,/Earlier DraftKings history through/);
assert.match(earlier,/Current evaluated quote stays at FanDuel/);
assert.match(earlier,/data-recorded-sportsbook-history="draftkings"/);
assert.doesNotMatch(earlier,/data-recorded-sportsbook-history="fanduel"/);
const noKalshi = renderToStaticMarkup(<PredictionMarketUnavailable variant="mobile" label="NAU +21.5" status="contract_unavailable"
  book={{...book,sportsbook:"fanduel",line:21.5}} recordedReference={{...book,sportsbook:"draftkings",line:21.5}}
  currentBook="fanduel" kind="spread"/>);
assert.match(noKalshi,/data-prediction-market-mode="sportsbook-only"/);
assert.match(noKalshi,/data-recorded-sportsbook-history="draftkings"/);
assert.match(noKalshi,/Current evaluated quote stays at FanDuel/);
assert.doesNotMatch(noKalshi,/data-kalshi-line/);

// An additional source-only graph uses the exact frozen record, never live
// replacement odds, later observations or another threshold's price.
const boundary = at("22:00");
const locked: PredictionMarketBookTrail = {
  ...book, locked: true,
  points: [[at("20:45"), 110 / 210, -110], [at("21:14"), 105 / 205, -105]],
};
const lockedOriginal = JSON.stringify(locked);
const frozen = renderToStaticMarkup(<RecordedSportsbookHistory book={locked} label="OKST −10" lockedAt={boundary} />);
assert.match(frozen, /data-book-odds="-110"/);
assert.match(frozen, /data-book-odds="-105"/);
assert.equal(JSON.stringify(locked), lockedOriginal, "reader preserves every existing locked field");
const afterLock = renderToStaticMarkup(<RecordedSportsbookHistory book={{...locked, points: [...locked.points, [boundary + 1, .8, -400]]}} label="OKST −10" lockedAt={boundary} />);
assert.doesNotMatch(afterLock, /data-book-odds="-400"/);
const unprovableLock = renderToStaticMarkup(<RecordedSportsbookHistory book={locked} label="OKST −10" lockedAt={NaN} />);
assert.doesNotMatch(unprovableLock, /data-sportsbook-line/);
console.log("Separated sportsbook history: non-overlap, exact line, source timestamps and frozen record precedence passed.");
