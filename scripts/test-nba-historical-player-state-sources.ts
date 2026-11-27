import assert from "node:assert/strict";
import * as newer from "../lib/research/nba/nbaHistoricalPlayerStateSources";
import { bridgeNbaHistoricalPlayerIds, nbaHistoricalReportAdmittedAt, parseNbaHistoricalInjuryPages,
  parseNbaPdfCreationClock, splitNbaRosterColumns, verifyNbaHistoricalReportClock,
  type PdfCell, type PlayerIdentityFacts } from "../lib/research/nba/nbaHistoricalPlayerStateSources";

const original = { bytes: Buffer.from("%PDF-primary-fixture"), url: "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2023-10-24_05PM.pdf",
  text: "Injury   Report: 10/24/23 05:30 PM", creationDate: "D:20231024173002-04'00'", lastModified: "Tue, 24 Oct 2023 21:30:04 GMT", fetchedAt: "2026-11-20T22:00:00Z" };
const clock = verifyNbaHistoricalReportClock(original);
assert.equal(clock.sourceAvailableAt, "2023-10-24T21:30:04.000Z"); assert.equal(clock.fetchedAt, original.fetchedAt);
assert(!nbaHistoricalReportAdmittedAt(clock, "2023-10-24T21:30:00Z")); assert(nbaHistoricalReportAdmittedAt(clock, "2023-10-24T22:00:00Z"));
assert.equal(verifyNbaHistoricalReportClock({ ...original, fetchedAt: "2027-01-01T00:00:00Z" }).sourceAvailableAt, clock.sourceAvailableAt);
for (const change of [{ bytes: Buffer.from("<html>security check") }, { url: original.url.replace("nba.com", "example.com") },
  { url: original.url + "?date=2023" }, { text: original.text.replace("10/24/23", "10/25/23") },
  { text: original.text + " Injury Report: 10/24/23 06:30 PM" }, { creationDate: "D:20231024172959-04'00'" },
  { lastModified: "Tue, 24 Oct 2023 21:30:01 GMT" }, { fetchedAt: "2023-10-24T21:30:03Z" }]) assert.throws(() => verifyNbaHistoricalReportClock({ ...original, ...change }));
assert.throws(() => parseNbaPdfCreationClock("D:20230230123000Z")); assert.throws(() => parseNbaPdfCreationClock("D:20231024173000"));
assert.equal(parseNbaPdfCreationClock("D:20231024173002-04'00'"), Date.parse("2023-10-24T21:30:02Z"));
assert.throws(() => verifyNbaHistoricalReportClock({ ...original, url: original.url.replace("2023-10-24", "2023-11-05"), text: "Injury Report: 11/05/23 01:30 AM" }), /ambiguous/);

const facts = (playerId: number, firstName: string, lastName: string): PlayerIdentityFacts => ({ playerId, firstName, lastName,
  college: "Oregon State", country: "USA", draftYear: null, draftRound: null, draftNumber: null });
const son = facts(1, "Gary", "Payton II"), father = facts(2, "Gary", "Payton");
assert.equal(bridgeNbaHistoricalPlayerIds([son], [father, { ...son, playerId: 3 }]).mapped.get(1)?.nbaId, 3, "generation is identity evidence");
assert.equal(bridgeNbaHistoricalPlayerIds([son], [father]).mapped.size, 0);
assert.equal(bridgeNbaHistoricalPlayerIds([facts(1, "Craig", "Porter")], [facts(3, "Craig", "Porter Jr.")]).mapped.get(1)?.nbaId, 3);
assert.equal(bridgeNbaHistoricalPlayerIds([facts(1, "Craig", "Porter")], [facts(3, "Craig", "Porter Jr."), facts(4, "Craig", "Porter Sr.")]).mapped.size, 0);
assert.equal(bridgeNbaHistoricalPlayerIds([son], [{ ...son, playerId: 3, college: "Different" }]).mapped.size, 0);
assert.equal(bridgeNbaHistoricalPlayerIds([son], [{ ...son, playerId: 3 }, { ...son, playerId: 4 }]).mapped.size, 0);
assert.equal(bridgeNbaHistoricalPlayerIds([son, { ...son, playerId: 2 }], [{ ...son, playerId: 3 }]).mapped.size, 0);
const drafted = { ...son, draftYear: 2023, draftRound: 2, draftNumber: 58 };
assert.equal(bridgeNbaHistoricalPlayerIds([drafted], [{ ...drafted, playerId: 3, firstName: "Official variant" }]).mapped.get(1)?.nbaId, 3);

