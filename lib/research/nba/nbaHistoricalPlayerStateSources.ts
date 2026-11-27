import { createHash } from "node:crypto";
export const NBA_HISTORICAL_PLAYER_STATE_SOURCE_RELEASE = "nba_historical_player_state_sources_2026_11_20_r1_primary_archives" as const;
export type PdfCell = { text: string; x: number; y: number; width?: number };
export const NBA_HISTORICAL_INJURY_GEOMETRY_RELEASE = "nba_historical_injury_geometry_2026_11_23_r3_canonical_viewport" as const;
export function nbaHistoricalViewportCell(cell: PdfCell, transform: readonly number[]): PdfCell {
  if (transform.length !== 6 || !transform.every(Number.isFinite) || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) throw Error("invalid_injury_viewport");
  return { ...cell, x: transform[0]! * cell.x + transform[2]! * cell.y + transform[4]!, y: transform[1]! * cell.x + transform[3]! * cell.y + transform[5]! };
}
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const exactName = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const biographyName = (v: string) => exactName(v.replace(/\b(jr|sr)\b\.?/gi, ""));
const name = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
const cities: Readonly<Record<string, string>> = { ATLANTA: "ATL", BOSTON: "BOS", BROOKLYN: "BKN", CHARLOTTE: "CHA", CHICAGO: "CHI", CLEVELAND: "CLE", DALLAS: "DAL", DENVER: "DEN", DETROIT: "DET", "GOLDEN STATE": "GSW", HOUSTON: "HOU", INDIANA: "IND", "L.A. CLIPPERS": "LAC", "L.A. LAKERS": "LAL", "LA CLIPPERS": "LAC", "LA LAKERS": "LAL", MEMPHIS: "MEM", MIAMI: "MIA", MILWAUKEE: "MIL", MINNESOTA: "MIN", "NEW ORLEANS": "NOP", "NEW YORK": "NYK", "OKLAHOMA CITY": "OKC", ORLANDO: "ORL", PHILADELPHIA: "PHI", PHOENIX: "PHX", PORTLAND: "POR", SACRAMENTO: "SAC", "SAN ANTONIO": "SAS", TORONTO: "TOR", UTAH: "UTA", WASHINGTON: "WAS" };

/** Original table columns, including inactive/two-way roster members. That
 * heading is not an injury designation. Introductory NEW YORK is not a team. */
