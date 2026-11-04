import { createHash } from "node:crypto";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { readLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";

export const UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE = "ucl_official_strength_2026_11_04_r1_dated_original_source" as const;
export const UCL_OFFICIAL_STRENGTH_URL = "https://clubelo.com/";
const KEY = "soccer::uefa_champions_league::official-strength::r1";
export type UclOfficialStrength = {
  release: typeof UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE;
  sourceUrl: typeof UCL_OFFICIAL_STRENGTH_URL;
  asOfDay: string;
  capturedAt: string;
  sourceHash: string;
  clubs: Array<{ name: string; slug: string; elo: number }>;
};
const text = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => String.fromCodePoint(n[0]?.toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

/** Read published table cells, never execute embedded scripts. The source has
 * omitted </td>/</tr> tags at level headings: a new row/cell closes the old one.
 * Requiring an exact two-cell club/rating row excludes fixture/odds tables. */
export function parseUclOfficialStrength(html: string, capturedAt: string): UclOfficialStrength {
  if (html.length > 2_000_000) throw Error("UCL official strength page exceeds bound");
  const asOfDay = html.match(/<h1>\s*<a\b[^>]*href="\/(\d{4}-\d{2}-\d{2})\//i)?.[1];
  const now = Date.parse(capturedAt), day = Date.parse(`${asOfDay}T00:00:00Z`);
  if (!asOfDay || !Number.isFinite(now) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== asOfDay
    || day > now || now - day > 2 * 86_400_000) throw Error("UCL official strength source date is missing, future or stale");
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const clubs = new Map<string, { name: string; slug: string; elo: number }>();
  let cells: string[] = [], cell: string | null = null;
  const closeCell = () => { if (cell !== null) cells.push(cell); cell = null; };
  const closeRow = () => {
    closeCell();
    if (cells.length === 2 && /^\d+(?:\.\d+)?$/.test(text(cells[1]!))) {
      const links = [...cells[0]!.matchAll(/<a\b[^>]*href="\/([^"/#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
      const link = links.at(-1);
      if (link) {
        const full = link[2]!.match(/<span\b[^>]*class="Ast"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? link[2]!;
        const row = { name: text(full), slug: link[1]!, elo: Number(text(cells[1]!)) };
        const prior = clubs.get(row.slug.toLowerCase());
        if (row.name && row.elo > 0 && Number.isFinite(row.elo)) {
          if (prior && (prior.elo !== row.elo || prior.name !== row.name)) throw Error(`Conflicting official club rating ${row.slug}`);
          clubs.set(row.slug.toLowerCase(), row);
        }
      }
    }
    cells = [];
  };
  for (const token of source.split(/(<\/?(?:tr|td)\b[^>]*>)/gi)) {
    if (/^<tr\b/i.test(token)) closeRow();
    else if (/^<\/tr\b/i.test(token)) closeRow();
    else if (/^<td\b/i.test(token)) { closeCell(); cell = ""; }
    else if (/^<\/td\b/i.test(token)) closeCell();
    else if (cell !== null) cell += token;
  }
  closeRow();
  if (clubs.size < 100) throw Error("UCL official strength club coverage incomplete");
  return { release: UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE, sourceUrl: UCL_OFFICIAL_STRENGTH_URL,
    asOfDay, capturedAt, sourceHash: createHash("sha256").update(html).digest("hex"), clubs: [...clubs.values()] };
}

/** Cache metadata is evidence, not a fresh observation inferred from fetch time. */
export function validUclOfficialStrength(value:UclOfficialStrength,now:Date):boolean {
  if(!value || value.release!==UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE || value.sourceUrl!==UCL_OFFICIAL_STRENGTH_URL
    || !/^[a-f0-9]{64}$/.test(value.sourceHash??"") || !Array.isArray(value.clubs) || value.clubs.length<100) return false;
  const day=Date.parse(`${value.asOfDay}T00:00:00Z`),captured=Date.parse(value.capturedAt);
  if(!Number.isFinite(day)||!Number.isFinite(captured)||day>captured||captured>now.getTime()||now.getTime()-day>2*86_400_000
    ||new Date(day).toISOString().slice(0,10)!==value.asOfDay)return false;
  const seen=new Set<string>();
  for(const c of value.clubs){if(!c||!c.name||!c.slug||!Number.isFinite(c.elo)||c.elo<=0||seen.has(c.slug.toLowerCase()))return false;seen.add(c.slug.toLowerCase());}
  return true;
}

export async function loadUclOfficialStrength(allowWrite: boolean): Promise<UclOfficialStrength> {
  const now = new Date(), today = computeSlateDate("soccer", now);
  const key = `${KEY}::${today}`;
  const cached = await readLabResponseSnapshot<UclOfficialStrength>(key, "fresh").catch(() => null);
  if (cached && validUclOfficialStrength(cached.payload,now) && computeSlateDate("soccer", cached.payload.capturedAt) === today
    && cached.payload.asOfDay <= now.toISOString().slice(0,10)
    && Date.parse(cached.payload.capturedAt) <= now.getTime()
    && now.getTime()-Date.parse(`${cached.payload.asOfDay}T00:00:00Z`) <= 2*86_400_000) return cached.payload;
  const response = await fetch(UCL_OFFICIAL_STRENGTH_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw Error(`UCL official strength source status ${response.status}`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length;
    if (size > 2_000_000) throw Error("UCL official strength response exceeds bound"); chunks.push(r.value); }
  } finally { await reader.cancel(); }
  // Availability is completion, not request start: a fetch crossing kickoff
  // cannot acquire invented pregame knowledge. Keep the page's own day intact.
  const completedAt = new Date();
  const completedKey = `${KEY}::${computeSlateDate("soccer",completedAt)}`;
  const payload = parseUclOfficialStrength(Buffer.concat(chunks).toString("utf8"), completedAt.toISOString());
  if (allowWrite) {
    const write = await upsertLabResponseSnapshot({ snapshotKey: completedKey, kind: "daily_edge", sport: "soccer",
      slateDate: payload.asOfDay, payload, source: "ucl_official_strength", payloadVersion: payload.release,
      ttlMs: payload.asOfDay === completedAt.toISOString().slice(0,10) ? 30 * 60 * 60_000 : 15 * 60_000, staleMs: 2 * 86_400_000 });
    if (!write.ok) throw Error("UCL official strength persistence failed");
  }
  return payload;
}
