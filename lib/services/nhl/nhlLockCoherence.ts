import {
  NHL_REGULAR_MODEL_RELEASE,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../automodel/nhlRegularModelV1";

export const NHL_LOCK_COHERENCE_RELEASE =
  "nhl_lock_coherence_2026_09_29_r1_current_release_tuple" as const;

type NhlLockRow = {
  game_id: number;
  market: string;
  pick: string;
  model_version: string;
  locked_at: string | null;
  snapshot_json: unknown;
};

export function assessNhlLockCoherence(opts: {
  gameIds: number[];
  rows: NhlLockRow[];
}): {
  checked: number;
  coherentGameIds: number[];
  blockedGameIds: number[];
  errors: string[];
} {
  const coherentGameIds: number[] = [];
  const blockedGameIds: number[] = [];
  const errors: string[] = [];
  const requiredMarkets = ["moneyline", "total", "spread"];

  for (const gameId of opts.gameIds) {
    const rows = opts.rows.filter((row) => row.game_id === gameId);
    const byMarket = new Map(rows.map((row) => [row.market, row]));
    const missing = requiredMarkets.filter((market) => !byMarket.has(market));
    if (rows.length !== 3 || missing.length > 0) {
      blockedGameIds.push(gameId);
      errors.push(`game_id=${gameId}: incomplete current NHL tuple (${rows.length}/3; missing=${missing.join(",") || "none"})`);
      continue;
    }
    const decoded = rows.map((row) => {
      const payload = row.snapshot_json as {
        model_output?: NhlModelOutput;
        feature_inputs?: NhlFeatureSnapshot;
      } | null;
      return { row, model: payload?.model_output, snapshot: payload?.feature_inputs };
    });
    const identity = decoded[0]?.model && decoded[0]?.snapshot
      ? JSON.stringify({ model: decoded[0].model, snapshot: decoded[0].snapshot })
      : null;
    const valid = identity !== null && decoded.every(({ row, model, snapshot }) => (
      row.model_version === NHL_REGULAR_MODEL_RELEASE
      && row.locked_at === null
      && model?.model_version === NHL_REGULAR_MODEL_RELEASE
      && snapshot?.game_type === 2
      && JSON.stringify({ model, snapshot }) === identity
    ));
    const picksAgree = valid
      && byMarket.get("moneyline")?.pick === decoded[0]!.model!.moneyline.pick
      && byMarket.get("total")?.pick === decoded[0]!.model!.total.pick
      && byMarket.get("spread")?.pick === decoded[0]!.model!.puck_line.pick;
    if (!picksAgree) {
      blockedGameIds.push(gameId);
      errors.push(`game_id=${gameId}: NHL score/pick/release tuple is incoherent`);
      continue;
    }
    coherentGameIds.push(gameId);
  }

  return {
    checked: opts.gameIds.length,
    coherentGameIds,
    blockedGameIds,
    errors,
  };
}
