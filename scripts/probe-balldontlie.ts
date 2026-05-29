/**
 * Gate A probe — BALLDONTLIE MLB GOAT
 *
 * Read-only diagnostic. Hits BDL's MLB endpoints using the key in
 * .env.local, prints a structured pass/fail field-coverage report to
 * stdout, and writes NOTHING to disk, database, or external systems.
 *
 * Guardrails baked in:
 *   • No Supabase client imported — no DB writes possible.
 *   • No fs writes — output is stdout only.
 *   • Key is read from process.env.BALLDONTLIE_API_KEY. The actual value
 *     is NEVER printed — only a masked preview (first 4 chars + length).
 *   • Hard cap MAX_API_CALLS = 12.
 *   • Endpoint paths are best-effort guesses based on BDL's MLB API
 *     conventions. If something returns 404, the probe reports it
 *     honestly and continues to the next endpoint.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/probe-balldontlie.ts
 *
 * Exit code is always 0 (this is a diagnostic, not a test).
 */

// Force module scoping so top-level helper names don't collide with the
// SharpAPI probe under the same compilation unit.
export {};

const BASE_URL = "https://api.balldontlie.io/mlb/v1";
// Patch round 4: expanded from 12 → 16 to accommodate the documented
// canonical endpoints (single-player detail, team season stats, hitter
// pitch-type season stats are new probes). BDL GOAT's observed quota
// of 600/window leaves abundant room.
const MAX_API_CALLS = 16;
// Patch round 4: per BDL docs, season_stats / splits / pitch_type
// endpoints all use a singular `season=` param. 2026 returned "Invalid
// value" in round 3 (likely too new); fall back to 2025 (most recent
// complete season). If 2025 also fails, the report will surface it and
// we can adjust.
const SEASON = 2025;
// Patch round 3: quota-aware pacing replaces the fixed 650ms throttle.
// The probe reads `x-ratelimit-*` headers from each response and waits
// only when the API tells us we need to (remaining=0 → wait until reset;
// 429 → honor retry-after). If BDL's observed rate limit is higher than
// expected (we're on GOAT — operator says exact limit is uncertain),
// the probe runs as fast as the headers allow.
let callsMade = 0;
let totalWaitMs = 0;
const probeStart = Date.now();

const KEY = process.env.BALLDONTLIE_API_KEY;
if (!KEY) {
  console.log("BALLDONTLIE_API_KEY missing from .env.local — abort");
  process.exit(0);
}

