import { supabase } from "@/lib/db/supabase";
import { BallDontLieUclProvider, type BdlUclMatch } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { regulationScore, UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND, UCL_SETTLEMENT_RELEASE, uclProviderIdFromExternal } from "./uclCompetitionContext";

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function addDay(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function dbStatus(match: BdlUclMatch, regulationAvailable: boolean): "scheduled" | "in_progress" | "completed" {
  if (match.status_state === "final" && regulationAvailable) return "completed";
  if (match.status_state === "in_progress") return "in_progress";
  return "scheduled";
}

let fixtureCache: { key: string; expiresAt: number; promise: Promise<BdlUclMatch[]> } | null = null;

export async function ingestUclFinalScores(input: { slateDate: string; apply: boolean }) {
  if (!fixtureCache || fixtureCache.key !== input.slateDate || fixtureCache.expiresAt <= Date.now()) {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for UCL score ingestion");
    fixtureCache = {
      key: input.slateDate,
      expiresAt: Date.now() + 5 * 60_000,
      promise: new BallDontLieUclProvider(apiKey).listMatches({ dates: [input.slateDate, addDay(input.slateDate)] }),
    };
  }
  const fixtures = (await fixtureCache.promise).filter((match) => etDate(match.date) === input.slateDate);
  const { data, error } = await supabase.from("games")
    .select("id,external_id,status,home_score,away_score,inning_scores")
    .eq("sport", "soccer")
    .eq("slate_date", input.slateDate)
    .gte("external_id", UCL_EXTERNAL_ID_OFFSET)
    .lt("external_id", UCL_EXTERNAL_ID_UPPER_BOUND);
  if (error) throw new Error(`load UCL games for settlement: ${error.message}`);
  const fixtureById = new Map(fixtures.map((match) => [match.id, match]));
  let updated = 0;
  let finalizedCount = 0;
  let heldSpecialFinals = 0;
  const errors: string[] = [];
  for (const row of (data ?? []) as Array<{ id: number; external_id: number; status: string; home_score: number | null; away_score: number | null; inning_scores: unknown }>) {
    const providerId = uclProviderIdFromExternal(row.external_id);
    const match = providerId === null ? null : fixtureById.get(providerId) ?? null;
    if (!match) continue;
    const settled = regulationScore(match);
    if (match.status_state === "final" && !settled.score) heldSpecialFinals++;
    if (match.status_state === "final" && settled.score) finalizedCount++;
    const payload = {
      status: dbStatus(match, settled.score !== null),
      home_score: settled.score?.home ?? null,
      away_score: settled.score?.away ?? null,
      inning_scores: {
        kind: "soccer_regulation_score_provenance",
        release: UCL_SETTLEMENT_RELEASE,
        provider: "balldontlie_ucl_v1",
        providerStatus: match.status,
        providerStatusDetail: match.status_detail,
        scoreSource: settled.source,
        regulationScore: settled.score,
        providerFinalScore: match.home_score === null || match.away_score === null ? null : { home: match.home_score, away: match.away_score },
      },
    };
    const prior = JSON.stringify({ status: row.status, home_score: row.home_score, away_score: row.away_score, inning_scores: row.inning_scores });
    if (!input.apply || prior === JSON.stringify(payload)) continue;
    const { error: updateError } = await supabase.from("games").update(payload).eq("id", row.id).eq("sport", "soccer");
    if (updateError) errors.push(`game ${row.id}: ${updateError.message}`); else updated++;
  }
  return { updated, apiEventsFetched: fixtures.length, finalizedCount, heldSpecialFinals, errors };
}
