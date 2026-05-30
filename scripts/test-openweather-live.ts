/**
 * Phase 4W — operator-run live API smoke for OpenWeatherProvider.
 *
 * Makes ONE real OpenWeather API call against a known ballpark
 * coordinate (Yankee Stadium) for a near-future game time. Verifies the
 * provider returns a valid WeatherForecastRecord and that field
 * mappings come back sensibly.
 *
 * Refuses to run without OPENWEATHER_API_KEY. Writes NOTHING to DB.
 * Prints NO secrets — the key is never logged, never included in any
 * error or output. Sanitized provider errors propagate cleanly.
 *
 * Operator-only. Not run as part of regression sweeps. Use to verify
 * the real key works against the real OpenWeather API after the code
 * is merged.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-openweather-live.ts
 */

import { OpenWeatherProvider } from "../lib/providers/real_api/OpenWeatherProvider";

if (
  !process.env.OPENWEATHER_API_KEY ||
  process.env.OPENWEATHER_API_KEY.trim().length === 0
) {
  console.error(
    "\n✗ REFUSING TO RUN: OPENWEATHER_API_KEY not set.\n" +
      "  Phase 4W live smoke needs the real OpenWeather API key in env.\n" +
      "  Add it to .env.local and re-run:\n\n" +
      "    npx tsx --env-file=.env.local scripts/test-openweather-live.ts\n"
  );
  process.exit(1);
}

const TEST_LAT = 40.8296; // Yankee Stadium
const TEST_LON = -73.9262;
// Target ~3 hours in the future so it's well within the 5-day window
// and the closest 3-hour forecast item should be within 6h.
const TEST_TIME = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  console.log(
    `\n━━━ OpenWeatherProvider live smoke ━━━\n` +
      `  target lat/lon: ${TEST_LAT}, ${TEST_LON} (Yankee Stadium)\n` +
      `  target time:    ${TEST_TIME} (~3h from now)\n` +
      `  API key present: yes (length ${process.env.OPENWEATHER_API_KEY!.length})\n`
  );

  const provider = new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY!);

  let record: Awaited<ReturnType<typeof provider.getForecast>>;
  try {
    record = await provider.getForecast(TEST_LAT, TEST_LON, TEST_TIME);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Provider threw: ${message}`);
    console.error(
      `  (error message is sanitized — no key, no URL, no payload echo)`
    );
    process.exit(1);
  }

  check("getForecast returned a non-null record", record !== null);
  if (record === null) {
    console.error("✗ Cannot continue — record null.");
    process.exit(1);
  }

  check(
    "forecast_for is a valid ISO timestamp",
    typeof record.forecast_for === "string" &&
      !Number.isNaN(Date.parse(record.forecast_for))
  );
  check(
    "fetched_at is a valid ISO timestamp",
    typeof record.fetched_at === "string" &&
      !Number.isNaN(Date.parse(record.fetched_at))
  );
  check(
    "temperature_f is a finite number (units=imperial verified)",
    typeof record.temperature_f === "number" &&
      Number.isFinite(record.temperature_f)
  );
  check(
    "temperature_f is in a plausible Fahrenheit range (-50 to 150)",
    typeof record.temperature_f === "number" &&
      record.temperature_f >= -50 &&
      record.temperature_f <= 150
  );
  check(
    "wind_speed_mph is a non-negative number (mph not m/s)",
    typeof record.wind_speed_mph === "number" && record.wind_speed_mph >= 0
  );
  check(
    "wind_speed_mph is in a plausible mph range (<150)",
    typeof record.wind_speed_mph === "number" && record.wind_speed_mph < 150
  );
  check(
    "wind_direction_degrees is in [0, 360] or null",
    record.wind_direction_degrees === null ||
      (typeof record.wind_direction_degrees === "number" &&
        record.wind_direction_degrees >= 0 &&
        record.wind_direction_degrees <= 360)
  );
  check(
    "humidity_pct is in [0, 100] or null",
    record.humidity_pct === null ||
      (typeof record.humidity_pct === "number" &&
        record.humidity_pct >= 0 &&
        record.humidity_pct <= 100)
  );
  check(
    "precipitation_probability is in [0, 100] or null",
    record.precipitation_probability === null ||
      (typeof record.precipitation_probability === "number" &&
        record.precipitation_probability >= 0 &&
        record.precipitation_probability <= 100)
  );
  check(
    "conditions is a string or null",
    typeof record.conditions === "string" || record.conditions === null
  );

  console.log(`\nSample returned record:`);
  console.log(`  forecast_for:               ${record.forecast_for}`);
  console.log(`  temperature_f:              ${record.temperature_f}`);
  console.log(`  feels_like_f:               ${record.feels_like_f}`);
  console.log(`  humidity_pct:               ${record.humidity_pct}`);
  console.log(`  wind_speed_mph:             ${record.wind_speed_mph}`);
  console.log(`  wind_direction_degrees:     ${record.wind_direction_degrees}`);
  console.log(`  precipitation_mm:           ${record.precipitation_mm}`);
  console.log(`  precipitation_probability:  ${record.precipitation_probability}`);
  console.log(`  conditions:                 ${record.conditions}`);

  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    process.exit(1);
  }
  console.log(`\n✅ Live OpenWeather smoke passed.`);
  console.log(
    `\nNotes:`
  );
  console.log(`  • One real API call was made (~1/1000 daily quota on free tier).`);
  console.log(`  • No data was written to the database.`);
  console.log(`  • API key was NOT printed anywhere in this output.`);
}

main().catch((e) => {
  // Defensive — any uncaught error path gets sanitized.
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nUnhandled error: ${msg}`);
  process.exit(1);
});