function maskedKeyPreview(k: string): string {
  return `${k.slice(0, 4)}... (length=${k.length})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Round 3: tracked quota state. Updated from every response's x-ratelimit-*
// headers. probe() consults this BEFORE issuing the next request: if
// remaining=0 from the previous response, wait for resetEpoch + buffer.
type QuotaState = {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
};
const quotaState: QuotaState = {
  limit: null,
  remaining: null,
  resetEpoch: null,
};

function parseQuotaFromHeaders(headers: Headers): {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
  retryAfter: number | null;
} {
  const numOrNull = (s: string | null): number | null => {
    if (s === null || s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const limit =
    headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit");
  const remaining =
    headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining");
  const reset =
    headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  const retryAfter = headers.get("retry-after");
  return {
    limit: numOrNull(limit),
    remaining: numOrNull(remaining),
    resetEpoch: numOrNull(reset),
    retryAfter: numOrNull(retryAfter),
  };
}

async function waitUntilReset(reason: string): Promise<void> {
  if (quotaState.resetEpoch === null) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const waitSec = Math.max(0, quotaState.resetEpoch - nowSec) + 2; // +2s buffer
  console.log(`  [throttle] ${reason} — waiting ${waitSec}s for quota reset...`);
  await sleep(waitSec * 1000);
  totalWaitMs += waitSec * 1000;
  // Window has rolled over; clear observed state so the next call doesn't
  // re-trigger the wait.
  quotaState.remaining = null;
  quotaState.resetEpoch = null;
}

type ProbeResult = {
  endpoint: string;
  status: number | null;
  durationMs: number;
  error?: string;
  body?: unknown;
  // Patch round 2: fetch as text first so we can show the raw payload
  // when JSON.parse fails. parseError + rawText are set on parse failure;
  // body is set on parse success. Never both.
  rawText?: string;
  parseError?: string;
  contentType?: string | null;
  quotaHeaders?: Record<string, string>;
};

async function probe(endpoint: string): Promise<ProbeResult> {
  if (callsMade >= MAX_API_CALLS) {
    return {
      endpoint,
      status: null,
      durationMs: 0,
      error: `call cap (${MAX_API_CALLS}) reached — skipped`,
    };
  }

  // Round 3: if the previous response told us remaining=0, wait for the
  // quota window to reset before issuing this request. Without quota
  // observations (e.g. first call), proceed immediately.
  if (quotaState.remaining === 0) {
    await waitUntilReset("remaining=0 from previous response");
  }

  callsMade++;
  const url = `${BASE_URL}${endpoint}`;
  const t0 = Date.now();

  async function doFetch(): Promise<Response> {
    return fetch(url, {
      headers: {
        // BDL's docs show Authorization header with the key value directly
        // (no "Bearer " prefix). If your account expects a different
        // format, the first call will surface a 401 and you can update.
        Authorization: KEY!,
        Accept: "application/json",
      },
    });
  }

  try {
    let res = await doFetch();
    let quota = parseQuotaFromHeaders(res.headers);

    // Round 3: if 429, honor retry-after (or 65s fallback), then retry
    // THIS endpoint once. The retry doesn't count against MAX_API_CALLS
    // because we already incremented callsMade for the intended request.
    if (res.status === 429) {
      const waitSec = (quota.retryAfter ?? 65) + 2; // +2s buffer
      console.log(
        `  [throttle] HTTP 429 on ${endpoint} — waiting ${waitSec}s (retry-after=${
          quota.retryAfter ?? "absent"
        })...`
      );
      await sleep(waitSec * 1000);
      totalWaitMs += waitSec * 1000;
      // Clear observed state — window has rolled over.
      quotaState.remaining = null;
      quotaState.resetEpoch = null;
      res = await doFetch();
      quota = parseQuotaFromHeaders(res.headers);
    }

    const durationMs = Date.now() - t0;
    const contentType = res.headers.get("content-type");

    // Round 3: update tracked quota state from the latest response. Track
    // limit too, so the final summary can report the observed window size.
    if (quota.limit !== null) quotaState.limit = quota.limit;
    if (quota.remaining !== null) quotaState.remaining = quota.remaining;
    if (quota.resetEpoch !== null) quotaState.resetEpoch = quota.resetEpoch;

    // Patch round 2: collect quota/rate-limit headers (BDL exposes
    // standard x-ratelimit-* per their docs; also capture retry-after).
    const quotaHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (
        lk.startsWith("x-ratelimit") ||
        lk.startsWith("ratelimit") ||
        lk === "retry-after"
      ) {
        quotaHeaders[k] = v;
      }
    });

    // Patch round 2: read body as text first, then attempt JSON.parse.
    // On parse failure we keep the raw text (first 500 chars) and the
    // parse error so the report can show what the API actually returned.
    const text = await res.text();
    try {
      const body = JSON.parse(text) as unknown;
      return {
        endpoint,
        status: res.status,
        durationMs,
        body,
        contentType,
        quotaHeaders,
      };
    } catch (parseErr) {
      return {
        endpoint,
        status: res.status,
        durationMs,
        rawText: text.slice(0, 500),
        parseError:
          parseErr instanceof Error ? parseErr.message : String(parseErr),
        contentType,
        quotaHeaders,
      };
    }
  } catch (e) {
    return {
      endpoint,
      status: null,
      durationMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function sampleStr(body: unknown, maxChars = 250): string {
  const s = JSON.stringify(body);
  if (s === undefined) return "(undefined)";
  return s.length <= maxChars ? s : s.slice(0, maxChars) + "...";
}

function section(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

function reportEndpoint(r: ProbeResult) {
  console.log(`  ${r.endpoint}`);
  if (r.error) {
    console.log(`  ERROR · ${r.durationMs}ms · ${r.error}`);
    return;
  }
  console.log(`  HTTP ${r.status} · ${r.durationMs}ms`);
  if (r.contentType) {
    console.log(`  content-type: ${r.contentType}`);
  }
  if (r.quotaHeaders && Object.keys(r.quotaHeaders).length > 0) {
    console.log(`  quota headers: ${JSON.stringify(r.quotaHeaders)}`);
  }
  // Patch round 2: on JSON.parse failure, print status, content-type,
  // and the raw body preview so the operator can see what came back.
  if (r.parseError) {
    console.log(`  PARSE FAILED: ${r.parseError}`);
    const preview = r.rawText ?? "";
    console.log(`  raw body (first ${preview.length} chars):`);
    console.log(`    ${preview.length > 0 ? preview : "(empty)"}`);
    return;
  }
  console.log(`  sample: ${sampleStr(r.body)}`);
}

function checkField(label: string, present: boolean, note?: string): void {
  const mark = present ? "✓" : "✗";
  console.log(`    [${mark}] ${label}${note ? " — " + note : ""}`);
}

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null;
}

async function main() {
  console.log("═".repeat(63));
  console.log("PROBE: BALLDONTLIE MLB GOAT");
  console.log(`Key:    ${maskedKeyPreview(KEY!)}`);
  console.log(`Base:   ${BASE_URL}`);
  console.log(`Cap:    ${MAX_API_CALLS} API calls`);
  console.log(`Start:  ${new Date().toISOString()}`);
  console.log("═".repeat(63));

  function dateISO(offsetDays = 0): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }
  const today = dateISO(0);
  const tomorrow = dateISO(1);
  const currentSeason = new Date().getUTCFullYear();

  // ── 1. /teams ─────────────────────────────────────────────────────
  section("1. GET /teams?per_page=5");
  const teams = await probe("/teams?per_page=5");
  reportEndpoint(teams);
  let firstTeamId: number | null = null;
  if (teams.status === 200) {
    const t0 = dig(teams.body, "data.0");
    firstTeamId = (dig(t0, "id") as number) ?? null;
    checkField("teams[0].id", present(dig(t0, "id")));
    checkField("teams[0].abbreviation", present(dig(t0, "abbreviation")));
    checkField(
      "teams[0].display_name / name",
      present(dig(t0, "display_name")) || present(dig(t0, "name"))
    );
    checkField("teams[0].division", present(dig(t0, "division")));
    checkField("teams[0].league", present(dig(t0, "league")));
  }

  // ── 2. /players ───────────────────────────────────────────────────
  section("2. GET /players?per_page=10");
  const players = await probe("/players?per_page=10");
  reportEndpoint(players);
  let samplePlayerId: number | null = null;
  let samplePitcherId: number | null = null;
  let sampleHitterId: number | null = null;
  // Patch round 4: BDL docs say player objects can include `bats_throws`
  // but our round-3 payload didn't show it. Expand the handedness check
  // to look for all documented and common field names, and log the
  // actual keys present on the sample object so we can see what BDL
  // returned. Also try /players/{id} (endpoint 6) for a more complete
  // detail payload — list endpoints sometimes omit fields.
  const HANDEDNESS_FIELDS = ["bats_throws", "bats", "throws", "bat_hand", "throw_hand"];
  if (players.status === 200) {
    const p0 = dig(players.body, "data.0");
    checkField("players[0].id", present(dig(p0, "id")));
    checkField("players[0].first_name", present(dig(p0, "first_name")));
    checkField("players[0].last_name", present(dig(p0, "last_name")));
    checkField("players[0].position", present(dig(p0, "position")));
    const anyHandedness = HANDEDNESS_FIELDS.some((k) => present(dig(p0, k)));
    checkField(
      `players[0] handedness (any of: ${HANDEDNESS_FIELDS.join(", ")})`,
      anyHandedness
    );
    if (!anyHandedness && p0 && typeof p0 === "object") {
      const keys = Object.keys(p0 as Record<string, unknown>);
      console.log(`    note: handedness absent — players[0] keys present: ${keys.join(", ")}`);
    }
    checkField("players[0].team", present(dig(p0, "team")));

    const pdata = dig(players.body, "data") as
      | Array<Record<string, unknown>>
      | undefined;
    // Patch round 2: BDL uses RP (relief), SP (starting), P (generic).
    // Round 1's `pos === "P"` filter missed RP/SP and skipped endpoints
    // 7 and 10. Widen the test to match any pitcher-style position.
    const isPitcherPos = (pos: string): boolean =>
      pos === "P" || pos === "RP" || pos === "SP";
    if (Array.isArray(pdata)) {
      for (const p of pdata) {
        const pos = String(p.position ?? "");
        if (samplePlayerId === null) {
          samplePlayerId = (p.id as number) ?? null;
        }
        if (isPitcherPos(pos) && samplePitcherId === null) {
          samplePitcherId = (p.id as number) ?? null;
        }
        if (!isPitcherPos(pos) && pos !== "" && sampleHitterId === null) {
          sampleHitterId = (p.id as number) ?? null;
        }
      }
    }
  }

  // ── 3. /games today ───────────────────────────────────────────────
  section(`3. GET /games?dates[]=${today}`);
  const gamesToday = await probe(`/games?dates[]=${today}&per_page=25`);
  reportEndpoint(gamesToday);
  if (gamesToday.status === 200) {
    const g0 = dig(gamesToday.body, "data.0");
    checkField("games[0].id", present(dig(g0, "id")));
    checkField(
      "games[0].date / start_time",
      present(dig(g0, "date")) || present(dig(g0, "start_time"))
    );
    checkField("games[0].home_team", present(dig(g0, "home_team")));
    checkField(
      "games[0].away_team / visitor_team",
      present(dig(g0, "away_team")) || present(dig(g0, "visitor_team"))
    );
    checkField("games[0].status", present(dig(g0, "status")));
    checkField(
      "games[0] probable starter (home/away)",
      present(dig(g0, "home_team_pitcher")) ||
        present(dig(g0, "home_starter")) ||
        present(dig(g0, "home_probable_pitcher"))
    );
  }

  // ── 4. /games tomorrow ────────────────────────────────────────────
  section(`4. GET /games?dates[]=${tomorrow}`);
  const gamesTomorrow = await probe(`/games?dates[]=${tomorrow}&per_page=25`);
  reportEndpoint(gamesTomorrow);

  // Pick a sample game id (prefer tomorrow — more likely to have starters posted)
  let sampleGameId: number | null = null;
  const tomorrowData = dig(gamesTomorrow.body, "data") as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(tomorrowData) && tomorrowData.length > 0) {
    sampleGameId = (tomorrowData[0]!.id as number) ?? null;
  } else {
    const todayData = dig(gamesToday.body, "data") as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(todayData) && todayData.length > 0) {
      sampleGameId = (todayData[0]!.id as number) ?? null;
    }
  }

  // ── 5. Single-game deep-dive ──────────────────────────────────────
  if (sampleGameId !== null) {
    section(`5. GET /games/${sampleGameId}`);
    const g = await probe(`/games/${sampleGameId}`);
    reportEndpoint(g);
  } else {
    section("5. Single-game deep-dive — skipped (no sample game id found)");
  }

  // ── 6. Single-player detail (handedness investigation) ────────────
  // Patch round 4: /players list endpoint omitted handedness fields in
  // round 3. Try the single-player detail endpoint — list responses
  // commonly trim fields that detail responses include.
  if (samplePlayerId !== null) {
    section(`6. GET /players/${samplePlayerId} (single-player detail — handedness check)`);
    const pd = await probe(`/players/${samplePlayerId}`);
    reportEndpoint(pd);
    if (pd.status === 200) {
      const detail = (dig(pd.body, "data") as Record<string, unknown> | undefined)
        ?? (pd.body as Record<string, unknown> | undefined);
      if (detail && typeof detail === "object") {
        const keys = Object.keys(detail);
        console.log(`    detail keys present: ${keys.join(", ")}`);
        for (const k of HANDEDNESS_FIELDS) {
          checkField(`/players/{id}.${k}`, present((detail as Record<string, unknown>)[k]));
        }
      }
    }
  } else {
    section("6. Single-player detail — skipped (no sample player id from /players)");
  }

  // ── 7. /lineups (replaces /box_scores per BDL docs) ───────────────
  // Patch round 4: documented endpoint is /lineups?game_ids[]=N. Lineups
  // typically appear 1-2 hours before first pitch (2026+ seasons per
  // docs). Includes batting_order + is_probable_pitcher.
  if (sampleGameId !== null) {
    section(`7. GET /lineups?game_ids[]=${sampleGameId} (lineups + probable pitcher)`);
    const lineups = await probe(`/lineups?game_ids[]=${sampleGameId}`);
    reportEndpoint(lineups);
    if (lineups.status === 200) {
      const ld = dig(lineups.body, "data") as
        | Array<Record<string, unknown>>
        | undefined;
      const hasRows = Array.isArray(ld) && ld.length > 0;
      checkField("lineups returned non-empty data array", hasRows);
      if (hasRows) {
        const l0 = ld[0]!;
        console.log(`    lineup row[0] keys: ${Object.keys(l0).join(", ")}`);
        checkField("lineups[0].game_id", present(l0.game_id));
        checkField("lineups[0].player_id", present(l0.player_id));
        checkField("lineups[0].team_id", present(l0.team_id));
        checkField("lineups[0].batting_order", present(l0.batting_order));
        checkField(
          "lineups[0].is_probable_pitcher (BDL docs)",
          present(l0.is_probable_pitcher)
        );
      } else {
        console.log(
          "    note: empty array. Likely game starts too far away — lineups post 1-2hrs before first pitch."
        );
      }
    }
  } else {
    section("7. Lineups — skipped (no sample game id)");
  }

  // ── 8. Pitcher season stats ───────────────────────────────────────
  // Patch round 4: documented param is `season=` (singular), not
  // `seasons[]=`. SEASON constant defaults to 2025 (round 3 showed 2026
  // returns "Invalid value" — too new). per_page=1 keeps payload small.
  if (samplePitcherId !== null) {
    section(
      `8. GET /season_stats?season=${SEASON}&player_ids[]=${samplePitcherId} (pitcher)`
    );
    const ps = await probe(
      `/season_stats?season=${SEASON}&player_ids[]=${samplePitcherId}&per_page=1`
    );
    reportEndpoint(ps);
    if (ps.status === 200) {
      const s = dig(ps.body, "data.0");
      if (s && typeof s === "object") {
        console.log(`    season_stats keys: ${Object.keys(s).join(", ")}`);
      }
      checkField("pitcher.era", present(dig(s, "era")));
      checkField(
        "pitcher.fip / xfip",
        present(dig(s, "fip")) || present(dig(s, "xfip"))
      );
      checkField("pitcher.whip", present(dig(s, "whip")));
      checkField(
        "pitcher.strikeouts / k",
        present(dig(s, "strikeouts")) ||
          present(dig(s, "k")) ||
          present(dig(s, "so"))
      );
      checkField(
        "pitcher.walks / bb",
        present(dig(s, "walks")) || present(dig(s, "bb"))
      );
      checkField(
        "pitcher.innings_pitched / ip",
        present(dig(s, "innings_pitched")) || present(dig(s, "ip"))
      );
    }
  } else {
    section("8. Pitcher season stats — skipped (no pitcher id from /players)");
  }

  // ── 9. Hitter season stats ────────────────────────────────────────
  if (sampleHitterId !== null) {
    section(
      `9. GET /season_stats?season=${SEASON}&player_ids[]=${sampleHitterId} (hitter)`
    );
    const hs = await probe(
      `/season_stats?season=${SEASON}&player_ids[]=${sampleHitterId}&per_page=1`
    );
    reportEndpoint(hs);
    if (hs.status === 200) {
      const s = dig(hs.body, "data.0");
      checkField("hitter.ops", present(dig(s, "ops")));
      checkField("hitter.avg", present(dig(s, "avg")));
      checkField(
        "hitter.home_runs / hr",
        present(dig(s, "home_runs")) || present(dig(s, "hr"))
      );
      checkField("hitter.rbi", present(dig(s, "rbi")));
      checkField(
        "hitter.strikeouts / so",
        present(dig(s, "strikeouts")) || present(dig(s, "so"))
      );
    }
  } else {
    section("9. Hitter season stats — skipped (no hitter id from /players)");
  }

  // ── 10. Team season stats (NEW) ───────────────────────────────────
  // Patch round 4: documented endpoint /teams/season_stats?season=N.
  // Provides team-level offense/pitching baseline for the model.
  section(`10. GET /teams/season_stats?season=${SEASON} (team baseline)`);
  const teamStats = await probe(
    `/teams/season_stats?season=${SEASON}&per_page=1`
  );
  reportEndpoint(teamStats);
  if (teamStats.status === 200) {
    const t = dig(teamStats.body, "data.0");
    if (t && typeof t === "object") {
      console.log(`    team_season_stats keys: ${Object.keys(t).join(", ")}`);
    }
    checkField("team_season_stats[0].team / team_id", present(dig(t, "team")) || present(dig(t, "team_id")));
    checkField("team batting (avg/ops/runs)",
      present(dig(t, "avg")) || present(dig(t, "ops")) || present(dig(t, "runs"))
    );
    checkField("team pitching (era/whip)",
      present(dig(t, "era")) || present(dig(t, "whip"))
    );
  }

  // ── 11. Player splits (vs-LHP / vs-RHP) ───────────────────────────
  // Patch round 4: documented endpoint /players/splits?player_id=N&season=N
  // (NOT /splits?player_ids[]=N&seasons[]=N).
  if (sampleHitterId !== null) {
    section(
      `11. GET /players/splits?player_id=${sampleHitterId}&season=${SEASON} (vs-LHP / vs-RHP)`
    );
    const splits = await probe(
      `/players/splits?player_id=${sampleHitterId}&season=${SEASON}`
    );
    reportEndpoint(splits);
    if (splits.status === 200) {
      const sd = dig(splits.body, "data") as
        | Array<Record<string, unknown>>
        | undefined;
      const hasRows = Array.isArray(sd) && sd.length > 0;
      checkField("splits returned non-empty data array", hasRows);
      if (hasRows) {
        const s0 = sd[0]!;
        console.log(`    split row[0] keys: ${Object.keys(s0).join(", ")}`);
        const hasVsLhp = sd.some((s) =>
          String(s.split_type ?? s.type ?? s.split ?? "")
            .toLowerCase()
            .includes("lhp") ||
          String(s.split_type ?? s.type ?? s.split ?? "")
            .toLowerCase()
            .includes("vs_left")
        );
        const hasVsRhp = sd.some((s) =>
          String(s.split_type ?? s.type ?? s.split ?? "")
            .toLowerCase()
            .includes("rhp") ||
          String(s.split_type ?? s.type ?? s.split ?? "")
            .toLowerCase()
            .includes("vs_right")
        );
        checkField("splits include vs-LHP / vs-left", hasVsLhp);
        checkField("splits include vs-RHP / vs-right", hasVsRhp);
      }
    }
  } else {
    section("11. Player splits — skipped (no hitter id)");
  }

  // ── 12. Pitcher pitch-type season stats ───────────────────────────
  // Patch round 4: documented endpoint is /pitcher_pitch_type_season_stats
  // (NOT /pitch_stats). Required params: season + player_ids[] +
  // season_type=regular per docs.
  if (samplePitcherId !== null) {
    section(
      `12. GET /pitcher_pitch_type_season_stats?season=${SEASON}&player_ids[]=${samplePitcherId}&season_type=regular&per_page=1`
    );
    const pitcherPitch = await probe(
      `/pitcher_pitch_type_season_stats?season=${SEASON}&player_ids[]=${samplePitcherId}&season_type=regular&per_page=1`
    );
    reportEndpoint(pitcherPitch);
    if (pitcherPitch.status === 200) {
      const s = dig(pitcherPitch.body, "data.0");
      if (s && typeof s === "object") {
        console.log(`    pitcher_pitch_type_season_stats keys: ${Object.keys(s).join(", ")}`);
      }
      checkField(
        "pitcher pitch_type field",
        present(dig(s, "pitch_type")) || present(dig(s, "pitch"))
      );
      checkField(
        "per-pitch usage (pct/share)",
        present(dig(s, "pct_of_total")) ||
          present(dig(s, "usage_pct")) ||
          present(dig(s, "pct")) ||
          present(dig(s, "usage_share"))
      );
      checkField(
        "per-pitch velocity",
        present(dig(s, "avg_velo_mph")) ||
          present(dig(s, "velocity")) ||
          present(dig(s, "avg_velocity"))
      );
      checkField("per-pitch whiff rate", present(dig(s, "whiff_rate")));
    }
  } else {
    section("12. Pitcher pitch-type season stats — skipped (no pitcher id)");
  }

  // ── 13. Hitter pitch-type season stats (NEW) ──────────────────────
  if (sampleHitterId !== null) {
    section(
      `13. GET /hitter_pitch_type_season_stats?season=${SEASON}&player_ids[]=${sampleHitterId}&season_type=regular&per_page=1`
    );
    const hitterPitch = await probe(
      `/hitter_pitch_type_season_stats?season=${SEASON}&player_ids[]=${sampleHitterId}&season_type=regular&per_page=1`
    );
    reportEndpoint(hitterPitch);
    if (hitterPitch.status === 200) {
      const s = dig(hitterPitch.body, "data.0");
      if (s && typeof s === "object") {
        console.log(`    hitter_pitch_type_season_stats keys: ${Object.keys(s).join(", ")}`);
      }
      checkField(
        "hitter pitch_type field",
        present(dig(s, "pitch_type")) || present(dig(s, "pitch"))
      );
      checkField(
        "hitter performance vs pitch (ops/avg/slg)",
        present(dig(s, "ops")) ||
          present(dig(s, "avg")) ||
          present(dig(s, "slg"))
      );
    }
  } else {
    section("13. Hitter pitch-type season stats — skipped (no hitter id)");
  }

  // ── 14. Player injuries (renamed from /injuries) ──────────────────
  // Patch round 4: documented endpoint is /player_injuries.
  section("14. GET /player_injuries?per_page=5");
  const inj = await probe("/player_injuries?per_page=5");
  reportEndpoint(inj);
  if (inj.status === 200) {
    const i0 = dig(inj.body, "data.0");
    if (i0 && typeof i0 === "object") {
      console.log(`    player_injuries[0] keys: ${Object.keys(i0).join(", ")}`);
    }
    checkField(
      "player_injuries[0].player / player_id",
      present(dig(i0, "player")) || present(dig(i0, "player_id"))
    );
    checkField("player_injuries[0].status", present(dig(i0, "status")));
    checkField(
      "player_injuries[0].description / return_estimate",
      present(dig(i0, "description")) || present(dig(i0, "return_estimate"))
    );
  }

  // ── 15. Plays / NRFI raw data ─────────────────────────────────────
  // Patch round 4: documented endpoint uses singular `game_id=N` (not
  // `game_ids[]=N`). Per docs, plays include inning, inning_type,
  // scoring_play, score_value, batter_id, pitcher_id, plus score state.
  if (sampleGameId !== null) {
    section(
      `15. GET /plays?game_id=${sampleGameId}&per_page=5 (NRFI raw-data check)`
    );
    const plays = await probe(`/plays?game_id=${sampleGameId}&per_page=5`);
    reportEndpoint(plays);
    if (plays.status === 200) {
      const p0 = dig(plays.body, "data.0");
      if (p0 && typeof p0 === "object") {
        console.log(`    plays[0] keys: ${Object.keys(p0).join(", ")}`);
      }
      checkField("plays[0].inning", present(dig(p0, "inning")));
      checkField("plays[0].inning_type", present(dig(p0, "inning_type")));
      checkField("plays[0].scoring_play", present(dig(p0, "scoring_play")));
      checkField("plays[0].score_value", present(dig(p0, "score_value")));
      checkField(
        "plays[0].batter / batter_id",
        present(dig(p0, "batter")) || present(dig(p0, "batter_id"))
      );
      checkField(
        "plays[0].pitcher / pitcher_id",
        present(dig(p0, "pitcher")) || present(dig(p0, "pitcher_id"))
      );
    }
  } else {
    section("15. Plays / NRFI — skipped (no sample game id)");
  }

  // ── NRFI coverage subsection ─────────────────────────────────────
  section("NRFI Coverage Summary (provisional — decision deferred)");
  console.log(
    "  Per Daniel's Gate 1 guidance, NRFI auto-prediction decision is deferred"
  );
  console.log("  until probe output is reviewed. Verdict is one of:");
  console.log(
    "    • Pre-aggregated 1st-inning stats present → NRFI auto-prediction practical V1"
  );
  console.log(
    "    • Plays/PA with inning marker present → NRFI 'possible with our own aggregation'"
  );
  console.log(
    "    • Neither → NRFI hold/no-play recommended for V1; revisit V2"
  );
  console.log("");
  console.log("  Cross-reference endpoints 8 and 15 above:");
  console.log(
    "    - Endpoint 8: does pitcher season_stats expose 1st-inning splits?"
  );
  console.log(
    "    - Endpoint 15: does /plays return inning + inning_type + scoring_play?"
  );

  // ── Final verdict summary ─────────────────────────────────────────
  console.log("\n" + "═".repeat(63));
  console.log("VERDICT SUMMARY — read endpoints above to fill in:");
  console.log("═".repeat(63));
  console.log("  Auth (≥1 endpoint returned HTTP 200): [ derive from above ]");
  console.log("  Teams:                       [ endpoint 1 ]");
  console.log("  Players (basic + handedness): [ endpoints 2 + 6 ]");
  console.log("  Slate / games:               [ endpoints 3-4 ]");
  console.log("  Single-game deep dive:       [ endpoint 5 ]");
  console.log("  Single-player detail:        [ endpoint 6 ]");
  console.log("  Lineups + probable pitcher:  [ endpoint 7 ]");
  console.log("  Pitcher season stats:        [ endpoint 8 ]");
  console.log("  Hitter season stats:         [ endpoint 9 ]");
  console.log("  Team season stats:           [ endpoint 10 ]");
  console.log("  vs-LHP / vs-RHP splits:      [ endpoint 11 ]");
  console.log("  Pitcher pitch-type stats:    [ endpoint 12 ]");
  console.log("  Hitter pitch-type stats:     [ endpoint 13 ]");
  console.log("  Player injuries:             [ endpoint 14 ]");
  console.log("  Plays / NRFI raw data:       [ endpoint 15 ]");
  console.log("");
  console.log(`  Total API calls made: ${callsMade} / ${MAX_API_CALLS}`);
  // Round 3: report the rate-limit observed via response headers, not
  // assumed from prior runs. If x-ratelimit-limit is null the API didn't
  // expose it; that's reported honestly.
  console.log("");
  console.log("OBSERVED RATE LIMIT (from x-ratelimit-* headers):");
  console.log(
    `  x-ratelimit-limit:    ${quotaState.limit ?? "(not observed)"}`
  );
  console.log(
    `  x-ratelimit-remaining (final): ${
      quotaState.remaining ?? "(not observed)"
    }`
  );
  console.log(
    `  x-ratelimit-reset (final epoch): ${
      quotaState.resetEpoch ?? "(not observed)"
    }`
  );
  console.log(
    `  Total wall-clock time:  ${((Date.now() - probeStart) / 1000).toFixed(1)}s`
  );
  console.log(
    `  Time spent waiting for quota: ${(totalWaitMs / 1000).toFixed(1)}s`
  );
  console.log("═".repeat(63));
}

main().catch((e) => {
  console.log(
    `\nProbe failed at top level: ${
      e instanceof Error ? e.message : String(e)
    }`
  );
  console.log("(diagnostic exit — code 0 always)");
  process.exit(0);
});