export function splitNbaRosterColumns(cell: PdfCell, verifiedNativeNames: ReadonlySet<string>): PdfCell[] {
  if (cell.width === undefined || cell.x + cell.width < 36.025 + (Math.round((cell.x - 36.025) / 108.04) + 1) * 108.04) return [cell];
  const words = cell.text.trim().split(/\s+/), matches: [string, string][] = [];
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" "), right = words.slice(i).join(" ");
    if (verifiedNativeNames.has(exactName(left.replace(/^\*/, ""))) && verifiedNativeNames.has(exactName(right.replace(/^\*/, "")))) matches.push([left, right]);
  }
  if (matches.length !== 1) throw Error("ambiguous_merged_roster_columns");
  const nextX = 36.025 + (Math.round((cell.x - 36.025) / 108.04) + 1) * 108.04;
  if (nextX > 469 || cell.x + cell.width > nextX + 108.04) throw Error("invalid_merged_roster_geometry");
  return [{ ...cell, text: matches[0]![0], width: undefined }, { ...cell, text: matches[0]![1], x: nextX, width: undefined }];
}
export function parseNbaOpeningRosterPdf(pages: readonly (readonly PdfCell[])[], verifiedNativeNames: readonly string[] = []) {
  const rosters = new Map<string, { displayName: string; twoWay: boolean; page: number; x: number; y: number }[]>();
  for (const [page, raw] of pages.entries()) {
    const dictionary = new Set(verifiedNativeNames.map(exactName));
    const items = [...raw].filter(t => t.text.trim()).sort((a, b) => Math.round(b.y * 10) - Math.round(a.y * 10) || a.x - b.x);
    const headingRows = new Map<number, Set<string>>();
    for (const t of items) if (cities[t.text.trim()]) { const y = Math.round(t.y * 10), row = headingRows.get(y) ?? new Set(); row.add(cities[t.text.trim()]!); headingRows.set(y, row); }
    const start = Math.max(...[...headingRows].filter(([, teams]) => teams.size >= 4).map(([y]) => y));
    if (!Number.isFinite(start)) throw Error("missing_roster_table_columns");
    const active = new Map<number, string>();
    const table = items.filter(t => Math.round(t.y * 10) <= start).flatMap(t => {
      const col = Math.round((t.x - 36.025) / 108.04);
      if (col < 0 || col > 4 || Math.abs(t.x - (36.025 + col * 108.04)) > 4 || cities[t.text.trim()] || /INACTIVE|Indicates|^PAGE |^\* =|^\d+$/.test(t.text.trim())) return [t];
      return splitNbaRosterColumns(t, dictionary);
    }).sort((a, b) => Math.round(b.y * 10) - Math.round(a.y * 10) || a.x - b.x);
    for (const cell of table) {
      if (Math.round(cell.y * 10) > start) continue;
      const col = Math.round((cell.x - 36.025) / 108.04);
      if (col < 0 || col > 4 || Math.abs(cell.x - (36.025 + col * 108.04)) > 4) continue;
      const text = cell.text.trim(), team = cities[text];
      if (team) { active.set(col, team); if (!rosters.has(team)) rosters.set(team, []); continue; }
      const current = active.get(col); if (!current || /INACTIVE|Indicates|^PAGE |^\* =|^\d+$/.test(text)) continue;
      const displayName = text.replace(/^\*/, "").trim();
      if (!/^[\p{L} .’'\-]+$/u.test(displayName) || !/[\p{L}].*\s.*[\p{L}]/u.test(displayName)) throw Error("invalid_roster_cell");
      rosters.get(current)!.push({ displayName, twoWay: text.startsWith("*"), page: page + 1, x: cell.x, y: cell.y });
    }
  }
  if (rosters.size !== 30) throw Error("incomplete_30_team_roster");
  const ownership = new Map<string, string>();
  for (const [team, players] of rosters) {
    if (players.length < 14 || players.length > 21) throw Error("invalid_roster_size");
    for (const p of players) { const key = exactName(p.displayName); if (ownership.has(key)) throw Error("duplicate_roster_identity"); ownership.set(key, team); }
  }
  return rosters;
}
function etInstant(year: number, month: number, day: number, hour: number, minute: number) {
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(nominal); if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || hour < 0 || hour > 23 || minute < 0 || minute > 59) throw Error("invalid_report_calendar");
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const candidates = [4, 5].map(offset => nominal + offset * 3600000).filter(at => {
    const p = Object.fromEntries(format.formatToParts(new Date(at)).map(t => [t.type, t.value]));
    return Number(p.year) === year && Number(p.month) === month && Number(p.day) === day && Number(p.hour) === hour && Number(p.minute) === minute;
  });
  if (candidates.length !== 1) throw Error("ambiguous_or_nonexistent_report_clock");
  return candidates[0]!;
}
export function parseNbaPdfCreationClock(value: string): number {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'?\d{2}'?)$/.exec(value);
  if (!m) throw Error("missing_exact_pdf_creation_clock");
  const [, year, month, day, hour, minute, second, zone] = m;
  const base = Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second!);
  const check = new Date(base); if (check.getUTCFullYear() !== +year! || check.getUTCMonth() !== +month! - 1 || check.getUTCDate() !== +day! || +hour! > 23 || +minute! > 59 || +second! > 59) throw Error("invalid_pdf_creation_clock");
  if (zone === "Z") return base;
  const digits = zone!.replace(/'/g, ""), offset = (+digits.slice(1, 3) * 60 + +digits.slice(3, 5)) * 60000;
  if (+digits.slice(1, 3) > 14 || +digits.slice(3, 5) > 59) throw Error("invalid_pdf_zone");
  return base - (digits[0] === "+" ? offset : -offset);
}
export type NbaHistoricalPdfClock = { release: typeof NBA_HISTORICAL_PLAYER_STATE_SOURCE_RELEASE; kind: "verified_historical_primary_pdf";
  url: string; rawSha256: string; fetchedAt: string; printedPublishedAt: string; pdfCreatedAt: string; httpModifiedAt: string; sourceAvailableAt: string };
