import { fetchNbaLiveRosterSnapshot, type NbaLiveRosterSnapshot } from "../../automodel/nba/nbaRosterRegime";
/** One authoritative collection per rolling-board request, including a known
 * unavailable result. No process cache, retry, writer or additional request. */
export function createNbaRequestRosterLoader(load: () => Promise<NbaLiveRosterSnapshot> = fetchNbaLiveRosterSnapshot): () => Promise<NbaLiveRosterSnapshot> {
  let pending: Promise<NbaLiveRosterSnapshot> | undefined;
  return () => pending ??= Promise.resolve().then(load);
}
