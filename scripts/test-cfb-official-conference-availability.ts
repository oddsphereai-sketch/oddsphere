import assert from "node:assert/strict";
import {
  CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS,
  extractFaktorEmbedUrl,
  fetchCfbOfficialConferenceAvailability,
  parseCfbFaktorAvailability,
  parseCfbOfficialConferenceAvailability,
  parseCfbOfficialJsonAvailability,
} from "../lib/services/football/cfbOfficialConferenceAvailability";
import { buildCfbGameAvailability } from "../lib/services/football/cfbGameAvailability";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

async function main(): Promise<void> {
const mountainWestGame = game("mw-1", "UNLV", "UNLV", "Air Force", "AFA", "2026-10-17T19:30:00.000Z");
const sunBeltGame = game("sb-1", "Georgia State", "GAST", "James Madison", "JMU", "2026-10-17T16:00:00.000Z");
const southAlabamaGame = game("sb-live", "South Alabama Jaguars", "USA", "Marshall Thundering Herd", "MRSH", "2026-10-20T23:30:00.000Z");
const cusaGame = game("cusa-live", "New Mexico State Aggies", "NMSU", "Sam Houston Bearkats", "SHSU", "2026-10-22T00:00:00.000Z");
const americanGame = game("aac-1", "Florida Atlantic", "FAU", "Army", "ARMY", "2026-10-17T16:00:00.000Z");

const json = parseCfbOfficialJsonAvailability({
  games: [sunBeltGame],
  capturedAt: "2026-10-17T12:00:00.000Z",
  sourceUrl: "https://sunbeltsports.org/report",
  json: {
    games: [{
      dateISO: "2026-10-17",
      updatedAtUTC: "2026-10-16T20:00:00Z",
      away: { name: "Georgia State", players: [{ name: "Ryan Green", position: "ILB", status: "Out" }] },
      home: { name: "James Madison", players: [{ name: "Healthy Player", position: "QB", status: "Available" }] },
    }],
  },
});
assert.equal(json["sb-1"]?.teams[0]?.players[0]?.name, "Ryan Green");
assert.equal(json["sb-1"]?.teams[1]?.players.length, 0, "available rows must not become injuries");

const liveSunBeltArgs = {
  games: [southAlabamaGame],
  capturedAt: "2026-10-20T11:00:00.000Z",
  sourceUrl: "https://sunbeltsports.org/report",
  json: {
    games: [{
      dateISO: "2026-10-20",
      updatedAtUTC: "2026-10-18T00:04:55.361Z",
      away: { name: "South Alabama", players: [{ name: "Jay Jaguar", position: "WR", status: "Questionable" }] },
      home: { name: "Marshall", players: [{ name: "Marco Herd", position: "LB", status: "Out" }] },
    }],
  },
};
const liveSunBelt = parseCfbOfficialJsonAvailability(liveSunBeltArgs);
assert.equal(liveSunBelt["sb-live"]?.teams[0]?.players[0]?.name, "Jay Jaguar", "school-only labels must match mascot-bearing schedule names");

const faktorHtml = `
<article class="availability-graphic-card" data-availability-graphic-card="true" aria-label="UNLV @ Air Force Initial Report">
  <div data-kickoff-at="2026-10-17 19:30:00" data-local-time-zone="America/New_York"></div>
  <div data-updated-at="2026-10-15 21:28:38" data-local-time-zone="America/New_York"></div>
  <div class="availability-team-table" aria-label="UNLV availability"><table>
    <tbody class="availability-status-section"><tr class="status-section-heading-row"><th class="status-section-heading"><span>QUESTIONABLE</span></th></tr>
      <tr class="availability-player-row"><td class="player-cell">Jai&#39;Den Thomas</td><td class="position-cell">RB</td></tr>
    </tbody></table></div>
  <div class="availability-team-table" aria-label="Air Force availability"><table>
    <tbody class="availability-status-section"><tr class="status-section-heading-row"><th class="status-section-heading"><span>OUT (GAME)</span></th></tr>
      <tr class="availability-player-row"><td class="player-cell">Liam Szarka</td><td class="position-cell">QB</td></tr>
    </tbody></table></div>
</article>`;
const faktor = parseCfbFaktorAvailability({ html: faktorHtml, games: [mountainWestGame], capturedAt: "2026-10-17T12:00:00.000Z", sourceUrl: "https://themw.com/report" });
assert.equal(faktor["mw-1"]?.reportUpdatedAt, "2026-10-15T21:28:38.000Z", "Faktor timestamps are UTC wall values");
assert.equal(faktor["mw-1"]?.teams[0]?.players[0]?.name, "Jai'Den Thomas");
assert.equal(faktor["mw-1"]?.teams[1]?.players[0]?.status, "OUT (GAME)");

const cusaSectionHtml = `
<section class="availability-graphic-card" data-availability-graphic-card="true" aria-label="NM State @ Sam Houston Initial Report">
  <div data-kickoff-at="2026-10-22 00:00:00" data-local-time-zone="UTC"></div>
  <div data-updated-at="2026-10-20 12:00:00" data-local-time-zone="UTC"></div>
  <div class="availability-team-table" aria-label="NM State availability"><table>
    <tbody class="availability-status-section"><tr class="status-section-heading-row"><th class="status-section-heading"><span>QUESTIONABLE</span></th></tr>
      <tr class="availability-player-row"><td class="player-cell">Aggie Quarterback</td><td class="position-cell">QB</td></tr>
    </tbody></table></div>
  <div class="availability-team-table" aria-label="Sam Houston availability"><table>
    <tbody class="availability-status-section"><tr class="status-section-heading-row"><th class="status-section-heading"><span>OUT</span></th></tr>
      <tr class="availability-player-row"><td class="player-cell">Bearkat Receiver</td><td class="position-cell">WR</td></tr>
    </tbody></table></div>
</section>`;
const cusa = parseCfbFaktorAvailability({ html: cusaSectionHtml, games: [cusaGame], capturedAt: "2026-10-20T12:00:00.000Z", sourceUrl: "https://conferenceusa.com/report" });
assert.equal(cusa["cusa-live"]?.teams[0]?.players[0]?.name, "Aggie Quarterback", "Faktor section containers and the NM State label must parse");

const hdi = parseCfbOfficialConferenceAvailability({
  games: [americanGame],
  capturedAt: "2026-10-17T12:00:00.000Z",
  sourceUrl: "https://theamerican.org/report",
  json: {
    current: {
      ReportType: "Initial",
      conferenceTimeZone: "ET",
      publishDate: "2026-10-17",
      postedTime: "07:30:00",
      footer: { date: "2026-10-17" },
      games: [
        { teamDisplayName: "Florida Atlantic Owls", rows: [{ name: "QB #8 Alex Able", status: "Questionable" }] },
        { teamDisplayName: "Army Black Knights", rows: [] },
      ],
    },
    pending: { ReportType: "Report Pending", footer: { date: "2026-10-17" }, games: [] },
  },
});
assert.equal(hdi["aac-1"]?.teams[0]?.players[0]?.position, "QB");

const clear = parseCfbOfficialJsonAvailability({
  games: [sunBeltGame],
  capturedAt: "2026-10-17T13:00:00.000Z",
  sourceUrl: "https://sunbeltsports.org/report",
  json: { games: [{ dateISO: "2026-10-17", updatedAtUTC: "2026-10-17T13:00:00Z", away: { name: "Georgia State", players: [] }, home: { name: "James Madison", players: [] } }] },
})["sb-1"]!;
assert.equal(buildCfbGameAvailability({ game: sunBeltGame, capturedAt: "2026-10-17T13:00:00.000Z", playbookRows: [], conferenceReport: clear })?.teams.every((team) => team.players.length === 0), true, "published clear reports must remain verified evidence");
assert.equal(parseCfbOfficialJsonAvailability({ ...{ games: [sunBeltGame], capturedAt: "2026-10-17T12:00:00.000Z", sourceUrl: "x" }, json: { games: [{ dateISO: "2026-10-18", away: { name: "Georgia State", players: [] }, home: { name: "James Madison", players: [] } }] } })["sb-1"], undefined, "wrong-date reports must fail closed");

assert.equal(extractFaktorEmbedUrl('<iframe src="https://faktorsports.com/k/embed/player-availability/full/MountainWest/11/MFB/2026?signature=a&amp;b=c"></iframe>'), "https://faktorsports.com/k/embed/player-availability/full/MountainWest/11/MFB/2026?signature=a&b=c");
assert.throws(() => extractFaktorEmbedUrl("<html></html>"), /faktor_embed_count_0/);

let requests = 0;
const integrated = await fetchCfbOfficialConferenceAvailability({
  games: [americanGame, sunBeltGame, mountainWestGame],
  capturedAt: "2026-10-17T12:00:00.000Z",
  fetchImpl: async (input, init) => {
    requests += 1;
    const url = String(input);
    if (url.includes("hdintelligence")) {
      const organization = JSON.parse(String(init?.body)).organization as string;
      return Response.json(organization === "American" ? {
        report: { ReportType: "Initial", conferenceTimeZone: "ET", publishDate: "2026-10-17", postedTime: "07:30:00", footer: { date: "2026-10-17" }, games: [{ teamDisplayName: "Florida Atlantic", rows: [{ name: "QB #8 Alex Able", status: "Questionable" }] }, { teamDisplayName: "Army", rows: [] }] },
      } : {});
    }
    if (url.includes("sunbelt-football")) return Response.json({ games: [{ dateISO: "2026-10-17", updatedAtUTC: "2026-10-16T20:00:00Z", away: { name: "Georgia State", players: [{ name: "Ryan Green", status: "Out" }] }, home: { name: "James Madison", players: [] } }] });
    if (url.includes("pac12-football")) return Response.json({ games: [] });
    if (url.includes("themw.com")) return new Response('<iframe src="https://faktorsports.com/k/embed/player-availability/full/MountainWest/11/MFB/2026?signature=mw"></iframe>');
    if (url.includes("conferenceusa.com")) return new Response('<iframe src="https://faktorsports.com/k/embed/player-availability/graphics/CUSA/11/MFB/2026/current?signature=cusa"></iframe>');
    if (url.includes("MountainWest")) return new Response(faktorHtml);
    if (url.includes("CUSA")) return new Response('<article class="availability-graphic-card graphics-empty-card" data-availability-graphic-card="true"></article>');
    return new Response("not found", { status: 404 });
  },
});
assert.equal(requests, CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS);
assert.equal(integrated.requests, CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS);
assert.deepEqual(Object.keys(integrated.reportsByGame).sort(), ["aac-1", "mw-1", "sb-1"]);
assert.deepEqual(integrated.failures, []);

console.log("CFB official conference availability source coverage tests passed.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

function game(providerGameId: string, awayName: string, awayAbbreviation: string, homeName: string, homeAbbreviation: string, scheduledStart: string): NcaafGame {
  return {
    providerGameId,
    providerWeek: 8,
    season: 2026,
    scheduledStart,
    status: "scheduled",
    awayScore: null,
    homeScore: null,
    away: { id: 1, conferenceId: null, abbreviation: awayAbbreviation, name: awayName, fbs: true },
    home: { id: 2, conferenceId: null, abbreviation: homeAbbreviation, name: homeName, fbs: true },
  };
}
