import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cbbMechanismPpp, enrichCbbMatchupMechanisms, enrichCbbEvidenceMaturity, CBB_MECHANISM_FEATURE_NAMES } from "../lib/cbb/matchupMechanismResearch";
import { CBB_SHOT_FEATURE_NAMES } from "../lib/cbb/shotProfileResearch";
import { CBB_SCORE_FEATURE_NAMES, type CbbScoreFeatureRow } from "../lib/cbb/scoreResearch";
import type { CbbBox } from "../lib/cbb/types";
const base = [0.5, 0.34, 0.38, 0.72, 0.3, 0.18, 0.28];
const change = (index: number, value: number) => base.map((v, i) => i === index ? value : v);
assert.ok(cbbMechanismPpp(change(0, 0.6)) > cbbMechanismPpp(base));
assert.ok(cbbMechanismPpp(change(5, 0.25)) < cbbMechanismPpp(base));
assert.ok(cbbMechanismPpp(change(6, 0.35)) > cbbMechanismPpp(base));
assert.ok(cbbMechanismPpp(change(3, 0.9)) > cbbMechanismPpp(base));
assert.throws(() => cbbMechanismPpp([NaN]), /invalid/);
async function main() {
  const dir = "/private/tmp/oddsphere-cbb-data";
  const rows = JSON.parse(await readFile(`${dir}/score-feature-development.json`, "utf8")) as CbbScoreFeatureRow[];
  const boxes = [...JSON.parse(await readFile(`${dir}/boxes-2022.json`, "utf8")).data, ...JSON.parse(await readFile(`${dir}/boxes-2023.json`, "utf8")).data] as CbbBox[];
  const selected = [rows[500], rows[1000], rows[2000], rows[4000]], history = rows.map(r => r.game), before = JSON.stringify(selected);
  const a = enrichCbbMatchupMechanisms(selected, history, boxes);
  // Change evaluated/future box scores: no own-game or future inputs can leak.
  // Each individually forecast row receives only same-day/future changes, not earlier valid games.
  for (let i = 0; i < 4; i++) {
    const row = selected[i], futureIds = new Set(history.filter(g => Date.parse(g.date) + 21600000 > Date.parse(row.forecast.asOf)).map(g => g.id));
    const altered = boxes.map(b => futureIds.has(b.game.id) ? { ...b, fgm: b.fgm! + 100, ftm: b.ftm! + 100 } : b);
    assert.deepEqual(enrichCbbMatchupMechanisms([row], history, altered)[0].features, a[i].features);
  }
  assert.equal(a[0].features.length, CBB_SCORE_FEATURE_NAMES.length + CBB_SHOT_FEATURE_NAMES.length + CBB_MECHANISM_FEATURE_NAMES.length);
  assert.ok(a.every(r => r.features.every(Number.isFinite)));
  const mature = enrichCbbEvidenceMaturity(a);
  assert.equal(mature[0].features.length, a[0].features.length * 2 - 1);
  assert.deepEqual(mature[0].features.slice(0, a[0].features.length), a[0].features);
  const empty = { ...a[0], features: a[0].features.map((v, i) => i === CBB_SCORE_FEATURE_NAMES.length + 1 ? 0 : v) };
  assert.ok(enrichCbbEvidenceMaturity([empty])[0].features.slice(a[0].features.length).every(v => v === 0));
  assert.throws(() => enrichCbbEvidenceMaturity([{ ...empty, features: [1] }]), /schema/);
  assert.equal(JSON.stringify(selected), before);
  console.log("CBB r7: accounting direction, finite matchup features, current/future box exclusion and input immutability passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
