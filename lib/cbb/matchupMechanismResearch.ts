import { CBB_SHOT_FEATURE_NAMES, enrichCbbShotProfiles } from "./shotProfileResearch";
import { CBB_SCORE_FEATURE_NAMES, type CbbScoreFeatureRow } from "./scoreResearch";
import type { CbbBox, CbbTrainingGame } from "./types";

export const CBB_MATCHUP_MECHANISM_RELEASE = "cbb_candidate_2026_10_28_r7_matchup_mechanism";
export const CBB_EVIDENCE_MATURITY_RELEASE = "cbb_candidate_2026_10_28_r8_evidence_maturity";
export const CBB_MECHANISM_FEATURE_NAMES = ["mechanism_margin_residual", "mechanism_total_residual", "pace_control_gap",
  "absolute_margin", "close_game_density", "close_game_ft_scoring", "efg_turnover_interaction_difference", "efg_turnover_interaction_sum",
  "miss_recovery_interaction_difference", "miss_recovery_interaction_sum", "shot_mix_interaction_difference", "shot_mix_interaction_sum"];
export const CBB_MECHANISM_FEATURE_COUNT = CBB_SCORE_FEATURE_NAMES.length + CBB_SHOT_FEATURE_NAMES.length + CBB_MECHANISM_FEATURE_NAMES.length;
const neutral = [0.5, 0.34, 0.38, 0.72, 0.3, 0.18, 0.28];
const ratio = (a: number, b: number, fallback: number) => b > 0 ? a / b : fallback;
const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const bounded = (p: number) => Math.max(0.01, Math.min(0.99, p));

/** Basketball accounting feature, not a postgame oracle or a hard-coded score adjustment. */
export function cbbMechanismPpp(profile: number[]) {
  if (profile.length !== 7 || !profile.every(Number.isFinite)) throw new Error("invalid CBB mechanism profile");
  const [two, three, share, ft, ftr, turnovers, rebounds] = profile;
  if (profile.some(v => v < 0) || [two, three, share, ft, turnovers, rebounds].some(v => v > 1)) throw new Error("invalid CBB mechanism rate");
  const fg = (1 - share) * two + share * three, efg = (1 - share) * two + 1.5 * share * three;
  const denominator = 1 - rebounds * (1 - fg) + 0.475 * ftr;
  if (!(denominator > 0)) throw new Error("invalid CBB mechanism denominator");
  return (1 - turnovers) * (2 * efg + ftr * ft) / denominator;
}

