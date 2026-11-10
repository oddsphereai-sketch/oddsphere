import { createHash } from "node:crypto";
import type { EplTrainingMatch } from "../epl/eplShadowModel";
import { normalizeUclStrengthClub } from "./uclCurrentStrengthPrior";

export const UCL_PAID_STATS_INPUT_RELEASE = "ucl_paid_stats_inputs_2026_11_10_r1_ucl_epl" as const;
export type UclPaidTrainingMatch = EplTrainingMatch & { competition: "ucl" | "epl" };

/** Provider IDs are shared across the two licensed competitions. Prove their
 * identities using exact normalized names; never pool unrelated numeric IDs. */
export function uclPaidTrainingInputs(ucl: EplTrainingMatch[], epl: EplTrainingMatch[]) {
  const names = new Map<number, string>();
  const rows: UclPaidTrainingMatch[] = [];
  for (const [competition, matches] of [["ucl", ucl], ["epl", epl]] as const) {
    for (const match of matches) {
      const pair = match.name.split(" at ");
      if (pair.length !== 2) throw Error(`Unparsed licensed ${competition} fixture ${match.id}`);
      for (const [id, name] of [[match.away_team_id, pair[0]!], [match.home_team_id, pair[1]!]] as const) {
        const key = normalizeUclStrengthClub(name), previous = names.get(id);
        if (!Number.isSafeInteger(id) || id <= 0 || !key || previous && previous !== key)
          throw Error(`Conflicting licensed soccer club identity ${id}`);
        names.set(id, key);
      }
      rows.push({ ...match, competition });
    }
  }
  return rows;
}

/** Frozen paid-UCL/EPL MAP likelihood. Separate competition scoring environments,
 * shared club attack/defence, released four-match Gamma modes /365-day weights /
 * 35% xG. No Elo input, market input, fitted blend or per-market score target. */
