/**
 * Phase 7B v0c-DE — NBA source/provenance badges.
 *
 * Shows which sources fed the per-game data block so the operator can
 * judge confidence. Honest: when a source is missing, the badge stays
 * dim rather than disappearing.
 */

import type { SourceBadges } from "@/lib/services/nba/nbaMarketIntelligence";
import type { NbaSnapshotProvenance } from "@/lib/services/nba/featureSnapshot";

function Badge({ label, on, caveat }: { label: string; on: boolean; caveat?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wider ${
        on
          ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-300"
          : "bg-gray-800/40 border-gray-700/40 text-gray-500"
      }`}
      title={caveat}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-gray-500"}`} />
      {label}
    </span>
  );
}

export function NbaSourceBadges({
  sources,
  provenance,
  injuryIngestEnabled,
}: {
  sources: SourceBadges;
  provenance: NbaSnapshotProvenance;
  injuryIngestEnabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Badge label="ESPN schedule" on={provenance.schedule_source === "espn_scoreboard"} />
      <Badge
        label={`BBR ratings (${provenance.home_ratings.populated ? "H" : "h·"}${provenance.away_ratings.populated ? "A" : "a·"})`}
        on={provenance.home_ratings.populated && provenance.away_ratings.populated}
        caveat={
          provenance.home_ratings.source_url ?? "Basketball Reference advanced-team table"
        }
      />
      <Badge label={`SharpAPI odds (${sources.book_count} ${sources.book_count === 1 ? "book" : "books"})`} on={sources.has_lines} />
      <Badge label="SharpAPI splits" on={sources.has_splits} caveat="Consensus only — no per-book splits" />
      <Badge label="SharpAPI EV" on={sources.has_opportunities} />
      <Badge
        label={injuryIngestEnabled ? "ESPN injuries" : "Injuries (not enabled)"}
        on={injuryIngestEnabled && provenance.injuries_source === "espn"}
        caveat={injuryIngestEnabled ? undefined : "Set NBA_INJURY_INGEST_ENABLED=true to enable"}
      />
      <Badge
        label={provenance.series_priors_found ? "Series context (priors)" : "Series context (none)"}
        on={provenance.series_priors_found}
      />
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wider bg-amber-500/10 border-amber-500/35 text-amber-300">
        Provisional / internal
      </span>
    </div>
  );
}
