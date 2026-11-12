/** Actual server pages and their client props. All reads and network are mocked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import type { NbaPlayerPropsMemberSnapshot } from "../lib/services/nba/nbaPlayerPropsProductContract";
import type { buildNbaPlayerPropsMemberClientSnapshot as BuildTransport } from "../lib/services/nba/nbaPlayerPropsMemberTransport.server";

globalThis.fetch = async () => { throw Error("Member transport proof forbids network"); };
const requireHere = createRequire(`${process.cwd()}/package.json`);
function load(path: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}) {
  const source = readFileSync(path, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, process: { env }, Date, console,
    require: (name: string) => {
      assert(name in dependencies, `Unexpected server import: ${name}`);
      return dependencies[name];
    },
  }, { filename: path });
  return loadedModule.exports;
}

const transport = load("lib/services/nba/nbaPlayerPropsMemberTransport.server.ts", { "server-only": {} });
const build = transport.buildNbaPlayerPropsMemberClientSnapshot as typeof BuildTransport;
const fixture = JSON.parse(readFileSync("lib/services/nba/fixtures/nbaPlayerPropsProductPreview.json", "utf8"));
fixture.decisions[0].lockedAt = "2026-11-10T21:00:00Z";
const privateSnapshot = {
  ...fixture,
  internalFutureDiagnostic: "PRIVATE_TOP_LEVEL_SENTINEL",
  diagnostics: {
    ...fixture.diagnostics,
    sourceContextAudits: { release: "synthetic-private", text: "PRIVATE_SOURCE_SENTINEL", padding: "x".repeat(1000000) },
    sourceContextAuditRetention: "PRIVATE_RETENTION_SENTINEL",
    aiReviewRuntime: {status:'active',newlyCompletedReviews:0,findings:['PRIVATE_AI_RUNTIME_SENTINEL'],observedAt:'2026-11-11T22:47:38Z'},
    futureInternalField: "PRIVATE_FUTURE_SENTINEL",
  },
} as NbaPlayerPropsMemberSnapshot;
const before = JSON.stringify(privateSnapshot);
const member = build(privateSnapshot);
assert.equal(member.decisions, privateSnapshot.decisions);
assert.equal(member.games, privateSnapshot.games);
assert.equal(JSON.stringify(member.decisions), JSON.stringify(privateSnapshot.decisions), "Exact legacy lock payloads retain every field");
assert.equal(JSON.stringify(privateSnapshot), before, "Private canonical source is never mutated");
assert.equal(member.memberTransportRelease, transport.NBA_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE);
assert.deepEqual(Object.keys(member.diagnostics).sort(), [
  "inputRows", "canonicalMarkets", "actionable", "bestAngles", "leans", "watchlists", "noPlays", "sportsbooks",
].sort());
assert(!JSON.stringify(member).includes("PRIVATE_"));
assert(JSON.stringify(member).length < before.length - 1000000, "Private megabyte metadata never contributes to member transport");

const Dashboard = () => null, Frame = () => null, Pills = () => null;
type Element = { type?: unknown; props?: Record<string, unknown> };
function findDashboard(value: unknown): Element | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.map(findDashboard).find(Boolean) ?? null;
  const element = value as Element;
  if (element.type === Dashboard) return element;
  return findDashboard(element.props?.children);
}
async function page(path: string, hasCurrent: boolean) {
  let reads = 0;
  const read = async () => { reads++; return hasCurrent ? privateSnapshot : null; };
  const dependencies: Record<string, unknown> = {
    "next/navigation": { redirect: () => { throw Error("Unexpected redirect"); }, notFound: () => { throw Error("Unexpected preview denial"); } },
    "@/app/lab/components/ProductAppFrame": { default: Frame, __esModule: true },
    "@/lib/db/supabase": { supabase: {} },
    "@/lib/services/football/nflPlayerPropsSnapshotStore": { readNflPlayerPropsMemberSnapshot: () => { throw Error("Unexpected NFL source read"); } },
    "@/lib/services/football/nflPlayerPropsMemberTransport.server": { encodeNflPlayerPropsMemberTransport: () => { throw Error("Unexpected NFL transport"); } },
    "./components/NflPlayerPropsProductDashboardTransport": { NflPlayerPropsProductDashboardTransport: () => null },
    "./components/NbaPlayerPropsProductDashboard": { NbaPlayerPropsProductDashboard: Dashboard },
    "@/app/player-props/components/NbaPlayerPropsProductDashboard": { NbaPlayerPropsProductDashboard: Dashboard },
    "./components/PlayerPropsLeaguePills": { PlayerPropsLeaguePills: Pills },
    "@/app/player-props/components/PlayerPropsLeaguePills": { PlayerPropsLeaguePills: Pills },
    "@/lib/config/productExperience": { isProductExperiencePreviewAvailable: () => true },
    "@/lib/services/memberDataAvailability": { readMemberDataWithDeadline: async (a: { read: typeof read }) => ({ value: await a.read() }) },
    "@/lib/services/football/nflForwardWeekSelection": { resolveNflForwardWeek: () => 1 },
    "@/lib/services/nba/nbaPlayerPropsLifecycle": { nbaPlayerPropsSlateDate: () => fixture.slateDate },
    "@/lib/services/nba/nbaPlayerPropsPrivateStore": { readNbaPlayerPropsPrivateSnapshot: read },
    "@/lib/services/nba/nbaPlayerPropsProductContract": { buildNbaPlayerPropsMemberSnapshot: () => privateSnapshot },
    "@/lib/services/nba/nbaPlayerPropsMemberTransport.server": transport,
    "@/lib/services/nba/fixtures/nbaPlayerPropsProductPreview.json": { default: privateSnapshot, __esModule: true },
    "@/lib/services/playerProps/playerPropsLeagueActivity.server": { readPlayerPropsLeagueActivity: () => { throw Error("Unexpected activity read"); } },
    "./lib/playerPropsLeagues": { preferredPlayerPropsHref: () => "/player-props?league=nba" },
    "react/jsx-runtime": requireHere("react/jsx-runtime"),
  };
  const run = load(path, dependencies, {
    NBA_PLAYER_PROPS_MEMBER_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-a-credential",
  }).default as (args: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  const element = findDashboard(await run({ searchParams: Promise.resolve({ league: "nba", reader: fixture.decisions[0].decisionKey }) }));
  assert(element, "Actual server page must reach its client dashboard boundary");
  assert.equal(reads, 1, "The sanitizer adds no source or database reads");
  const payload = element.props?.snapshot as NbaPlayerPropsMemberSnapshot;
  assert.deepEqual(payload, member);
  assert.equal(element.props?.initialSelectedKey, fixture.decisions[0].decisionKey);
  assert(!JSON.stringify(element.props).includes("PRIVATE_"), "Private diagnostics must be absent from actual client props, not merely hidden in rendered HTML");
  assert.equal(JSON.stringify(payload.decisions[0]), JSON.stringify(privateSnapshot.decisions[0]));
  assert.equal(JSON.stringify(privateSnapshot), before);
}
async function main() {
  assert.match(readFileSync("app/player-props/components/NbaPlayerPropsProductDashboard.tsx", "utf8"), /^"use client";/);
  for (const path of ["app/player-props/page.tsx", "app/dev/nba-props-preview/page.tsx"]) {
    await page(path, true);
    await page(path, false);
  }
  console.log("Private NBA member transport passed: actual main/preview server pages, current/fallback sources, allowlisted browser props, stripped current/future private diagnostics and megabyte payload; exact stored decisions/locks and private source preserved, one existing read, zero network.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
