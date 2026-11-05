import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { canonicalSplitJson, currentSplitEventDate, prepareArchivedCurrentSplitFeed,
  iterateCurrentSplitObservations, splitArchiveBatches } from "../lib/providers/real_api/currentSplitObservationArchive";
import { hydrateCurrentSplitHistory, currentSplitReadDates, validateSharpApiCurrentSplitFeed,
  applySharpApiCurrentSplitOverlay, __TEST__, type SharpApiCurrentSplitFeed } from "../lib/providers/real_api/sharpApiCurrentSplits";

async function main() {
  const url = new URL(process.env.CURRENT_SPLIT_ARCHIVE_TEST_URL ?? "");
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1", "only a disposable loopback PostgREST is permitted");
  const requestBytes: number[] = [];
  const db = createClient(url.href, "offline", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(target.origin, url.origin);
    const headers = new Headers(init?.headers); headers.delete("authorization");
    if (target.pathname.endsWith("/archive_current_split_observations")) requestBytes.push(Buffer.byteLength(String(init?.body)));
    target.pathname = target.pathname.replace(/^\/rest\/v1\//, "/");
    return fetch(target, { ...init, headers });
  } } });
  const base: SharpApiCurrentSplitFeed = { source: "owls_current_splits", release: "owls_current_splits_2026_10_27_r1_complete_named_book",
    sport: "cfb", fetchedAt: "2026-11-05T12:00:00Z", rows: [] };
  const row = (eventDate: string, index: number) => ({ event_id: `ncaaf:Away@Home-${eventDate}`, league: "ncaaf", sportsbook: "circa",
    away_team: "Away", home_team: "Home", fetched_at: new Date(Date.parse("2026-10-27T10:00:00Z") + index * 300_000).toISOString(),
    moneyline: { handle_pct: { away: 61, home: 39 }, bets_pct: { away: 53, home: 47 } },
    unknownFutureEvidence: { exact: [null, "🏈", 0, false, "source clock remains authoritative"] } });
  const previous = { ...base, rows: [row("20261027", 0), row("20261107", 0), { ...row("20261107", 0), event_id: "undated-original" }] };
  const current = { ...base, rows: [row("20261107", 1)] };
  const previousJson = JSON.stringify(previous);
  const merged = __TEST__.mergeCurrentSplitFeeds(previous, current);
  const hot = await prepareArchivedCurrentSplitFeed({ client: db, previous, current, merged });
  assert.equal(JSON.stringify(previous), previousJson, "archiving never mutates its original receipt");
  assert.equal(hot.rows.length, 3, "past event is archived, future and unknown-date rows stay hot");
  assert.ok(validateSharpApiCurrentSplitFeed(hot, "cfb"));
  assert.equal(currentSplitEventDate({ event_id: "invalid-20261345" }), null);
  assert.deepEqual(currentSplitReadDates("2026-11-05", ["2026-11-06T01:00:00Z"]), ["2026-11-05", "2026-11-06"]);
  const restored = await hydrateCurrentSplitHistory(hot, undefined, db);
  assert.deepEqual(restored.rows, merged.rows, "unspecific legacy lookbacks restore the exact retained row sequence");
  const historical = await hydrateCurrentSplitHistory(hot, ["2026-10-27"], db);
  assert.deepEqual(historical.rows.filter((r) => currentSplitEventDate(r) === "2026-10-27"), [previous.rows[0]]);
  let queried = false;
  const forbiddenRead = { from: () => { queried = true; throw Error("Current reads must not load cold history"); } } as unknown as typeof db;
  assert.strictEqual(await hydrateCurrentSplitHistory(hot, ["2026-11-07"], forbiddenRead), hot);
  assert.equal(queried, false);

  const missing = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Migration absent" } }) } as unknown as typeof db;
  assert.strictEqual(await prepareArchivedCurrentSplitFeed({ client: missing, previous, current, merged }), merged, "uninstalled migration cannot prune legacy data");
  await assert.rejects(() => prepareArchivedCurrentSplitFeed({ client: missing, previous: hot, current, merged }), /unavailable/);
  const incomplete = { rpc: async () => ({ data: { acknowledged: -1 }, error: null }) } as unknown as typeof db;
  await assert.rejects(() => prepareArchivedCurrentSplitFeed({ client: incomplete, previous, current, merged }), /incomplete/);
  assert.equal(JSON.stringify(previous), previousJson);

  // All future captures are archived BEFORE the legacy 96-row display trim.
  const partials = Array.from({ length: 120 }, (_, i) => ({ ...row("20261027", i + 1), moneyline: { handle_pct: { away: null, home: null }, bets_pct: { away: 53, home: 47 } } }));
  const later = { ...base, rows: partials };
  const legacyLater = __TEST__.mergeCurrentSplitFeeds(merged, later);
  const hotLater = await prepareArchivedCurrentSplitFeed({ client: db, previous: hot, current: later,
    merged: __TEST__.mergeCurrentSplitFeeds(hot, later) });
  assert.deepEqual((await hydrateCurrentSplitHistory(hotLater, undefined, db)).rows, legacyLater.rows, "cold restore retains the same last-complete fallback through >96 partial captures");
  const all = []; for await (const observation of iterateCurrentSplitObservations(db, hotLater)) all.push(observation.payload);
  const hashes = new Set(all.map((r) => createHash("sha256").update(canonicalSplitJson(r)).digest("hex")));
  for (const source of [...previous.rows, ...current.rows, ...partials]) assert(hashes.has(createHash("sha256").update(canonicalSplitJson(source)).digest("hex")), "every original and new observation remains available for research");
  assert(all.length > legacyLater.rows.length, "research retains observations beyond the display-history cap");
  const beforeRetry = all.length;
  await prepareArchivedCurrentSplitFeed({ client: db, previous: hotLater, current: later, merged: hotLater });
  let afterRetry = 0; for await (const saved of iterateCurrentSplitObservations(db, hotLater)) { assert(saved.id > 0); afterRetry++; }
  assert.equal(afterRetry, beforeRetry, "retries append no duplicate or replacement evidence");

  const locked = { date: "2026-10-27", sport: "cfb", games: [{ id: "locked", awayTeam: "Away", homeTeam: "Home", gameStartAt: "2026-10-27T20:00:00Z", lockState: "locked", lockedAt: "2026-10-27T19:00:00Z", markets: { moneyline: { exactLockedEvidence: [1, 2, 3] } } }] };
  const lockedJson = JSON.stringify(locked);
  applySharpApiCurrentSplitOverlay(locked as unknown as Parameters<typeof applySharpApiCurrentSplitOverlay>[0], historical);
  assert.equal(JSON.stringify(locked), lockedJson, "history access cannot reinterpret a locked record");

  if (process.argv[2]) {
    const captured = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const entry = Array.isArray(captured) ? captured.find((r) => r.snapshot_key.includes("::cfb::")) : captured;
    const payload = entry.payload.encoding === "gzip-base64" ? JSON.parse(gunzipSync(Buffer.from(entry.payload.payload, "base64"))) : entry.payload;
    const fixture = validateSharpApiCurrentSplitFeed(payload, "cfb"); assert(fixture);
    const next = { ...fixture, rows: fixture.rows.slice(-5).map((r) => ({ ...r, _offline_archive_parity_test: true })) };
    const expected = __TEST__.mergeCurrentSplitFeeds(fixture, next);
    const prepared = await prepareArchivedCurrentSplitFeed({ client: db, previous: fixture, current: next, merged: expected });
    const hydrated = await hydrateCurrentSplitHistory(prepared, undefined, db);
    // Synthetic scenario uses a distinct event identity; compare only native
    // fixture identities so this shared disposable archive adds no test inputs.
    const events = new Set(fixture.rows.map((r) => r.event_id));
    const actual = hydrated.rows.filter((r) => events.has(r.event_id));
    assert.deepEqual(actual, expected.rows);
    let capturedRows = 0;
    const archiveHashes = new Set<string>();
    for await (const saved of iterateCurrentSplitObservations(db, fixture)) {
      archiveHashes.add(createHash("sha256").update(canonicalSplitJson(saved.payload)).digest("hex")); capturedRows++;
    }
    for (const original of fixture.rows) assert(archiveHashes.has(createHash("sha256").update(canonicalSplitJson(original)).digest("hex")));
    console.log(JSON.stringify({ privateFixtureRows: fixture.rows.length, hotRows: prepared.rows.length,
      retainedLookbackRows: actual.length, archiveRows: capturedRows, exactRetainedRows: true,
      hash: createHash("sha256").update(canonicalSplitJson(actual)).digest("hex") }));
  }
  assert(Math.max(...requestBytes) < 1_000_000);
  assert(splitArchiveBatches(base, [row("20261027", 0), row("20261027", 0)]).flat().length === 1);
  console.log(JSON.stringify({ pass: true, maximumArchiveRequestBytes: Math.max(...requestBytes), checks: "actual RPC acknowledgement, exact history/clock/field preservation, full capture retention, bounded paging, current-date isolation, migration/failure preservation, retry idempotence, unknown dates and locked reader bytes" }));
}
void main();
