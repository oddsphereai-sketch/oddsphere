/**
 * Gate A probe — SharpAPI
 *
 * Read-only diagnostic. Hits SharpAPI's MLB endpoints using the key in
 * .env.local, validates field coverage against the OddSphere sharp-signal
 * framework's exact requirements (Layer 1/2/3), and produces the
 * three-verdict $229 vs $399 report.
 *
 * Writes NOTHING to disk, database, or external systems.
 *
 * Guardrails baked in:
 *   • No Supabase client imported — no DB writes possible.
 *   • No fs writes — output is stdout only.
 *   • Key read from process.env.SHARPAPI_KEY. Never printed in full —
 *     only a masked preview (first 4 chars + length).
 *   • Hard cap MAX_API_CALLS = 8.
 *   • Endpoint paths are best-effort. If endpoints return 404, the probe
 *     reports it honestly and continues. If BASE_URL is wrong, update
 *     the constant below per your SharpAPI account dashboard and rerun.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/probe-sharpapi.ts
 *
 * Exit code is always 0 (this is a diagnostic, not a test).
 */

// Force module scoping so top-level helper names don't collide with the
// BALLDONTLIE probe under the same compilation unit.
export {};

// Patch round 4: canonical base URL + auth per SharpAPI docs (operator-
// verified from their dashboard). Round 2-3's guessed base URL returned
// the SharpAPI marketing site's HTML. This URL hits the real JSON API.
const BASE_URL = "https://api.sharpapi.io/api/v1";
const MAX_API_CALLS = 8;
let callsMade = 0;

const KEY = process.env.SHARPAPI_KEY;
if (!KEY) {
  console.log("SHARPAPI_KEY missing from .env.local — abort");
  process.exit(0);
}

