# Phase 6 — Auditor / Fixer / Operator Roadmap

**Date:** 2026-06-10
**Auditor:** Phase 6 — final phase of the site-wide reliability audit
**Scope:** Synthesize Phases 0–5 into a **concrete engineering implementation plan** for making the OddSphere platform reliable enough that World Cup / Soccer can ship as the next major build without forcing soccer into MLB/NBA/NHL assumptions.
**Method:** Read-only synthesis. Every recommendation backed by file:line or SQL evidence from prior phases.

---

## How to read this document

This is NOT a narrative. It is an **engineering work order** with sections A–M.

- §A–J = platform contracts and shared systems that must be built before any new sport launches.
- §K = the Soccer / World Cup workstream broken into 10 minimum-required workstreams + an explicit launch gate.
- §L = prioritized delivery buckets, sequenced 1–7. Bucket #4 ("Before World Cup / Soccer launch") is the next engineering work order after immediate trust fixes.
- §M = the final per-sport status table.

**Reading instruction for the team:** start at §L (prioritized roadmap), then drill into §A–J for the foundation pieces, then drill into §K for the Soccer build sequence. §M is the dashboard view.

**Framing rule:** "NOT LAUNCH READY" from Phase 5 does NOT mean "deprioritize Soccer." It means "do the foundation first so Soccer can ship correctly." Soccer is the next major build; this roadmap exists to make that happen safely.

---

## A. Shared platform contract — universal Daily Edge

Every sport — MLB, NBA, NHL today; Soccer, NFL, Player Props next — must coordinate through the same 12 contracts. Today these are implicit; Phase 6 codifies them.