/** Own receipt time is NEVER backdated. This is primary archived-document
 * availability evidence, not proof that our collector ran before the game. */
export function verifyNbaHistoricalReportClock(args: { bytes: Uint8Array; url: string; text: string; creationDate: string; lastModified: string; fetchedAt: string }): NbaHistoricalPdfClock {
  return { release: NBA_HISTORICAL_PLAYER_STATE_SOURCE_RELEASE, ...verifyHistoricalReportClockCore(args, ["ak-static.cms.nba.com"]) };
}
export const NBA_HISTORICAL_PDF_CLOCK_R2 = "nba_historical_pdf_clock_2026_11_23_r2_official_archive_hosts" as const;
export function verifyNbaHistoricalReportClockV2(args: Parameters<typeof verifyNbaHistoricalReportClock>[0]) {
  return { release: NBA_HISTORICAL_PDF_CLOCK_R2, ...verifyHistoricalReportClockCore(args, ["ak-static.cms.nba.com", "official.nba.com"]) };
}
function verifyHistoricalReportClockCore(args: Parameters<typeof verifyNbaHistoricalReportClock>[0], hosts: readonly string[]) {
  const url = new URL(args.url), path = /^\/referee\/injury\/Injury-Report_(\d{4})-(\d{2})-(\d{2})_[^/]+\.pdf$/.exec(url.pathname);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || !path || url.search || url.hash || Buffer.from(args.bytes).subarray(0, 5).toString() !== "%PDF-") throw Error("untrusted_historical_report");
  const headers = [...args.text.matchAll(/Injury\s+Report:\s*(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*(AM|PM)/g)];
  if (!headers.length || new Set(headers.map(m => m[0])).size !== 1) throw Error("missing_or_conflicting_printed_report_clock");
  const m = headers[0]!; if (+path[1]! !== 2000 + +m[3]! || +path[2]! !== +m[1]! || +path[3]! !== +m[2]!) throw Error("report_url_and_printed_date_disagree");
  if (+m[4]! < 1 || +m[4]! > 12) throw Error("invalid_report_hour");
  const printed = etInstant(2000 + +m[3]!, +m[1]!, +m[2]!, +m[4]! % 12 + (m[6] === "PM" ? 12 : 0), +m[5]!);
  const created = parseNbaPdfCreationClock(args.creationDate), modified = Date.parse(args.lastModified), fetched = Date.parse(args.fetchedAt);
  if (![modified, fetched].every(Number.isFinite) || created < printed || modified < created || fetched < modified) throw Error("invalid_historical_publication_chronology");
  return { kind: "verified_historical_primary_pdf" as const, url: args.url,
    rawSha256: hash(args.bytes), fetchedAt: args.fetchedAt, printedPublishedAt: new Date(printed).toISOString(), pdfCreatedAt: new Date(created).toISOString(),
    httpModifiedAt: new Date(modified).toISOString(), sourceAvailableAt: new Date(Math.max(printed, created, modified)).toISOString() };
}
export function nbaHistoricalReportAdmittedAt(clock: Pick<NbaHistoricalPdfClock, "sourceAvailableAt">, cutoff: string) {
  const at = Date.parse(cutoff); return Number.isFinite(at) && Date.parse(clock.sourceAvailableAt) <= at;
}
export type PlayerIdentityFacts = { playerId: number; firstName: string; lastName: string; college: string | null; country: string | null;
  draftYear: number | null; draftRound: number | null; draftNumber: number | null };
/** Biographical identity only. Present team, jersey, salary, stats and current
 * active status are deliberately absent from this input type. */
