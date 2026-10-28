import type { CbbBox, CbbTrainingGame } from "./types";
import type { CbbScoreFeatureRow } from "./scoreResearch";
import { normalCdf } from "./model";

export const CBB_SHOT_PROFILE_RELEASE = "cbb_candidate_2026_10_28_r3_shot_profile";
const KEYS = ["two_pct", "three_pct", "three_share", "ft_pct", "ft_rate", "turnovers", "rebounds", "pace_sd", "efficiency_sd"];
export const CBB_SHOT_FEATURE_NAMES = ["sample_difference", "sample_sum",
  ...["season", "recent"].flatMap(window => KEYS.flatMap(key => [`${window}_${key}_difference`, `${window}_${key}_sum`]))];
type Appearance = { game: CbbTrainingGame; own: CbbBox; opponent: CbbBox };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const ratio = (a: number, b: number, fallback: number) => b > 0 ? a / b : fallback;
const defaults = [0.5, 0.34, 0.38, 0.72, 0.3, 0.18, 0.28, 5, 15];

/** Outcomes may form labels, never current-game or future profile inputs. */
export function enrichCbbShotProfiles(rows: CbbScoreFeatureRow[], history: CbbTrainingGame[], boxes: CbbBox[]): CbbScoreFeatureRow[] {
  const boxMap = new Map(boxes.map(box => [`${box.game.id}:${box.team.id}`, box]));
  const appearances = new Map<number, Appearance[]>();
  for (const game of history) for (const [id, other] of [[game.homeId, game.awayId], [game.awayId, game.homeId]]) {
    const own = boxMap.get(`${game.id}:${id}`), opponent = boxMap.get(`${game.id}:${other}`);
    if (!own || !opponent) throw new Error("missing accepted CBB profile box");
    appearances.set(id, [...(appearances.get(id) ?? []), { game, own, opponent }]);
  }
  const profile = (entries: Appearance[], defense: boolean) => {
    const sum = (key: keyof Pick<CbbBox, "fgm" | "fga" | "fg3m" | "fg3a" | "ftm" | "fta" | "turnovers" | "oreb" | "dreb">) =>
      entries.reduce((s, row) => s + (defense ? row.opponent[key] : row.own[key])!, 0);
    const rebounds = entries.reduce((s, row) => s + (defense ? row.own.dreb! : row.opponent.dreb!), 0);
    return [ratio(sum("fgm") - sum("fg3m"), sum("fga") - sum("fg3a"), defaults[0]),
      ratio(sum("fg3m"), sum("fg3a"), defaults[1]), ratio(sum("fg3a"), sum("fga"), defaults[2]),
      ratio(sum("ftm"), sum("fta"), defaults[3]), ratio(sum("fta"), sum("fga"), defaults[4]),
      ratio(sum("turnovers"), entries.reduce((s, row) => s + row.game.possessions, 0), defaults[5]),
      ratio(sum("oreb"), sum("oreb") + rebounds, defaults[6]),
      entries.length > 1 ? sd(entries.map(row => row.game.tempo)) : defaults[7],
      entries.length > 1 ? sd(entries.map(row => {
        const home = row.own.team.id === row.game.homeId;
        const score = (home !== defense) ? row.game.homeScore : row.game.awayScore;
        return score / row.game.possessions * 100;
      })) : defaults[8]];
  };
  return rows.map(row => {
    if (!Number.isFinite(Date.parse(row.forecast.asOf)) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date)) throw new Error("invalid CBB shot-profile as-of");
    const get = (id: number) => {
      const available = (appearances.get(id) ?? []).filter(a => a.game.id !== row.game.id &&
        Date.parse(a.game.date) + 21600000 <= Date.parse(row.forecast.asOf));
      const current = available.filter(a => a.game.season === row.game.season).sort((a, b) => b.game.date.localeCompare(a.game.date));
      const prior = available.filter(a => a.game.season === row.game.season - 1);
      const build = (recent: boolean, defense: boolean) => {
        const games = recent ? current.slice(0, 5) : current;
        const fresh = profile(games, defense), old = prior.length ? profile(prior, defense) : defaults;
        const precision = games.length / (games.length + (recent ? 3 : 5));
        return fresh.map((value, i) => precision * value + (1 - precision) * old[i]);
      };
      return { count: current.length, build };
    };
    const home = get(row.game.homeId), away = get(row.game.awayId);
    const extra = [(home.count - away.count) / 20, (home.count + away.count) / 60];
    for (const recent of [false, true]) {
      const ho = home.build(recent, false), hd = home.build(recent, true), ao = away.build(recent, false), ad = away.build(recent, true);
      for (let i = 0; i < defaults.length; i++) {
        // FT accuracy is shooter-owned, not credited to opponent FT defense.
        const h = i === 3 ? ho[i] : (ho[i] + ad[i]) / 2;
        const a = i === 3 ? ao[i] : (ao[i] + hd[i]) / 2;
        const scale = i >= 7 ? 0.1 : 10;
        extra.push((h - a) * scale, (h + a - 2 * defaults[i]) * scale);
      }
    }
    if (extra.length !== CBB_SHOT_FEATURE_NAMES.length || !extra.every(Number.isFinite)) throw new Error("invalid CBB shot profile");
    return { ...row, features: [...row.features, ...extra] };
  });
}

