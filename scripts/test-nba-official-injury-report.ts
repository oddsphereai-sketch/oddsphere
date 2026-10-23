import assert from "node:assert/strict";
import {
  __OFFICIAL_NBA_INJURIES_TEST__,
  fetchLatestOfficialNbaInjuryReport,
  parseOfficialNbaGameInjuries,
  selectLatestOfficialNbaReportUrl,
} from "../lib/services/nba/officialNbaInjuryReport";

const report = `
Injury Report: 10/23/26 02:00 PM
Page 1 of 2
Game Date Game Time Matchup Team Player Name Current Status Reason
10/23/2026 07:00 (ET) TOR@WAS Toronto Raptors Bittle, Nate Out Injury/Illness - Right Foot
Washington Wizards Okpara, Felix Questionable Injury/Illness - Illness
08:00 (ET) DET@MIA Detroit Pistons Harkless, Elijah Out G League - Two-Way
Jones, Isaac Out G League - Two-Way
Onyenso, Ugonna Out G League - Two-Way
Prince, Taurean Available Personal Reasons
Miami Heat Goldin, Vladislav Available Injury/Illness - Right Ankle Sprain
Smith, Dru Available Injury/Illness - Right Calf Strain
Injury Report: 10/23/26 02:00 PM
Page 2 of 2
09:30 (ET) HOU@SAS Houston Rockets Adams, Steven Questionable Injury/Illness - Right Calf
San Antonio Spurs Fox, De'Aaron Questionable Injury/Illness - Right Wrist
10/24/2026 06:00 (ET) MIA@CHA Miami Heat NOT YET SUBMITTED
Charlotte Hornets NOT YET SUBMITTED
`;

const parsed = parseOfficialNbaGameInjuries(report, "2026-10-23", "DET", "MIA");
assert(parsed, "exact report should parse");
assert.deepEqual(parsed.get("DET")?.map((player) => [player.name, player.status]), [
  ["Elijah Harkless", "out"],
  ["Isaac Jones", "out"],
  ["Ugonna Onyenso", "out"],
  ["Taurean Prince", "available"],
]);
assert.deepEqual(parsed.get("MIA")?.map((player) => [player.name, player.status]), [
  ["Vladislav Goldin", "available"],
  ["Dru Smith", "available"],
]);
assert.equal(parseOfficialNbaGameInjuries(report, "2026-10-24", "MIA", "CHA"), null);
assert.equal(parseOfficialNbaGameInjuries(report, "2026-10-23", "MIA", "DET"), null);
assert.equal(parseOfficialNbaGameInjuries(report, "2026-10-23", "DET", "BOS"), null);

const html = `
  <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_10_00AM.pdf">old</a>
  <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_02_00PM.pdf">latest</a>
  <a href="https://evil.example/Injury-Report_2026-10-23_09_00PM.pdf">untrusted</a>
`;
assert.equal(
  selectLatestOfficialNbaReportUrl(html, "2026-10-23"),
  "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_02_00PM.pdf",
);
assert.equal(__OFFICIAL_NBA_INJURIES_TEST__.reportDateInEastern("2026-10-24T00:30:00.000Z"), "2026-10-23");
assert.equal(__OFFICIAL_NBA_INJURIES_TEST__.seasonSlugForReportDate("2026-10-23"), "2026-27");
assert.equal(__OFFICIAL_NBA_INJURIES_TEST__.seasonSlugForReportDate("2027-01-02"), "2026-27");

async function main(): Promise<void> {
  let calls = 0;
  const fetched = await fetchLatestOfficialNbaInjuryReport("2026-10-23", {
    fetchImpl: async (input) => {
      calls++;
      const url = String(input);
      if (url.startsWith("https://official.nba.com/")) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      assert.equal(url, "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_02_00PM.pdf");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    },
    extractPdfText: async () => ({ text: report, totalPages: 2 }),
  });
  assert.equal(calls, 2);
  assert.equal(fetched?.reportDate, "2026-10-23");
  console.log("PASS: official NBA injury fallback exact-date/exact-match contract");
}

void main();
