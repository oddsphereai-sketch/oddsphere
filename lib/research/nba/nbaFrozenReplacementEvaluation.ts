import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
type Market = "moneyline" | "spread" | "total";
type Pick = { side: "home" | "away" | "over" | "under"; grade: string; probability: number; line: number | null; price: number; book: string };
export type NbaFrozenReplacement = { generatedAt: string; frozenAt: string; sourceSha256: string; incumbentRelease: string; candidateRelease: string;
  games: readonly { gameId: number; startAt: string; incumbentProjection: { marginHome: number; total: number };
    candidateProjection: { marginHome: number; total: number };
    markets: readonly { market: Market; incumbent: Pick; candidate: Pick }[] }[] };
export type NbaFrozenFinal = { gameId: number; homeScore: number; awayScore: number; finalAt: string; observedAt: string };
const actionable = (p: Pick) => p.grade === "lean" || p.grade === "best_angle";
function validatePick(m: Market, p: Pick) {
  if (!p.book || !Number.isInteger(p.price) || Math.abs(p.price) < 100 || !Number.isFinite(p.probability) || p.probability <= 0 || p.probability >= 1 ||
      !(m === "total" ? ["over", "under"] : ["home", "away"]).includes(p.side) ||
      (m === "moneyline" ? p.line !== null : p.line === null || !Number.isFinite(p.line))) throw Error("invalid_frozen_contract");
}
function settled(m: Market, p: Pick, f: NbaFrozenFinal) {
  const difference = m === "moneyline" ? (p.side === "home" ? f.homeScore - f.awayScore : f.awayScore - f.homeScore) :
    m === "spread" ? (p.side === "home" ? f.homeScore - f.awayScore : f.awayScore - f.homeScore) + p.line! :
      p.side === "over" ? f.homeScore + f.awayScore - p.line! : p.line! - f.homeScore - f.awayScore;
  const result = difference > 0 ? "win" : difference < 0 ? "loss" : "push";
  const units = result === "push" ? 0 : result === "loss" ? -1 : p.price > 0 ? p.price / 100 : 100 / -p.price;
  return { result, units, actionable: actionable(p), probability: p.probability,
    brier: result === "push" ? null : (p.probability - (result === "win" ? 1 : 0)) ** 2 };
}
/** Scores only the frozen exact contracts. No result joins during freezing,
 * missing-price guesses, model refits, release blending, writes or provider IO. */
export function evaluateNbaFrozenReplacement(frozen: NbaFrozenReplacement, finals: readonly NbaFrozenFinal[]) {
  const generated = Date.parse(frozen.generatedAt); if (!Number.isFinite(generated) || !Number.isFinite(Date.parse(frozen.frozenAt)) || Date.parse(frozen.frozenAt) < generated || !/^[a-f0-9]{64}$/.test(frozen.sourceSha256) || !frozen.incumbentRelease || !frozen.candidateRelease) throw Error("invalid_frozen_release");
  const seen = new Set<number>(), outcomes = new Map<number, NbaFrozenFinal>();
  for (const f of finals) {
    if (!Number.isSafeInteger(f.gameId) || f.gameId <= 0 || ![f.homeScore, f.awayScore].every(v => Number.isInteger(v) && v >= 0) || f.homeScore === f.awayScore ||
      !Number.isFinite(Date.parse(f.finalAt)) || !Number.isFinite(Date.parse(f.observedAt)) || Date.parse(f.observedAt) < Date.parse(f.finalAt)) throw Error("invalid_final");
    if (outcomes.has(f.gameId) && nbaPlayerStateHash(outcomes.get(f.gameId)) !== nbaPlayerStateHash(f)) throw Error("conflicting_final");
    outcomes.set(f.gameId, f);
  }
  const rows = frozen.games.flatMap(g => {
    if (seen.has(g.gameId) || !Number.isSafeInteger(g.gameId) || g.gameId <= 0 || !Number.isFinite(Date.parse(g.startAt)) || generated >= Date.parse(g.startAt) || Date.parse(frozen.frozenAt) >= Date.parse(g.startAt) ||
      ![g.incumbentProjection.marginHome, g.incumbentProjection.total, g.candidateProjection.marginHome, g.candidateProjection.total].every(Number.isFinite)) throw Error("invalid_pregame_freeze");
    seen.add(g.gameId);
    if (g.markets.length !== 3 || new Set(g.markets.map(m => m.market)).size !== 3 || !["moneyline", "spread", "total"].every(m => g.markets.some(p => p.market === m))) throw Error("incomplete_frozen_game");
    const f = outcomes.get(g.gameId); if (f && Date.parse(f.finalAt) <= Date.parse(g.startAt)) throw Error("final_before_game");
    return g.markets.map(m => {
      validatePick(m.market, m.incumbent); validatePick(m.market, m.candidate);
      return { gameId: g.gameId, market: m.market, incumbentActionable: actionable(m.incumbent), candidateActionable: actionable(m.candidate), incumbent: f ? settled(m.market, m.incumbent, f) : null,
        candidate: f ? settled(m.market, m.candidate, f) : null,
        promotion: !actionable(m.incumbent) && actionable(m.candidate), demotion: actionable(m.incumbent) && !actionable(m.candidate),
        incumbentAbsoluteError: f ? Math.abs((m.market === "total" ? g.incumbentProjection.total : g.incumbentProjection.marginHome) - (m.market === "total" ? f.homeScore + f.awayScore : f.homeScore - f.awayScore)) : null,
        candidateAbsoluteError: f ? Math.abs((m.market === "total" ? g.candidateProjection.total : g.candidateProjection.marginHome) - (m.market === "total" ? f.homeScore + f.awayScore : f.homeScore - f.awayScore)) : null };
    });
  });
  if (finals.some(f => !seen.has(f.gameId))) throw Error("unmatched_final");
  const summary = (["moneyline", "spread", "total"] as const).map(market => {
    const subset = rows.filter(r => r.market === market);
    const arm = (name: "incumbent" | "candidate") => {
      const values = subset.flatMap(r => r[name] === null ? [] : [r[name]!]);
      return { wins: values.filter(v => v.result === "win").length, losses: values.filter(v => v.result === "loss").length,
        pushes: values.filter(v => v.result === "push").length, pending: subset.length - values.length,
        actionable: subset.filter(r => name === "incumbent" ? r.incumbentActionable : r.candidateActionable).length,
        settledActionable: values.filter(v => v.actionable).length, actionableUnits: values.filter(v => v.actionable).reduce((n, v) => n + v.units, 0) };
    };
    return { market, incumbent: arm("incumbent"), candidate: arm("candidate"), promotions: subset.filter(r => r.promotion).length, demotions: subset.filter(r => r.demotion).length };
  });
  return { frozenHash: nbaPlayerStateHash(frozen), incumbentRelease: frozen.incumbentRelease, candidateRelease: frozen.candidateRelease,
    summary, rows, qualification: "research_evidence_only_not_automatic_release_authority" };
}
