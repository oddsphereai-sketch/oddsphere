# Phase 5 — Future Sports Readiness

**Date:** 2026-06-10
**Auditor:** Phase 5 of the site-wide reliability audit
**Scope:** Platform-readiness audit (NOT modeling research) for three future areas — World Cup / Soccer, NFL, Player Props — plus the shared future-sport adapter contract. Goal: classify launch readiness with evidence and document what the platform contract requires before any new sport or market category ships.
**Method:** Read-only. Every claim cites `file:line` or DB query result.

---

## Summary verdict

| Area | Classification | One-line rationale |
|------|----------------|--------------------|
| **World Cup / Soccer** | **NOT LAUNCH READY** | No files, no provider, no model, no team-country support, no 3-way grading, no draw handling, no soccer sport key (only `ucl` placeholder) |
| **NFL** | **PARTIAL — NEEDS ADAPTER WORK** | `nfl` IS in Sport + TrackedSport unions, manual upload schema exists, `spread` is in TrackedMarketV17 — but no seed service, no SharpAPI integration, no spread grader, no weekly-slate support, no QB snapshot |
| **Player Props** | **PARTIAL — MORE INFRASTRUCTURE THAN EXPECTED** | `players` + `prop_predictions` + `prediction_breakdowns` + `prediction_results` tables exist; `propModelOrchestrator.ts` has a 7-layer pipeline; 7 MLB prop markets enumerated. Gaps: DNP handling, alt-lines, cross-provider player normalizer, prop-card UI, SharpAPI prop-line proof |
| **Shared future-sport adapter contract** | **PARTIAL — IMPLICIT, NOT CODIFIED** | Sport union + Sportset + ISlateProvider + TrackedSport unions exist but no single `SportAdapter` interface enforcing schedule/market/snapshot/grading/tracking-scope coherence |