function solve(x: number[][], y: number[], weights: number[], penalty: number) {
  const width = x[0].length;
  const a = Array.from({ length: width }, () => Array(width + 1).fill(0) as number[]);
  for (let k = 0; k < x.length; k++) for (let i = 0; i < width; i++) {
    a[i][width] += weights[k] * x[k][i] * y[k];
    for (let j = 0; j < width; j++) a[i][j] += weights[k] * x[k][i] * x[k][j];
  }
  for (let i = 0; i < width; i++) a[i][i] += penalty;
  for (let i = 0; i < width; i++) {
    let pivot = i; for (let k = i + 1; k < width; k++) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    if (Math.abs(a[i][i]) < 1e-12) throw new Error("singular shot-profile fit");
    const divisor = a[i][i]; for (let j = i; j <= width; j++) a[i][j] /= divisor;
    for (let k = 0; k < width; k++) if (k !== i) {
      const value = a[k][i]; for (let j = i; j <= width; j++) a[k][j] -= value * a[i][j];
    }
  }
  return a.map(row => row[width]);
}
export type CbbShotHead = { release: string; throughSeason: number; penalty: number; loss: "squared" | "huber"; margin: number[]; total: number[] };
export function fitCbbShotHead(rows: CbbScoreFeatureRow[], throughSeason: number, penalty: number, loss: CbbShotHead["loss"]): CbbShotHead {
  if (rows.length < 200 || rows.some(r => r.game.season > throughSeason)) throw new Error("invalid CBB shot-head chronology");
  if (!(penalty > 0) || !["squared", "huber"].includes(loss) || rows.some(r => r.features.length !== rows[0].features.length || !r.features.every(Number.isFinite))) throw new Error("invalid CBB shot-head features/options");
  const x = rows.map(r => r.features);
  const fit = (y: number[], delta: number) => {
    let weights = y.map(() => 1), coefficients: number[] = [];
    for (let iteration = 0; iteration < (loss === "huber" ? 8 : 1); iteration++) {
      coefficients = solve(x, y, weights, penalty);
      weights = y.map((v, i) => Math.min(1, delta / Math.max(1e-9, Math.abs(v - x[i].reduce((s, f, j) => s + f * coefficients[j], 0)))));
    }
    return coefficients;
  };
  return { release: CBB_SHOT_PROFILE_RELEASE, throughSeason, penalty, loss,
    margin: fit(rows.map(r => r.game.homeScore - r.game.awayScore - r.forecast.margin), 10),
    total: fit(rows.map(r => r.game.homeScore + r.game.awayScore - r.forecast.total), 15) };
}
export function applyCbbShotHead(rows: CbbScoreFeatureRow[], head: CbbShotHead) {
  return rows.map(row => {
    if (row.game.season <= head.throughSeason) throw new Error("in-sample CBB shot-head evaluation");
    if (head.margin.length !== row.features.length || head.total.length !== row.features.length) throw new Error("CBB shot-head width mismatch");
    const dot = (coef: number[]) => coef.reduce((s, v, j) => s + v * row.features[j], 0);
    const margin = row.forecast.margin + dot(head.margin), total = row.forecast.total + dot(head.total);
    const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2, sd = row.forecast.uncertainty.marginSd;
    if (![margin, total, homeScore, awayScore].every(Number.isFinite) || homeScore <= 0 || awayScore <= 0) throw new Error("incoherent CBB shot-head score");
    const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
    const homeWinProbability = (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero);
    return { ...row, forecast: { ...row.forecast, release: head.release, margin, total, homeScore, awayScore, homeWinProbability } };
  });
}
