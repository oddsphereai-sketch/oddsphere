/**
 * Phase 7B v0c-DE — NBA Daily Edge shell (slate + reader).
 *
 * Layout mirrors the MLB Daily Edge reader-on-right pattern:
 *   • Left column: scrollable slate of NbaSlateCards (1 per game)
 *   • Right column: reader for the selected game (NbaReader)
 *   • Mobile: stacked — slate first, reader expands below the selected card
 *
 * Internal/admin only — never member-facing.
 */

"use client";

import { useState } from "react";
import type { NbaDailyEdgeDto } from "@/lib/services/nba/buildNbaDailyEdgeDto";
import { NbaSlateCard } from "./NbaSlateCard";
import { NbaReader } from "./NbaReader";

export function NbaDailyEdgeShell({ dto }: { dto: NbaDailyEdgeDto }) {
  const initialSelected = dto.games[0]?.game_external_id ?? null;
  const [selected, setSelected] = useState<number | null>(initialSelected);

  const selectedGame =
    selected === null
      ? null
      : dto.games.find((g) => g.game_external_id === selected) ?? null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200">
      {/* Top notice band */}
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] uppercase tracking-wider text-amber-200">
        {dto.notice} · Slate {dto.slate_date_et} ET · {dto.games.length}{" "}
        {dto.games.length === 1 ? "game" : "games"}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Slate column */}
        <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 px-1 mb-1">
            Slate · {dto.slate_date_et}
          </div>
          {dto.games.length === 0 ? (
            <div className="rounded-lg border border-gray-700/40 bg-gray-900/40 p-4 text-sm text-gray-500">
              No NBA games on this slate.
            </div>
          ) : (
            dto.games.map((g) => (
              <NbaSlateCard
                key={g.game_external_id}
                game={g}
                selected={selected === g.game_external_id}
                onSelect={() => setSelected(g.game_external_id)}
              />
            ))
          )}
        </aside>

        {/* Reader column */}
        <main>
          {selectedGame === null ? (
            <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-8 text-center text-sm text-gray-500">
              Select a game from the slate to view the full Daily Edge read.
            </div>
          ) : (
            <NbaReader
              game={selectedGame}
              injuryIngestEnabled={dto.injury_ingest_enabled}
            />
          )}
        </main>
      </div>
    </div>
  );
}
