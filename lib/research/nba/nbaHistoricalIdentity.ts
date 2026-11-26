import { createHash } from "node:crypto";
import type { PlayerIdentityFacts } from "./nbaHistoricalPlayerStateSources";

export const NBA_HISTORICAL_BIOGRAPHY_RELEASE = "nba_historical_biography_2026_11_21_r1_native_facts" as const;
type Table = { name?: string; headers?: unknown[]; rowSet?: unknown[][] };
const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const optionalNumber = (v: unknown): number | null => { if (v === null || v === undefined || v === "Undrafted" || v === "Undrafted ") return null;
  const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
/** Additional native players, including never-played two-way members absent
 * from the stats index. No current-team, active-status or performance fields. */
export function readNbaOfficialBiographicalFacts(args: { bytes: Uint8Array; url: string; sha256: string; nbaPlayerId: number }) {
  const url = new URL(args.url), params = [...url.searchParams];
  if (!positive(args.nbaPlayerId) || url.protocol !== "https:" || url.hostname !== "stats.nba.com" || url.pathname !== "/stats/commonplayerinfo" || url.hash ||
    params.length !== 2 || url.searchParams.get("PlayerID") !== String(args.nbaPlayerId) || url.searchParams.get("LeagueID") !== "00" ||
    createHash("sha256").update(args.bytes).digest("hex") !== args.sha256) throw Error("unverified_native_biography_source");
  const payload = JSON.parse(Buffer.from(args.bytes).toString("utf8"));
  const echoed = Array.isArray(payload.parameters) ? payload.parameters : [payload.parameters];
  if (echoed.filter((p: Record<string, unknown> | null) => p?.PlayerID === args.nbaPlayerId).length !== 1 ||
    echoed.filter((p: Record<string, unknown> | null) => p?.LeagueID === "00").length !== 1) throw Error("biography_native_query_mismatch");
  const tables = (payload.resultSets as Table[] | undefined)?.filter(t => t.name === "CommonPlayerInfo");
  if (tables?.length !== 1 || tables[0]!.rowSet?.length !== 1 || !tables[0]!.headers || new Set(tables[0]!.headers).size !== tables[0]!.headers.length) throw Error("ambiguous_native_biography");
  const table = tables[0]!, row = table.rowSet![0]!;
  if (table.headers!.length !== row.length) throw Error("malformed_native_biography");
  const values = Object.fromEntries(table.headers!.map((h, i) => [String(h), row[i]]));
  const text = (field: string) => typeof values[field] === "string" && (values[field] as string).trim() ? (values[field] as string).trim() : null;
  if (values.PERSON_ID !== args.nbaPlayerId || !text("FIRST_NAME") || !text("LAST_NAME")) throw Error("missing_native_biographical_identity");
  const facts: PlayerIdentityFacts = { playerId: args.nbaPlayerId, firstName: text("FIRST_NAME")!, lastName: text("LAST_NAME")!,
    college: text("SCHOOL"), country: text("COUNTRY"), draftYear: optionalNumber(values.DRAFT_YEAR), draftRound: optionalNumber(values.DRAFT_ROUND), draftNumber: optionalNumber(values.DRAFT_NUMBER) };
  return { release: NBA_HISTORICAL_BIOGRAPHY_RELEASE, facts, rawSha256: args.sha256,
    authority: "biographical_identity_only_not_historical_roster_or_performance" as const };
}
/** An explicit NBA-authored name-to-native-ID hyperlink is alias evidence.
 * It establishes identity only; it never establishes past team membership. */
export function readNbaPrimaryNativeNameLinks(args: { bytes: Uint8Array; url: string; sha256: string }) {
  const url = new URL(args.url);
  if (url.protocol !== "https:" || url.hostname !== "www.nba.com" || !/^\/news\/nba-player-movement-\d{4}$/.test(url.pathname) || url.search || url.hash ||
    createHash("sha256").update(args.bytes).digest("hex") !== args.sha256) throw Error("unverified_native_alias_source");
  const links = new Map<string, { nbaPlayerId: number; sourceDisplayName: string; sourceSha256: string }>();
  for (const m of Buffer.from(args.bytes).toString("utf8").matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/g)) {
    let href: URL; try { href = new URL(m[2]!, url); } catch { continue; }
    const native = /^\/player\/(\d+)\/[^/]+\/?$/.exec(href.pathname);
    if (href.protocol !== "https:" || href.hostname !== "www.nba.com" || href.search || href.hash || !native || !positive(Number(native[1]))) continue;
    const sourceDisplayName = m[3]!.replace(/<[^>]*>/g, "").replace(/&#0?39;|&#8217;|&apos;|&rsquo;/g, "'").trim();
    if (!/^[\p{L} .’'\-]+$/u.test(sourceDisplayName) || !sourceDisplayName.includes(" ")) continue;
    const nbaPlayerId = Number(native[1]), key = `${nbaPlayerId}:${sourceDisplayName}`;
    links.set(key, { nbaPlayerId, sourceDisplayName, sourceSha256: args.sha256 });
  }
  return [...links.values()].sort((a, b) => a.nbaPlayerId - b.nbaPlayerId || a.sourceDisplayName.localeCompare(b.sourceDisplayName));
}
/** Two reviewed spellings in one exact original roster document. Preserve the
 * original display name. This is no general nickname/fuzzy matching rule. */
export function resolveNba2023OpeningRosterSpelling(args: { rosterPdfSha256: string; team: string; sourceDisplayName: string;
  nativeFacts: PlayerIdentityFacts; article: { bytes: Uint8Array; url: string; sha256: string } }) {
  if (args.rosterPdfSha256 !== "c122900f6a322dc7aac4aa5d1096d185e652bd439d79595106bc35eb130178f7") return null;
  const p = args.nativeFacts;
  const ish = args.team === "POR" && args.sourceDisplayName === "Ishmail Wainright" && p.playerId === 1630688 && p.firstName === "Ish" && p.lastName === "Wainright" && p.college === "Baylor" && p.country === "USA";
  const chris = args.team === "MIL" && args.sourceDisplayName === "Chis Livingston" && p.playerId === 1641753 && p.firstName === "Chris" && p.lastName === "Livingston" && p.college === "Kentucky" && p.draftYear === 2023 && p.draftRound === 2 && p.draftNumber === 58;
  if (!ish && !chris) return null;
  const expected = ish ? "https://www.nba.com/suns/features/journey-joy" : "https://www.nba.com/bucks/news/milwaukee-bucks-sign-chris-livingston";
  if (args.article.url !== expected || createHash("sha256").update(args.article.bytes).digest("hex") !== args.article.sha256) throw Error("unverified_roster_spelling_source");
  const html = Buffer.from(args.article.bytes).toString("utf8"), embedded = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!embedded) throw Error("missing_primary_spelling_article");
  const article = JSON.parse(embedded[1]!).props?.pageProps?.pageObject;
  if (article?.permalink !== expected || article.status !== "publish" || !Number.isFinite(Date.parse(article.date)) || Date.parse(article.date) >= Date.parse("2023-10-23T23:59:59Z")) throw Error("wrong_or_later_spelling_article");
  const content = JSON.stringify(article.contentExpanded);
  if (ish ? !/Ishmail\s+[“]Ish[”]\s+Carzell\s+Wainright/.test(content) : !(article.title === "Milwaukee Bucks sign Chris Livingston" && /58th overall pick/.test(content) && /2023 NBA Draft/.test(content) && /Kentucky/.test(content))) throw Error("missing_primary_spelling_confirmation");
  return { nbaPlayerId: p.playerId, sourceDisplayName: args.sourceDisplayName, canonicalDisplayName: `${p.firstName} ${p.lastName}`,
    sourceSpellingPreserved: true, rosterPdfSha256: args.rosterPdfSha256, articleSha256: args.article.sha256, articleUrl: expected,
    authority: "identity_annotation_only_not_historical_availability" as const };
}
