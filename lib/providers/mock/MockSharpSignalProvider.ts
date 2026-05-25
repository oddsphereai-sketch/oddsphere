import type { Sport } from "../../types/domain/Sport";
import type {
  ISharpSignalProvider,
  SharpSignalRecord,
} from "../interfaces/ISharpSignalProvider";

import sharpSignalsJson from "./fixtures/sharp_signals.json";
import gamesJson from "./fixtures/games.json";

const SHARP_SIGNALS = sharpSignalsJson as unknown as SharpSignalRecord[];

// Slate-date + sport indexing of games (mock games only have UTC timestamps).
// Mirrors the helper in MockOddsProvider — kept local because the two mocks
// are otherwise independent and we don't want a shared util file just for
// fixture indexing.
type GameMeta = { id: number; sport: Sport; slate: string };
const GAMES_META: GameMeta[] = (gamesJson as unknown as Array<{
  external_id: number;
  sport: Sport;
  game_date: string;
}>).map((g) => {
  const t = new Date(g.game_date);
  const slate =
    t.getUTCHours() < 6
      ? new Date(t.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
      : g.game_date.slice(0, 10);
  return { id: g.external_id, sport: g.sport, slate };
});

function gamesOnSlate(date: string): Set<number> {
  return new Set(GAMES_META.filter((g) => g.slate === date).map((g) => g.id));
}

export class MockSharpSignalProvider implements ISharpSignalProvider {
  async getSharpSignals(
    date: string,
    gameExternalId?: number
  ): Promise<SharpSignalRecord[]> {
    if (gameExternalId !== undefined) {
      return SHARP_SIGNALS.filter(
        (s) => s.game_external_id === gameExternalId
      );
    }
    const ids = gamesOnSlate(date);
    return SHARP_SIGNALS.filter((s) => ids.has(s.game_external_id));
  }
}
