import {
  applyMlbPlaybookVenueWeatherOverlay,
  buildMlbPlaybookVenueWeatherFailureAudits,
} from "../lib/services/mlbPlaybookVenueWeatherOverlay";
import type { GameSnapshot } from "../lib/automodel/types";
import type { PlaybookVenueWeatherRow } from "../lib/providers/playbook/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function snap(overrides: Record<string, unknown> = {}) {
  return {
    game_external_id: 1001,
    slate_date: "2026-06-24",
    game_date: "2026-06-24T18:00:00Z",
    home_team: { id: 1, abbreviation: "MIA", name: "Marlins" },
    away_team: { id: 2, abbreviation: "TEX", name: "Rangers" },
    home_starter: null,
    away_starter: null,
    home_lineup_top8: [],
    away_lineup_top8: [],
    ballpark: { park_factor_runs: 93, is_dome: false },
    weather: null,
    market: {},
    sharp: {},
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: false,
      lineup_confirmed: false,
      weather_available: false,
      season_stats_present: false,
    },
    ...overrides,
  } as unknown as GameSnapshot;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    teamId: "MIA",
    stale: false,
    staleReason: null,
    fetchedAt: "2026-06-24T12:00:00Z",
    weatherSource: "playbook",
    venue: {
      parkProfile: "SLIGHT_PITCHER",
      roofStatus: { status: "CLOSED", confidence: "HIGH" },
    },
    conditions: {
      tempF: 72,
      wind: { mph: 12, type: "OUT" },
    },
    impact: {},
    ...overrides,
  } as unknown as PlaybookVenueWeatherRow;
}

console.log("━━━ MLB Playbook venue/weather overlay ━━━");

{
  const result = applyMlbPlaybookVenueWeatherOverlay([snap()], [row()]);
  const out = result.snapshots[0]!;
  const audit = result.auditByExternalId.get(1001);

  check("closed roof marks park as dome", out.ballpark?.is_dome === true);
  check("closed roof creates neutral weather when DB weather missing", out.weather !== null);
  check("closed roof neutralizes wind to 0", out.weather?.wind_speed_mph === 0);
  check("closed roof weather is not notable", out.weather?.is_notable === false);
  check("closed roof sets weather_available=true", out.data_quality.weather_available === true);
  check("closed roof audit reason", audit?.reason === "closed_roof_weather_neutralized");
  check("fresh closed-roof row is classified fresh", audit?.provider_status === "fresh");
  check("applied fresh row has no fallback", audit?.fallback_source === null);
}

{
  const result = applyMlbPlaybookVenueWeatherOverlay(
    [snap({ game_external_id: 1002, ballpark: { park_factor_runs: 102, is_dome: true } })],
    [
      row({
        teamId: "MIA",
        venue: { parkProfile: "NEUTRAL", roofStatus: { status: "OPEN", confidence: "MED" } },
        conditions: { tempF: 88, wind: { mph: 14, type: "OUT" } },
      }),
    ],
  );
  const out = result.snapshots[0]!;
  const audit = result.auditByExternalId.get(1002);

  check("open roof can clear stale dome flag", out.ballpark?.is_dome === false);
  check("open roof applies Playbook temp", out.weather?.temperature_f === 88);
  check("open roof applies Playbook wind", out.weather?.wind_speed_mph === 14);
  check("open roof notable weather is preserved", out.weather?.is_notable === true);
  check("open roof audit applied", audit?.applied === true && audit.reason === "playbook_weather_overlay_applied");
  check("fresh open-roof row is classified fresh", audit?.provider_status === "fresh");
}

{
  const result = applyMlbPlaybookVenueWeatherOverlay([snap({ game_external_id: 1003 })], []);
  const out = result.snapshots[0]!;
  const audit = result.auditByExternalId.get(1003);

  check("missing row leaves snapshot unchanged", out.weather === null);
  check("missing row audit not applied", audit?.applied === false && audit.reason === "missing_playbook_home_team_row");
  check("missing row is classified missing", audit?.provider_status === "missing");
  check("missing standard fallback is explicit", audit?.fallback_source === "unavailable");
}

{
  const weather = {
    temperature_f: 78,
    humidity_pct: 54,
    wind_speed_mph: 7,
    wind_direction_degrees: 180,
    is_notable: false,
    notable_reason: null,
    standard_source: "weather_forecasts" as const,
    standard_fetched_at: "2026-06-24T11:55:00Z",
  };
  const input = snap({ game_external_id: 1004, weather });
  const result = applyMlbPlaybookVenueWeatherOverlay(
    [input],
    [
      row({
        stale: true,
        staleReason:
          "OpenWeather onecall error (429): account temporarily blocked by requests limitation",
      }),
    ],
  );
  const audit = result.auditByExternalId.get(1004);

  check("stale embedded OpenWeather 429 leaves snapshot identity", result.snapshots[0] === input);
  check("embedded OpenWeather 429 is classified rate_limited", audit?.provider_status === "rate_limited");
  check("embedded 429 records standard fallback", audit?.fallback_source === "weather_forecasts");
}

{
  const weather = {
    temperature_f: 78,
    humidity_pct: 54,
    wind_speed_mph: 7,
    wind_direction_degrees: 180,
    is_notable: false,
    notable_reason: null,
    standard_source: "weather_forecasts" as const,
    standard_fetched_at: "2026-06-24T11:55:00Z",
  };
  const inputs = [
    snap({ game_external_id: 1005, weather }),
    snap({ game_external_id: 1006, weather: null }),
  ];
  const audits = buildMlbPlaybookVenueWeatherFailureAudits(
    inputs,
    new Error("Playbook request failed with status 429"),
  );

  check("call-level 429 creates one bounded audit per game", audits.size === 2);
  check("call-level 429 is classified rate_limited", audits.get(1005)?.provider_status === "rate_limited");
  check("call-level 429 records weather_forecasts fallback", audits.get(1005)?.fallback_source === "weather_forecasts");
  check("call-level 429 records unavailable fallback when absent", audits.get(1006)?.fallback_source === "unavailable");
  check("call-level failure does not persist raw error", !JSON.stringify([...audits.values()]).includes("status 429"));
}

{
  const audits = buildMlbPlaybookVenueWeatherFailureAudits(
    [snap({ game_external_id: 1007 })],
    new Error("fetch failed: provider unavailable"),
  );
  check("call-level unavailable is classified", audits.get(1007)?.provider_status === "unavailable");
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) {
  console.error(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("✅ MLB Playbook venue/weather overlay tests passed.");
