/**
 * MLB Playbook public-splits PROMOTION audit (READ-ONLY, multi-slate).
 *
 * Ticket: o-mlb-playbook-splits-shadow.
 *
 * Decision support: should Playbook become the MLB PRIMARY public-splits
 * provider (SharpAPI backstop) without hurting grades / Best Angle / ROI?
 *
 * Methodology mirrors Codex's ratified single-slate harness
 * (scripts/operator/playbook-model-impact-audit.ts): load the locked DB state,
 * then re-run the REAL pipeline (deriveMarketSignal + classifyEvidence +
 * deriveGrade) twice per market — once with the stored SharpAPI public split,
 * once with the Playbook public split — EVERYTHING ELSE IDENTICAL. Only
 * public_betting_pct / public_money_pct differ between the two runs; +EV /
 * fair-prob / steam / RLM / odds are untouched (Playbook never supplies them).
 *
 * Multi-slate: iterates a date range and pulls Playbook splits via
 * /v1/splits-history (frozen pregame) so past slates can be compared.
 *
 * Symmetric A/B on the MODEL side: for each market we compare the model-side
 * SharpAPI public% vs the model-side Playbook public% through the same code
 * path — isolating the PROVIDER effect (not stored-vs-recompute drift).
 *
 * READ-ONLY: no DB/UI/grade/tracking/line-movement writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-mlb-splits-promotion-audit.ts \
 *     [--from 2026-06-10] [--to 2026-06-24] [--json]
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag } from "./_cliCommon";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookSplitGame } from "../../lib/providers/playbook/types";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import { deriveMarketSignal, type MarketSignalSource } from "../../lib/services/marketSignalDerivationService";
import { classifyEvidence, classifySharpDivergenceTier } from "../../lib/services/signalEvidenceClassifier";
import { deriveGrade } from "../../lib/services/gradeDerivationService";
import type { Side } from "../../lib/types/domain/Lines";
import type { Grade, MarketSignal } from "../../lib/types/domain/Grade";
import { profitMultiplier } from "../../lib/utils/odds";

type MarketType = "moneyline" | "total";
type MarketKey = "ml" | "ou";

const API_KEY = process.env.PLAYBOOK_API_KEY ?? "";
function redact(s: string): string { return API_KEY ? s.split(API_KEY).join("***") : s; }

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(+d + 86400000); }
  return out;
}

type SharpRow = {
  game_id: number; market_type: string; side: Side;
  is_plus_ev: boolean | null; ev_pct: number | null;
  has_steam_move: boolean | null; steam_books_count: number | null;
  has_reverse_line_movement: boolean | null; rlm_direction: string | null;
  public_betting_pct: number | null; public_money_pct: number | null;
};

function sourceFrom(row: SharpRow | null, bets: number | null, money: number | null): MarketSignalSource | null {
  if (!row) return null;
  return {
    side: row.side, is_plus_ev: row.is_plus_ev ?? false, ev_pct: row.ev_pct,
    has_steam_move: row.has_steam_move ?? false, steam_books_count: row.steam_books_count,
    has_reverse_line_movement: row.has_reverse_line_movement ?? false, rlm_direction: row.rlm_direction,
    public_betting_pct: bets, public_money_pct: money,
  };
}

/** Playbook public bet%/money% for an EXACT side (model side), per market. */
function pbForSide(pb: PlaybookSplitGame | undefined, market: MarketType, side: Side): { bets: number | null; money: number | null; booksUsed: number | null } {
  if (!pb?.splits) return { bets: null, money: null, booksUsed: null };
  if (market === "moneyline") {
    const m = pb.splits.moneyline;
    const bets = side === "home" ? m?.bets?.homePercent ?? null : side === "away" ? m?.bets?.awayPercent ?? null : null;
    const money = side === "home" ? m?.money?.homePercent ?? null : side === "away" ? m?.money?.awayPercent ?? null : null;
    return { bets, money, booksUsed: m?.source?.booksUsed ?? null };
  }
  const t = pb.splits.total;
  const bets = side === "over" ? t?.bets?.overPercent ?? null : side === "under" ? t?.bets?.underPercent ?? null : null;
  const money = side === "over" ? t?.money?.overPercent ?? null : side === "under" ? t?.money?.underPercent ?? null : null;
  return { bets, money, booksUsed: t?.source?.booksUsed ?? null };
}

