/**
 * Phase 4W — pure unit tests for OpenWeatherProvider.
 *
 * All tests use a STUBBED global fetch — no network calls, no DB writes,
 * no API key required. Verifies:
 *
 *   - constructor validates apiKey
 *   - URL contains units=imperial
 *   - URL does not appear in error messages (no key leakage)
 *   - response mapping per Phase 4W field map
 *   - closest-forecast selection
 *   - rejects matches >6h from target
 *   - returns null for empty / malformed list
 *   - returns null for malformed forGameTime / invalid lat/lon
 *   - throws sanitized error on network failure
 *   - throws sanitized error on non-200 status
 *
 * Runs via: npx tsx scripts/test-openweather-provider.ts
 */

import {
  OpenWeatherProvider,
  mapItemToRecord,
  pickClosestForecast,
} from "../lib/providers/real_api/OpenWeatherProvider";
import type {
  OpenWeatherForecastItem,
  OpenWeatherForecastResponse,
} from "../lib/types/api/openweather";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function checkThrows(
  label: string,
  fn: () => unknown | Promise<unknown>,
  expectedSubstring?: string
): Promise<void> {
  return Promise.resolve().then(async () => {
    try {
      const r = fn();
      if (r instanceof Promise) await r;
      fail++;
      const msg = `  ✗ ${label} did NOT throw`;
      console.log(msg);
      failures.push(msg);
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (!expectedSubstring || m.includes(expectedSubstring)) {
        pass++;
        console.log(`  ✓ ${label} threw "${m.slice(0, 80)}"`);
      } else {
        fail++;
        const msg = `  ✗ ${label} threw wrong message: ${m}`;
        console.log(msg);
        failures.push(msg);
      }
    }
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const TEST_KEY = "test_key_NEVER_used_in_real_calls_4D1A2B3C";

function makeItem(opts: {
  /** Unix seconds */
  dt: number;
  temp?: number;
  feels?: number;
  humidity?: number;
  wind_speed?: number;
  wind_deg?: number;
  rain_3h?: number;
  snow_3h?: number;
  pop?: number;
  conditions?: string;
}): OpenWeatherForecastItem {
  return {
    dt: opts.dt,
    dt_txt: new Date(opts.dt * 1000).toISOString(),
    main: {
      temp: opts.temp ?? 72,
      feels_like: opts.feels ?? 72,
      humidity: opts.humidity ?? 50,
      pressure: 1015,
    },
    weather: [
      {
        id: 800,
        main: opts.conditions ?? "Clear",
        description: "clear sky",
        icon: "01d",
      },
    ],
    wind: {
      speed: opts.wind_speed ?? 5,
      deg: opts.wind_deg ?? 90,
    },
    pop: opts.pop,
    rain: opts.rain_3h !== undefined ? { "3h": opts.rain_3h } : undefined,
    snow: opts.snow_3h !== undefined ? { "3h": opts.snow_3h } : undefined,
  };
}

function makeResponse(items: OpenWeatherForecastItem[]): OpenWeatherForecastResponse {
  return {
    cod: "200",
    message: 0,
    cnt: items.length,
    list: items,
    city: {
      id: 5128581,
      name: "New York",
      coord: { lat: 40.8296, lon: -73.9262 },
      country: "US",
      timezone: -14400,
      sunrise: 0,
      sunset: 0,
    },
  };
}

/**
 * Stub global fetch with a deterministic handler. Returns the URL the
 * provider built so tests can assert query-string contents WITHOUT
 * exposing it via thrown errors.
 *
 * Captures each call so the test can inspect the URL after the call —
 * crucial for the "URL contains units=imperial" assertion + the
 * "URL is NOT in error message" assertion.
 */
function withStubbedFetch(
  responder: (url: string) => Promise<Response> | Response,
  fn: () => Promise<void>,
  capturedUrls: string[] = []
): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    capturedUrls.push(url);
    return responder(url);
  }) as typeof global.fetch;
  return fn().finally(() => {
    global.fetch = originalFetch;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function main() {

// ─── Constructor validation ──────────────────────────────────────────
section("Constructor — apiKey validation");

await checkThrows(
  "empty string apiKey → throws",
  () => new OpenWeatherProvider(""),
  "apiKey is required"
);
await checkThrows(
  "whitespace-only apiKey → throws",
  () => new OpenWeatherProvider("   "),
  "apiKey is required"
);
await checkThrows(
  "undefined apiKey → throws",
  () => new OpenWeatherProvider(undefined as unknown as string),
  "apiKey is required"
);
check(
  "valid apiKey constructs cleanly",
  (() => {
    try {
      new OpenWeatherProvider(TEST_KEY);
      return true;
    } catch {
      return false;
    }
  })()
);

// ─── URL building ─────────────────────────────────────────────────────
section("URL building — units=imperial pinned");

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  const captured: string[] = [];
  await withStubbedFetch(
    () => jsonResponse(makeResponse([makeItem({ dt: Math.floor(Date.now() / 1000) })])),
    async () => {
      await provider.getForecast(40.83, -73.93, new Date().toISOString());
    },
    captured
  );
  const url = captured[0] ?? "";
  check(
    "URL contains units=imperial",
    url.includes("units=imperial")
  );
  check(
    "URL contains lat=40.83",
    url.includes("lat=40.83")
  );
  check(
    "URL contains lon=-73.93",
    url.includes("lon=-73.93")
  );
  check(
    "URL contains api.openweathermap.org/data/2.5/forecast",
    url.includes("api.openweathermap.org/data/2.5/forecast")
  );
  check(
    "URL contains appid query param (key presence; value not logged)",
    url.includes("appid=")
  );
}

// ─── pickClosestForecast — direct unit tests ─────────────────────────
section("pickClosestForecast — closest selection + 6h reject");

{
  const target = 1716393600 * 1000; // 2024-05-22T12:00Z arbitrary
  // Items at -2h, +1h, +5h. Closest is +1h.
  const items: OpenWeatherForecastItem[] = [
    makeItem({ dt: 1716393600 - 7200 }),
    makeItem({ dt: 1716393600 + 3600 }),
    makeItem({ dt: 1716393600 + 18000 }),
  ];
  const picked = pickClosestForecast(items, target);
  check(
    "selects +1h item (closest)",
    picked !== null && picked.dt === 1716393600 + 3600
  );
}

{
  // Single far-away item (>6h) → null
  const target = 1716393600 * 1000;
  const items = [makeItem({ dt: 1716393600 + 8 * 3600 })]; // +8h
  const picked = pickClosestForecast(items, target);
  check(
    "rejects single item >6h from target (returns null)",
    picked === null
  );
}

{
  // Empty list → null
  const picked = pickClosestForecast([], 1716393600 * 1000);
  check("empty list → null", picked === null);
}

{
  // Item exactly at 6h boundary — inclusive (≤6h is allowed)
  const target = 1716393600 * 1000;
  const items = [makeItem({ dt: 1716393600 + 6 * 3600 })]; // exactly +6h
  const picked = pickClosestForecast(items, target);
  check(
    "exactly 6h offset boundary is INCLUSIVE → returns the item",
    picked !== null && picked.dt === 1716393600 + 6 * 3600
  );
}

{
  // Malformed item (missing dt) is skipped; valid item picked
  const target = 1716393600 * 1000;
  const items = [
    { ...makeItem({ dt: 1716393600 }), dt: undefined as unknown as number },
    makeItem({ dt: 1716393600 + 3600 }),
  ];
  const picked = pickClosestForecast(items, target);
  check(
    "malformed item (no dt) skipped; valid item picked",
    picked !== null && picked.dt === 1716393600 + 3600
  );
}

// ─── mapItemToRecord — field mapping ─────────────────────────────────
section("mapItemToRecord — field mapping per Phase 4W §5");

{
  const item = makeItem({
    dt: 1716393600,
    temp: 78.4,
    feels: 80.2,
    humidity: 65,
    wind_speed: 12.6,
    wind_deg: 145,
    rain_3h: 1.2,
    snow_3h: 0,
    pop: 0.4,
    conditions: "Rain",
  });
  const r = mapItemToRecord(item);
  check(
    "forecast_for is ISO string of (dt × 1000)",
    r.forecast_for === new Date(1716393600 * 1000).toISOString()
  );
  check("temperature_f rounded to 78", r.temperature_f === 78);
  check("feels_like_f rounded to 80", r.feels_like_f === 80);
  check("humidity_pct === 65", r.humidity_pct === 65);
  check(
    "wind_speed_mph rounded to 13 (Math.round(12.6) === 13)",
    r.wind_speed_mph === 13
  );
  check(
    "wind_direction_degrees === 145",
    r.wind_direction_degrees === 145
  );
  check(
    "precipitation_mm === rain_3h (1.2) when no snow",
    r.precipitation_mm === 1.2
  );
  check(
    "precipitation_probability === Math.round(0.4 × 100) === 40",
    r.precipitation_probability === 40
  );
  check('conditions === "Rain"', r.conditions === "Rain");
  check(
    "fetched_at is a valid ISO timestamp",
    typeof r.fetched_at === "string" && !Number.isNaN(Date.parse(r.fetched_at))
  );
}

{
  // pop = 0 → 0% probability
  const r = mapItemToRecord(makeItem({ dt: 1716393600, pop: 0 }));
  check("pop=0 → precipitation_probability=0", r.precipitation_probability === 0);
}

{
  // pop missing → null
  const item = makeItem({ dt: 1716393600 });
  item.pop = undefined;
  const r = mapItemToRecord(item);
  check(
    "pop undefined → precipitation_probability=null",
    r.precipitation_probability === null
  );
}

{
  // Rain + snow combine into precipitation_mm
  const r = mapItemToRecord(
    makeItem({ dt: 1716393600, rain_3h: 0.8, snow_3h: 0.4 })
  );
  check(
    "rain+snow combine into precipitation_mm (0.8+0.4=1.2)",
    Math.abs(r.precipitation_mm! - 1.2) < 0.001
  );
}

{
  // Neither rain nor snow → 0 (not null)
  const r = mapItemToRecord(makeItem({ dt: 1716393600 }));
  check("no rain + no snow → precipitation_mm === 0", r.precipitation_mm === 0);
}

{
  // Empty weather array → conditions=null
  const item = makeItem({ dt: 1716393600 });
  item.weather = [];
  const r = mapItemToRecord(item);
  check("empty weather[] → conditions=null", r.conditions === null);
}

{
  // Defensive null inputs for individual numerics
  const item = makeItem({ dt: 1716393600 });
  item.main = { ...item.main, temp: null as unknown as number };
  const r = mapItemToRecord(item);
  check(
    "non-number temp → temperature_f=null",
    r.temperature_f === null
  );
}

// ─── End-to-end provider with stubbed fetch ──────────────────────────
section("getForecast — end-to-end with stubbed fetch");

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  const target = new Date("2026-06-15T20:00:00Z");
  const targetSec = Math.floor(target.getTime() / 1000);
  // Build response with closest item at exactly target time
  const items = [
    makeItem({ dt: targetSec - 3600, temp: 70 }),
    makeItem({ dt: targetSec, temp: 75, wind_speed: 8, wind_deg: 90 }),
    makeItem({ dt: targetSec + 3600, temp: 78 }),
  ];
  const result = await new Promise<Awaited<ReturnType<typeof provider.getForecast>>>(
    (resolve) => {
      withStubbedFetch(
        () => jsonResponse(makeResponse(items)),
        async () => {
          resolve(await provider.getForecast(40.83, -73.93, target.toISOString()));
        }
      );
    }
  );
  check("end-to-end: returns non-null record", result !== null);
  check(
    "end-to-end: picks the item at game time (temp 75)",
    result?.temperature_f === 75
  );
  check(
    "end-to-end: maps wind speed (8) + direction (90)",
    result?.wind_speed_mph === 8 && result?.wind_direction_degrees === 90
  );
}

{
  // Empty list response → null
  const provider = new OpenWeatherProvider(TEST_KEY);
  const result = await new Promise<Awaited<ReturnType<typeof provider.getForecast>>>(
    (resolve) => {
      withStubbedFetch(
        () => jsonResponse(makeResponse([])),
        async () => {
          resolve(
            await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z")
          );
        }
      );
    }
  );
  check("empty list response → returns null", result === null);
}

{
  // Game >>5 days out — list won't have anything within 6h → null
  const provider = new OpenWeatherProvider(TEST_KEY);
  const items = [makeItem({ dt: Math.floor(Date.now() / 1000) })];
  const result = await new Promise<Awaited<ReturnType<typeof provider.getForecast>>>(
    (resolve) => {
      withStubbedFetch(
        () => jsonResponse(makeResponse(items)),
        async () => {
          resolve(
            await provider.getForecast(40.83, -73.93, "2099-01-01T00:00:00Z")
          );
        }
      );
    }
  );
  check("game far in future → no usable forecast → null", result === null);
}

// ─── Malformed inputs → null (no throw) ──────────────────────────────
section("Malformed inputs — null inputs return null gracefully");

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  // Capture fetch calls so we can assert it was NOT called for bad inputs
  const captured: string[] = [];
  await withStubbedFetch(
    () => jsonResponse(makeResponse([])),
    async () => {
      const r1 = await provider.getForecast(
        Number.NaN,
        -73.93,
        "2026-06-15T20:00:00Z"
      );
      const r2 = await provider.getForecast(
        40.83,
        Number.NaN,
        "2026-06-15T20:00:00Z"
      );
      const r3 = await provider.getForecast(
        40.83,
        -73.93,
        "not-an-iso-date"
      );
      check("NaN latitude → null", r1 === null);
      check("NaN longitude → null", r2 === null);
      check("malformed forGameTime → null", r3 === null);
    },
    captured
  );
  check(
    "no fetch attempted on malformed inputs (no API quota wasted)",
    captured.length === 0
  );
}

// ─── Error handling — sanitized messages (NO key leakage) ────────────
section("Error handling — sanitized messages (NO key/URL leakage)");

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  await checkThrows(
    "network error → sanitized throw",
    async () => {
      await withStubbedFetch(
        () => {
          throw new Error("connect ECONNREFUSED 1.2.3.4:443");
        },
        async () => {
          await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
        }
      );
    },
    "network error contacting forecast endpoint"
  );
}

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  let caughtMessage = "";
  try {
    await withStubbedFetch(
      () => {
        throw new Error("connect ECONNREFUSED 1.2.3.4:443");
      },
      async () => {
        await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
      }
    );
  } catch (e) {
    caughtMessage = (e as Error).message;
  }
  check(
    "network error message does NOT contain the API key",
    !caughtMessage.includes(TEST_KEY)
  );
  check(
    "network error message does NOT contain 'appid='",
    !caughtMessage.includes("appid=")
  );
  check(
    "network error message does NOT contain underlying error text",
    !caughtMessage.includes("ECONNREFUSED")
  );
}

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  await checkThrows(
    "401 response → sanitized throw with status",
    async () => {
      await withStubbedFetch(
        () =>
          new Response("Unauthorized — invalid appid sk-redacted", {
            status: 401,
          }),
        async () => {
          await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
        }
      );
    },
    "status 401"
  );
}

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  let caughtMessage = "";
  try {
    await withStubbedFetch(
      () =>
        new Response("Unauthorized — invalid appid sk-test_key_NEVER_used", {
          status: 401,
        }),
      async () => {
        await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
      }
    );
  } catch (e) {
    caughtMessage = (e as Error).message;
  }
  check(
    "401 error message does NOT echo response body (no key leakage)",
    !caughtMessage.includes(TEST_KEY) && !caughtMessage.includes("Unauthorized")
  );
}

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  await checkThrows(
    "429 (rate limit) → sanitized throw with status",
    async () => {
      await withStubbedFetch(
        () => new Response("rate limited", { status: 429 }),
        async () => {
          await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
        }
      );
    },
    "status 429"
  );
}

{
  const provider = new OpenWeatherProvider(TEST_KEY);
  await checkThrows(
    "200 with malformed JSON → sanitized throw",
    async () => {
      await withStubbedFetch(
        () =>
          new Response("not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        async () => {
          await provider.getForecast(40.83, -73.93, "2026-06-15T20:00:00Z");
        }
      );
    },
    "malformed JSON"
  );
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All OpenWeatherProvider unit tests passed.`);

}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
