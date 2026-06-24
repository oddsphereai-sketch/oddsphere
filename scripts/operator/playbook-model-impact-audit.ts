/**
 * Playbook model-impact audit (READ-ONLY).
 *
 * Ticket: o-playbook-model-impact-audit.
 *
 * Compares the current DB-backed market/grade path against a proposed
 * Playbook-backed public-splits overlay. It does NOT write sharp_signals,
 * game_predictions, grades, UI fields, tracking rows, or line movement.
 *
 * Initial scope: MLB, because MLB already has current SharpAPI public splits
 * and Playbook public splits. Other sports can reuse this once their split
 * lanes exist.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-model-impact-audit.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--json] [--out path.json]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { supabase } from "../../lib/db/supabase";
import { todayUTC, readStringFlag, readBoolFlag } from "./_cliCommon";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookSplitGame } from "../../lib/providers/playbook/types";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import {
  deriveMarketSignal,
  type MarketSignalSource,
} from "../../lib/services/marketSignalDerivationService";
import { classifyEvidence } from "../../lib/services/signalEvidenceClassifier";
import { deriveGrade } from "../../lib/services/gradeDerivationService";
import type { Side } from "../../lib/types/domain/Lines";
import type { Grade, MarketSignal } from "../../lib/types/domain/Grade";

type Sport = "mlb";
type MarketKey = "ml" | "ou";
type MarketType = "moneyline" | "total";

type TeamRow = { id: number; abbreviation: string | null; name: string | null };
type GameRow = {
  id: number;
  home_team_id: number;
  away_team_id: number;
  slate_date: string;
  sport: string;
};
type PredictionRow = {
  id: number;
  game_id: number | null;
  predicted_ml_winner: Side | null;
  predicted_ou_side: Side | null;
  ml_confidence: number | null;
  ou_confidence: number | null;
  ml_market_signal: MarketSignal | null;
  ou_market_signal: MarketSignal | null;
  ml_grade: Grade | null;
  ou_grade: Grade | null;
  ml_signal_type: string | null;
  ou_signal_type: string | null;
  sport_specific: Record<string, unknown> | null;
};
type SharpSignalRow = {
  game_id: number;
  market_type: string;
  side: Side;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  has_steam_move: boolean | null;
  steam_books_count: number | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

type AuditRow = {
  game: string;
  market: MarketType;
  modelSide: Side;
  current: {
    bets: number | null;
    money: number | null;
    marketSignal: MarketSignal | null;
    grade: Grade | null;
  };
  playbook: {
    bets: number | null;
    money: number | null;
    booksUsed: number | null;
    publicSide: Side | null;
    marketSignal: MarketSignal;
    grade: Grade | null;
  };
  changed: {
    publicPct: boolean;
    marketSignal: boolean;
    grade: boolean;
    publicMoneyConflict: boolean;
    bestAngle: boolean;
  };
  tracking: {
    currentBestAngle: boolean | null;
    currentPublicMoneyConflict: boolean;
    playbookPublicMoneyConflict: boolean;
    bestAngleImpact: "none" | "demote" | "possible_restore";
  };
  note?: string;
};

type PredictionRecordAuditRow = {
  game_id: number;
  market: MarketType;
  best_angle: boolean | null;
};

const API_KEY = process.env.PLAYBOOK_API_KEY ?? "";

function redact(s: string): string {
  return API_KEY ? s.split(API_KEY).join("***REDACTED***") : s;
}

function gameKeyFromTeams(away: string | null, home: string | null): string | null {
  if (!away || !home) return null;
  return `${away}@${home}`;
}

function playbookGameKey(row: PlaybookSplitGame): string | null {
  const away = normalizeMlbTeamName(row.awayTeamName ?? "");
  const home = normalizeMlbTeamName(row.homeTeamName ?? "");
  return away && home ? `${away}@${home}` : null;
}

function pctChanged(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) >= 0.5;
}

function signalSource(row: SharpSignalRow | null): MarketSignalSource | null {
  if (row === null) return null;
  return {
    side: row.side,
    is_plus_ev: row.is_plus_ev ?? false,
    ev_pct: row.ev_pct,
    has_steam_move: row.has_steam_move ?? false,
    steam_books_count: row.steam_books_count,
    has_reverse_line_movement: row.has_reverse_line_movement ?? false,
    rlm_direction: row.rlm_direction,
    public_betting_pct: row.public_betting_pct,
    public_money_pct: row.public_money_pct,
  };
}

function withPlaybookPublic(
  current: SharpSignalRow | null,
  publicSide: Side,
  bets: number | null,
  money: number | null
): MarketSignalSource {
  return {
    side: current?.side ?? publicSide,
    is_plus_ev: current?.is_plus_ev ?? false,
    ev_pct: current?.ev_pct ?? null,
    has_steam_move: current?.has_steam_move ?? false,
    steam_books_count: current?.steam_books_count ?? null,
    has_reverse_line_movement: current?.has_reverse_line_movement ?? false,
    rlm_direction: current?.rlm_direction ?? null,
    public_betting_pct: bets,
    public_money_pct: money,
  };
}

function playbookPublicFor(
  row: PlaybookSplitGame | undefined,
  market: MarketType
): { side: Side | null; bets: number | null; money: number | null; booksUsed: number | null } {
  if (!row?.splits) return { side: null, bets: null, money: null, booksUsed: null };
  if (market === "moneyline") {
    const m = row.splits.moneyline;
    const homeBets = m?.bets?.homePercent ?? null;
    const awayBets = m?.bets?.awayPercent ?? null;
    const side: Side | null =
      homeBets === null && awayBets === null
        ? null
        : (homeBets ?? -1) >= (awayBets ?? -1)
          ? "home"
          : "away";
    return {
      side,
      bets: side === "home" ? homeBets : side === "away" ? awayBets : null,
      money: side === "home" ? m?.money?.homePercent ?? null : side === "away" ? m?.money?.awayPercent ?? null : null,
      booksUsed: m?.source?.booksUsed ?? null,
    };
  }

  const t = row.splits.total;
  const overBets = t?.bets?.overPercent ?? null;
  const underBets = t?.bets?.underPercent ?? null;
  const side: Side | null =
    overBets === null && underBets === null
      ? null
      : (overBets ?? -1) >= (underBets ?? -1)
        ? "over"
        : "under";
  return {
    side,
    bets: side === "over" ? overBets : side === "under" ? underBets : null,
    money: side === "over" ? t?.money?.overPercent ?? null : side === "under" ? t?.money?.underPercent ?? null : null,
    booksUsed: t?.source?.booksUsed ?? null,
  };
}

function oppositeSide(market: MarketType, side: Side): Side | null {
  if (market === "moneyline") {
    if (side === "home") return "away";
    if (side === "away") return "home";
    return null;
  }
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function publicMoneyConflictFromSignals(
  signals: ReadonlyArray<SharpSignalRow>,
  market: MarketType,
  modelSide: Side
): boolean {
  const opp = oppositeSide(market, modelSide);
  if (opp === null) return false;
  const row = signals.find((s) => s.market_type === market && s.side === opp);
  if (!row) return false;
  const money = row.public_money_pct;
  const bets = row.public_betting_pct;
  return money !== null && bets !== null && money >= 60 && money - bets >= 15;
}

function publicMoneyConflictFromPlaybook(
  row: PlaybookSplitGame | undefined,
  market: MarketType,
  modelSide: Side
): boolean {
  const opp = oppositeSide(market, modelSide);
  if (opp === null || !row?.splits) return false;
  if (market === "moneyline") {
    const m = row.splits.moneyline;
    const money = opp === "home" ? m?.money?.homePercent ?? null : m?.money?.awayPercent ?? null;
    const bets = opp === "home" ? m?.bets?.homePercent ?? null : m?.bets?.awayPercent ?? null;
    return money !== null && bets !== null && money >= 60 && money - bets >= 15;
  }
  const t = row.splits.total;
  const money = opp === "over" ? t?.money?.overPercent ?? null : t?.money?.underPercent ?? null;
  const bets = opp === "over" ? t?.bets?.overPercent ?? null : t?.bets?.underPercent ?? null;
  return money !== null && bets !== null && money >= 60 && money - bets >= 15;
}

function bestAngleImpact(
  currentBestAngle: boolean | null,
  currentConflict: boolean,
  playbookConflict: boolean
): AuditRow["tracking"]["bestAngleImpact"] {
  if (currentBestAngle === true && !currentConflict && playbookConflict) return "demote";
  if (currentBestAngle === false && currentConflict && !playbookConflict) return "possible_restore";
  return "none";
}

function edgeForModelSide(signal: SharpSignalRow | null, modelSide: Side): number | null {
  if (!signal) return null;
  return signal.side === modelSide ? signal.ev_pct : null;
}

function confidenceFor(pred: PredictionRow, key: MarketKey): number | null {
  return key === "ml" ? pred.ml_confidence : pred.ou_confidence;
}

function currentMarketSignal(pred: PredictionRow, key: MarketKey): MarketSignal | null {
  return key === "ml" ? pred.ml_market_signal : pred.ou_market_signal;
}

function currentGrade(pred: PredictionRow, key: MarketKey): Grade | null {
  return key === "ml" ? pred.ml_grade : pred.ou_grade;
}

function gradeWith(
  pred: PredictionRow,
  key: MarketKey,
  marketSignal: MarketSignal,
  modelSide: Side,
  signal: MarketSignalSource,
  currentSignal: SharpSignalRow | null
): Grade | null {
  const modelEdgePct = edgeForModelSide(currentSignal, modelSide);
  const sportSpecific = pred.sport_specific ?? {};
  const listedLineRaw = sportSpecific.listed_line;
  const out = deriveGrade({
    kind: "game",
    modelEdgePct,
    marketSignal,
    evidence: classifyEvidence(modelSide, signal),
    modelConfidence: confidenceFor(pred, key),
    starterConfirmed: sportSpecific.starter_confirmed === true,
    opposingDeterministicWarning: sportSpecific.opposing_deterministic_warning === true,
    marketLineAvailable: typeof listedLineRaw === "number",
  });
  return out.grade;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("This audit is READ-ONLY. --write is not supported.");
    process.exit(1);
  }
  const sport = (readStringFlag(argv, "--sport") ?? "mlb") as Sport;
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");
  const outPath = readStringFlag(argv, "--out");
  if (sport !== "mlb") {
    console.error("Initial model-impact audit supports --sport mlb only.");
    process.exit(1);
  }
  if (!API_KEY) {
    console.error("PLAYBOOK_API_KEY missing from .env.local.");
    process.exit(1);
  }

  console.log(`[playbook-model-impact-audit] sport=${sport} date=${date} mode=READ-ONLY`);

  const { data: teamsRaw } = await supabase.from("teams").select("id, abbreviation, name");
  const teamAbbr = new Map<number, string>();
  for (const t of (teamsRaw ?? []) as TeamRow[]) {
    teamAbbr.set(t.id, t.abbreviation ?? t.name ?? "");
  }

  const { data: gamesRaw } = await supabase
    .from("games")
    .select("id, home_team_id, away_team_id, slate_date, sport")
    .eq("sport", sport)
    .eq("slate_date", date);
  const games = (gamesRaw ?? []) as GameRow[];
  const gameKeyById = new Map<number, string>();
  for (const g of games) {
    const key = gameKeyFromTeams(teamAbbr.get(g.away_team_id) ?? null, teamAbbr.get(g.home_team_id) ?? null);
    if (key) gameKeyById.set(g.id, key);
  }
  const gameIds = games.map((g) => g.id);

  const client = new PlaybookClient(API_KEY);
  const pb = await client.splits("mlb");
  const pbByKey = new Map<string, PlaybookSplitGame>();
  for (const row of pb.body.data ?? []) {
    const key = playbookGameKey(row);
    if (key) pbByKey.set(key, row);
  }

  const { data: predsRaw } = await supabase
    .from("game_predictions")
    .select(
      "id, game_id, predicted_ml_winner, predicted_ou_side, ml_confidence, ou_confidence, ml_market_signal, ou_market_signal, ml_grade, ou_grade, ml_signal_type, ou_signal_type, sport_specific"
    )
    .in("game_id", gameIds);
  const preds = (predsRaw ?? []) as unknown as PredictionRow[];

  const { data: signalsRaw } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct"
    )
    .in("game_id", gameIds);
  const signalByGameMarket = new Map<string, SharpSignalRow>();
  const signalsByGame = new Map<number, SharpSignalRow[]>();
  for (const s of (signalsRaw ?? []) as SharpSignalRow[]) {
    signalByGameMarket.set(`${s.game_id}:${s.market_type}`, s);
    if (!signalsByGame.has(s.game_id)) signalsByGame.set(s.game_id, []);
    signalsByGame.get(s.game_id)!.push(s);
  }

  const { data: recordsRaw } = await supabase
    .from("prediction_records")
    .select("game_id, market, best_angle")
    .eq("sport", sport)
    .eq("slate_date", date)
    .in("market", ["moneyline", "total"]);
  const bestAngleByGameMarket = new Map<string, boolean | null>();
  for (const r of (recordsRaw ?? []) as PredictionRecordAuditRow[]) {
    bestAngleByGameMarket.set(`${r.game_id}:${r.market}`, r.best_angle);
  }

  const rows: AuditRow[] = [];
  for (const pred of preds) {
    if (pred.game_id === null) continue;
    const game = gameKeyById.get(pred.game_id);
    if (!game) continue;
    const pbRow = pbByKey.get(game);

    const markets: Array<{ key: MarketKey; type: MarketType; side: Side | null }> = [
      { key: "ml", type: "moneyline", side: pred.predicted_ml_winner },
      { key: "ou", type: "total", side: pred.predicted_ou_side },
    ];

    for (const m of markets) {
      if (m.side === null) continue;
      const currentSignal = signalByGameMarket.get(`${pred.game_id}:${m.type}`) ?? null;
      const currentSource = signalSource(currentSignal);
      const currentMs = currentMarketSignal(pred, m.key);
      const currentGr = currentGrade(pred, m.key);
      const pbPublic = playbookPublicFor(pbRow, m.type);

      if (pbPublic.side === null) {
        const currentConflict = publicMoneyConflictFromSignals(
          signalsByGame.get(pred.game_id) ?? [],
          m.type,
          m.side
        );
        const currentBestAngle = bestAngleByGameMarket.get(`${pred.game_id}:${m.type}`) ?? null;
        rows.push({
          game,
          market: m.type,
          modelSide: m.side,
          current: {
            bets: currentSignal?.public_betting_pct ?? null,
            money: currentSignal?.public_money_pct ?? null,
            marketSignal: currentMs,
            grade: currentGr,
          },
          playbook: {
            bets: null,
            money: null,
            booksUsed: null,
            publicSide: null,
            marketSignal: currentMs ?? "market_neutral",
            grade: currentGr,
          },
          changed: {
            publicPct: false,
            marketSignal: false,
            grade: false,
            publicMoneyConflict: false,
            bestAngle: false,
          },
          tracking: {
            currentBestAngle,
            currentPublicMoneyConflict: currentConflict,
            playbookPublicMoneyConflict: currentConflict,
            bestAngleImpact: "none",
          },
          note: "no Playbook public split row matched this game/market",
        });
        continue;
      }

      const proposedSource = withPlaybookPublic(currentSignal, pbPublic.side, pbPublic.bets, pbPublic.money);
      const proposedMs = deriveMarketSignal(m.side, proposedSource);
      const proposedGrade = gradeWith(pred, m.key, proposedMs, m.side, proposedSource, currentSignal);
      const currentDerivedMs = currentSource ? deriveMarketSignal(m.side, currentSource) : "market_neutral";
      const currentSignalForCompare = currentMs ?? currentDerivedMs;
      const currentConflict = publicMoneyConflictFromSignals(
        signalsByGame.get(pred.game_id) ?? [],
        m.type,
        m.side
      );
      const proposedConflict = publicMoneyConflictFromPlaybook(pbRow, m.type, m.side);
      const currentBestAngle = bestAngleByGameMarket.get(`${pred.game_id}:${m.type}`) ?? null;
      const baImpact = bestAngleImpact(currentBestAngle, currentConflict, proposedConflict);

      rows.push({
        game,
        market: m.type,
        modelSide: m.side,
        current: {
          bets: currentSignal?.public_betting_pct ?? null,
          money: currentSignal?.public_money_pct ?? null,
          marketSignal: currentMs,
          grade: currentGr,
        },
        playbook: {
          bets: pbPublic.bets,
          money: pbPublic.money,
          booksUsed: pbPublic.booksUsed,
          publicSide: pbPublic.side,
          marketSignal: proposedMs,
          grade: proposedGrade,
        },
        changed: {
          publicPct:
            pctChanged(currentSignal?.public_betting_pct ?? null, pbPublic.bets) ||
            pctChanged(currentSignal?.public_money_pct ?? null, pbPublic.money),
          marketSignal: currentSignalForCompare !== proposedMs,
          grade: currentGr !== proposedGrade,
          publicMoneyConflict: currentConflict !== proposedConflict,
          bestAngle: baImpact !== "none",
        },
        tracking: {
          currentBestAngle,
          currentPublicMoneyConflict: currentConflict,
          playbookPublicMoneyConflict: proposedConflict,
          bestAngleImpact: baImpact,
        },
      });
    }
  }

  const summary = {
    sport,
    date,
    gamesInDb: games.length,
    playbookGamesMatched: [...gameKeyById.values()].filter((k) => pbByKey.has(k)).length,
    marketsAudited: rows.length,
    publicPctChanges: rows.filter((r) => r.changed.publicPct).length,
    marketSignalChanges: rows.filter((r) => r.changed.marketSignal).length,
    gradeChanges: rows.filter((r) => r.changed.grade).length,
    publicMoneyConflictChanges: rows.filter((r) => r.changed.publicMoneyConflict).length,
    bestAngleDemotions: rows.filter((r) => r.tracking.bestAngleImpact === "demote").length,
    bestAnglePossibleRestores: rows.filter((r) => r.tracking.bestAngleImpact === "possible_restore").length,
    noPlaybookMatch: rows.filter((r) => r.note).length,
  };
  const changedRows = rows.filter(
    (r) =>
      r.changed.publicPct ||
      r.changed.marketSignal ||
      r.changed.grade ||
      r.changed.publicMoneyConflict ||
      r.changed.bestAngle
  );
  const artifact = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary,
    changedRows,
    rows,
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  if (json) {
    console.log(JSON.stringify(artifact, null, 2));
  } else {
    console.log("\nSummary");
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
    console.log("\nChanged rows (first 25)");
    for (const r of changedRows.slice(0, 25)) {
      console.log(
        `  ${r.game} ${r.market} model=${r.modelSide} ` +
          `current ${r.current.bets ?? "-"}b/${r.current.money ?? "-"}m ${r.current.marketSignal ?? "-"} ${r.current.grade ?? "-"} ` +
          `→ playbook ${r.playbook.bets ?? "-"}b/${r.playbook.money ?? "-"}m books=${r.playbook.booksUsed ?? "-"} ` +
          `${r.playbook.marketSignal} ${r.playbook.grade ?? "-"} ` +
          `ba=${r.tracking.currentBestAngle ?? "-"} conflict ${r.tracking.currentPublicMoneyConflict ? "Y" : "n"}→${r.tracking.playbookPublicMoneyConflict ? "Y" : "n"} impact=${r.tracking.bestAngleImpact}`
      );
    }
    if (changedRows.length > 25) console.log(`  ... ${changedRows.length - 25} more changed rows`);
    if (outPath) console.log(`\nArtifact written: ${outPath}`);
    console.log("\n✓ Read-only audit complete. No DB/UI/grading/line-movement writes.");
  }
}

main().catch((e) => {
  console.error(`FATAL: ${redact((e as Error).message ?? String(e))}`);
  process.exit(2);
});
