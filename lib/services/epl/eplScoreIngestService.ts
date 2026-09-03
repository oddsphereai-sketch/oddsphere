import { supabase } from "@/lib/db/supabase";
import { BallDontLieEplProvider, type BdlEplMatch } from "@/lib/providers/real_api/BallDontLieEplProvider";
import { EPL_EXTERNAL_ID_OFFSET } from "./eplProductionPipeline";

export function eplProviderIdFromExternal(externalId: number): number | null {
  if (externalId >= 30_000_000) return null;
  const id = externalId - EPL_EXTERNAL_ID_OFFSET;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function addDay(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function dbStatus(match: BdlEplMatch): "scheduled" | "in_progress" | "completed" {
  if (match.status_state === "final") return "completed";
  if (match.status_state === "in_progress") return "in_progress";
  return "scheduled";
}

let fixtureCache: { key: string; expiresAt: number; promise: Promise<BdlEplMatch[]> } | null = null;

export async function ingestEplFinalScores(input: { slateDate: string; apply: boolean }) {
  const key = input.slateDate;
  if (!fixtureCache || fixtureCache.key !== key || fixtureCache.expiresAt <= Date.now()) {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for EPL score ingestion");
    const provider = new BallDontLieEplProvider(apiKey);
    fixtureCache = { key, expiresAt: Date.now() + 5 * 60_000, promise: provider.listMatches({ dates: [input.slateDate, addDay(input.slateDate)] }) };
  }
  const fixtures = (await fixtureCache.promise).filter((match) => etDate(match.date) === input.slateDate);
  const { data, error } = await supabase.from("games").select("id,external_id,status,home_score,away_score").eq("sport", "soccer").eq("slate_date", input.slateDate).gte("external_id", EPL_EXTERNAL_ID_OFFSET).lt("external_id", 30_000_000);
  if (error) throw new Error(`load EPL games for settlement: ${error.message}`);
  const fixtureById = new Map(fixtures.map((match) => [match.id, match]));
  let updated = 0;
  let finalizedCount = 0;
  const errors: string[] = [];
  for (const row of (data ?? []) as Array<{ id: number; external_id: number; status: string; home_score: number | null; away_score: number | null }>) {
    const providerId = eplProviderIdFromExternal(row.external_id);
    const match = providerId === null ? null : fixtureById.get(providerId) ?? null;
    if (!match) continue;
    if (match.status_state === "final") finalizedCount++;
    const payload = { status: dbStatus(match), home_score: match.home_score, away_score: match.away_score };
    if (!input.apply || (row.status === payload.status && row.home_score === payload.home_score && row.away_score === payload.away_score)) continue;
    const { error: updateError } = await supabase.from("games").update(payload).eq("id", row.id).eq("sport", "soccer");
    if (updateError) errors.push(`game ${row.id}: ${updateError.message}`); else updated++;
  }
  return { updated, apiEventsFetched: fixtures.length, finalizedCount, errors };
}