function oppositeSide(market: MarketType, side: Side): Side | null {
  if (market === "moneyline") return side === "home" ? "away" : side === "away" ? "home" : null;
  return side === "over" ? "under" : side === "under" ? "over" : null;
}

/** Opposing-public-money conflict guard (predictionRecordService rule). */
function conflict(betsOpp: number | null, moneyOpp: number | null): boolean {
  return moneyOpp !== null && betsOpp !== null && moneyOpp >= 60 && moneyOpp - betsOpp >= 15;
}

function gradeOf(
  source: MarketSignalSource, ms: MarketSignal, modelSide: Side,
  sharpRow: SharpRow | null, conf: number | null, ss: Record<string, unknown>
): Grade | null {
  const modelEdgePct = sharpRow && sharpRow.side === modelSide ? sharpRow.ev_pct : null;
  return deriveGrade({
    kind: "game", modelEdgePct, marketSignal: ms,
    evidence: classifyEvidence(modelSide, source),
    modelConfidence: conf,
    starterConfirmed: ss.starter_confirmed === true,
    opposingDeterministicWarning: ss.opposing_deterministic_warning === true,
    marketLineAvailable: typeof ss.listed_line === "number",
  }).grade;
}

type SlateStat = {
  date: string; gamesDb: number; pbGames: number; matched: number; marketsAudited: number;
  noSharp: number; noPlaybook: number;
  publicPctChanged: number; marketSignalChanged: number; gradeChanged: number;
  publicSmokeFlipped: number; divergenceTierChanged: number; conflictChanged: number;
  bestAngleAffected: number; booksUsedPopulated: number;
  gradeChangedWithResult: number; playbookChangeHelped: number; playbookChangeHurt: number; playbookChangeNeutral: number;
  playbookUpgrades: number; playbookDowngrades: number; upgradedUnits: number; downgradedUnits: number;
  byMarket: Record<MarketType, {
    changedWithResult: number;
    helped: number;
    hurt: number;
    upgrades: number;
    downgrades: number;
    upgradedUnits: number;
    downgradedUnits: number;
  }>;
};

type OutcomeRow = {
  game_id: number;
  market: string;
  result: string | null;
  odds_american: number | null;
};

const GRADE_RANK: Record<Grade, number> = {
  market_watch: 0,
  sharp_conflict: 1,
  public_smoke: 2,
  model_only: 3,
  market_led: 3,
  sharp_confirmed: 4,
  best_signal: 5,
};

function resultUnits(result: string | null, odds: number | null): number | null {
  if (odds === null) return null;
  if (result === "win") return profitMultiplier(odds);
  if (result === "loss") return -1;
  if (result === "push" || result === "void") return 0;
  return null;
}

function emptyMarketStats(): SlateStat["byMarket"][MarketType] {
  return {
    changedWithResult: 0,
    helped: 0,
    hurt: 0,
    upgrades: 0,
    downgrades: 0,
    upgradedUnits: 0,
    downgradedUnits: 0,
  };
}