function maskedKeyPreview(k: string): string {
  return `${k.slice(0, 4)}... (length=${k.length})`;
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
  callsMade++;
  const url = `${BASE_URL}${endpoint}`;
  const t0 = Date.now();
  try {
    // Patch round 4: SharpAPI docs specify X-API-Key as the primary auth
    // header (Bearer also supported per docs but not preferred). Single
    // header keeps requests clean — if 401, we'd flip to Bearer.
    const res = await fetch(url, {
      headers: {
        "X-API-Key": KEY!,
        Accept: "application/json",
      },
    });
    const durationMs = Date.now() - t0;
    const contentType = res.headers.get("content-type");

    // Patch round 2: collect quota / rate-limit headers (standard x-
    // ratelimit-* names + retry-after).
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
    // Round 1 reported "(non-JSON response)" for all three SharpAPI
    // endpoints — the previous catch handler erased the actual response
    // content. Now we preserve the raw text and show the first 500 chars
    // so the operator can see what the API actually returned (HTML
    // landing page, empty body, XML, etc.).
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

function sampleStr(body: unknown, maxChars = 300): string {
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
  // Critical for SharpAPI where round 1's blanket "(non-JSON response)"
  // erased all signal about the actual response shape.
  if (r.parseError) {
    console.log(`  PARSE FAILED: ${r.parseError}`);
    const preview = r.rawText ?? "";
    console.log(`  raw body (first ${preview.length} chars):`);
    console.log(`    ${preview.length > 0 ? preview : "(empty)"}`);
    return;
  }
  console.log(`  sample: ${sampleStr(r.body)}`);
}

function checkField(label: string, found: boolean, note?: string): void {
  const mark = found ? "✓" : "✗";
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

/**
 * Deep-search a payload for any property whose name (case-insensitive)
 * contains the target token. Useful when API response shapes are unknown.
 * Bounded depth to avoid pathological responses.
 */
function looksFor(obj: unknown, token: string): boolean {
  const target = token.toLowerCase();
  function walk(node: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (node === null || node === undefined) return false;
    if (typeof node === "string") return node.toLowerCase().includes(target);
    if (Array.isArray(node)) {
      return node.some((n) => walk(n, depth + 1));
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k.toLowerCase().includes(target)) return true;
        if (walk(v, depth + 1)) return true;
      }
    }
    return false;
  }
  return walk(obj, 0);
}

async function main() {
  console.log("═".repeat(63));
  console.log("PROBE: SHARPAPI");
  console.log(`Key:    ${maskedKeyPreview(KEY!)}`);
  console.log(`Base:   ${BASE_URL}`);
  console.log(`Cap:    ${MAX_API_CALLS} API calls`);
  console.log(`Start:  ${new Date().toISOString()}`);
  console.log("═".repeat(63));
  console.log("");
  console.log(
    "NOTE: Patch round 4 uses the canonical base URL + endpoints per"
  );
  console.log(
    "operator-verified SharpAPI docs. Per docs, Pinnacle is the reference"
  );
  console.log(
    "for +EV and no-vig calculations; supported sharp books include"
  );
  console.log(
    "Pinnacle, Bookmaker, Circa Sports. Endpoints probed: /events, /odds,"
  );
  console.log(
    "/odds/best, /opportunities/ev (framework-critical), /opportunities/"
  );
  console.log(
    "low_hold, /opportunities/arbitrage. Public-betting %, RLM, steam are"
  );
  console.log(
    "NOT in the documented endpoint list — probe does not guess those."
  );

  // ── 1. /events?sport=mlb (auth + MLB event list) ──────────────────
  // Patch round 4: /events is the documented entry point — provides auth
  // check + the event_id we need for downstream endpoints.
  section("1. GET /events?sport=mlb (auth + MLB event list)");
  const events = await probe(`/events?sport=mlb`);
  reportEndpoint(events);

  function findEventId(body: unknown): string | number | null {
    const candidates: unknown[] = [];
    const d = dig(body, "data");
    if (Array.isArray(d) && d.length > 0) candidates.push(d[0]);
    if (Array.isArray(body) && body.length > 0) candidates.push(body[0]);
    for (const c of candidates) {
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        const id = o.event_id ?? o.id ?? o.eventId;
        if (typeof id === "string" || typeof id === "number") return id;
      }
    }
    return null;
  }

  let sampleEventId: string | number | null = findEventId(events.body);
  if (events.status === 200 && sampleEventId !== null) {
    console.log(`    sample event_id captured: ${sampleEventId}`);
  } else if (events.status === 200) {
    console.log("    note: events returned 200 but no event id parseable —");
    console.log("    response shape may differ from {data: [...]}");
  }

  // ── 2. /odds for sample event (per-book line coverage) ────────────
  // Patch round 4: /odds is the canonical endpoint (was /sports/mlb/odds).
  // Per docs supported sharp books include Pinnacle, Bookmaker, Circa.
  let oddsBody: unknown = null;
  if (sampleEventId !== null) {
    section(`2. GET /odds?event_id=${sampleEventId} (per-book coverage)`);
    const odds = await probe(`/odds?event_id=${sampleEventId}`);
    reportEndpoint(odds);
    oddsBody = odds.body;
    if (odds.status === 200) {
      console.log("");
      console.log("  PER-BOOK COVERAGE (deep-search for book names):");
      checkField(
        "Pinnacle (sharp reference)",
        looksFor(oddsBody, "pinnacle")
      );
      checkField(
        "Bookmaker (sharp book)",
        looksFor(oddsBody, "bookmaker")
      );
      checkField(
        "Circa Sports (sharp book)",
        looksFor(oddsBody, "circa")
      );
      checkField("DraftKings", looksFor(oddsBody, "draftkings"));
      checkField("FanDuel", looksFor(oddsBody, "fanduel"));
      checkField("BetMGM", looksFor(oddsBody, "betmgm"));
      checkField("Caesars", looksFor(oddsBody, "caesars"));
      console.log("");
      console.log("  MARKET COVERAGE:");
      checkField(
        "moneyline / h2h",
        looksFor(oddsBody, "moneyline") || looksFor(oddsBody, "h2h")
      );
      checkField(
        "totals",
        looksFor(oddsBody, "totals") || looksFor(oddsBody, "total")
      );
      checkField(
        "first_inning / first_half (NRFI relevant)",
        looksFor(oddsBody, "first_inning") ||
          looksFor(oddsBody, "first_half") ||
          looksFor(oddsBody, "1st")
      );
    }
  } else {
    section("2. /odds — skipped (no sample event id from /events)");
  }

  // ── 3. /odds/best for sample event (best price per side) ──────────
  // Patch round 4: documented endpoint. Confirms Pinnacle as de-vig
  // reference and lets us see SharpAPI's "best price" response shape.
  let oddsBestBody: unknown = null;
  if (sampleEventId !== null) {
    section(`3. GET /odds/best?event_id=${sampleEventId} (best price per side)`);
    const best = await probe(`/odds/best?event_id=${sampleEventId}`);
    reportEndpoint(best);
    oddsBestBody = best.body;
    if (best.status === 200) {
      checkField(
        "Pinnacle referenced in best-price response",
        looksFor(oddsBestBody, "pinnacle")
      );
      checkField(
        "explicit 'best' or top-price field",
        looksFor(oddsBestBody, "best") || looksFor(oddsBestBody, "top")
      );
    }
  } else {
    section("3. /odds/best — skipped (no sample event id)");
  }

  // ── 4. /opportunities/ev (FRAMEWORK-CRITICAL) ─────────────────────
  // Patch round 4: per docs, Pinnacle is the reference for +EV and
  // no-vig calculations. This endpoint is where pinnacle_fair_probability
  // / fair_odds / ev_pct / is_plus_ev should live. Without these,
  // sharp_confirmed and best_signal grades can't be derived.
  let evBody: unknown = null;
  section(`4. GET /opportunities/ev?sport=mlb (FRAMEWORK-CRITICAL — Pinnacle EV)`);
  const ev = await probe(`/opportunities/ev?sport=mlb`);
  reportEndpoint(ev);
  evBody = ev.body;
  if (ev.status === 200) {
    console.log("");
    console.log("  FRAMEWORK-CRITICAL FIELD MATRIX (across /opportunities/ev):");
    checkField(
      "pinnacle_fair_probability / fair_probability",
      looksFor(evBody, "pinnacle_fair_probability") ||
        looksFor(evBody, "fair_probability") ||
        looksFor(evBody, "fair_prob"),
      "drives Sharp Confirmed / Best Signal EV math"
    );
    checkField(
      "fair_odds / no_vig_price / no_vig",
      looksFor(evBody, "fair_odds") ||
        looksFor(evBody, "no_vig_price") ||
        looksFor(evBody, "no_vig") ||
        looksFor(evBody, "novig"),
      "edgeForModelSide computation"
    );
    checkField(
      "ev_pct / ev_percent / edge",
      looksFor(evBody, "ev_pct") ||
        looksFor(evBody, "ev_percent") ||
        looksFor(evBody, "edge") ||
        looksFor(evBody, "ev_value"),
      "Layer 2 EV tier classifier (1.5/3/5 thresholds)"
    );
    checkField(
      "is_plus_ev / plus_ev flag",
      looksFor(evBody, "is_plus_ev") ||
        looksFor(evBody, "plus_ev") ||
        looksFor(evBody, "is_ev_positive"),
      "Layer 1 EV branch"
    );
    checkField(
      "Pinnacle line value referenced",
      looksFor(evBody, "pinnacle")
    );
  } else if (ev.status === 403 || ev.status === 401) {
    console.log("    note: 403/401 — tier may not include /opportunities/ev");
  }

  // ── 5. /opportunities/low_hold ────────────────────────────────────
  // Patch round 4: low-hold markets (vig-stripped). Per docs, Pro tier
  // includes +EV; Sharp tier includes "All". Probing helps surface which
  // tier the trial is on.
  if (callsMade < MAX_API_CALLS) {
    section("5. GET /opportunities/low_hold?sport=mlb");
    const lh = await probe(`/opportunities/low_hold?sport=mlb`);
    reportEndpoint(lh);
    if (lh.status === 403 || lh.status === 401) {
      console.log("    note: 403/401 — tier may not include /opportunities/low_hold");
    }
  } else {
    section("5. /opportunities/low_hold — skipped (call cap)");
  }

  // ── 6. /opportunities/arbitrage ───────────────────────────────────
  // Patch round 4: arbitrage between books. Helps confirm Pro vs Sharp
  // tier access without contacting sales.
  if (callsMade < MAX_API_CALLS) {
    section("6. GET /opportunities/arbitrage?sport=mlb");
    const arb = await probe(`/opportunities/arbitrage?sport=mlb`);
    reportEndpoint(arb);
    if (arb.status === 403 || arb.status === 401) {
      console.log("    note: 403/401 — tier may not include /opportunities/arbitrage");
    }
  } else {
    section("6. /opportunities/arbitrage — skipped (call cap)");
  }

  // ── Three-verdict report (round 4 — Pro vs Sharp framing) ────────
  console.log("\n" + "═".repeat(63));
  console.log("THREE-VERDICT REPORT — FRAMEWORK ALIGNMENT");
  console.log("═".repeat(63));
  console.log("");
  console.log("VERIFIED COVERAGE (from real payloads above):");
  console.log("  Read the per-endpoint [ check ] marks. Every check is a field");
  console.log("  the trial returned. A missing critical field signals either a");
  console.log("  tier gap or a payload shape we didn't introspect correctly.");
  console.log("");
  console.log("PRO vs SHARP TIER DELTAS (per SharpAPI docs):");
  console.log("  - Pro tier: includes +EV and Middles");
  console.log("  - Sharp tier: includes 'All' + Priority Support");
  console.log("  Critical question: does the trial expose /opportunities/ev");
  console.log("  with Pinnacle fair_probability + fair_odds + ev_pct? If yes,");
  console.log("  Pro tier likely covers our framework's needs. If no, Sharp");
  console.log("  tier is required.");
  console.log("");
  console.log("EXPECTED FRAMEWORK GAPS (per SharpAPI's documented endpoints):");
  console.log("  Documented SharpAPI endpoints are:");
  console.log("    /events, /odds, /odds/best, /opportunities/{ev,low_hold,arbitrage}");
  console.log("  These DO NOT include public-betting-%, RLM, or steam-move");
  console.log("  detection. Our framework Layer 1/2/3 uses those fields for:");
  console.log("    - public_smoke detection (needs betting + money %)");
  console.log("    - RLM tier classifier (needs public_betting_pct + reversal)");
  console.log("    - steam_alert (needs steam_books_count)");
  console.log("    - sharp_div tier (needs handle-vs-ticket gap)");
  console.log("  If trial confirms these are absent, framework grades that");
  console.log("  depend on them (public_smoke, market_led via steam/RLM,");
  console.log("  sharp_conflict via multi-axis) need alternative source OR");
  console.log("  framework adjustment.");
  console.log("");
  console.log("GRADE SUPPORT MATRIX (likely outcome given documented endpoints):");
  console.log("  market_watch     - supportable (conservative default)");
  console.log("  model_only       - supportable (needs line values only)");
  console.log("  sharp_confirmed  - supportable IF /opportunities/ev returns");
  console.log("                     Pinnacle fair_probability + ev_pct");
  console.log("  best_signal      - supportable on EV axis alone if Pinnacle");
  console.log("                     data confirmed; multi-axis variant may");
  console.log("                     need additional source");
  console.log("  public_smoke     - LIKELY BLOCKED (no public betting % in");
  console.log("                     documented endpoints)");
  console.log("  market_led       - partial (EV alignment possible; steam +");
  console.log("                     RLM signals absent)");
  console.log("  sharp_conflict   - LIKELY BLOCKED (needs multi-axis opposing");
  console.log("                     evidence the docs don't expose)");
  console.log("");
  console.log("RECOMMENDED VERDICT (operator fills in based on above):");
  console.log("  ( ) Verdict 1: Pinnacle EV math confirmed in /opportunities/ev");
  console.log("                  -> proceed with chosen tier. Plan framework");
  console.log("                  adjustments for the missing public_betting /");
  console.log("                  RLM / steam axes (alternative source OR remove");
  console.log("                  dependent grades from V1 scope).");
  console.log("  ( ) Verdict 2: Pinnacle EV NOT confirmed in trial");
  console.log("                  -> escalate to SharpAPI sales or evaluate");
  console.log("                  alternative providers.");
  console.log("  ( ) Verdict 3: Trial endpoints failed (HTTP errors)");
  console.log("                  -> debug base URL / auth before deciding.");
  console.log("");
  console.log(`Total API calls made: ${callsMade} / ${MAX_API_CALLS}`);
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
