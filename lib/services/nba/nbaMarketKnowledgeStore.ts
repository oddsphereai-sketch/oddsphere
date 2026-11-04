import type { SupabaseClient } from "@supabase/supabase-js";
import { isNbaMarketKnowledgeState, type NbaMarketKnowledgeState } from "./nbaMarketConsequence";
import { NBA_MODEL_RELEASE, NBA_PREVIOUS_MODEL_RELEASE } from "../../automodel/nba/nbaChampionRuntime";

/** Read the existing sole writer's unlocked captures. Any surviving market
 * can carry state when ML is held; duplicate market copies must agree. No new
 * table, writer or response-time persistence is introduced.
 */
export async function loadNbaMarketKnowledgeStates(args: {
  client: SupabaseClient; slateDate: string; modelRelease: string; externalIdByDbId: ReadonlyMap<number, number>;
}): Promise<Map<number, NbaMarketKnowledgeState>> {
  const result = new Map<number, NbaMarketKnowledgeState>();
  if (!args.externalIdByDbId.size) return result;
  const read = (modelRelease: string, gameIds: readonly number[]) => args.client.from("prediction_records")
    .select("game_id,market,knowledge:snapshot_json->nba_game_dto_at_capture->grounding_audit->market_reader_knowledge_state")
    .eq("sport", "nba").eq("slate_date", args.slateDate).eq("model_version", modelRelease)
    .in("market", ["moneyline", "spread", "total"]).in("game_id", [...gameIds])
    .is("locked_at", null).limit(gameIds.length * 3 + 1);
  const prior = await read(args.modelRelease, [...args.externalIdByDbId.keys()]);
  if (prior.error) throw new Error(`NBA market knowledge-state lookup failed: ${prior.error.message}`);
  const rows = (prior.data ?? []) as unknown as { game_id: number; market: string; knowledge: unknown }[];
  if (rows.length > args.externalIdByDbId.size * 3 || new Set(rows.map(r => `${r.game_id}:${r.market}`)).size !== rows.length)
    throw new Error("NBA market knowledge-state identity is ambiguous");
  for (const row of rows) {
    const externalId = args.externalIdByDbId.get(row.game_id);
    if (externalId === undefined || row.knowledge == null) continue; // First-release bootstrap only.
    if (!isNbaMarketKnowledgeState(row.knowledge) || row.knowledge.eventId !== String(externalId))
      throw new Error("NBA stored market knowledge-state is corrupt; refusing a silent epoch reset");
    const existing = result.get(externalId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row.knowledge)) throw new Error("NBA stored market knowledge-state copies disagree");
    result.set(externalId, row.knowledge);
  }
  // This release changes pressure attribution, not the numerical forecast or
  // market knowledge epoch. Carry only its exact predecessor's unlocked state
  // when the current release has no state for that game; never reset anchors
  // merely because the grade/model stamp advances. Current state always wins.
  const missing = [...args.externalIdByDbId].filter(([, externalId]) => !result.has(externalId));
  if (args.modelRelease === NBA_MODEL_RELEASE && missing.length) {
    const previous = await loadNbaMarketKnowledgeStates({ ...args, modelRelease: NBA_PREVIOUS_MODEL_RELEASE,
      externalIdByDbId: new Map(missing) });
    for (const [externalId, knowledge] of previous) result.set(externalId, knowledge);
  }
  return result;
}