export function bridgeNbaHistoricalPlayerIds(bdl: readonly PlayerIdentityFacts[], nba: readonly PlayerIdentityFacts[]) {
  const mapped = new Map<number, { nbaId: number; basis: "draft_triplet_surname" | "exact_name_college_country" }>(), excluded: { bdlId: number; reason: string }[] = [];
  for (const p of bdl) {
    const drafted = [p.draftYear, p.draftRound, p.draftNumber].every(v => Number.isSafeInteger(v) && v! > 0);
    const matches = nba.filter(q => drafted ? q.draftYear === p.draftYear && q.draftRound === p.draftRound && q.draftNumber === p.draftNumber && name(q.lastName) === name(p.lastName) :
      p.college && p.country && biographyName(p.firstName + " " + p.lastName) === biographyName(q.firstName + " " + q.lastName) && name(p.college) === name(q.college ?? "") && name(p.country) === name(q.country ?? ""));
    if (matches.length !== 1) { excluded.push({ bdlId: p.playerId, reason: matches.length ? "ambiguous_biographical_identity" : "unmatched_biographical_identity" }); continue; }
    if (mapped.has(p.playerId) && mapped.get(p.playerId)!.nbaId !== matches[0]!.playerId) throw Error("conflicting_native_player_identity");
    mapped.set(p.playerId, { nbaId: matches[0]!.playerId, basis: drafted ? "draft_triplet_surname" : "exact_name_college_country" });
  }
  const reverse = new Map<number, number[]>(); for (const [id, p] of mapped) reverse.set(p.nbaId, [...(reverse.get(p.nbaId) ?? []), id]);
  for (const ids of reverse.values()) if (ids.length > 1) for (const id of ids) { mapped.delete(id); excluded.push({ bdlId: id, reason: "duplicate_native_identity" }); }
  return { mapped, excluded };
}

export type NbaHistoricalInjurySection = { gameDate: string; matchup: string; teamName: string; submitted: boolean;
  players: { sourceName: string; rawStatus: string; reason: string; page: number }[] };
/** Geometry owns columns: a reason containing a team/player/status word cannot
 * create a new row. Page continuations retain their actual preceding section.
 * An omitted healthy player is deliberately NOT synthesized as Available. */
export function parseNbaHistoricalInjuryPages(pages: readonly (readonly PdfCell[])[]): NbaHistoricalInjurySection[] {
  return parseInjuryPages(pages, false);
}
export const NBA_HISTORICAL_INJURY_TIME_RELEASE = "nba_historical_injury_time_2026_11_21_r2_printed_tip_binding" as const;
export function parseNbaHistoricalInjuryPagesWithTimes(pages: readonly (readonly PdfCell[])[]) {
  return parseInjuryPages(pages, true).map(s => { if (!s.gameTime) throw Error("missing_printed_injury_game_time"); return { ...s, gameTime: s.gameTime }; });
}
/** Binds a postgame native schedule value to a separately published pregame
 * printed schedule. An omitted AM/PM is checked modulo twelve, not invented. */