async function auditSlate(client: PlaybookClient, date: string, examples: string[]): Promise<SlateStat> {
  const stat: SlateStat = {
    date, gamesDb: 0, pbGames: 0, matched: 0, marketsAudited: 0, noSharp: 0, noPlaybook: 0,
    publicPctChanged: 0, marketSignalChanged: 0, gradeChanged: 0, publicSmokeFlipped: 0,
    divergenceTierChanged: 0, conflictChanged: 0, bestAngleAffected: 0, booksUsedPopulated: 0,
    gradeChangedWithResult: 0, playbookChangeHelped: 0, playbookChangeHurt: 0, playbookChangeNeutral: 0,
    playbookUpgrades: 0, playbookDowngrades: 0, upgradedUnits: 0, downgradedUnits: 0,
    byMarket: { moneyline: emptyMarketStats(), total: emptyMarketStats() },
  };

  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", "mlb");
  const abbr = new Map<number, string>();
  for (const t of teams ?? []) abbr.set(t.id as number, (t.abbreviation as string) ?? (t.name as string) ?? "");

  const { data: games } = await supabase.from("games").select("id, home_team_id, away_team_id").eq("sport", "mlb").eq("slate_date", date);
  stat.gamesDb = (games ?? []).length;
  if (stat.gamesDb === 0) return stat;
  const keyById = new Map<number, string>();
  for (const g of games ?? []) keyById.set(g.id as number, `${abbr.get(g.away_team_id as number)}@${abbr.get(g.home_team_id as number)}`);
  const ids = (games ?? []).map((g) => g.id as number);

  let pbRows: PlaybookSplitGame[] = [];
  try { const r = await client.splitsHistory("mlb", date); pbRows = ((r.body as { data?: PlaybookSplitGame[] }).data) ?? []; }
  catch (e) { void e; }
  stat.pbGames = pbRows.length;
  const pbByKey = new Map<string, PlaybookSplitGame>();
  for (const r of pbRows) { const a = normalizeMlbTeamName(r.awayTeamName ?? ""); const h = normalizeMlbTeamName(r.homeTeamName ?? ""); if (a && h) pbByKey.set(`${a}@${h}`, r); }
  stat.matched = [...keyById.values()].filter((k) => pbByKey.has(k)).length;

  const { data: preds } = await supabase.from("game_predictions")
    .select("game_id, predicted_ml_winner, predicted_ou_side, ml_confidence, ou_confidence, sport_specific").in("game_id", ids);
  const { data: signals } = await supabase.from("sharp_signals")
    .select("game_id, market_type, side, is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct").in("game_id", ids);
  const byGameMarketSide = new Map<string, SharpRow>();
  for (const s of (signals ?? []) as SharpRow[]) byGameMarketSide.set(`${s.game_id}:${s.market_type}:${s.side}`, s);
  const { data: recs } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, best_angle, odds_american")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .in("market", ["moneyline", "total"]);
  const bestAngleBy = new Map<string, boolean | null>();
  for (const r of recs ?? []) bestAngleBy.set(`${r.game_id}:${r.market}`, r.best_angle as boolean | null);
  const recordIds = (recs ?? []).map((r) => r.id as number);
  const { data: grades } = recordIds.length
    ? await supabase
        .from("prediction_grades")
        .select("prediction_record_id, result")
        .in("prediction_record_id", recordIds)
    : { data: [] };
  const resultByRecordId = new Map((grades ?? []).map((g) => [g.prediction_record_id as number, g.result as string | null]));
  const outcomeBy = new Map<string, OutcomeRow>();
  for (const r of recs ?? []) {
    outcomeBy.set(`${r.game_id}:${r.market}`, {
      game_id: r.game_id as number,
      market: r.market as string,
      result: resultByRecordId.get(r.id as number) ?? null,
      odds_american: r.odds_american as number | null,
    });
  }

  for (const p of preds ?? []) {
    const gid = p.game_id as number;
    const key = keyById.get(gid); if (!key) continue;
    const pb = pbByKey.get(key);
    const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
    const markets: Array<{ key: MarketKey; type: MarketType; side: Side | null; conf: number | null }> = [
      { key: "ml", type: "moneyline", side: p.predicted_ml_winner as Side | null, conf: p.ml_confidence as number | null },
      { key: "ou", type: "total", side: p.predicted_ou_side as Side | null, conf: p.ou_confidence as number | null },
    ];
    for (const m of markets) {
      if (m.side === null) continue;
      stat.marketsAudited++;
      const sharpRow = byGameMarketSide.get(`${gid}:${m.type}:${m.side}`) ?? null;
      if (!sharpRow) { stat.noSharp++; continue; }
      const pbSide = pbForSide(pb, m.type, m.side);
      if (pbSide.bets === null && pbSide.money === null) { stat.noPlaybook++; continue; }
      if (pbSide.booksUsed && pbSide.booksUsed > 0) stat.booksUsedPopulated++;

      // Symmetric A/B on the model side: only public_* differ.
      const srcSharp = sourceFrom(sharpRow, sharpRow.public_betting_pct, sharpRow.public_money_pct)!;
      const srcPb = sourceFrom(sharpRow, pbSide.bets, pbSide.money)!;
      const msSharp = deriveMarketSignal(m.side, srcSharp);
      const msPb = deriveMarketSignal(m.side, srcPb);
      const grSharp = gradeOf(srcSharp, msSharp, m.side, sharpRow, m.conf, ss);
      const grPb = gradeOf(srcPb, msPb, m.side, sharpRow, m.conf, ss);

      // Opposing-money conflict guard: compare opposite-side public on each source.
      const opp = oppositeSide(m.type, m.side);
      const oppSharp = opp ? byGameMarketSide.get(`${gid}:${m.type}:${opp}`) ?? null : null;
      const oppPb = opp ? pbForSide(pb, m.type, opp) : { bets: null, money: null, booksUsed: null };
      const confSharp = conflict(oppSharp?.public_betting_pct ?? null, oppSharp?.public_money_pct ?? null);
      const confPb = conflict(oppPb.bets, oppPb.money);

      const divSharp = classifySharpDivergenceTier(sharpRow.public_betting_pct, sharpRow.public_money_pct);
      const divPb = classifySharpDivergenceTier(pbSide.bets, pbSide.money);

      const pctChanged =
        (sharpRow.public_betting_pct ?? null) === null || pbSide.bets === null
          ? (sharpRow.public_betting_pct ?? null) !== pbSide.bets
          : Math.abs((sharpRow.public_betting_pct ?? 0) - (pbSide.bets ?? 0)) >= 0.5 ||
            Math.abs((sharpRow.public_money_pct ?? 0) - (pbSide.money ?? 0)) >= 0.5;

      if (pctChanged) stat.publicPctChanged++;
      if (msSharp !== msPb) stat.marketSignalChanged++;
      if (grSharp !== grPb) {
        stat.gradeChanged++;
        if (grSharp !== null && grPb !== null) {
          const outcome = outcomeBy.get(`${gid}:${m.type}`) ?? null;
          const units = resultUnits(outcome?.result ?? null, outcome?.odds_american ?? null);
          const rankDelta = GRADE_RANK[grPb] - GRADE_RANK[grSharp];
          if (outcome?.result === "win" || outcome?.result === "loss" || outcome?.result === "push" || outcome?.result === "void") {
            const byMarket = stat.byMarket[m.type];
            byMarket.changedWithResult++;
            stat.gradeChangedWithResult++;
            if (rankDelta > 0) {
              stat.playbookUpgrades++;
              byMarket.upgrades++;
              stat.upgradedUnits += units ?? 0;
              byMarket.upgradedUnits += units ?? 0;
              if (outcome.result === "win") { stat.playbookChangeHelped++; byMarket.helped++; }
              else if (outcome.result === "loss") { stat.playbookChangeHurt++; byMarket.hurt++; }
              else stat.playbookChangeNeutral++;
            } else if (rankDelta < 0) {
              stat.playbookDowngrades++;
              byMarket.downgrades++;
              stat.downgradedUnits += units ?? 0;
              byMarket.downgradedUnits += units ?? 0;
              if (outcome.result === "loss") { stat.playbookChangeHelped++; byMarket.helped++; }
              else if (outcome.result === "win") { stat.playbookChangeHurt++; byMarket.hurt++; }
              else stat.playbookChangeNeutral++;
            } else {
              stat.playbookChangeNeutral++;
            }
          }
        }
      }
      if ((msSharp === "public_smoke") !== (msPb === "public_smoke")) stat.publicSmokeFlipped++;
      if (divSharp !== divPb) stat.divergenceTierChanged++;
      if (confSharp !== confPb) stat.conflictChanged++;
      const ba = bestAngleBy.get(`${gid}:${m.type}`) ?? null;
      const baAffected = (ba === true && !confSharp && confPb) || (grSharp !== grPb && (grSharp === "best_signal" || grPb === "best_signal"));
      if (baAffected) {
        stat.bestAngleAffected++;
        const outcome = outcomeBy.get(`${gid}:${m.type}`);
        if (examples.length < 20) examples.push(`${date} ${key} ${m.type} model=${m.side} sharp ${sharpRow.public_betting_pct}b/${sharpRow.public_money_pct}m ${msSharp}/${grSharp ?? "-"} -> pb ${pbSide.bets}b/${pbSide.money}m ${msPb}/${grPb ?? "-"} confΔ ${confSharp?"Y":"n"}->${confPb?"Y":"n"} result=${outcome?.result ?? "-"}`);
      } else if ((grSharp !== grPb || msSharp !== msPb) && examples.length < 20) {
        const outcome = outcomeBy.get(`${gid}:${m.type}`);
        examples.push(`${date} ${key} ${m.type} model=${m.side} sharp ${sharpRow.public_betting_pct}b/${sharpRow.public_money_pct}m ${msSharp}/${grSharp ?? "-"} -> pb ${pbSide.bets}b/${pbSide.money}m ${msPb}/${grPb ?? "-"} result=${outcome?.result ?? "-"}`);
      }
    }
  }
  return stat;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) { console.error("READ-ONLY. --write unsupported."); process.exit(1); }
  const from = readStringFlag(argv, "--from") ?? "2026-06-10";
  const to = readStringFlag(argv, "--to") ?? "2026-06-24";
  const json = readBoolFlag(argv, "--json");
  if (!API_KEY) { console.error("PLAYBOOK_API_KEY missing."); process.exit(1); }

  console.log(`[playbook-mlb-splits-promotion-audit] ${from}..${to} mode=READ-ONLY`);
  const client = new PlaybookClient(API_KEY);
  const examples: string[] = [];
  const stats: SlateStat[] = [];
  for (const d of eachDate(from, to)) stats.push(await auditSlate(client, d, examples));

  const sum = (f: (s: SlateStat) => number) => stats.reduce((a, s) => a + f(s), 0);
  const agg = {
    slates: stats.filter((s) => s.gamesDb > 0).length,
    gamesDb: sum((s) => s.gamesDb), pbGamesMatched: sum((s) => s.matched),
    marketsAudited: sum((s) => s.marketsAudited), noSharp: sum((s) => s.noSharp), noPlaybook: sum((s) => s.noPlaybook),
    auditedBoth: sum((s) => s.marketsAudited) - sum((s) => s.noSharp) - sum((s) => s.noPlaybook),
    publicPctChanged: sum((s) => s.publicPctChanged),
    marketSignalChanged: sum((s) => s.marketSignalChanged),
    gradeChanged: sum((s) => s.gradeChanged),
    publicSmokeFlipped: sum((s) => s.publicSmokeFlipped),
    divergenceTierChanged: sum((s) => s.divergenceTierChanged),
    conflictChanged: sum((s) => s.conflictChanged),
    bestAngleAffected: sum((s) => s.bestAngleAffected),
    booksUsedPopulated: sum((s) => s.booksUsedPopulated),
    gradeChangedWithResult: sum((s) => s.gradeChangedWithResult),
    playbookChangeHelped: sum((s) => s.playbookChangeHelped),
    playbookChangeHurt: sum((s) => s.playbookChangeHurt),
    playbookChangeNeutral: sum((s) => s.playbookChangeNeutral),
    playbookUpgrades: sum((s) => s.playbookUpgrades),
    playbookDowngrades: sum((s) => s.playbookDowngrades),
    upgradedUnits: Number(sum((s) => s.upgradedUnits).toFixed(2)),
    downgradedUnits: Number(sum((s) => s.downgradedUnits).toFixed(2)),
    byMarket: {
      moneyline: {
        changedWithResult: sum((s) => s.byMarket.moneyline.changedWithResult),
        helped: sum((s) => s.byMarket.moneyline.helped),
        hurt: sum((s) => s.byMarket.moneyline.hurt),
        upgrades: sum((s) => s.byMarket.moneyline.upgrades),
        downgrades: sum((s) => s.byMarket.moneyline.downgrades),
        upgradedUnits: Number(sum((s) => s.byMarket.moneyline.upgradedUnits).toFixed(2)),
        downgradedUnits: Number(sum((s) => s.byMarket.moneyline.downgradedUnits).toFixed(2)),
      },
      total: {
        changedWithResult: sum((s) => s.byMarket.total.changedWithResult),
        helped: sum((s) => s.byMarket.total.helped),
        hurt: sum((s) => s.byMarket.total.hurt),
        upgrades: sum((s) => s.byMarket.total.upgrades),
        downgrades: sum((s) => s.byMarket.total.downgrades),
        upgradedUnits: Number(sum((s) => s.byMarket.total.upgradedUnits).toFixed(2)),
        downgradedUnits: Number(sum((s) => s.byMarket.total.downgradedUnits).toFixed(2)),
      },
    },
  };

  if (json) { console.log(JSON.stringify({ from, to, agg, stats, examples }, null, 2)); return; }

  console.log("\nPer-slate (games | pbMatched | auditedBoth | msΔ | gradeΔ | smokeΔ | divΔ | conflictΔ | BA):");
  for (const s of stats) {
    if (s.gamesDb === 0) continue;
    const both = s.marketsAudited - s.noSharp - s.noPlaybook;
    console.log(`  ${s.date}  ${String(s.gamesDb).padStart(2)}g  pb=${String(s.matched).padStart(2)}  both=${String(both).padStart(3)}  ms=${s.marketSignalChanged}  grade=${s.gradeChanged}  smoke=${s.publicSmokeFlipped}  div=${s.divergenceTierChanged}  conflict=${s.conflictChanged}  BA=${s.bestAngleAffected}`);
  }
  console.log("\n── AGGREGATE (provider A/B: SharpAPI public vs Playbook public, model side) ──");
  for (const [k, v] of Object.entries(agg)) console.log(`  ${k}: ${v}`);
  const pct = (n: number) => agg.auditedBoth ? `${((n / agg.auditedBoth) * 100).toFixed(1)}%` : "n/a";
  console.log(`\n  marketSignal change rate: ${pct(agg.marketSignalChanged)} of ${agg.auditedBoth} both-covered markets`);
  console.log(`  grade change rate:        ${pct(agg.gradeChanged)}`);
  console.log(`  public_smoke flip rate:   ${pct(agg.publicSmokeFlipped)}`);
  console.log(`  Best Angle affected:      ${agg.bestAngleAffected} markets`);
  console.log("\n  Outcome check on changed-grade markets:");
  console.log(`    changed with result: ${agg.gradeChangedWithResult}`);
  console.log(`    Playbook helped/hurt/neutral: ${agg.playbookChangeHelped}/${agg.playbookChangeHurt}/${agg.playbookChangeNeutral}`);
  console.log(`    Playbook upgrades: ${agg.playbookUpgrades} (${agg.upgradedUnits >= 0 ? "+" : ""}${agg.upgradedUnits.toFixed(2)}u if followed)`);
  console.log(`    Playbook downgrades: ${agg.playbookDowngrades} (${agg.downgradedUnits >= 0 ? "+" : ""}${agg.downgradedUnits.toFixed(2)}u avoided if downgraded losses dominate)`);
  console.log("    by market:");
  for (const market of ["moneyline", "total"] as const) {
    const m = agg.byMarket[market];
    console.log(
      `      ${market}: changed=${m.changedWithResult} helped/hurt=${m.helped}/${m.hurt} ` +
      `up=${m.upgrades} (${m.upgradedUnits >= 0 ? "+" : ""}${m.upgradedUnits.toFixed(2)}u) ` +
      `down=${m.downgrades} (${m.downgradedUnits >= 0 ? "+" : ""}${m.downgradedUnits.toFixed(2)}u)`
    );
  }
  console.log("\nExamples (changed markets, first 20):");
  for (const e of examples) console.log(`  ${e}`);
  console.log("\n✓ Read-only. No DB/UI/grade/tracking/line-movement writes.");
}

main().catch((e) => { console.error(`FATAL: ${redact((e as Error).message ?? String(e))}`); process.exit(2); });
