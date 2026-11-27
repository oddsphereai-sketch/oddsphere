import { createHash } from "node:crypto";
import { parseNbaPdfCreationClock } from "./nbaHistoricalPlayerStateSources";

export const NBA_HISTORICAL_GAMEBOOK_RELEASE = "nba_historical_gamebook_2026_11_21_r2_original_box_scope" as const;
const fields = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "pf", "stl", "tov", "blk", "plusMinus", "pts"] as const;
type Counts = Record<typeof fields[number], number>;
export type NbaOriginalBoxPlayer = Counts & { jersey: string; sourceName: string; seconds: number; starter: boolean; boxContribution: number; fullGameContributionShare: number };
export type NbaOriginalBoxTeam = { sourceTeamName: string; seconds: number; counts: Counts; players: NbaOriginalBoxPlayer[]; repeatedJerseys: string[];
  didNotPlay: { jersey: string; sourceName: string; designation: string }[] };
const teamNames: Readonly<Record<string, readonly string[]>> = { ATL: ["ATLANTA HAWKS"], BOS: ["BOSTON CELTICS"], BKN: ["BROOKLYN NETS"], CHA: ["CHARLOTTE HORNETS"], CHI: ["CHICAGO BULLS"], CLE: ["CLEVELAND CAVALIERS"], DAL: ["DALLAS MAVERICKS"], DEN: ["DENVER NUGGETS"], DET: ["DETROIT PISTONS"], GSW: ["GOLDEN STATE WARRIORS"], HOU: ["HOUSTON ROCKETS"], IND: ["INDIANA PACERS"], LAC: ["LA CLIPPERS", "LOS ANGELES CLIPPERS"], LAL: ["LOS ANGELES LAKERS"], MEM: ["MEMPHIS GRIZZLIES"], MIA: ["MIAMI HEAT"], MIL: ["MILWAUKEE BUCKS"], MIN: ["MINNESOTA TIMBERWOLVES"], NOP: ["NEW ORLEANS PELICANS"], NYK: ["NEW YORK KNICKS"], OKC: ["OKLAHOMA CITY THUNDER"], ORL: ["ORLANDO MAGIC"], PHI: ["PHILADELPHIA 76ERS"], PHX: ["PHOENIX SUNS"], POR: ["PORTLAND TRAIL BLAZERS"], SAC: ["SACRAMENTO KINGS"], SAS: ["SAN ANTONIO SPURS"], TOR: ["TORONTO RAPTORS"], UTA: ["UTAH JAZZ"], WAS: ["WASHINGTON WIZARDS"] };
const instant = (v: string) => { const n = Date.parse(v); if (!Number.isFinite(n)) throw Error("invalid_gamebook_clock"); return n; };
function seconds(value: string) { const [m, s] = value.split(":").map(Number); if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s >= 60) throw Error("invalid_original_minutes"); return m * 60 + s; }
function counts(text: string): Counts {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== fields.length || values.some((n, i) => !Number.isSafeInteger(n) || i !== 14 && n < 0)) throw Error("invalid_original_box_counts");
  const c = Object.fromEntries(fields.map((f, i) => [f, values[i]])) as Counts;
  if (c.fgm > c.fga || c.fg3m > c.fg3a || c.ftm > c.fta || c.fg3m > c.fgm || c.reb !== c.oreb + c.dreb || c.pts !== 2 * c.fgm + c.fg3m + c.ftm) throw Error("incoherent_original_box_counts");
  return c;
}
// The glossary's box contribution numerator. The first page does not establish
// each player's on-court denominator: full-game contribution share MUST NOT be
// presented as the provider's player PIE or passed to the rotation ledger.
const contribution = (c: Counts) => c.pts + c.fgm + c.ftm - c.fga - c.fta + c.dreb + .5 * c.oreb + c.ast + c.stl + .5 * c.blk - c.pf - c.tov;
function parseTeam(text: string): NbaOriginalBoxTeam {
  const heading = /^\s*([^\n]+?)\s*\(\d+-\d+\)/.exec(text); if (!heading) throw Error("missing_original_team_heading");
  const sourceTeamName = heading[1]!.trim(), players: NbaOriginalBoxPlayer[] = [], didNotPlay: NbaOriginalBoxTeam["didNotPlay"] = [];
  let total: { seconds: number; counts: Counts } | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim(); if (/^SCORE BY PERIOD|^Inactive:/.test(line)) break;
    const player = /^(\d{1,3})\s+(.+?)\s+(?:([CFG](?:[-/][CFG])?)\s+)?(\d{1,2}:\d{2})\s+([+\-\d\s]+)$/.exec(line);
    if (player) {
      if (total) throw Error("player_after_original_total");
      const [, jersey, sourceName, position, time, values] = player;
      const c = counts(values!);
      players.push({ ...c, jersey: jersey!, sourceName: sourceName!.trim(), seconds: seconds(time!), starter: !!position, boxContribution: contribution(c), fullGameContributionShare: NaN }); continue;
    }
    const dnp = /^(\d{1,3})\s+(.+?)\s+(DNP\s*-.*|DND\s*-.*|NWT\s*-.*)$/.exec(line);
    if (dnp) { didNotPlay.push({ jersey: dnp[1]!, sourceName: dnp[2]!.trim(), designation: dnp[3]! }); continue; }
    const aggregate = /^(\d{3}:\d{2})\s+([+\-\d\s]+)$/.exec(line);
    if (aggregate) { if (total) throw Error("duplicate_original_total"); total = { seconds: seconds(aggregate[1]!), counts: counts(aggregate[2]!) }; continue; }
    // Any unparsed numbered player or minute row invalidates this team.
    if (/^\d{1,3}\s+[\p{L}]|\d{1,3}:\d{2}\s+\d+\s+\d+/u.test(line)) throw Error("unparsed_original_box_row:" + line);
  }
  if (!total || players.length < 5 || players.length > 20 || players.filter(p => p.starter).length !== 5 || total.seconds < 14400 || (total.seconds - 14400) % 1500 !== 0 ||
    players.some(p => p.seconds > total!.seconds / 5) || Math.abs(players.reduce((n, p) => n + p.seconds, 0) - total.seconds) > 2) throw Error("incomplete_original_rotation");
  if (new Set([...players, ...didNotPlay].map(p => p.sourceName.toLowerCase())).size !== players.length + didNotPlay.length) throw Error("duplicate_original_box_identity");
  // Jerseys are retained source fields, never unique/native identity authority.
  const jerseys = [...players, ...didNotPlay].map(p => p.jersey), repeatedJerseys = [...new Set(jerseys.filter((j, i) => jerseys.indexOf(j) !== i))];
  for (const field of fields) {
    const sum = players.reduce((n, p) => n + p[field], 0), expected = total.counts[field] * (field === "plusMinus" ? 5 : 1);
    if (sum !== expected) throw Error("original_player_team_sum_mismatch:" + field);
  }
  return { sourceTeamName, seconds: total.seconds, counts: total.counts, players, didNotPlay, repeatedJerseys };
}
export function parseNbaOriginalFinalBox(firstPageText: string) {
  const text = firstPageText.replace(/\r/g, "").replace(/−/g, "-");
  if (!/^NATIONAL BASKETBALL ASSOCIATION OFFICIAL SCORER'S REPORT\s+FINAL BOX\b/.test(text)) throw Error("not_original_final_box");
  const parts = text.split(/\bVISITOR:\s*/); let teams: string[];
  if (parts.length === 2) teams = parts[1]!.split(/\bHOME:\s*/);
  else if (parts.length === 1) {
    // Neutral-site reports omit VISITOR/HOME labels. Require exactly two real
    // team-name/record headings; verify both against URL orientation below.
    const headings = [...text.matchAll(/^([^\n]+?)\s*\(\d+-\d+\)\s*(?:POS[^\n]*)?$/gm)].filter(m => Object.values(teamNames).some(names => names.includes(m[1]!.trim().toUpperCase())));
    if (headings.length !== 2) throw Error("missing_original_neutral_team_headings");
    teams = [text.slice(headings[0]!.index, headings[1]!.index), text.slice(headings[1]!.index)];
  } else throw Error("duplicate_original_visitor");
  if (teams.length !== 2) throw Error("missing_original_home");
  const away = parseTeam(teams[0]!), home = parseTeam(teams[1]!);
  if (away.seconds !== home.seconds || away.counts.pts === home.counts.pts || home.counts.plusMinus !== home.counts.pts - away.counts.pts || home.counts.plusMinus !== -away.counts.plusMinus) throw Error("incoherent_original_final");
  const denominator = contribution(away.counts) + contribution(home.counts); if (denominator <= 0) throw Error("invalid_original_contribution_denominator");
  for (const team of [away, home]) for (const player of team.players) player.fullGameContributionShare = contribution(player) / denominator;
  return { away, home, fullGameContributionDenominator: denominator };
}
export type NbaOriginalGamebook = ReturnType<typeof verifyNbaOriginalGamebook>;
export function verifyNbaOriginalGamebook(args: { bytes: Uint8Array; url: string; sha256: string; creationDate: string; lastModified: string;
  fetchedAt: string; firstPageText: string; gameId: number; startAt: string; away: string; home: string }) {
  const url = new URL(args.url), target = /^\/pdfs\/(\d{8})\/\1_([A-Z]{2,3})([A-Z]{2,3})_book\.pdf$/.exec(url.pathname);
  const hash = createHash("sha256").update(args.bytes).digest("hex"), start = instant(args.startAt), created = parseNbaPdfCreationClock(args.creationDate), modified = instant(args.lastModified), fetched = instant(args.fetchedAt);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start)).replace(/-/g, "");
  if (url.protocol !== "https:" || url.hostname !== "statsdmz.nba.com" || url.search || url.hash || !target || target[1] !== day || target[2] !== args.away || target[3] !== args.home ||
    !Number.isSafeInteger(args.gameId) || args.gameId <= 0 || Buffer.from(args.bytes).subarray(0, 5).toString() !== "%PDF-" || hash !== args.sha256 || created <= start || modified < created || fetched < modified) throw Error("unverified_original_gamebook");
  const box = parseNbaOriginalFinalBox(args.firstPageText);
  if (!teamNames[args.away]?.includes(box.away.sourceTeamName.toUpperCase()) || !teamNames[args.home]?.includes(box.home.sourceTeamName.toUpperCase())) throw Error("gamebook_team_identity_mismatch");
  return { release: NBA_HISTORICAL_GAMEBOOK_RELEASE, gameId: args.gameId, startAt: args.startAt, awayAbbreviation: args.away, homeAbbreviation: args.home,
    url: args.url, rawSha256: hash, fetchedAt: args.fetchedAt, pdfCreatedAt: new Date(created).toISOString(), httpModifiedAt: new Date(modified).toISOString(),
    sourceAvailableAt: new Date(Math.max(created, modified)).toISOString(), ...box };
}
/** Target outcome and every post-cutoff primary source remain excluded. */
export function admitNbaOriginalPriorGamebook(book: NbaOriginalGamebook, target: { gameId: number; cutoff: string }) {
  const cutoff = instant(target.cutoff);
  return book.gameId !== target.gameId && instant(book.startAt) < cutoff && instant(book.sourceAvailableAt) <= cutoff;
}