const merged = { text: "Thanasis Antetokounmpo Kyle Anderson", x: 144.05, y: 397.38, width: 168.5 };
const dictionary = new Set(["thanasisantetokounmpo", "kyleanderson"]);
assert.deepEqual(splitNbaRosterColumns(merged, dictionary).map(c => c.text), ["Thanasis Antetokounmpo", "Kyle Anderson"]);
assert.throws(() => splitNbaRosterColumns(merged, new Set()), /ambiguous_merged/);
assert.equal(merged.text, "Thanasis Antetokounmpo Kyle Anderson");

const cell = (text: string, x: number, y: number): PdfCell => ({ text, x, y });
const header = [cell("Game Date", 24, 480), cell("Game Time", 120, 480), cell("Matchup", 200, 480), cell("Team", 265, 480), cell("Player Name", 425, 480), cell("Current Status", 586, 480), cell("Reason", 667, 480)];
const first = [...header, cell("10/24/2023", 24, 450), cell("LAL@DEN", 200, 450), cell("Los Angeles Lakers", 265, 450),
  cell("Player, One", 425, 450), cell("Out", 586, 450), cell("Injury/Illness - Right Hamstring;", 667, 456), cell("Strain", 667, 444),
  cell("Player, Two", 425, 420), cell("Questionable", 586, 420), cell("Left Ankle;", 667, 420)];
const second = [cell("Injury Report: 10/24/23 05:30 PM", 289, 533), cell("Sprain", 667, 490), cell("Denver Nuggets", 265, 460), cell("NOT YET SUBMITTED", 425, 460)];
const report = parseNbaHistoricalInjuryPages([first, second]);
assert.equal(report.length, 2); assert.equal(report[0].players.length, 2); assert.equal(report[0].players[0].reason, "Injury/Illness - Right Hamstring; Strain");
assert.equal(report[0].players[1].reason, "Left Ankle; Sprain"); assert.equal(report[1].submitted, false); assert.equal(report[1].players.length, 0);
assert(!report[0].players.some(p => p.rawStatus === "Available"), "unlisted players are never synthesized as healthy");
assert.throws(() => parseNbaHistoricalInjuryPages([first, [cell("Los Angeles Lakers", 265, 460)]]), /duplicate_injury_team/);
assert.throws(() => parseNbaHistoricalInjuryPages([[...header, cell("Out", 586, 450)]]), /malformed/);
assert.throws(() => parseNbaHistoricalInjuryPages([[...header, cell("Unowned reason", 667, 450)]]), /orphan/);
console.log("Historical NBA primary clocks, real fetch-time preservation, cutoff/DST refusal, biographical identity/generations, merged roster columns, wrapped/page-continuation injuries and unknown-team refusal passed; no model fit or production access.");

// Explicit R2/R3 paths do not widen the original R1 host/parser contract.
const official = { ...original, url: original.url.replace("ak-static.cms.nba.com", "official.nba.com") };
assert.throws(() => verifyNbaHistoricalReportClock(official), /untrusted/);
assert.equal(newer.verifyNbaHistoricalReportClockV2(official).sourceAvailableAt, clock.sourceAvailableAt);
assert.throws(() => newer.verifyNbaHistoricalReportClockV2({ ...official, url: official.url.replace("official.nba.com", "official.nba.com.example.org") }), /untrusted/);
const timed = [...first, cell("07:30 (ET)", 120, 450)];
const withTimes = newer.parseNbaHistoricalInjuryPagesWithTimes([timed]);
assert.equal(withTimes[0]!.gameTime, "07:30(ET)");
assert(newer.nbaHistoricalPrintedTipMatches(withTimes[0]!, "2023-10-24T23:30:00Z"));
assert(!newer.nbaHistoricalPrintedTipMatches(withTimes[0]!, "2023-10-24T23:00:00Z"));
assert(!newer.nbaHistoricalPrintedTipMatches(withTimes[0]!, "2023-10-25T23:30:00Z"));
const rotated = timed.map(c => ({ ...c, x: c.y, y: c.x }));
assert.deepEqual(newer.parseNbaHistoricalInjuryPagesWithTimes([rotated.map(c => newer.nbaHistoricalViewportCell(c, [0, 1, 1, 0, 0, 0]))]), withTimes);
assert.deepEqual(parseNbaHistoricalInjuryPages([first, second]), report, "legacy parser remains exact");
