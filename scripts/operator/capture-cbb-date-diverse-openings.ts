/** Bounded, private historical capture. No forecast, grade, lock, or production writer. */
import { readFile, writeFile } from "node:fs/promises";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";

const dir = "/private/tmp/oddsphere-cbb-data";
// Chosen as calendar dates before inspecting their odds or outcomes: nine early-season
// Saturdays and five NCAA-tournament dates. Do not select dates by winning results.
const firstDates = ["2025-11-15", "2025-11-22", "2025-12-06", "2025-12-13",
  "2026-01-03", "2026-01-10", "2026-01-17", "2026-01-24", "2026-01-31",
  "2026-03-19", "2026-03-20", "2026-03-22", "2026-03-26", "2026-03-27"];
// Fixed weekday calendar, independently of the first cohort's outcomes.
const weekdayDates = ["2026-02-02", "2026-02-04", "2026-02-06", "2026-02-09", "2026-02-11", "2026-02-13",
  "2026-02-16", "2026-02-18", "2026-02-20", "2026-02-23", "2026-02-25", "2026-02-27",
  "2026-03-02", "2026-03-04", "2026-03-06", "2026-03-09", "2026-03-11", "2026-03-13"];
const existingSaturdays = ["2026-02-07", "2026-02-14", "2026-02-21", "2026-02-28", "2026-03-07", "2026-03-14"];
const saturationDates = Array.from({ length: 43 }, (_, i) => new Date(Date.UTC(2026, 1, 1 + i)).toISOString().slice(0, 10))
  .filter(date => !weekdayDates.includes(date) && !existingSaturdays.includes(date));
const weekdays = process.argv.includes("--set=weekdays");
const saturation = process.argv.includes("--set=saturation");
const dates = saturation ? saturationDates : weekdays ? weekdayDates : firstDates;
const target = `${dir}/${saturation ? "saturation" : weekdays ? "weekday" : "date-diverse"}-opening-raw.json`;
async function main() {
  try {
    const cached = JSON.parse(await readFile(target, "utf8"));
    if (JSON.stringify(cached.dates) !== JSON.stringify(dates) || !Array.isArray(cached.data))
      throw new Error("date-diverse opening cache does not match the fixed cohort");
    console.log(JSON.stringify({ cached: true, dates: dates.length, rows: cached.data.length,
      requests: 0, productionWrites: 0 }));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "", { maxRequests: 150 });
  const data = await client.odds(dates, "opening");
  await writeFile(target, JSON.stringify({ fetchedAt: new Date().toISOString(), dates, providerRequests: client.calls,
    productionWrites: 0, data }));
  console.log(JSON.stringify({ cached: false, dates: dates.length, rows: data.length,
    requests: client.calls, productionWrites: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB opening capture failed"); process.exitCode = 1; });
