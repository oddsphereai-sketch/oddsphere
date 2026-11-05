import assert from "node:assert/strict";
import {cbbAvailabilityUpperBoundMs,cbbEvidenceProvablyBefore,cbbEvidenceReceiptBounds} from "../lib/cbb/marketReceiptTime";
const before={fetchedAt:"2026-11-02T15:00:00.100Z",canonicalReceipt:{kind:"db_inserted_upper_bound" as const,
 availableBy:"2026-11-02T15:00:00.123001+00:00",providerEventId:"ncaab:A@B-20261102",ingestionRunId:"cbb:2026-11-02:2026-11-02T15:00:00.100Z",
 observationIds:[1,2] as [number,number],rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}};
assert.equal(cbbEvidenceReceiptBounds(before).available,Date.parse("2026-11-02T15:00:00.124Z"));
assert.equal(cbbEvidenceProvablyBefore(before,{fetchedAt:"2026-11-02T15:00:00.123Z"}),false,"truncated microseconds cannot prove availability before the next request");
assert.equal(cbbEvidenceProvablyBefore(before,{fetchedAt:"2026-11-02T15:00:00.124Z"}),true);
assert.equal(cbbAvailabilityUpperBoundMs("2026-11-02T15:00:00.123000Z"),Date.parse("2026-11-02T15:00:00.123Z"));
assert.equal(cbbAvailabilityUpperBoundMs("2026-11-02T10:00:00.123001-05:00"),Date.parse("2026-11-02T15:00:00.124Z"));
assert.ok(Number.isNaN(cbbAvailabilityUpperBoundMs("bad")));
assert.equal(before.canonicalReceipt.availableBy,"2026-11-02T15:00:00.123001+00:00","raw native clock is preserved");
console.log("PASS CBB receipt clocks: sub-millisecond DB availability rounds outward, raw timestamps retained and overlapping windows never prove order.");

const inFlight={requestedAt:"2026-11-02T15:00:00.110Z",fetchedAt:"2026-11-02T15:00:00.200Z"};
assert.equal(cbbEvidenceReceiptBounds(inFlight).earliest,Date.parse(inFlight.requestedAt));
assert.equal(cbbEvidenceReceiptBounds(inFlight).available,Date.parse(inFlight.fetchedAt));
assert.equal(cbbEvidenceProvablyBefore(before,inFlight),false,"flow available during an already-in-flight quote request cannot prove a later response");
assert.equal(cbbEvidenceProvablyBefore(before,{...inFlight,requestedAt:"2026-11-02T15:00:00.125Z"}),true);
assert.ok(Number.isNaN(cbbEvidenceReceiptBounds({...inFlight,requestedAt:"2026-11-02T15:00:00.300Z"}).earliest));
assert.equal(cbbEvidenceReceiptBounds({...inFlight,requestedAt:"bad"}).available,Date.parse(inFlight.fetchedAt),"invalid ordering metadata does not erase an actual quote");