**The single biggest blocker across all three areas: the platform contract is implicit.** Each existing sport (MLB / NBA / NHL) was built by extending sport-aware switches (`if sport === "mlb"`, `marketKeysFor(sport)`, etc.) rather than by implementing a shared `SportAdapter` interface. Adding a fourth sport without first codifying the contract will compound this tech debt. The cross-sport auditor v2 (task #453) is the most urgent prerequisite.

---

## 1. World Cup / Soccer

### 1.1 File inventory

**Soccer-specific files: NONE FOUND.**

Searched `find lib app scripts -path "*soccer*" -o -path "*Soccer*" -o -path "*worldcup*" -o -path "*world_cup*" -o -path "*fifa*" -o -path "*1x2*"` — zero matches.

Grep `"soccer\|worldcup\|world_cup\|1x2\|fifa"` across `lib/` and `app/` `.ts`/`.tsx` files — zero matches.

### 1.2 Sport union

`lib/types/domain/Sport.ts:8-15`:
```ts
export type Sport =
  | "mlb"
  | "nba"
  | "nfl"
  | "cbb"
  | "cfb"
  | "nhl"
  | "ucl";
```

`ucl` (UEFA Champions League) is the closest thing to a soccer placeholder. **`"soccer"` is NOT in the union.** World Cup specifically does not have a sport key. Whether `ucl` would be extended to mean "all soccer" or whether a new `"soccer"` / `"world_cup"` key is added is a Phase-6 design decision.

`lib/types/domain/Tracking.ts:98-105` `TrackedSport` includes `ucl` as well. The tracking layer is more soccer-aware than the model layer.

### 1.3 Vercel cron

No soccer-related routes in `vercel.json`. Daily refresh slots for `mlb`, `nba`, `nhl` only.

### 1.4 Provider readiness

- `lib/providers/real_api/SharpAPISignalProvider.ts:587` hardcodes `const sportKey: Sport = "mlb"` for the signals path. NHL has its own client `lib/providers/nhl/_sharpApiNhlClient.ts`. There is no soccer client.
- `lib/providers/real_api/BallDontLieSlateProvider.ts:302` hardcodes `sportKey: Sport = "mlb"` — BDL is MLB-focused; would not cover soccer in any case.
- No FIFA / Opta / Sportradar / SoccerData integration exists.
- `lib/providers/interfaces/ISlateProvider.ts:61-74` exposes a sport-agnostic `getGames(date, sport?)` interface — the CONTRACT is generic enough; no IMPLEMENTATION exists.

### 1.5 Schema readiness

- `games.sport` is `TEXT NOT NULL` with no CHECK constraint (per Phase 0 + the schema dump). It would silently accept `sport='soccer'`.
- `teams` table has NO country/nationality column. National teams (USA, France) would store identically to club teams (Bayern Munich). **BLOCKING for World Cup** — national-team disambiguation requires schema migration.
- `prediction_records.market` is also `TEXT NOT NULL` with no CHECK. Accepts arbitrary values.
- `TrackedMarketV17` (`lib/types/domain/Tracking.ts:107-114`) includes `"double_chance"` — a soccer-style market. **Someone began thinking about soccer in the tracking layer**, even though no model writes it.

### 1.6 Grading / draw handling

`lib/services/predictionGrader.ts` `gradeMoneyline` returns `result = "void"` when `winningTeam === null` (the soccer-draw case). Per the GradeResult type, `void` is a valid outcome, but **soccer draws are conventionally `"push"` (stake returned), NOT `"void"` (bet cancelled).** A 1X2 market with a `"home"` pick that ends in a draw should be a `loss` (the home team didn't win), not a void. This is a design decision for Phase 6, but the existing semantics need to be re-evaluated for soccer.

### 1.7 Daily Edge shell readiness

- `app/api/lab/daily-edge/route.ts` — soccer/ucl branches: **DO NOT EXIST**. Only `if (sport === "nba")` and `if (sport === "nhl")` branches. Soccer requests would fall through to the empty default.
- The 3-card layout (ML / Total / FI for MLB; ML / Total for NBA; ML / Total / "first_inning"=puck-line for NHL) does not fit the 3-way 1X2 market without redesign.

### 1.8 Soccer verdict

**NOT LAUNCH READY.** Estimated work to make soccer "platform-ready" (NOT including the actual model):
1. Add `"soccer"` or `"world_cup"` to Sport + TrackedSport unions (1 file).
2. Schema migration: `teams.country_code` column + uniqueness rules for national vs club teams.
3. New schedule provider (FIFA API / Sportradar / equivalent).
4. New `seedSoccerGamesService.ts` analogous to `seedNhlGamesService.ts`.
5. Schema: `prediction_records.market` value taxonomy explicitly enumerated (currently TEXT; should be CHECK-constrained or enum, otherwise soccer markets silently slip through).
6. Grader: 3-way outcome path for 1X2 (home / draw / away), with `"push"` semantics for draws on 1X2 picks.
7. Daily Edge shell: new `marketKeysFor("soccer")` + new card layout for 3-way + 90-min vs full-time vs aggregate (depending on competition).
8. Cron entry + env gate.
9. Public-tracking scope decision: explicitly enumerate which soccer markets we intend to officially track (per [[feedback-public-tracking-vs-internal-audit]]).

---

## 2. NFL

### 2.1 What's already in place

- `lib/types/domain/Sport.ts:11` — `nfl` IS in Sport union.
- `lib/types/domain/Tracking.ts:100` — `nfl` IS in TrackedSport.
- `lib/types/domain/Tracking.ts:114` — `"spread"` IS in TrackedMarketV17.
- `lib/scoresModel/sportSchemas.ts:128-132` — `NFL_SCHEMA` exists (manual upload form fields: predicted scores, ML, OU, confidence — but **no spread fields**).
- `app/lab/components/SportSelector.tsx` references `nfl` (UI placeholder).
- `app/admin/slate/page.tsx` references `nfl` (admin placeholder).

### 2.2 What's missing

- **No NFL schedule provider.** `find lib -path "*nfl*"` returns the placeholders above + nothing else. No `lib/providers/nfl/_nflApiClient.ts`. No `lib/services/nfl/seedNflGamesService.ts`.
- **No `/api/cron/nfl-daily-refresh` route.** vercel.json has no NFL entry.
- **No SharpAPI NFL integration.** `lib/providers/real_api/SharpAPISignalProvider.ts:587` hardcodes `sportKey="mlb"`. NHL has its own client; NFL has nothing.
- **`NFL_SCHEMA` lacks spread fields.** Spread is the primary NFL betting market, but the manual upload form only collects ML + Total + predicted scores. Operator cannot enter "Chiefs -7.5" via the manual flow.
- **No spread grading.** `lib/services/predictionGrader.ts` handles `moneyline`, `total`, `first_inning`, `nrfi`, `yrfi`, `double_chance` only (per grader code + TrackedMarketV17). No spread comparison logic.
- **No QB-specific snapshot.** `lib/automodel/types.ts:40` `StarterSnapshot` is pitcher-centric (era, whip, K/9, throws). NFL QB snapshot type would need to be added.
- **Weekly slate not supported.** `slate_date` is a single YYYY-MM-DD column. NFL plays Thursday / Sunday / Monday in the same week — needs either a "week" concept or per-day slate splits.

### 2.3 What conflicts (legacy simulation artifacts)

Searched `find lib -name "*.ts" | xargs grep -l "simulation\|monte.carlo\|simulate"` — **NONE FOUND** in production code. The codebase is clean of pre-Daily-Edge NFL simulation logic. The NFL placeholders are minimal and non-conflicting.

### 2.4 Tie / OT handling

Neither the shared grader (`predictionGrader.ts`) nor `gradeNhlPredictions.ts` handles tied NFL games. NFL ties are rare but possible (overtime ends 10-10 if no team scores). For an NFL ML bet, a tie is a `"push"`. For spread, depends on the line. Phase 6 must define.

### 2.5 NFL verdict

**PARTIAL — NEEDS ADAPTER WORK.** Foundation exists (Sport union, TrackedSport, NFL_SCHEMA, `spread` market type) but no real provider, no seed service, no cron, no spread grader, no weekly slate support. Estimated work to reach platform-ready:
1. Add NFL league parameter to SharpAPI clients OR build dedicated NFL API client.
2. Build `lib/services/nfl/seedNflGamesService.ts` modeled on NHL.
3. Extend `NFL_SCHEMA` with spread fields.
4. Implement spread grading branch in `predictionGrader.ts` (compare `actual_spread = home_score - away_score` to `predicted_spread + line_value` for the picked side).
5. Define tie / OT policy.
6. Decide on weekly-slate concept vs per-day slates with same week_id.
7. Cron entry + env gate (`NFL_CRON_ENABLED`).
8. Public-tracking scope decision: which markets at launch?

---

## 3. Player Props

### 3.1 What's already in place (significant surprise)

Player props have **far more infrastructure than NFL or Soccer.** Most of it is dry-run only behind `AUTOMODEL_DB_WRITES_ENABLED`.

**Schema:**
- `players` table (`lib/db/schema.sql:67`) — rich columns: `id`, `external_id` (BDL player_id), `mlb_person_id` (MLB Stats API Person ID), `sport`, `team_id`, `first_name`, `last_name`, `full_name`, `position`, `is_pitcher`, `active`, `bats`, `throws`, `birth_place`, `dob`, `age`, `height`, `weight`, `debut_year`, `draft`. UNIQUE on (sport, external_id).
- `prop_predictions` table (`lib/db/schema.sql:549`) — `prop_market`, `prop_line`, `model_probability`, `fair_probability`, `edge_pct`, `confidence_score`, `confidence_stars`, `tier`, `best_sportsbook`, `best_odds_american`, `ev_pct`, `reasoning`, `caveat`, `bet_odds_american`, `closing_odds_american`, `clv_pct`, `beat_closing_line`, `model_version`. **Already has CLV columns** (the only place in the codebase that does — see Phase 3 §M.1).
- `prediction_breakdowns` table (`lib/db/schema.sql:596`) — 6-factor breakdown: marcel_base_rate, matchup_log5_rate, park_adjustment, weather_adjustment, platoon_adjustment, recency_adjustment, expected_plate_appearances + 6 confidence components.
- `prediction_results` table (`lib/db/schema.sql:630`) — `prop_prediction_id` FK + `outcome` + `actual_value`. Independent from `prediction_grades` (which is game-market grading).
- `lines.player_id` column (`lib/db/schema.sql:425`) — BIGINT REFERENCES players(id), nullable. Index `idx_lines_player` on (player_id, market_type). Game lines have `player_id IS NULL`; prop lines key on player_id.

**Markets:**
- `PropMarketType` enum (`lib/types/domain/Lines.ts:12`): `batter_hits`, `batter_total_bases`, `batter_home_runs`, `batter_rbis`, `pitcher_strikeouts`, `pitcher_earned_runs`, `pitcher_hits_allowed`. 7 MLB markets.

**Model:**
- `lib/models/props/propModelOrchestrator.ts` — FULL 7-layer pipeline: **Marcel regression → Log5 matchup → Park adjustment → Weather adjustment → Platoon adjustment → Recency adjustment → Distribution selection → Edge vs Pinnacle fair → Tier classification → 6-factor confidence → Reasoning + caveat.**
- Dry-run only. Phase-3C-gated behind `AUTOMODEL_DB_WRITES_ENABLED`.

**Grading:**
- `lib/models/tracking/outcomeResolver.ts:84` `resolveProp()` handles all 7 prop markets. Extracts actual value from `PlayerStatLine` (batting_h, batting_hr, batting_tb, batting_rbi, pitching_k, pitching_er, pitching_h). Compares to prop line. Resolves win/loss/push.

### 3.2 What's missing

- **No `player_game_stats` table.** Grading depends on real-time BDL queries; no audit-friendly persistence layer for per-player per-game stats.
- **No DNP / scratch handling.** `outcomeResolver.resolveProp` does NOT consult `player_injuries` before grading. A scratched batter has null stats → defaults to 0 → ANY OVER bet on `0.5 hits` would `loss`-grade. Should be `void`.
- **No alternate-line support.** `lines.is_main_line` column DOES NOT EXIST. Cannot distinguish `Garcia 5.5 K` from `Garcia 6.5 K` from `Garcia 7.5 K`.
- **No cross-provider player_id normalizer.** Team normalizers exist (`_teamNameNormalizer.ts` in `real_api` and `nhl`), but no `_playerIdNormalizer.ts`. If SharpAPI returns a player_id that doesn't match BDL, there's no reconciliation.
- **No SharpAPI prop-line code evidence.** Grep across `lib/providers/sharp/` and `lib/providers/real_api/` for "prop" or "player" yields no prop-line fetch path. Production availability unproven.
- **No Daily Edge prop card UI.** `app/lab/components/daily-edge/DailyEdgeShell.tsx` is game-centric. No per-player card layout exists.
- **No prop calibration baseline.** `calibration_buckets` is game-market only.

### 3.3 What's "ready" but blocked by writes flag

`AUTOMODEL_DB_WRITES_ENABLED` is the gate. Once flipped (for props), the model would start writing `prop_predictions` rows. **But** without DNP handling, the first scratched player would produce a misleading graded loss. Don't flip the flag until §3.2 gaps are addressed.

### 3.4 Player Props verdict

**PARTIAL — MORE INFRASTRUCTURE THAN EXPECTED.** The core platform contract (schema, grading, model math) is ~70% production-ready. Remaining work:
1. Add `lines.is_main_line BOOLEAN DEFAULT TRUE` for alt-line distinction.
2. Add `player_game_stats` table for persisted per-player per-game stats (audit substrate + faster grading).
3. Extend `outcomeResolver.resolveProp` to check `player_injuries` and return `"void"` for scratched/DNP players.
4. Add cross-provider player_id normalizer (`_playerIdNormalizer.ts`).
5. Prove SharpAPI prop-line coverage (dry-run for 1 MLB day; confirm DraftKings + FanDuel + Caesars at minimum).
6. Build per-player prop card UI in Daily Edge.
7. Extend `calibration_buckets` schema to support prop-market dimensions.
8. **Public-tracking scope decision:** props are NOT historically tracked. Per [[feedback-public-tracking-vs-internal-audit]], adding rows to `prop_predictions` and `prediction_results` is conceptually OK for the prop track (a separate substrate from `prediction_records` / `prediction_grades`). But the UI must NOT mix props into the "official Daily Edge tracking" section unless intentionally launched as a tracked category with sample-size baseline.

---

## 4. Shared future-sport adapter contract

The current platform extends sport coverage by **sport-aware switches**, not by a single `SportAdapter` interface. Searched the codebase for any abstraction file like `SportAdapter` / `SportContract` / `SportRegistry` — DOES NOT EXIST. The closest abstractions are:

| File | What it does | Scope |
|------|--------------|-------|
| `lib/types/domain/Sport.ts` | Sport union | Type-level only |
| `lib/types/domain/Tracking.ts` | TrackedSport + TrackedMarketV17 unions | Type-level only |
| `lib/providers/interfaces/ISlateProvider.ts` | `getGames(date, sport?)` | One-method interface |
| `lib/services/automationOrchestrator.ts` | Sport-agnostic cron orchestration | Steps S1-S8 sport-parameterized but switch-heavy inside |
| `app/api/lab/daily-edge/route.ts:2668, 2698` | `if (sport === "nba") {...}` / `if (sport === "nhl") {...}` | Hardcoded branches |
| `app/lab/components/daily-edge/DailyEdgeShell.tsx` `marketKeysFor(sport)` | Per-sport market list | Hardcoded |
| `lib/services/predictionGrader.ts` | MLB grader + NHL has its own grader | Sport-specific files |

### 4.1 What a `SportAdapter` interface should require

If we were to codify the contract (Phase-6 work), it would look like:

```ts
interface SportAdapter {
  // Identity
  sport: Sport;
  displayName: string;

  // Markets
  publicTrackingMarkets: ReadonlyArray<TrackedMarket>;  // officially tracked
  contextOnlyMarkets: ReadonlyArray<MarketKey>;          // displayed but not tracked
  marketKeys: ReadonlyArray<MarketKey>;                  // union of both

  // Schedule
  seedSlate(date: string): Promise<SeedResult>;
  lockSchedule: LockScheduleDescriptor;

  // Sources
  linesProvider: ILinesProvider;
  signalProvider: ISignalProvider | null;
  scheduleProvider: IScheduleProvider;
  scoreProvider: IScoreProvider;

  // Model
  buildPrediction(game: GameRow, snapshot: SportFeatureSnapshot): Promise<SportPrediction>;
  modelVersion: string;

  // Snapshot
  buildLockSnapshot(prediction: SportPrediction, market: GameMarket): SnapshotJson;
  lockSnapshotContract: LockSnapshotContract;

  // Grading
  gradePrediction(record: PredictionRecord, finalState: GameFinalState): GradeRow;
  draftDrawRules: DrawRules;        // win | loss | push | void
  draftOTRules: OTRules;

  // Display
  buildDtoForGame(game: GameRow, prediction: PredictionRecord): SportGameDto;
  cardLayout: CardLayoutDescriptor;
  contextOnlyDisplayLabels: Record<MarketKey, string>;

  // Auditor
  auditRules: SportAuditAdapter;
}
```

This is one possible shape — Phase 6 must decide.

### 4.2 Why no adapter today: trade-off

The reason no formal adapter exists is that MLB / NBA / NHL were each built sequentially, learning from the previous. The current state is OK for 3 sports; it WILL NOT scale to 4-6 sports + player props without becoming unmaintainable. Every new sport adds another `if (sport === "...")` branch in 5+ files.

The 2026-06-10 cross-sport auditor task #453 is the most concrete prerequisite: building a sport-adapter for the auditor will force the same shape across sports' lock-snapshot writers and DTO builders.

---

## 5. Launch readiness classification

Final classifications, with the criteria each tier requires:

### READY TO BUILD ON PLATFORM CONTRACT
*Definition:* the platform contract — schema, provider abstractions, model interfaces, lock snapshot, grading, DTO, UI, auditor — supports the new area without breaking changes. Adding the new area is a matter of writing the sport-specific files.

*Areas in this tier today:* **NONE.**

The current 3-sport state (MLB / NBA / NHL) was reached by SPECIALIZING. Adding a fourth area requires either (a) accepting more specialization debt or (b) extracting the implicit contract first. Both options are valid; neither is "ready to build on the platform contract today."

### PARTIAL — NEEDS ADAPTER WORK

**NFL:** Foundation in place (Sport union, TrackedSport, `spread` market type, manual upload schema), but no real provider, no seed service, no cron, no spread grader, no weekly-slate support. ~2-3 weeks of focused adapter work to reach platform-ready.

**Player Props:** Surprising amount of infrastructure exists (schema + 7-layer model + grader skeleton). Remaining work: DNP handling, alt-lines, cross-provider player_id normalizer, prop-card UI, SharpAPI prop-line validation. ~2-3 weeks of focused work + a careful public-tracking scope decision.

### NOT LAUNCH READY

**World Cup / Soccer:** Zero soccer files. `"soccer"` not even in Sport union (only `ucl` placeholder). No fixture provider. No team-country support. No 3-way grading. No 1X2 model. 4-6 weeks of focused adapter work for the platform alone (the model is a separate research project).

### BLOCKED

None today — but **adding any of the three above areas without first codifying the SportAdapter contract is a tech-debt landmine.** That codification is Phase-6 work and is the prerequisite for any future-sport launch beyond NFL.

---

## 6. Phase-6 carry-forward from this Phase-5 audit

### Cross-cutting (highest priority)

27. **Codify `SportAdapter` interface.** Extract the implicit contract into `lib/types/SportAdapter.ts` with the shape sketched in §4.1. Existing MLB/NBA/NHL must implement it (refactor, not rewrite). This is the prerequisite for any future-sport launch.
28. **Official public tracking market registry.** Build a single source of truth (e.g., `lib/config/officialTrackingMarkets.ts`) listing which (sport, market) tuples are publicly tracked. Auditor uses it. UI uses it. Adding a market to public tracking requires editing this registry. Per [[feedback-public-tracking-vs-internal-audit]].
29. **Context-only `displayed_market_snapshot` substrate.** Define the shape (probably a sub-object on `snapshot_json.displayed_context_markets`) so context-only markets like NBA spread, NHL puck-line, future player-prop "model context" can be captured at lock without joining into public tracking. Per [[feedback-public-tracking-vs-internal-audit]].

### Soccer / World Cup

30. **Soccer scope decision** — `"soccer"` vs `"world_cup"` vs `"ucl"` as the sport key. Whether to keep `ucl` as a separate sport or fold it into a broader `soccer`. International vs club teams.
31. **Schema: `teams.country_code`** column + uniqueness rule for national teams. Required for any soccer launch.
32. **Soccer draw-aware grading rules.** When a 1X2 pick is `"home"` and the match draws, the grade is `"loss"` (home didn't win), NOT `"push"`. When the pick is `"draw"` and the match doesn't draw, also `"loss"`. When the pick is `"double_chance home_or_draw"` and the match is a home-win OR draw, `"win"`. Codify in the grader.
33. **Soccer market naming.** ML / Total / FI is misleading for soccer. Naming convention: `result_3way` for 1X2, `over_under_goals_2_5` for goals total, `both_teams_to_score` for BTTS, `asian_handicap` for handicap. Reuse `double_chance` (already in TrackedMarketV17).

### NFL

34. **NFL spread grading.** Implement the spread branch in `predictionGrader.ts` with explicit tie semantics for ML and push semantics for spread.
35. **NFL weekly slate concept.** Either add `slate_week` column or model NFL as multiple per-day slates with shared `season_week`. Phase-6 design decision.
36. **NFL provider integration.** Either extend SharpAPI client to pass `league="nfl"` or build a dedicated NFL provider (likely NFL.com + ESPN combination).
37. **NFL QB snapshot type.** Analogous to MLB `StarterSnapshot` but for QBs. Replaces / extends the existing MLB-centric snapshot.
38. **NFL_SCHEMA spread fields.** Extend `lib/scoresModel/sportSchemas.ts:128-132` to include `predicted_spread_value`, `predicted_spread_side`, `spread_confidence`.

### Player Props

39. **`lines.is_main_line` column** for alt-line distinction. Migration: `ALTER TABLE lines ADD COLUMN is_main_line BOOLEAN NOT NULL DEFAULT TRUE`.
40. **`player_game_stats` table** for per-player per-game stats persistence. Auditor substrate + faster grading.
41. **DNP / scratch handling in `outcomeResolver.resolveProp`.** Check `player_injuries` before grading. Return `"void"` for scratched / inactive players.
42. **Cross-provider `_playerIdNormalizer.ts`.** Resolve SharpAPI vs BDL player_id divergence.
43. **SharpAPI prop-line production validation.** Dry-run for 1 MLB day; confirm book coverage.
44. **Daily Edge prop card UI.** Per-player card or collapsible "All Props" panel.
45. **Prop calibration extension.** `calibration_buckets` schema dimensions for prop markets.
46. **Props public-tracking decision.** Are props in the official tracking section, or context-only? Per [[feedback-public-tracking-vs-internal-audit]]. Today they are in their OWN tracking substrate (`prop_predictions` + `prediction_results`), which is fine — but the UI must NOT mix them into the game-market "Daily Edge tracking" section unless deliberate.

---

## 7. Important non-claims (Phase 5)

Per the discipline of Phases 3 + 4, things that are **explicitly not yet true:**

1. **No future sport is "ready to launch today."** PARTIAL means platform supports portions; LAUNCH means model is calibrated, members can use it, accuracy is measured.
2. **Player props is NOT live.** All write paths gated behind `AUTOMODEL_DB_WRITES_ENABLED`. The infrastructure exists; production traffic does not.
3. **The propModelOrchestrator has NOT been validated.** Phase 3C completion does NOT mean it has predictive accuracy — only that the dry-run pipeline runs without errors.
4. **CLV columns exist on `prop_predictions`** (`closing_odds_american`, `clv_pct`, `beat_closing_line`) but **CLV is still not tracked for any sport** (per Phase 3 §M.1). The presence of columns is NOT the same as CLV being measured.
5. **`TrackedMarketV17` includes `double_chance` and `spread`** — but neither is produced by any current model. The tracking schema is more future-aware than the model layer.
6. **No formal SportAdapter exists.** The platform appears more polished than it is because of careful sport-specific code paths; the underlying coordination is via type unions + switches.
7. **World Cup launch readiness is a 4-6 week project minimum**, not counting the model itself.
8. **NFL launch readiness is a 2-3 week project minimum**, not counting the model itself.
9. **Player props launch readiness is a 2-3 week project minimum** plus a public-tracking scope decision.
10. **The cross-sport auditor (task #453) is a hard prerequisite** for any future-sport launch beyond NFL. Without it, NBA/NHL gaps documented in Phases 2 + 4 will repeat for every new sport.

---

## Verdict

**No future sport is ready to launch today.** The platform contract is implicit, not codified, and the existing 3-sport implementation is on the edge of what sport-aware switches can support. Phase 5 recommends:

1. **Codify the SportAdapter interface first** (§27). This is the prerequisite for any clean expansion.
2. **NFL second.** Highest reuse of existing infrastructure (Sport union, TrackedSport, manual schema, spread market type), most known unknowns.
3. **Player Props third.** Surprising readiness; primary work is DNP handling, alt-lines, and a deliberate public-tracking scope decision. Should ship as its OWN substrate (`prop_predictions` + `prediction_results`), not mixed into game-market tracking.
4. **Soccer / World Cup last.** Highest ramp; benefits most from a codified adapter contract.

Phase 6 must produce a sequenced delivery plan, not parallel launches.

---

## Cross-references

- Phase 0 inventory: `docs/audit/00-inventory.md`
- Phase 1 critical path: `docs/audit/01-active-sports-critical-path.md`
- Phase 2 NBA deep dive: `docs/audit/02-nba-model-logic-calibration.md`
- Phase 3 MLB benchmark: `docs/audit/03-mlb-benchmark-audit.md`
- Phase 4 NHL audit: `docs/audit/04-nhl-automation-tracking-audit.md`
- Public-tracking-vs-internal-audit rule: `~/.claude/.../memory/feedback_public_tracking_vs_internal_audit.md`
- Phase 6 immediate roadmap: `~/.claude/.../memory/project_phase_6_immediate_roadmap.md`

## Next phase

Phase 6 — Auditor / fixer / operator roadmap. Deliverable: `docs/audit/06-auditor-fixer-operator-roadmap.md`. Will consolidate all carry-forward items (1-46) from Phases 2-5 into a sequenced delivery plan.