export function fitUclPaidStats(input: UclPaidTrainingMatch[], asOf: string) {
  const now = Date.parse(asOf), seen = new Map<string, UclPaidTrainingMatch>();
  if (!Number.isFinite(now) || input.length > 4_000) throw Error("Invalid licensed soccer fit bounds");
  for (const match of input) {
    const date = Date.parse(match.date);
    if (!Number.isFinite(date)) throw Error("Invalid licensed soccer fixture date");
    if (date >= now || match.status_state !== "final" || match.home_score === null || match.away_score === null) continue;
    if (![match.home_score, match.away_score].every(goal => Number.isFinite(goal) && goal >= 0)
      || ![match.id, match.home_team_id, match.away_team_id].every(id => Number.isSafeInteger(id) && id > 0)
      || match.home_team_id === match.away_team_id || !["ucl", "epl"].includes(match.competition))
      throw Error("Invalid licensed soccer training fixture");
    const key = `${match.competition}:${match.id}`, old = seen.get(key);
    const identity = (row: UclPaidTrainingMatch) => JSON.stringify([row.date, row.home_team_id, row.away_team_id,
      row.home_score, row.away_score, row.home_xg, row.away_xg]);
    if (old && identity(old) !== identity(match)) throw Error(`Conflicting licensed soccer fixture ${key}`);
    seen.set(key, match);
  }
  const effective = (goals: number, xg: number | null) => typeof xg === "number" && Number.isFinite(xg) && xg >= 0 ? .65 * goals + .35 * xg : goals;
  const rows = [...seen.values()].map(match => ({ h: match.home_team_id, a: match.away_team_id, c: match.competition,
    y: effective(match.home_score!, match.home_xg), z: effective(match.away_score!, match.away_xg),
    w: 2 ** (-(now - Date.parse(match.date)) / 86_400_000 / 365) }));
  if (!rows.length || !rows.some(row => row.c === "ucl") || !rows.some(row => row.c === "epl"))
    throw Error("Both licensed soccer training competitions are required");
  const ids = [...new Set(rows.flatMap(row => [row.h, row.a]))];
  if (ids.length > 256) throw Error("Licensed soccer club bound exceeded");
  const byTeam = new Map(ids.map(id => [id, [] as typeof rows]));
  for (const row of rows) { byTeam.get(row.h)!.push(row); byTeam.get(row.a)!.push(row); }
  const byLeague = new Map<"ucl" | "epl", typeof rows>();
  for (const row of rows) { const group = byLeague.get(row.c) ?? []; group.push(row); byLeague.set(row.c, group); }
  const rates = new Map([...byLeague].map(([competition, group]) => {
    const weight = group.reduce((sum, row) => sum + row.w, 0);
    return [competition, { h: Math.max(1e-8, group.reduce((sum, row) => sum + row.w * row.y, 0) / weight),
      a: Math.max(1e-8, group.reduce((sum, row) => sum + row.w * row.z, 0) / weight) }] as const;
  }));
  const weight = rows.reduce((sum, row) => sum + row.w, 0);
  const exposure = 4 * rows.reduce((sum, row) => sum + row.w * (row.y + row.z), 0) / (2 * weight);
  if (!(exposure > 0)) throw Error("Licensed soccer scoring exposure unavailable");
  const attack = new Map(ids.map(id => [id, 1])), defense = new Map(ids.map(id => [id, 1]));
  let converged = false, iterations = 0;
  for (; iterations < 1024; iterations++) {
    const before = [...attack.values(), ...defense.values(), ...[...rates.values()].flatMap(rate => [rate.h, rate.a])];
    for (const id of ids) {
      let goals = exposure, expected = exposure;
      for (const row of byTeam.get(id)!) {
        const rate = rates.get(row.c)!;
        if (row.h === id) { goals += row.w * row.y; expected += row.w * rate.h * defense.get(row.a)!; }
        else { goals += row.w * row.z; expected += row.w * rate.a * defense.get(row.h)!; }
      }
      attack.set(id, goals / expected);
    }
    for (const id of ids) {
      let goals = exposure, expected = exposure;
      for (const row of byTeam.get(id)!) {
        const rate = rates.get(row.c)!;
        if (row.h === id) { goals += row.w * row.z; expected += row.w * rate.a * attack.get(row.a)!; }
        else { goals += row.w * row.y; expected += row.w * rate.h * attack.get(row.h)!; }
      }
      defense.set(id, goals / expected);
    }
    for (const [competition, group] of byLeague) rates.set(competition, {
      h: Math.max(1e-8, group.reduce((sum, row) => sum + row.w * row.y, 0)
        / group.reduce((sum, row) => sum + row.w * attack.get(row.h)! * defense.get(row.a)!, 0)),
      a: Math.max(1e-8, group.reduce((sum, row) => sum + row.w * row.z, 0)
        / group.reduce((sum, row) => sum + row.w * attack.get(row.a)! * defense.get(row.h)!, 0)),
    });
    const after = [...attack.values(), ...defense.values(), ...[...rates.values()].flatMap(rate => [rate.h, rate.a])];
    if (after.every((value, index) => Math.abs(Math.log(value / before[index]!)) < 1e-8)) { converged = true; break; }
  }
  if (!converged) throw Error("Licensed soccer opponent fit did not converge");
  return { rates, attack, defense, exposure, iterations, converged, rows: rows.length,
    uclRows: byLeague.get("ucl")!.length, eplRows: byLeague.get("epl")!.length,
    effectiveMatches: new Map(ids.map(id => [id, byTeam.get(id)!.reduce((sum, row) => sum + row.w, 0)])),
    sourceHash: createHash("sha256").update(JSON.stringify([...seen.values()].map(row => [row.competition, row.id,
      row.date, row.home_team_id, row.away_team_id, row.home_score, row.away_score, row.home_xg, row.away_xg]))).digest("hex") };
}