| # | Contract | Today's state | Phase 6 target |
|---|----------|---------------|---------------|
| A1 | **Schedule / fixture adapter** | Per-sport seed services (`seedNhlGamesService.ts`, no NFL, no Soccer); `ISlateProvider` interface generic but only NBA/MLB implementations exist | One interface, per-sport implementations registered in the `SportAdapter` (see §B). Sport-agnostic seed dispatcher in `automationOrchestrator.ts` |
| A2 | **Market adapter** | Sport-aware switches: `marketKeysFor(sport)` in `DailyEdgeShell.tsx`; `refreshNhlLinesService.ts:111-119` normalizes per-sport market names | Declarative `marketAdapter` on each `SportAdapter` listing publicTrackingMarkets + contextOnlyMarkets + normalization rules |
| A3 | **Prediction generator** | Sport-specific files: `mlbAutoModelV2_2.ts`, `nbaAutoModelV1.ts`, `nhlAutoModelV0.ts`, plus `propModelOrchestrator.ts` | `buildPrediction(snapshot)` method on each `SportAdapter`. Sport-agnostic dispatcher in `automodelService.ts` |
| A4 | **Lock snapshot** | Implicit shape per sport: MLB 47 keys, NBA flat `predicted_*` (post-`cba9ea5`), NHL 7 keys; no `lockSnapshotContract.ts` | Shared `lockSnapshotContract.ts` (see §E) with required base fields + sport-specific extensions registered via `SportAdapter` |
| A5 | **DTO / card adapter** | `app/api/lab/daily-edge/route.ts:2698-2719` has `if (sport === "nba")` / `if (sport === "nhl")` branches; MLB is the fall-through default | `buildDtoForGame()` method on each `SportAdapter`. Sport-agnostic dispatcher in `route.ts` |
| A6 | **Public tracking market registry** | NONE. `TrackedMarketV17` enumerates possibilities but no per-sport map | New file `lib/config/officialTrackingMarkets.ts` (see §C) — single source of truth for which (sport, market) tuples are publicly tracked |
| A7 | **Context-only displayed market snapshot** | NONE. NBA spread + NHL puck-line currently violate the displayed-without-capture rule | New `snapshot_json.displayed_context_markets` substrate (see §D) |
| A8 | **Grading adapter** | `predictionGrader.ts` (MLB, shared) + `nhl/gradeNhlPredictions.ts` (NHL specific). Soccer/NFL/props missing | `gradePrediction(record, finalState)` method on each `SportAdapter` with sport-specific draw / OT / push rules |
| A9 | **Calibration adapter** | `calibration_buckets` table has MLB rows only; NBA/NHL not represented; mixed `model_version` not filtered | Per-sport calibration writer + reader; filter by `model_version`; document per-market sample-size requirements |
| A10 | **Auditor adapter** | `scripts/operator/audit-daily-edge-integrity.ts:32-38` is MLB-only (task #453) | Per-sport `auditRules` on each `SportAdapter` (HIGH/WARN/INFO checks per §H) consumed by a sport-agnostic auditor runner |
| A11 | **Automatic fixer adapter** | Repair operator scripts exist (e.g., null-odds, splits backfill) but no shared engine | Sport-agnostic refresh-cycle fixer (see §G) parameterized by per-sport rules in `SportAdapter` |
| A12 | **Operator dashboard / reporting** | No dedicated operator UI; per-slate diagnosis via DB queries + ad-hoc scripts in `scripts/operator/` | New `/lab/operator` or `/admin/operator` page (see §J) consuming structured output from auditor + fixer + adapter status |

All 12 contracts must be addressable through one identifier: the `SportAdapter`.

---

## B. `SportAdapter` interface (the single most important Phase 6 artifact)

Codify in `lib/types/SportAdapter.ts`. Required methods + descriptors:

```ts
export interface SportAdapter {
  // === Identity ===
  readonly sport: Sport;                              // discriminator
  readonly displayName: string;
  readonly launchStatus: LaunchStatus;                // "trusted" | "partial" | "blocked" | "not_ready"

  // === Markets ===
  readonly publicTrackingMarkets: ReadonlyArray<TrackedMarket>;
  readonly contextOnlyMarkets: ReadonlyArray<MarketKey>;
  readonly marketKeys: ReadonlyArray<MarketKey>;
  marketLabel(market: MarketKey): string;
  marketNormalize(providerName: string): MarketKey | null;

  // === Schedule / fixtures ===
  scheduleProvider: IScheduleProvider;
  seedSlate(date: string, opts: SeedOpts): Promise<SeedResult>;
  lockScheduleDescriptor: LockScheduleDescriptor;     // T-60 / per-game / weekly

  // === Sources ===
  linesProvider: ILinesProvider;
  signalProvider: ISignalProvider | null;             // null when unavailable
  scoreProvider: IScoreProvider;

  // === Model ===
  readonly modelVersion: string;
  buildPrediction(
    game: GameRow,
    snapshot: SportFeatureSnapshot
  ): Promise<SportPrediction>;

  // === Lock snapshot ===
  buildLockSnapshot(
    prediction: SportPrediction,
    market: GameMarket,
    sources: SnapshotSources
  ): SnapshotJson;
  readonly lockSnapshotContract: LockSnapshotContract;
  readonly contextMarketSnapshotContract: ContextMarketSnapshotContract;

  // === Grading ===
  gradePrediction(
    record: PredictionRecord,
    finalState: GameFinalState
  ): GradeRow;
  readonly drawRules: DrawRules;                      // "win|loss|push|void" mapping per market
  readonly otRules: OTRules;                          // OT/extra-innings/extra-time policy

  // === Display ===
  buildDtoForGame(
    game: GameRow,
    prediction: PredictionRecord | null,
    sources: DtoSources
  ): SportGameDto;
  readonly cardLayout: CardLayoutDescriptor;
  readonly contextOnlyDisplayLabels: Record<MarketKey, string>;

  // === Calibration ===
  readonly calibrationContract: CalibrationContract;  // sample-size requirements per market

  // === Auditor / fixer ===
  readonly auditRules: SportAuditAdapter;
  readonly fixerRules: SportFixerAdapter;
}

export type LaunchStatus = "trusted" | "partial" | "blocked" | "not_ready";
```

Registry: `lib/sports/index.ts` exports `sportRegistry: Record<Sport, SportAdapter>`. Every consumer (orchestrator, route handler, auditor, fixer, UI) reads from the registry instead of switching on `sport`.

**Acceptance criterion for Phase 6 completion:** zero `if (sport === "...")` switches outside the `sports/<sport>` directories. The audit can grep for `sport === "` occurrences in `lib/services/`, `app/api/`, `app/lab/` and confirm they shrink toward zero.

---

## C. Official public tracking market registry

New file: `lib/config/officialTrackingMarkets.ts`

```ts
export const OFFICIAL_TRACKING_REGISTRY: Record<Sport, ReadonlyArray<TrackedMarket>> = {
  mlb: ["moneyline", "total", "first_inning"],
  nba: ["moneyline", "total"],
  nhl: ["moneyline", "total"],
  nfl: [],                          // TBD — explicitly empty until product launch decision
  soccer: [],                       // TBD — see §K.7 for launch candidates
  ucl: [],                          // TBD
  cbb: [],
  cfb: [],
} as const;

export function isOfficiallyTracked(sport: Sport, market: TrackedMarket): boolean {
  return OFFICIAL_TRACKING_REGISTRY[sport].includes(market);
}
```

Consumers must call `isOfficiallyTracked(sport, market)`:
- `predictionRecordService.ts` before inserting a row that has tracking semantics.
- Auditor when checking "official tracked market missing grade after final" (§H HIGH check).
- UI when deciding whether a market belongs in the public tracking section.
- Calibration writer when deciding whether to record a bucket.

**Soccer candidates for official launch:** see §K.7. Phase 6 does NOT decide; it recommends and surfaces for product approval.

---

## D. Context-only displayed market snapshot

New substrate on every locked record: `snapshot_json.displayed_context_markets`.

Shape:

```ts
type DisplayedContextMarket = {
  market: MarketKey;
  pick: string;                     // e.g., "VGK +1.5"
  side: "home" | "away" | "over" | "under" | "draw" | string;
  line: number | null;
  odds_american: number | null;
  grade_or_label: string;           // e.g., "Model context · lean"
  edge_pct: number | null;
  model_projection: unknown;        // shape per market
  source_evidence: SourceEvidence;
  ui_label: string;                 // e.g., "Model context · Not part of official tracking"
  officially_tracked: false;        // always false in this substrate
  displayed_at_lock: true;
  captured_at: string;              // ISO timestamp
};

// Stored as:
snapshot_json.displayed_context_markets: Record<MarketKey, DisplayedContextMarket>;
```

Writer location: per-sport `buildLockSnapshot()` in the `SportAdapter`. The writer captures every market that `buildDtoForGame` would render but that is NOT in `OFFICIAL_TRACKING_REGISTRY[sport]`.

Reader location:
- Auditor (`§H` HIGH check: "displayed field not present in lock snapshot") reads this substrate to verify card-snapshot consistency.
- UI does NOT need to read it — UI reads live state + the regular DTO.

**This is the substrate that closes the NHL puck-line gap (Phase 4 §A.4 Option A) and reopens the door to NBA spread display (currently hidden via Option B).**

---

## E. Shared lock snapshot contract

New file: `lib/types/LockSnapshotContract.ts`.

### E.1 Required base fields (every sport, every market)

```ts
export interface LockSnapshotBase {
  // Identity
  sport: Sport;
  market: MarketKey;
  model_version: string;

  // Pick
  pick: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;

  // Model output
  confidence: number;
  play_grade: PlayGrade;
  model_probability: number;
  market_probability: number;
  edge_pct: number;

  // Provenance
  source_evidence: SourceEvidence;
  line_source_quality: "real_book" | "consensus_fallback" | "unavailable";
  market_state: "available" | "thin" | "unavailable";
  signal_state: "available" | "thin" | "unavailable";
  input_freshness: Record<string, string>;  // field → ISO timestamp

  // Lock
  locked_at: string;
  lock_source: "automation" | "manual" | "operator_override";

  // Flags
  officially_tracked: boolean;
  context_only: boolean;
}
```

### E.2 Sport-specific extensions

Each `SportAdapter` registers an extension type:

```ts
// MLB
interface MlbLockSnapshotExt {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  fi_v2_audit?: object;             // first-inning specific
  v2_2_audit: object;               // posterior + capping flags
  data_integrity: object;           // 13-key block
  framework_grades_at_lock: object;
  signal_rows_at_lock: SignalRow[];
  lines_at_lock: LineRow[];
}

// NBA
interface NbaLockSnapshotExt {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_spread_home: number;
  splits_state: "available" | "unavailable";
  current_price: { odds_american: number; sportsbook: string; note: string };
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  displayed_context_markets?: Record<MarketKey, DisplayedContextMarket>;  // spread context if shown
}

// NHL
interface NhlLockSnapshotExt {
  predicted_home_goals: number;
  predicted_away_goals: number;
  predicted_total_goals: number;
  goalie_assumption: {
    home: { source: "confirmed" | "default_most_playoff_gp"; player_name: string };
    away: { source: "confirmed" | "default_most_playoff_gp"; player_name: string };
  };
  market_at_lock: { total_line: number; ml_book_count: number; lines_snapshot: LineRow[] };
  displayed_context_markets?: Record<MarketKey, DisplayedContextMarket>;  // puck-line context
}

// Soccer (NEW for Phase 6)
interface SoccerLockSnapshotExt {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total_goals: number;
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  market_odds_home: number | null;
  market_odds_draw: number | null;
  market_odds_away: number | null;
  market_total_line: number | null;
  market_total_over_odds: number | null;
  market_total_under_odds: number | null;
  fixture_metadata: SoccerFixtureMetadata;  // tournament, stage, group, neutral_site, knockout, ET/penalties_eligible
  grading_state: "regulation_only" | "full_time" | "extra_time" | "penalties";
  displayed_context_markets?: Record<MarketKey, DisplayedContextMarket>;  // BTTS / handicap if shown
}

// NFL
interface NflLockSnapshotExt {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_spread_home: number;
  qb_assumption: { home: QbSnapshot; away: QbSnapshot };
  week_number: number;
  primetime_flag: boolean;
}

// Player props
interface PropLockSnapshotExt {
  player_id: number;
  player_external_id: string;
  player_name: string;
  team_id: number;
  prop_market: PropMarketType;
  prop_line: number;
  is_main_line: boolean;             // requires lines.is_main_line column (§K? no — Phase 6 #39)
  scratched_at_lock: boolean;
  // ... per propModelOrchestrator 6-factor breakdown reference
}
```

### E.3 Auditor verifies the contract

Auditor reads `snapshot_json` and checks:
- All `LockSnapshotBase` fields present.
- The sport-specific extension matches the registered shape for that `model_version`.
- `officially_tracked` matches `OFFICIAL_TRACKING_REGISTRY[sport].includes(market)`.
- `context_only === !officially_tracked`.

---

## F. Shared `assertNotLocked()` / lock write guard

New file: `lib/db/assertNotLocked.ts`.

```ts
/**
 * Single trip-wire for any write that would touch a locked prediction_record.
 * Throws if locked_at IS NOT NULL.
 *
 * Replaces 5 distributed guards documented in Phase 3 §A.5:
 *   - predictionRecordService.ts:1404-1421
 *   - automodelService.ts:291-314 (fetchLockedExternalIds)
 *   - trackingRefreshService.ts:245-248
 *   - automationOrchestrator.ts:1145 (ingestScoresModel)
 *   - daily-edge/route.ts:137-150 (resolveLockedVerdict)
 *
 * After Phase 6: every PredictionRecord writer calls this directly.
 */
export async function assertNotLocked(
  supabase: SupabaseClient,
  predictionRecordId: number,
  field: keyof PredictionRecordWriteable,
  context: { writer: string; reason: string }
): Promise<void>;
```

### F.1 Fields the guard protects (per Phase 3 §A.5 + the auditor contract)

Post-lock, NO mutation of:
- `pick`
- `side`
- `market`
- `line_value`
- `odds_american`
- `confidence`
- `play_grade`
- `model_probability`
- `market_probability`
- `edge_pct`
- `rationale`
- `source_evidence`
- `snapshot_json.v2_2_audit` (or sport equivalent)
- `snapshot_json.predicted_*` fields

### F.2 Fields that MAY be updated post-lock (with source attribution)

- `prediction_grades.*` (grading rows)
- `tracking_results.*` (tracking rows)
- `snapshot_json.post_lock_repairs[]` (operator-attributed repair log)
- `snapshot_json.post_lock_invalidated_at` + `post_lock_invalidation_reason` (incident path)
- Final score / status fields on `games` (from trusted source)

Database-level enforcement consideration: a PostgreSQL trigger on `prediction_records` UPDATE that rejects column changes when `locked_at IS NOT NULL` (whitelist of allowed columns). This is belt-and-suspenders to the application-level guard.

---

## G. Refresh-cycle auditor / fixer

Per [[project-auditor-fixer-design-contract]], every refresh is a mini-integrity pass. Phase 6 turns this into shipping code.

### G.1 The 10-step pass

```
Each refresh cycle (cron-driven, sport-parameterized via SportAdapter):

1. Refresh source / provider data (lines, signals, schedule, scores).
2. Check inputs present + fresh + internally consistent.
3. Detect stale / missing / mismatched / thin data.
4. Repair safe deterministic issues automatically (§I rules).
5. Mark unrepaired required issues as BLOCKED / PARTIAL with exact reason.
6. Refresh prediction_records IF game still pre-lock AND inputs changed (per Phase 6
   pre-lock pick refresh rule — refresh is good, silent post-lock change is bad).
7. Preserve current/history/provenance so we can prove what changed and why.
8. Prevent stale/incomplete data from being presented as trusted (slate gate).
9. AT LOCK: freeze the complete prediction snapshot per §E contract.
10. AFTER LOCK: prevent decision changes; only add/repair source-backed
    outcome/grade/tracking fields (with attribution per §F.2).
```

### G.2 Sport-agnostic core, sport-specific rules

The 10-step loop lives in `lib/services/refreshCycleAuditor.ts`. Each step calls the active `SportAdapter` for sport-specific decisions:
- Step 2: `SportAdapter.scheduleProvider.checkFreshness()`
- Step 3: `SportAdapter.auditRules.detectStaleness()`
- Step 4: `SportAdapter.fixerRules.canAutoRepair(issue)`
- Step 6: `SportAdapter.buildPrediction()` (called only if pre-lock + inputs changed)
- Step 9: `SportAdapter.buildLockSnapshot()` once at lock

### G.3 Failure modes

If step 1–4 cannot resolve a required input, step 8 BLOCKs the slate. The decision tree:

| State | Result | UI |
|-------|--------|-----|
| All required inputs present, fresh, consistent | TRUSTED | Card renders normally |
| Some context inputs thin / stale | PARTIAL | Card renders with "Partial data" badge; auditor logs WARN |
| Required input missing AND not repairable from source | BLOCKED | Card hides or shows "Data unavailable today" |
| Required input missing AND vendor coverage gap | BLOCKED with vendor attribution | Card hides; INFO logged |
| Post-lock bug discovered after users saw the slate | INVALIDATED | Original locked record preserved; `snapshot_json.post_lock_invalidated_at` set; auditor surfaces |

### G.4 Why this matters for Soccer

Soccer's failure modes are different from MLB:
- Soccer matches can be postponed / abandoned / forfeit.
- Tournament stages have different grading rules (regulation vs ET vs penalties).
- Neutral-site venues have no home-team adjustment.

The 10-step pass is sport-agnostic because the steps themselves are universal; the per-sport behavior lives in `SportAdapter`. Soccer's adapter (§K) implements the soccer-specific versions of each rule.

---

## H. Auditor checks — cross-sport HIGH / WARN / INFO

The auditor today (`scripts/operator/audit-daily-edge-integrity.ts`) is MLB-only with 5 categories (A: lock contract, B: splits, C: lines/odds, D: tracking/grading, E: thinning). Phase 6 generalizes to cross-sport via `SportAdapter.auditRules`.

### H.1 HIGH (slate / market blocked; user-visible)

1. **Scheduled game missing prediction** — game in `games` with `status = "scheduled"`, no row in `prediction_records` for an officially-tracked market.
2. **Card reads live data after lock** — DTO returns a different pick/confidence/line than `prediction_records` for a locked row.
3. **Displayed field not present in lock snapshot** — DTO renders a market value (line, grade, edge) for which no snapshot field exists. Per §D, context-only markets must be captured in `displayed_context_markets`.
4. **Official tracked market missing grade after final** — game `status = "final"`, market in `OFFICIAL_TRACKING_REGISTRY[sport]`, no `prediction_grades` row.
5. **Stale prediction pre-lock when inputs changed** — `prediction_records.updated_at` < input `_source_recorded_at` AND `locked_at IS NULL`.
6. **Invalid final score / status** — `games.status = "final"` but `home_score IS NULL` or `away_score IS NULL`.
7. **Required market line missing** — locked row has `line_value IS NULL` AND market requires a line (Total, Spread).
8. **Public tracking market not in registry** — `prediction_records.market` value not in `OFFICIAL_TRACKING_REGISTRY[sport]` AND `officially_tracked = true`.
9. **Untracked context market displayed without context label / internal snapshot** — DTO renders a market not in registry, but `snapshot_json.displayed_context_markets[market]` is absent OR UI label doesn't include "context" / "not part of official tracking".
10. **Soccer draw market forced into binary win/loss logic** — soccer prediction with `prob_draw IS NOT NULL` but grader returned `result = "loss"` or `"win"` on a drawn match (should be per the soccer draw rules in §K.4).
11. **Soccer match missing draw odds when 1X2 is official** — soccer `prediction_records` for 1X2 market but `snapshot_json.market_odds_draw IS NULL`.
12. **Soccer grading unable to grade draw outcome correctly** — soccer final state has tied score AND no grade row produced AND grader returned an error.
13. **Post-lock locked field mutation detected** — audit trail shows a write to a protected field (§F.1) on a locked row without invalidation path.

### H.2 WARN (degraded but not blocking)

1. **Sharp / public data unavailable** — `sharp_signals` table empty for game; SportAdapter `signalProvider !== null` but returned no rows.
2. **Thin market data** — `< 3` book-distinct prices for a market.
3. **Calibration sample too small** — fewer than 30 graded predictions per (sport, market, model_version, confidence bucket).
4. **Heuristic source assumption** — NHL `goalie_assumption.source = "default_most_playoff_gp"`; soccer team mapping fallback; etc.
5. **Missing optional context** — weather data unavailable, lineup not confirmed (MLB), etc.
6. **Soccer team mapping confidence below threshold** — fuzzy-match score < 0.95 for a team alias.
7. **Fixture provider lacks neutral-site or tournament metadata** — soccer match missing stage / group / knockout flag.
8. **Substrate completeness** — locked record missing one of the §E base fields (e.g., older records before substrate rollout — INFO not WARN if before rollout date).

### H.3 INFO (logged, no action)

1. **Source unavailable by vendor** — SharpAPI returned 404 for a known-thin market (NHL Finals splits).
2. **No public splits expected** — sport adapter declares `signalProvider: null`.
3. **Context-only market hidden** — `marketKeysFor(sport)` omits a market that's in `contextOnlyMarkets`; valid Option-B state.
4. **Older record without substrate** — locked before §E rollout date; not a defect.

### H.4 Per-sport overrides

Each `SportAdapter.auditRules` declares which of the 13 HIGH checks apply, and any sport-specific additions. Soccer (§K.9) adds:
- HIGH: fixture missing stage metadata for a knockout match (grading rules diverge by stage).
- HIGH: team mapping unmatched after deterministic + alias attempts.
- WARN: ET / penalties eligibility unknown.

---

## I. Automatic fixer rules

### I.1 Safe pre-lock auto-repair (no operator approval required)

The fixer SHOULD automatically apply these when source-backed evidence exists:

| Repair | Pre-lock | Post-lock | Rule |
|--------|----------|-----------|------|
| Stale current row → restore from fresh provider | ✅ | ❌ | Source-backed |
| Missing `_source` / `_source_recorded_at` metadata → backfill | ✅ | ✅ | Provenance |
| Missing snapshot/provenance fields on pre-lock record → backfill | ✅ | ❌ | Pre-lock only |
| Stale `prediction_records` when inputs changed → refresh prediction | ✅ | ❌ | Pre-lock pick refresh is GOOD |
| Wrong game `status` / `slate_date` → repair from source | ✅ | ✅ when source-backed | ET-aware (see [[feedback-no-stale-vs-blocked-menus]]) |
| Final score / status backfill from trusted source | n/a | ✅ | Outcome ingest |
| Pending grades after final → resolve | n/a | ✅ | Source-backed grading |
| Tracking row tied to wrong prediction_record → re-key | n/a | ✅ when source-backed | Match by game+market+side |
| Soccer fixture status / date repair when source-backed | ✅ | ✅ | Postponement, time-change |
| Soccer team alias / country mapping repair when deterministic | ✅ | ❌ | Pre-lock only |
| `lines` row with broken `line_value` sign convention → flip per `marketAdapter` | ✅ | ❌ | Sign-convention guard |

### I.2 Unsafe without operator approval

Per [[project-auditor-fixer-design-contract]]:

- Changing locked pick / confidence / line / odds / play_grade / model_probability / edge / rationale.
- Retroactively adding a market to public tracking (writing a `prediction_records` row backdated for a market not in `OFFICIAL_TRACKING_REGISTRY` at the time of lock).
- Changing historical tracking scope (mutating past `prediction_records.market` or `officially_tracked` flag).
- Converting soccer draw / no-draw logic after lock (e.g., re-grading a 1X2 "home" pick as `push` after originally graded as `loss`).
- Changing official Soccer launch markets without product approval.

### I.3 Invalidation path

When a post-lock bug requires a correction:

```
1. PRESERVE original locked record (do not overwrite).
2. ADD snapshot_json.post_lock_invalidated_at + post_lock_invalidation_reason +
   operator_attribution.
3. ADD snapshot_json.post_lock_repairs[] with {at, operator_id, field, prior_value,
   new_value, reason, source_row_id} (machine-readable, not free-text).
4. AUDITOR surfaces invalidated records visibly so members + tracking see honest state.
5. UI shows the original pick + an "Updated: see notes" indicator.
```

---

## J. Operator dashboard

New page: `/admin/operator` (or `/lab/operator`). Single-pane-of-glass.

### J.1 What the operator sees

**Per-sport, per-slate strip:**
- Sport label + status pill (TRUSTED / BLOCKED / PARTIAL / NOT_LAUNCHED)
- Last refresh time
- Provider response freshness (per source: lines, signals, schedule, scores)
- Market coverage (3 of 3 / 2 of 3 / etc.)
- Sharp / public coverage
- Prediction freshness (count + last update)
- Lock status (count locked / total)
- Snapshot completeness (% of locked records passing §E base check)
- Grading / tracking status (graded count vs final count)
- Safe auto-repairs applied this cycle (count + reasons)
- Repairs needing approval (count + reasons + buttons)
- User-facing impact ("X games shown" / "Y games blocked")

**World Cup / Soccer launch-readiness checklist** (when soccer adapter exists but launch_status === "partial" || "not_ready"):
- §K.10 ten launch criteria as checkboxes.
- Each check shows green/red + the audit query that determines it.

### J.2 What the operator can do

- One-click manual refresh per sport per slate (calls the same `runSlate(sport, date)` orchestrator path; never bypasses guards).
- One-click "approve repair" for repairs in the pending bucket. Approval requires a note ≥ 10 chars stored as `repair.operator_note`.
- One-click "invalidate locked record" → enters the §I.3 invalidation path with operator attribution.
- View `prediction_records` history for any game (joins audit log).

### J.3 What the operator CANNOT do

- Direct DB writes (read-only DB connection on the dashboard).
- Bypass the lock guard (§F).
- Change tracking scope (the registry §C is the only source of truth).
- Trigger any action without attribution.

---

## K. World Cup / Soccer — immediate roadmap

**World Cup is the next major build.** Soccer is "NOT LAUNCH READY" today; Phase 6 makes it launch-ready. Below is the minimum-required sequence of workstreams.

### K.1 Sport registration

**Workstream:** add the sport key to all type unions, registries, and routes.

- Decide between `"soccer"`, `"world_cup"`, or tournament-specific sport keys (e.g., `"fifa_wc_2026"`).
- Recommended: use `"soccer"` as the broad sport key with a `competition` field on `games` to distinguish WC, UCL, league play. This avoids fragmenting the schema as more competitions launch.
- Files to update:
  - `lib/types/domain/Sport.ts:8-15` — add `| "soccer"`.
  - `lib/types/domain/Tracking.ts:98-105` — add `| "soccer"` to `TrackedSport`.
  - `lib/config/officialTrackingMarkets.ts` (new) — register markets per §K.7.
  - `lib/sports/index.ts` (new) — register `SoccerAdapter`.
  - `app/api/lab/daily-edge/route.ts` — add soccer dispatch (after adapter registry exists, this is one line).
  - `app/lab/components/daily-edge/DailyEdgeShell.tsx:71,247` — soccer market labels.
  - `vercel.json` — add `/api/cron/soccer-daily-refresh` entry.

**Acceptance:** `sport === "soccer"` recognized by all type guards, type-checker clean, tests pass.

### K.2 Fixture / schedule provider

**Workstream:** identify and integrate a soccer fixture API.

- Candidates: SportRadar Soccer API, OptaSports, API-Football, FBR Reference, official FIFA API (if available for WC 2026).
- Required fields per fixture:
  - `external_id`, `competition` (e.g., "fifa_wc_2026"), `stage` (group/round_16/quarter/semi/final), `group` (if group stage), `home_team`, `away_team`, `home_team_country`, `away_team_country`, `kickoff_iso`, `venue`, `is_neutral_site`, `et_eligible`, `penalties_eligible`.
- Handle:
  - Tournament stages (group → knockout transition).
  - Postponement / replay / abandonment.
  - Time zone correctness (soccer kickoffs span global timezones; slate_date may need a tournament-anchored timezone like FIFA's published schedule).
- New file: `lib/providers/soccer/_soccerApiClient.ts`.
- New file: `lib/services/soccer/seedSoccerGamesService.ts`.

**Acceptance:** seed pipeline ingests at least one full WC group-stage day with correct stage / group / venue / ET metadata. Idempotent re-runs are no-ops.

### K.3 Team / country mapping

**Workstream:** support national teams (and clubs for UCL phase 2).

- Schema migration:
  ```sql
  ALTER TABLE teams ADD COLUMN country_code CHAR(3);          -- ISO 3166-1 alpha-3
  ALTER TABLE teams ADD COLUMN is_national_team BOOLEAN DEFAULT FALSE;
  ALTER TABLE teams ADD COLUMN competition_scope TEXT;        -- nullable for clubs that play multiple comps
  ```
- New file: `lib/providers/soccer/_teamNameNormalizer.ts` — maps "USA" / "United States" / "United States of America" to a single internal team_id.
- Alias table consideration: `team_aliases` for nicknames + provider-id mappings.
- Logging: unmatched-row counter via `auditRules` (HIGH if any unmatched team after deterministic + alias attempts; see §H per-sport overrides).

**Acceptance:** all 32 WC teams (or whatever the 2026 tournament size is) have a single internal team_id with `country_code` set. No duplicates. Provider IDs from at least one fixture API map deterministically.

### K.4 Soccer markets + draw handling

**Workstream:** define market keys and grading semantics for soccer.

Markets to support (in priority order):

| Market | Key | Public tracking candidate? | Grading semantics |
|--------|-----|---------------------------|------------------|
| 1X2 / result_3way | `result_3way` | YES (§K.7) | Home win → home wins; draw → home picks lose, draw picks win, away picks lose; away win → away wins |
| Total goals | `total` | YES (§K.7) | Standard over/under; push on exact integer line; void on abandonment |
| Double chance | `double_chance` | TBD | Already in `TrackedMarketV17`; home_or_draw / away_or_draw / home_or_away |
| Both teams to score | `btts` | NO (context-only) | Standard yes/no |
| Asian handicap | `asian_handicap` | NO (context-only) | Quarter-goal lines need partial wins; defer to v2 |
| Spread / European handicap | `spread` | NO (context-only) | Integer/half handicap |

**Draw rule for 1X2:**
- Pick = "home", match = draw → `result = "loss"`.
- Pick = "draw", match = draw → `result = "win"`.
- Pick = "away", match = draw → `result = "loss"`.

**This OVERRIDES the current MLB grader's `winningTeam === null → "void"` semantic** (Phase 5 §1.6). The soccer grader must NOT inherit that semantic. New file: `lib/services/soccer/gradeSoccerPredictions.ts`.

**Stage-specific rules:**
- Group stage: regulation 90' decides. No ET. Draws are valid outcomes.
- Knockout: full match outcome includes ET + penalties. Sportsbooks differ — some grade regulation-only, others grade after ET+pens. Phase 6 must lock the policy: **default to "full match including ET / penalties"** (matches most US books). Snapshot field: `grading_state` (§E.2 SoccerLockSnapshotExt).

### K.5 Soccer model contract

**Workstream:** declare what the model must output (NOT building the model — that's a separate research project).

Required outputs from `SoccerAdapter.buildPrediction`:
- `prob_home_win: number` (0–1)
- `prob_draw: number` (0–1)
- `prob_away_win: number` (0–1) — must sum to 1.0
- `predicted_home_score: number`
- `predicted_away_score: number`
- `predicted_total_goals: number`
- `confidence: number` (0–100 mapped per existing scale)
- `play_grade: PlayGrade`

Required missing-data behavior:
- If `prob_draw` cannot be computed (e.g., model only outputs binary), the prediction is BLOCKED — soccer requires a 3-way distribution.
- If sharp/public data unavailable, model output is degraded to PARTIAL data quality tier (analogous to NBA `data_quality_tier`).
- If team-mapping fallback used, log WARN per §H.

**Note:** the model itself is OUT OF SCOPE for Phase 6. Phase 6 codifies the INTERFACE. Daniel's separate "research/build the World Cup model" workstream produces the implementation.

### K.6 Soccer lock snapshot

**Workstream:** wire `SoccerLockSnapshotExt` (§E.2) into `buildLockSnapshot`.

Required fields at lock (per §E.2 + §E.1 base):
- All `LockSnapshotBase` fields.
- All `SoccerLockSnapshotExt` fields.
- `displayed_context_markets` for any market shown but not officially tracked (§D).

**Acceptance:** `auditRules.lockSnapshotComplete()` passes for a sample WC fixture lock.

### K.7 Soccer grading + tracking

**Workstream:** implement `gradeSoccerPredictions.ts` + update `OFFICIAL_TRACKING_REGISTRY`.

Recommended initial Soccer official-tracking markets (FOR PRODUCT APPROVAL — NOT a unilateral Phase 6 decision):
- `result_3way` (1X2)
- `total` (total goals)

Recommended initial Soccer context-only markets:
- `double_chance`
- `btts`
- `asian_handicap`
- `spread`

Rationale:
- 1X2 is the foundational soccer market. Members expect it.
- Total goals is a clean binary-like market with well-understood semantics.
- Double chance, BTTS, handicap, spread are derivatives — best shown as context until we have a calibration sample.

**Public tracking pollution risk:** adding any of these to `OFFICIAL_TRACKING_REGISTRY.soccer = []` requires intentional product approval. Phase 6 leaves the array empty by default; engineering must NOT silently populate it.

### K.8 Soccer UI / reader

**Workstream:** sport-specific card layout for 3-way markets.

- Reader card: 3-column layout for 1X2 (Home / Draw / Away) instead of binary chips.
- "Projected score" with goals (e.g., "Brazil 2 - 1 Croatia").
- "Projected total goals" prominent (e.g., "Model total: 2.7").
- Context-only chips visually distinct (e.g., BTTS shown smaller, with "Model context" label).
- NO "moneyline" wording — use "Result (1X2)" or "Match result".
- NO "first inning" / "puck line" / "spread" leakage. `marketKeysFor("soccer")` returns `["result_3way", "total"]` only (plus context markets in a separate display section).

### K.9 Soccer auditor + fixer rules

**Workstream:** declare `SoccerAdapter.auditRules` and `SoccerAdapter.fixerRules`.

Per-sport HIGH additions (§H.4):
- Fixture missing stage metadata for a knockout match.
- Team mapping unmatched after deterministic + alias attempts.
- 1X2 prediction missing `prob_draw`.
- 1X2 prediction with `prob_draw > 0` graded as binary win/loss.
- Soccer match with `et_eligible = true` graded before ET resolution.

Per-sport WARN additions:
- Team mapping confidence < 0.95.
- ET / penalties eligibility unknown.
- Knockout match with regulation tie but no ET state ingested.

Fixer additions (§I.1):
- Soccer fixture status (postponed / replay) repair from source.
- Soccer team alias mapping repair when deterministic.
- Neutral-site flag backfill from venue table.

### K.10 Soccer LAUNCH GATE (must pass all 10 before public-facing launch)

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Fixtures seed automatically for the next 7 days | Cron output + `games` table query |
| 2 | Market data ingests automatically for each fixture | `lines` table query per fixture, expect ≥ 3 books per market |
| 3 | Predictions generate for ALL intended matches | `prediction_records` count == `games` count for the slate |
| 4 | Draw-aware model output exists | Every prediction has `prob_draw IS NOT NULL` and 3 probabilities sum to 1.0 |
| 5 | Lock snapshot passes contract (§E) | Auditor reports zero HIGH issues for substrate completeness |
| 6 | DTO / card is soccer-specific and honest | Manual visual review + no "moneyline" / "first inning" wording leakage |
| 7 | Grading supports intended official markets | Test suite: home-win, away-win, draw outcomes all produce correct grades for 1X2 and total |
| 8 | Public tracking registry is approved (`OFFICIAL_TRACKING_REGISTRY.soccer = [...]`) | Product sign-off, registry committed |
| 9 | Auditor passes for a full sample slate | Zero HIGH issues, no unresolved unmatched team mappings |
| 10 | Operator dashboard shows soccer slate green | Dashboard renders sport row with TRUSTED status |

Until all 10 pass, soccer is BLOCKED from member-facing rendering. Internal admin / operator views may show partial state.

---

## L. Prioritized roadmap — sequenced delivery buckets

### Bucket 1 — Immediate live-card trust fixes (this week)

| # | Item | Source | Effort |
|---|------|--------|--------|
| L1.1 | NBA sharp_signals coverage investigation (vendor gap vs pipeline bug) | Phase 4 §L.1 | 1 day investigation |
| L1.2 | NHL DTO honesty: replace hardcoded `sharpSignals: []`, `result.markets.pickResult: null`, `sharpRead: "wait_no_edge_clean"` | Phase 4 §F.3 + §L.3-5 | 1 day |
| L1.3 | NHL puck-line: decide Option A (internal capture + UI label) or Option B (hide) | Phase 4 §A.4 + §L.2 | 0.5 day decision + 1 day implementation |

### Bucket 2 — Before next NBA / NHL slate (next sprint)

| # | Item | Source | Effort |
|---|------|--------|--------|
| L2.1 | NHL pending-grade UPDATE regression test | Phase 4 §L.11 | 0.5 day |
| L2.2 | NHL substrate completeness extension (add `predicted_*_score`, `data_integrity`, `framework_grades_at_lock`) | Phase 4 §L + Phase 6 §E.2 | 2 days |
| L2.3 | NHL confirmed-goalie ingest (replace `default_most_playoff_gp` heuristic) | Phase 4 §L.7 | 3 days |
| L2.4 | NBA sharp_signals writer for whatever SharpAPI returns | Phase 2 §H + memory item #2 | 3 days |

### Bucket 3 — Before MLB stays the benchmark (next 2-3 sprints)

| # | Item | Source | Effort |
|---|------|--------|--------|
| L3.1 | Shared `lockSnapshotContract.ts` (§E) — extract MLB, NBA, NHL implicit shapes into one module | Phase 3 §N.1 + Phase 6 §E | 4 days |
| L3.2 | Shared `assertNotLocked()` trip-wire (§F) — replace 5 distributed guards + add DB-level constraint | Phase 3 §N.2 + Phase 6 §F | 3 days |
| L3.3 | Model-version-aware calibration writer + reader (filter by `model_version`) | Phase 3 §N.3 | 3 days |
| L3.4 | MLB ML overconfidence correction (n=181, 58.1% vs 65% expected) — apply shrinkage post-blend OR re-label OR surface honestly | Phase 3 §N.7 | 2-5 days |
| L3.5 | MLB Total calibration review (n=38, 47.4%) — investigate posterior_total guardrail / weather gate / dual-source line picker | Phase 3 §N.6 | 5 days research |
| L3.6 | CLV design decision (build end-to-end OR document explicit absence) | Phase 3 §N.4 + memory non-claim #1 | 1 week if building; 1 day if documenting absence |
| L3.7 | Market movement (open→current) design decision: ingest or remove scaffold | Phase 3 §N.5 | 1 week if building; 1 day if removing |
| L3.8 | Per-field provenance extension (`_source`, `_source_row_id`, `_source_recorded_at`) | Phase 3 §N.10 | 4 days |
| L3.9 | Auditor substrate-completeness check (rollout-date-aware) | Phase 3 §N.8 | 2 days |
| L3.10 | Post-lock invalidation path (machine-readable, not free-text) | Phase 3 §N.9 + Phase 6 §I.3 | 3 days |

### Bucket 4 — Before World Cup / Soccer launch (the next engineering work order)

**This is the SoccerAdapter foundation bucket. Soccer is next, but only after these land.**

| # | Item | Source | Effort |
|---|------|--------|--------|
| L4.1 | **Codify `SportAdapter` interface** in `lib/types/SportAdapter.ts` | Phase 6 §B | 1 week |
| L4.2 | Refactor MLB into `MlbAdapter implements SportAdapter` (no behavior change) | Phase 6 §B | 1.5 weeks |
| L4.3 | Refactor NBA into `NbaAdapter implements SportAdapter` | Phase 6 §B | 1 week |
| L4.4 | Refactor NHL into `NhlAdapter implements SportAdapter` | Phase 6 §B | 1 week |
| L4.5 | **Official public tracking market registry** `lib/config/officialTrackingMarkets.ts` | Phase 6 §C | 2 days |
| L4.6 | **Context-only `displayed_market_snapshot` substrate** (§D) — implement for NBA spread + NHL puck-line first | Phase 6 §D | 4 days |
| L4.7 | **Shared refresh-cycle auditor / fixer** (§G) — 10-step pass parameterized by `SportAdapter` | Phase 6 §G | 1.5 weeks |
| L4.8 | **Cross-sport auditor generalization** (task #453) — `audit-daily-edge-integrity.ts` → sport-adapter-driven | Phase 6 §H + task #453 | 1 week |
| L4.9 | **Soccer sport registration** (§K.1) — add `"soccer"` to Sport union + register `SoccerAdapter` stub | Phase 6 §K.1 | 1 day |
| L4.10 | **Soccer team / country schema migration** (§K.3) — `teams.country_code`, `is_national_team`, `competition_scope` | Phase 6 §K.3 | 2 days |
| L4.11 | **Soccer fixture provider** (§K.2) — `_soccerApiClient.ts` + `seedSoccerGamesService.ts` + tournament metadata | Phase 6 §K.2 | 1.5 weeks |
| L4.12 | **Soccer team / country mapping** (§K.3) — `_teamNameNormalizer.ts` + alias table + deterministic guards | Phase 6 §K.3 | 1 week |
| L4.13 | **Soccer market keys + draw grading** (§K.4) — `gradeSoccerPredictions.ts` with 1X2 draw semantics; stage-aware ET/penalties policy | Phase 6 §K.4 | 1 week |
| L4.14 | **Soccer model contract** (§K.5) — declare interface; model implementation is separate research workstream | Phase 6 §K.5 | 2 days interface + ongoing research |
| L4.15 | **Soccer lock snapshot extension** (§K.6 + §E.2) — `SoccerLockSnapshotExt` wired into `SoccerAdapter.buildLockSnapshot` | Phase 6 §K.6 | 3 days |
| L4.16 | **Soccer UI / reader** (§K.8) — 3-way card layout, "Match result" wording, no MLB/NBA/NHL label leakage | Phase 6 §K.8 | 1.5 weeks |
| L4.17 | **Soccer auditor + fixer rules** (§K.9) — `SoccerAdapter.auditRules` HIGH/WARN additions | Phase 6 §K.9 | 4 days |
| L4.18 | **Soccer launch gate verification** (§K.10) — operator dashboard renders all 10 checks; product approval required for `OFFICIAL_TRACKING_REGISTRY.soccer = [...]` | Phase 6 §K.10 + §J | 3 days |
| L4.19 | **Operator dashboard** (§J) — at minimum, per-sport status strip + soccer launch checklist | Phase 6 §J | 1.5 weeks |

**Bucket 4 total estimated effort:** ~14 weeks of focused engineering, assuming serial work on the adapter refactor (which is the critical-path piece). Some items can parallelize.

**Bucket 4 critical path:** L4.1 → L4.2/L4.3/L4.4 (parallel) → L4.5/L4.6 → L4.7/L4.8 → L4.9–L4.18 (Soccer-specific) → L4.19 (operator).

### Bucket 5 — Before NFL launch

| # | Item | Source | Effort |
|---|------|--------|--------|
| L5.1 | NFL provider integration (SharpAPI `league="nfl"` or new client) | Phase 5 §2.2 + §6.36 | 1 week |
| L5.2 | NFL `seedNflGamesService.ts` + weekly slate concept | Phase 5 §2.2 + §6.35 | 1.5 weeks |
| L5.3 | `NFL_SCHEMA` extension with spread fields | Phase 5 §6.38 | 1 day |
| L5.4 | Spread grading branch in `predictionGrader.ts` (or `NflAdapter.gradePrediction`) | Phase 5 §6.34 | 4 days |
| L5.5 | NFL QB snapshot type | Phase 5 §6.37 | 3 days |
| L5.6 | NFL tie / OT policy | Phase 5 §2.4 + §6.34 | 1 day decision + 2 days code |
| L5.7 | NFL `OFFICIAL_TRACKING_REGISTRY.nfl = [...]` decision | Phase 5 §6 + §C | Product decision |
| L5.8 | NFL cron entry + `NFL_CRON_ENABLED` gate | Phase 5 §2.2 | 1 day |

### Bucket 6 — Before Player Props launch

| # | Item | Source | Effort |
|---|------|--------|--------|
| L6.1 | `lines.is_main_line` column + migration | Phase 5 §6.39 | 1 day |
| L6.2 | `player_game_stats` table for persistence | Phase 5 §6.40 | 2 days |
| L6.3 | DNP / scratch handling in `outcomeResolver.resolveProp` | Phase 5 §6.41 | 3 days |
| L6.4 | Cross-provider `_playerIdNormalizer.ts` | Phase 5 §6.42 | 4 days |
| L6.5 | SharpAPI prop-line production validation (dry-run + book coverage proof) | Phase 5 §6.43 | 3 days |
| L6.6 | Daily Edge prop card UI | Phase 5 §6.44 | 1.5 weeks |
| L6.7 | Prop calibration buckets extension | Phase 5 §6.45 | 3 days |
| L6.8 | Props public-tracking scope decision (own substrate or context-only?) | Phase 5 §6.46 | Product decision |

### Bucket 7 — Longer-term hardening

| # | Item | Source | Effort |
|---|------|--------|--------|
| L7.1 | CLV measurement infrastructure end-to-end | Phase 3 §M.1 | 2 weeks |
| L7.2 | Closing-line snapshot job + CLV reporting per sport | Phase 6 §A9 | 1 week |
| L7.3 | True market movement ingestion (open→current delta as model input) | Phase 3 §M.2 + Phase 6 §A3 | 2 weeks |
| L7.4 | Cross-provider data reconciliation framework | Phase 5 §4 | 2 weeks |
| L7.5 | Live in-game audit (post-launch, post-tracking) | Phase 6 §J | TBD |
| L7.6 | Automated calibration drift detection | Phase 3 §N.3 | 1 week |
| L7.7 | Database trigger enforcing lock guard (belt-and-suspenders to §F) | Phase 6 §F | 1 week |
| L7.8 | Public tracking pollution alarm (auditor HIGH if a row would land in `prediction_records` for an out-of-registry market) | Phase 6 §C | 3 days |

---

## M. Final platform status table

| Sport | Current status | Launch readiness | Officially-tracked markets | Context-only markets shown | Major blockers | Required next step |
|-------|----------------|------------------|---------------------------|---------------------------|----------------|-------------------|
| **MLB** | LIVE | TRUSTED (near-benchmark, not yet fully benchmark) | ML, Total, First Inning | (none) | Lock snapshot contract implicit; ML overconfidence (58.1% vs 65% in 60-70% band); Total calibration underwater (47.4%); 3 model versions in `prediction_records`; CLV not measured | Bucket 3 items L3.1–L3.10 |
| **NBA** | LIVE — limited slate | PARTIAL (Finals only) | ML, Total | (Spread currently hidden via `cba9ea5`; could be context-only with §D substrate) | Sharp signals writer absent (vendor gap + pipeline gap); SharpAPI NBA coverage thin; ML overconfidence likely (NBA-specific calibration sample insufficient); thin substrate | Bucket 2 items L2.4 + Bucket 4 items L4.6 (displayed_market_snapshot enabling future spread re-display) |
| **NHL** | LIVE — Stanley Cup only | PARTIAL (n=1 game verified, tracking works) | ML, Total | Puck-line (Option A — internal capture + UI label — recommended) | Sharp_signals empty for verified game; thin snapshot (7/47 keys); goalie heuristic; 3 hardcoded DTO honesty gaps; no auditor coverage | Bucket 1 items L1.1, L1.2, L1.3 + Bucket 2 items L2.1, L2.2, L2.3 |
| **World Cup / Soccer** | NOT IMPLEMENTED | NOT LAUNCH READY → **next major build** | TBD (recommended: result_3way + total goals; pending product approval) | TBD (recommended context-only: double_chance, btts, asian_handicap, spread) | No sport key, no provider, no team-country schema, no model, no grader, no draw handling, no shared adapter contract yet | **Bucket 4 — entire bucket. Critical path: §B SportAdapter → §K Soccer workstreams 1-10 → §K.10 launch gate.** |
| **NFL** | NOT IMPLEMENTED (placeholder schema only) | PARTIAL — needs adapter work | TBD | TBD | No provider, no seed service, no cron, no spread grader, no weekly-slate concept, no QB snapshot | Bucket 5 after Bucket 4 lands |
| **Player Props** | INFRASTRUCTURE READY (dry-run only) | PARTIAL — surprising readiness | TBD (separate substrate decision) | TBD | DNP handling, alt-lines, player_id normalizer, prop UI, SharpAPI prop-line validation | Bucket 6 (can partially parallelize with Bucket 5) |

---

## N. Important non-claims (Phase 6)

1. **No future sport is ready to launch today.** Soccer is next; that doesn't mean Soccer ships first. Bucket 4 must land first.
2. **The `SportAdapter` interface (§B) is the single biggest unlock.** Without it, every new sport compounds tech debt. With it, Soccer / NFL / Player Props can each ship as a focused workstream.
3. **The `OFFICIAL_TRACKING_REGISTRY` (§C) is approval-gated.** Engineering does not unilaterally add markets to public tracking — Daniel approves each registry change.
4. **The Soccer model itself is OUT OF SCOPE for Phase 6.** Phase 6 codifies the interface and the platform contracts. The model is a separate research workstream that produces an implementation conforming to `SoccerAdapter.buildPrediction`.
5. **CLV remains not-measured.** L7.1 is Bucket 7 — longer-term hardening. Soccer launch does NOT depend on CLV.
6. **The auditor v2 (§H, task #453) is a hard prerequisite** for Soccer launch. Without cross-sport auditor coverage, Soccer is "trusted by claim only."
7. **Operator dashboard (§J) is required for Soccer launch.** Today no single-pane operator view exists; the dashboard makes the launch gate (§K.10) verifiable instead of self-reported.
8. **Estimated effort is engineering-only.** Product approval cycles, model research, calibration baselines accumulating live samples — none of those are in the bucket estimates.
9. **Numbers are not guaranteed.** "1 week", "2 weeks" — these are planning estimates derived from comparable workstreams (NBA adapter took ~3 weeks; NHL took ~3 weeks; MLB took multiple quarters). Refine in sprint planning.
10. **Phase 6 is the audit deliverable.** It is NOT the implementation. Each bucket item should be broken into PRs / commits / tests per the team's normal workflow.

---

## O. How Phase 6 maps to existing work

For continuity with the existing 100+ task list:

| Phase 6 § | Existing pending tasks closed by this work |
|-----------|-------------------------------------------|
| §B SportAdapter | #453 (Auditor v2 generalize to cross-sport with sport adapter interface) — partially; full closure when §H lands |
| §H Cross-sport auditor checks | #453 |
| §K.2 Soccer fixture provider | (new) |
| §K.3 Team/country mapping | (new) |
| §K.4 Soccer markets + draw handling | (new) |
| §I Fixer rules | #448 (NBA: sharp signals pipeline — partially) |
| §J Operator dashboard | (new) |
| Bucket 2 NHL items | #450 (closed by Phase 4 audit), #451 (closed by Phase 4 audit), #452 (closed by Phase 4 audit for n=1; full validation needs more games) |

Pending items #135, #136, #137, #138, #142, #147, #148, #149, #257, #417, #418 are outside this audit scope.

---

## Verdict

**The OddSphere platform is reliable enough to operate today — MLB, NBA Finals, NHL Finals — but it is NOT yet a platform that can absorb a fourth sport without compounding tech debt.** Phase 6 turns the implicit cross-sport contract into an explicit `SportAdapter` interface, defines the registry that separates public tracking from internal audit, builds the refresh-cycle auditor/fixer with sport-adapter rules, and stages the Soccer / World Cup workstreams as the next engineering work order.

**The 14-week Bucket 4 critical path is the practical answer to "how do we launch World Cup correctly?"**

This is the final phase of the site-wide reliability audit. Implementation begins with Bucket 1 trust fixes; the World Cup roadmap is Bucket 4.

---

## Cross-references

- Phase 0 inventory: `docs/audit/00-inventory.md`
- Phase 1 critical path: `docs/audit/01-active-sports-critical-path.md`
- Phase 2 NBA deep dive: `docs/audit/02-nba-model-logic-calibration.md`
- Phase 3 MLB benchmark: `docs/audit/03-mlb-benchmark-audit.md`
- Phase 4 NHL automation + tracking: `docs/audit/04-nhl-automation-tracking-audit.md`
- Phase 5 future sports readiness: `docs/audit/05-future-sports-readiness.md`
- Auditor/fixer design contract: `~/.claude/.../memory/project_auditor_fixer_design_contract.md`
- Public-tracking-vs-internal-audit rule: `~/.claude/.../memory/feedback_public_tracking_vs_internal_audit.md`
- Phase 6 immediate roadmap memory: `~/.claude/.../memory/project_phase_6_immediate_roadmap.md`
- Daily Edge integrity contract: `~/.claude/.../memory/project_daily_edge_integrity_contract.md`
- Site-wide reliability audit (parent): `~/.claude/.../memory/project_site_wide_reliability_audit.md`