export function nbaHistoricalPrintedTipMatches(section: { gameDate: string; gameTime: string }, startAt: string) {
  const clock = /^(\d{1,2}):(\d{2})(AM|PM)?(?:\(ET\))?$/.exec(section.gameTime);
  if (!clock || +clock[1]! < 1 || +clock[1]! > 12 || +clock[2]! > 59 || !Number.isFinite(Date.parse(startAt))) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startAt));
  const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return section.gameDate === `${p.month}/${p.day}/${p.year}` && +clock[2]! === +p.minute! &&
    (clock[3] ? +p.hour! === +clock[1]! % 12 + (clock[3] === "PM" ? 12 : 0) : +p.hour! % 12 === +clock[1]! % 12);
}
function parseInjuryPages(pages: readonly (readonly PdfCell[])[], includeTimes: boolean) {
  type Section = NbaHistoricalInjurySection & { gameTime?: string };
  const sections: Section[] = []; let gameDate = "", gameTime = "", matchup = "", current: Section | undefined;
  let bounds: { date: number; time: number; matchup: number; team: number; player: number; status: number; reason: number } | undefined;
  let previous: NbaHistoricalInjurySection["players"][number] | undefined;
  for (const [page, cells] of pages.entries()) {
    const rows = new Map<number, PdfCell[]>();
    for (const cell of cells) { if (!cell.text.trim()) continue; const y = Math.round(cell.y * 10); rows.set(y, [...(rows.get(y) ?? []), cell]); }
    // Preserve the PDF's source text order. Wrapped reasons can start above
    // the vertically centered player label; sorting Y would attach them to
    // the wrong athlete. Geometry still determines each field's column.
    for (const unordered of rows.values()) {
      const row = unordered.sort((a, b) => a.x - b.x), full = row.map(c => c.text.trim()).join(" ");
      if (/Injury\s+Report:|^Page \d+ of \d+$/.test(full)) continue;
      if (/Game Date/.test(full) && /Player Name/.test(full) && /Status/.test(full)) {
        const at = (label: string) => { const c = row.find(c => c.text.trim().startsWith(label)); if (!c) throw Error("missing_injury_column"); return c.x; };
        bounds = { date: at("Game"), time: row.filter(c => c.text.trim().startsWith("Game"))[1]?.x ?? NaN, matchup: at("Matchup"), team: at("Team"), player: at("Player"), status: at("Current"), reason: at("Reason") };
        const xs = Object.values(bounds); if (!xs.every(Number.isFinite) || xs.some((x, i) => i > 0 && x <= xs[i - 1]!)) throw Error("invalid_injury_columns");
        continue;
      }
      if (!bounds) throw Error("injury_rows_before_column_header");
      const b = bounds, field = (lo: number, hi = Infinity) => row.filter(c => c.x >= lo - 2 && c.x < hi - 2).map(c => c.text.trim()).join(" ").trim();
      const date = field(b.date, b.time), match = field(b.matchup, b.team), team = field(b.team, b.player), player = field(b.player, b.status), status = field(b.status, b.reason), reason = field(b.reason);
      if (date) { if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) throw Error("invalid_injury_game_date"); gameDate = date; }
      if (includeTimes) { const printedTime = field(b.time, b.matchup).replace(/\s/g, ""); if (printedTime) { if (!/^\d{1,2}:\d{2}(?:AM|PM)?(?:\(ET\))?$/.test(printedTime)) throw Error("invalid_printed_injury_game_time"); gameTime = printedTime; } }
      if (match) { if (!/^[A-Z]{2,3}@[A-Z]{2,3}$/.test(match)) throw Error("invalid_injury_matchup"); matchup = match; current = undefined; previous = undefined; }
      if (team) {
        if (!gameDate || !matchup) throw Error("orphan_injury_team");
        current = { gameDate, matchup, teamName: team, submitted: !/NOT YET SUBMITTED/i.test(player + " " + status + " " + reason), players: [], ...(includeTimes ? { gameTime } : {}) };
        if (sections.some(s => s.gameDate === gameDate && s.matchup === matchup && s.teamName === team)) throw Error("duplicate_injury_team_section");
        sections.push(current); previous = undefined;
      }
      if (/NOT YET SUBMITTED/i.test(player + " " + status + " " + reason)) { if (!current) throw Error("orphan_unsubmitted_report"); current.submitted = false; continue; }
      if (player || status) {
        if (!current || !current.submitted || !player || !["Out", "Questionable", "Doubtful", "Probable", "Available"].includes(status) || !player.includes(",")) throw Error("malformed_injury_player_row");
        if (current.players.some(p => exactName(p.sourceName) === exactName(player))) throw Error("duplicate_injury_player");
        previous = { sourceName: player, rawStatus: status, reason, page: page + 1 }; current.players.push(previous);
      } else if (reason) { if (!previous) throw Error("orphan_injury_reason:" + full); previous.reason = (previous.reason + " " + reason).trim(); }
      else if (field(b.date, b.reason)) throw Error("unrecognized_injury_row");
    }
  }
  if (!sections.length) throw Error("empty_injury_report"); return sections;
}
