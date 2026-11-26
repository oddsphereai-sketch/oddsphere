import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitNbaOriginalPriorGamebook, parseNbaOriginalFinalBox, verifyNbaOriginalGamebook } from "../lib/research/nba/nbaHistoricalGamebook";

const player = (i: number, home: boolean) => `${i} Player ${String.fromCharCode(65 + i)} ${i === 1 ? "C" : i < 4 ? "F" : "G"} 48:00 4 8 0 2 ${!home && i === 1 ? "0 0" : "2 2"} 1 3 4 2 2 1 1 1 ${home ? "2" : "-2"} ${!home && i === 1 ? "8" : "10"}`;
const header = "NATIONAL BASKETBALL ASSOCIATION OFFICIAL SCORER'S REPORT\nFINAL BOX\nTuesday, October 24, 2023\n";
const firstPageText = header + "VISITOR: Los Angeles Lakers (0-1)\n" + Array.from({ length: 5 }, (_, i) => player(i + 1, false)).join("\n") +
  "\n6 Bench Player DNP - Coach's Decision\n240:00 20 40 0 10 8 8 5 15 20 10 10 5 5 5 -2 48\nHOME: DENVER NUGGETS (1-0)\n" + Array.from({ length: 5 }, (_, i) => player(i + 1, true)).join("\n") +
  "\n240:00 20 40 0 10 10 10 5 15 20 10 10 5 5 5 2 50\nSCORE BY PERIOD\n";
const parsed = parseNbaOriginalFinalBox(firstPageText);
assert.equal(parsed.away.players.length, 5); assert.equal(parsed.away.didNotPlay[0].designation, "DNP - Coach's Decision");
assert.equal(parsed.home.players.reduce((n, p) => n + p.seconds, 0), 14400); assert.equal(parsed.home.counts.pts, 50);
assert.equal(parsed.fullGameContributionDenominator, 98); assert.equal(parsed.home.players[0].boxContribution, 10);
assert.equal(parsed.home.players[0].fullGameContributionShare, 10 / 98);
assert(!("pie" in parsed.home.players[0]), "full-game share is not on-court player PIE");
assert.deepEqual(parseNbaOriginalFinalBox(firstPageText.replace("VISITOR: ", "").replace("HOME: ", "")), parsed, "neutral-site headings preserve orientation");
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("FINAL BOX", "1st QUARTER ONLY")), /not_original_final/);
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("48:00", "47:00")), /incomplete_original_rotation/);
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("-2 48", "-2 49")), /incoherent_original_box/);
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("4 8 0 2", "4 8 2 1")), /incoherent_original_box/);
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("5 Player F G", "5 Player F X")), /unparsed_original|incomplete_original_rotation/);
assert.throws(() => parseNbaOriginalFinalBox(firstPageText.replace("Player B C", "Player C C")), /duplicate_original_box_identity/);
const repeatedJersey = parseNbaOriginalFinalBox(firstPageText.replace("2 Player C", "1 Player C"));
assert.deepEqual(repeatedJersey.away.repeatedJerseys, ["1"], "jersey alone never establishes identity");

const bytes = Buffer.from("%PDF-original-test"), sha256 = createHash("sha256").update(bytes).digest("hex");
const receipt = { bytes, sha256, firstPageText, url: "https://statsdmz.nba.com/pdfs/20231024/20231024_LALDEN_book.pdf", creationDate: "D:20231024215847-04'00'",
  lastModified: "Wed, 25 Oct 2023 01:58:47 GMT", fetchedAt: "2026-11-21T13:00:00Z", gameId: 10, startAt: "2023-10-24T23:30:00Z", away: "LAL", home: "DEN" };
const book = verifyNbaOriginalGamebook(receipt); assert.equal(book.sourceAvailableAt, "2023-10-25T01:58:47.000Z"); assert.equal(book.fetchedAt, receipt.fetchedAt);
assert(admitNbaOriginalPriorGamebook(book, { gameId: 11, cutoff: "2023-10-26T22:00:00Z" }));
assert(!admitNbaOriginalPriorGamebook(book, { gameId: 10, cutoff: "2023-10-26T22:00:00Z" }), "target outcomes remain excluded even after final");
assert(!admitNbaOriginalPriorGamebook(book, { gameId: 11, cutoff: "2023-10-25T01:58:46Z" }));
for (const change of [{ sha256: "0".repeat(64) }, { url: receipt.url.replace("nba.com", "example.com") }, { firstPageText: firstPageText.replace("Los Angeles Lakers", "Boston Celtics") },
  { home: "LAL" }, { url: receipt.url.replaceAll("20231024", "20231025") }, { fetchedAt: "2023-10-25T01:58:46Z" }, { creationDate: "D:20231024215849-04'00'" }]) assert.throws(() => verifyNbaOriginalGamebook({ ...receipt, ...change }));
const revised = verifyNbaOriginalGamebook({ ...receipt, creationDate: "D:20250702214841Z", lastModified: "Wed, 02 Jul 2025 21:48:42 GMT" });
assert(!admitNbaOriginalPriorGamebook(revised, { gameId: 11, cutoff: "2025-01-26T22:00:00Z" }), "an old URL cannot backdate a later regenerated document");
assert.equal(JSON.stringify(verifyNbaOriginalGamebook(receipt)), JSON.stringify(book));
console.log("Original NBA gamebook: exact seconds/team counts/contribution scope, neutral roles, DNP preservation, jersey ambiguity, original body/clock/team binding, later regeneration and target/post-cutoff refusal passed; no model fit or production IO.");
