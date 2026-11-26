import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bridgeNbaHistoricalPlayerIds } from "../lib/research/nba/nbaHistoricalPlayerStateSources";
import { readNbaOfficialBiographicalFacts, readNbaPrimaryNativeNameLinks, resolveNba2023OpeningRosterSpelling } from "../lib/research/nba/nbaHistoricalIdentity";
const headers = ["PERSON_ID", "FIRST_NAME", "LAST_NAME", "SCHOOL", "COUNTRY", "DRAFT_YEAR", "DRAFT_ROUND", "DRAFT_NUMBER", "TEAM_ID", "PTS"];
const payload = { parameters: [{ PlayerID: 1641777 }, { LeagueID: "00" }], resultSets: [{ name: "CommonPlayerInfo", headers,
  rowSet: [[1641777, "Charles", "Bediako", "Alabama", "Canada", "Undrafted", "Undrafted", "Undrafted", 0, 0]] }] };
const args = (p: unknown) => { const bytes = Buffer.from(JSON.stringify(p)); return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), url: "https://stats.nba.com/stats/commonplayerinfo?PlayerID=1641777&LeagueID=00", nbaPlayerId: 1641777 }; };
const result = readNbaOfficialBiographicalFacts(args(payload));
assert.equal(result.facts.playerId, 1641777); assert.equal(result.facts.draftYear, null); assert.equal(result.facts.college, "Alabama");
const changed = structuredClone(payload); changed.resultSets[0].rowSet[0][8] = 99999; changed.resultSets[0].rowSet[0][9] = 1000000;
assert.deepEqual(readNbaOfficialBiographicalFacts(args(changed)).facts, result.facts, "current team/performance never changes historical biographical identity");
const bdl = { ...result.facts, playerId: 56677865 };
assert.equal(bridgeNbaHistoricalPlayerIds([bdl], [result.facts]).mapped.get(bdl.playerId)?.nbaId, 1641777);
assert.equal(bridgeNbaHistoricalPlayerIds([{ ...bdl, college: null }], [result.facts]).mapped.size, 0, "a native biography cannot fill missing other-provider facts by name alone");
assert.throws(() => readNbaOfficialBiographicalFacts({ ...args(payload), sha256: "0".repeat(64) }), /unverified/);
assert.throws(() => readNbaOfficialBiographicalFacts({ ...args(payload), nbaPlayerId: 123 }), /unverified/);
const wrong = structuredClone(payload); wrong.resultSets[0].rowSet[0][0] = 1;
assert.throws(() => readNbaOfficialBiographicalFacts(args(wrong)), /missing_native/);
const duplicate = structuredClone(payload); duplicate.resultSets[0].rowSet.push(duplicate.resultSets[0].rowSet[0]);
assert.throws(() => readNbaOfficialBiographicalFacts(args(duplicate)), /ambiguous/);
const echoed = structuredClone(payload); echoed.parameters[0].PlayerID = 12;
assert.throws(() => readNbaOfficialBiographicalFacts(args(echoed)), /query_mismatch/);
const html = Buffer.from('<a href="https://www.nba.com/player/1631466/jeenathan-williams/">Jeenathan Williams</a><a href="https://example.com/player/1/wrong/">Wrong Person</a>');
const linkArgs = { bytes: html, sha256: createHash("sha256").update(html).digest("hex"), url: "https://www.nba.com/news/nba-player-movement-2023" };
assert.deepEqual(readNbaPrimaryNativeNameLinks(linkArgs).map(p => [p.nbaPlayerId, p.sourceDisplayName]), [[1631466, "Jeenathan Williams"]]);
assert.throws(() => readNbaPrimaryNativeNameLinks({ ...linkArgs, url: "https://example.com/news/nba-player-movement-2023" }), /unverified/);
const url = "https://www.nba.com/bucks/news/milwaukee-bucks-sign-chris-livingston", pageObject = { permalink: url, status: "publish", date: "2023-07-10T16:14:42Z", title: "Milwaukee Bucks sign Chris Livingston",
  contentExpanded: ["Selected 58th overall pick in the 2023 NBA Draft from Kentucky."] };
const articleBytes = Buffer.from('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { pageObject } } }) + "</script>");
const spelling = { rosterPdfSha256: "c122900f6a322dc7aac4aa5d1096d185e652bd439d79595106bc35eb130178f7", team: "MIL", sourceDisplayName: "Chis Livingston",
  nativeFacts: { playerId: 1641753, firstName: "Chris", lastName: "Livingston", college: "Kentucky", country: "USA", draftYear: 2023, draftRound: 2, draftNumber: 58 },
  article: { bytes: articleBytes, sha256: createHash("sha256").update(articleBytes).digest("hex"), url } };
const annotation = resolveNba2023OpeningRosterSpelling(spelling);
assert.equal(annotation?.sourceDisplayName, "Chis Livingston"); assert.equal(annotation?.canonicalDisplayName, "Chris Livingston"); assert.equal(annotation?.sourceSpellingPreserved, true);
assert.equal(resolveNba2023OpeningRosterSpelling({ ...spelling, team: "NYK" }), null);
assert.equal(resolveNba2023OpeningRosterSpelling({ ...spelling, rosterPdfSha256: "0".repeat(64) }), null);
assert.equal(resolveNba2023OpeningRosterSpelling({ ...spelling, nativeFacts: { ...spelling.nativeFacts, draftNumber: 57 } }), null);
assert.throws(() => resolveNba2023OpeningRosterSpelling({ ...spelling, article: { ...spelling.article, sha256: "0".repeat(64) } }), /unverified/);
console.log("NBA native biographies: source/body/query/row binding, never-played identity recovery, team/stat mutation invariance and incomplete cross-provider refusal passed; no historical availability or live model authority.");
