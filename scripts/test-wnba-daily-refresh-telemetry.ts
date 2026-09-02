import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const {
    summarizeWnbaDailyRefreshErrors,
    WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_LENGTH,
  } = await import("../lib/cron/wnbaDailyRefreshTelemetry");

  const routeSource = readFileSync(
    new URL("../app/api/cron/wnba-daily-refresh/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    routeSource,
    /from "@\/lib\/cron\/wnbaDailyRefreshTelemetry";/,
    "the route must import telemetry helpers from a non-route module",
  );
  assert.doesNotMatch(
    routeSource,
    /export (?:const|function|type) (?:WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_LENGTH|summarizeWnbaDailyRefreshErrors|WnbaDailyRefreshStageError)/,
    "Next route modules must not export telemetry helpers or types",
  );
  assert.match(routeSource, /export async function GET\(/, "the route must retain GET");
  assert.match(routeSource, /export const POST = GET;/, "the route must retain the POST alias");
  assert.match(routeSource, /export const maxDuration = 300;/, "the route must retain its duration config");

  assert.equal(
    summarizeWnbaDailyRefreshErrors([]),
    null,
    "a successful or zero-slate run must not fabricate an error message",
  );

  const summary = summarizeWnbaDailyRefreshErrors([
    { stage: "seed:2026-09-02", message: "playbook slate bucket: transient timeout" },
    { stage: "lines", message: "SharpAPI network error" },
  ]);
  assert.equal(
    summary,
    "[seed:2026-09-02] playbook slate bucket: transient timeout | [lines] SharpAPI network error",
    "partial telemetry must retain deterministic stage prefixes",
  );
  assert.equal(
    summarizeWnbaDailyRefreshErrors([
      { stage: "lines", message: "SharpAPI network error" },
      { stage: "seed:2026-09-02", message: "playbook slate bucket: transient timeout" },
    ]),
    "[lines] SharpAPI network error | [seed:2026-09-02] playbook slate bucket: transient timeout",
    "telemetry ordering must match route-stage ordering rather than sorting or regrouping errors",
  );

  const sensitiveSummary = summarizeWnbaDailyRefreshErrors([
    {
      stage: "lines",
      message: "Authorization: Bearer super-secret-token\nGET https://provider.test/odds?api_key=query-secret&league=wnba",
    },
    { stage: "model", message: "token=another-secret password: final-secret" },
  ]);
  assert.ok(sensitiveSummary, "a partial run must persist a nonempty summary");
  assert.ok(!sensitiveSummary.includes("super-secret-token"), "bearer credentials must be redacted");
  assert.ok(!sensitiveSummary.includes("query-secret"), "query-string credentials must be redacted");
  assert.ok(!sensitiveSummary.includes("another-secret"), "token assignments must be redacted");
  assert.ok(!sensitiveSummary.includes("final-secret"), "password assignments must be redacted");
  assert.ok(!/[\r\n\t]/.test(sensitiveSummary), "control whitespace must be normalized");

  const boundedSummary = summarizeWnbaDailyRefreshErrors(
    Array.from({ length: 12 }, (_, index) => ({
      stage: `stage-${index}`,
      message: `failure-${index}-${"x".repeat(600)}`,
    })),
  );
  assert.ok(boundedSummary, "nonempty errors must always produce a summary");
  assert.ok(
    boundedSummary.length <= WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_LENGTH,
    "persisted telemetry must honor the hard length cap",
  );
  assert.ok(boundedSummary.startsWith("[stage-0] failure-0-"), "the first stage must survive truncation");
  assert.ok(!boundedSummary.includes("[stage-5]"), "only the bounded first five errors may enter the message");

  console.log("WNBA daily-refresh telemetry tests passed");
}

void main();