export function enrichCbbMatchupMechanisms(rows: CbbScoreFeatureRow[], history: CbbTrainingGame[], boxes: CbbBox[]) {
  const enriched = enrichCbbShotProfiles(rows, history, boxes);
  const boxMap = new Map(boxes.map(b => [`${b.game.id}:${b.team.id}`, b]));
  const appearances = new Map<number, Array<{ game: CbbTrainingGame; own: CbbBox; other: CbbBox }>>();
  for (const game of history) for (const [id, opponent] of [[game.homeId, game.awayId], [game.awayId, game.homeId]]) {
    const own = boxMap.get(`${game.id}:${id}`), other = boxMap.get(`${game.id}:${opponent}`);
    if (!own || !other) throw new Error("missing CBB mechanism box");
    const list = appearances.get(id) ?? []; list.push({ game, own, other }); appearances.set(id, list);
  }
  return enriched.map(row => {
    if (Date.parse(row.forecast.asOf) > Date.parse(row.game.date)) throw new Error("future CBB mechanism state");
    const get = (id: number, defense: boolean) => {
      const available = (appearances.get(id) ?? []).filter(a => a.game.id !== row.game.id && Date.parse(a.game.date) + 21600000 <= Date.parse(row.forecast.asOf));
      const current = available.filter(a => a.game.season === row.game.season), prior = available.filter(a => a.game.season === row.game.season - 1);
      const profile = (entries: typeof available) => {
        const sum = (key: "fgm" | "fga" | "fg3m" | "fg3a" | "ftm" | "fta" | "turnovers" | "oreb") => entries.reduce((s, a) => s + (defense ? a.other[key] : a.own[key])!, 0);
        const dreb = entries.reduce((s, a) => s + (defense ? a.own.dreb! : a.other.dreb!), 0);
        return [ratio(sum("fgm") - sum("fg3m"), sum("fga") - sum("fg3a"), neutral[0]), ratio(sum("fg3m"), sum("fg3a"), neutral[1]),
          ratio(sum("fg3a"), sum("fga"), neutral[2]), ratio(sum("ftm"), sum("fta"), neutral[3]), ratio(sum("fta"), sum("fga"), neutral[4]),
          ratio(sum("turnovers"), entries.reduce((s, a) => s + a.game.possessions, 0), neutral[5]), ratio(sum("oreb"), sum("oreb") + dreb, neutral[6])];
      };
      const fresh = profile(current), old = prior.length ? profile(prior) : neutral, precision = current.length / (current.length + 5);
      const rates = fresh.map((v, i) => precision * v + (1 - precision) * old[i]);
      const tempo = (entries: typeof available) => entries.reduce((s, a) => s + a.game.tempo, 0) / Math.max(1, entries.length);
      return { rates, tempo: precision * (current.length ? tempo(current) : 69) + (1 - precision) * (prior.length ? tempo(prior) : 69) };
    };
    const ho = get(row.game.homeId, false), hd = get(row.game.homeId, true), ao = get(row.game.awayId, false), ad = get(row.game.awayId, true);
    const matchup = (own: number[], other: number[]) => own.map((v, i) => i === 3 ? v : i === 4 ? v * other[i] / neutral[i] :
      logistic(logit(bounded(v)) + logit(bounded(other[i])) - logit(neutral[i])));
    const h = matchup(ho.rates, ad.rates), a = matchup(ao.rates, hd.rates);
    const hPoints = cbbMechanismPpp(h) * row.forecast.possessions, aPoints = cbbMechanismPpp(a) * row.forecast.possessions;
    const close = Math.exp(-0.5 * (row.forecast.margin / row.forecast.uncertainty.marginSd) ** 2);
    const interactions = (p: number[]) => {
      const efg = (1 - p[2]) * p[0] + 1.5 * p[2] * p[1], fg = (1 - p[2]) * p[0] + p[2] * p[1];
      return [(efg - 0.5) * (p[5] - 0.18) * 100, (1 - fg) * p[6], p[2] * (1.5 * p[1] - p[0]) * 10];
    };
    const hi = interactions(h), ai = interactions(a);
    const extra = [(hPoints - aPoints - row.forecast.margin) / 20, (hPoints + aPoints - row.forecast.total) / 20,
      Math.abs(ho.tempo - ao.tempo) / 5, Math.abs(row.forecast.margin) / 10, close,
      close * (h[3] * h[4] + a[3] * a[4]), ...hi.flatMap((v, i) => [v - ai[i], v + ai[i]])];
    if (extra.length !== CBB_MECHANISM_FEATURE_NAMES.length || !extra.every(Number.isFinite)) throw new Error("invalid CBB mechanism feature");
    return { ...row, features: [...row.features, ...extra] };
  });
}

/** Sample maturity changes a learned relationship, not a hard decision or score bump. */
export function enrichCbbEvidenceMaturity(rows: CbbScoreFeatureRow[]): CbbScoreFeatureRow[] {
  return rows.map(row => {
    // The first two R3 additions are sample difference and sample sum (/60).
    const meanGames = row.features[CBB_SCORE_FEATURE_NAMES.length + 1] * 30;
    if (!(meanGames >= 0) || !Number.isFinite(meanGames) || row.features.length !== CBB_MECHANISM_FEATURE_COUNT) throw new Error("invalid CBB evidence-maturity feature schema");
    const maturity = meanGames / (meanGames + 5);
    return { ...row, features: [...row.features, ...row.features.slice(1).map(v => v * maturity)] };
  });
}
