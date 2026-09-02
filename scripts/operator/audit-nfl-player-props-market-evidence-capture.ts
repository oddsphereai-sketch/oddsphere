import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
  type NflPlayerPropsMarketEvidenceCapture,
} from "../../lib/services/football/nflPlayerPropsMarketEvidenceCapture";

async function main(): Promise<void> {
  const paths = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  if (paths.length === 0) throw new Error("Pass one or more persisted NFL props snapshot JSON files.");
  const reports = [];
  for (const path of paths) {
    const snapshot = JSON.parse(await readFile(path, "utf8")) as Snapshot;
    const capture = snapshot.board?.marketEvidence;
    if (!capture) throw new Error(`${path} has no NFL props market evidence capture.`);
    if (capture.r !== NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE) {
      throw new Error(`${path} uses unexpected capture release ${capture.r}.`);
    }
    const decisions = snapshot.board?.decisions ?? snapshot.memberDecisions ?? [];
    const ids = new Set(capture.i.map((identity) => identity[0]));
    const referenced = decisions.flatMap((decision) => decision.marketEvidenceId ? [decision.marketEvidenceId] : []);
    const missingReferences = [...new Set(referenced.filter((id) => !ids.has(id)))];
    const currentBytes = Buffer.byteLength(JSON.stringify(snapshot));
    const baselineBytes = Buffer.byteLength(JSON.stringify(stripAuditMetadata(snapshot)));
    const addedBytes = currentBytes - baselineBytes;
    reports.push({
      path,
      release: capture.r,
      schema: capture.s,
      currentBytes,
      baselineBytes,
      addedBytes,
      hardCapBytes: NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
      withinHardCap: addedBytes <= NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
      observedIdentities: capture.n,
      retainedIdentities: capture.k,
      omittedIdentities: capture.o,
      categoryRetention: capture.c,
      maximumBooksOnIdentity: Math.max(0, ...capture.i.map((identity) => identity[2].length)),
      sourceClasses: count(capture.i.flatMap((identity) => identity[2].map((book) => book[2]))),
      breadthReasons: count(capture.i.flatMap((identity) => identity[3].slice(7))),
      evaluatedSideMasks: count(capture.i.flatMap((identity) => identity[2].map((book) => String(book[14])))),
      referencedDecisions: referenced.length,
      missingReferences,
      decisionValueSha256: createHash("sha256")
        .update(JSON.stringify(stripAuditMetadata(snapshot)))
        .digest("hex"),
    });
    if (addedBytes > NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES) {
      throw new Error(`${path} exceeds the NFL props evidence added-byte cap.`);
    }
    if (missingReferences.length) throw new Error(`${path} contains unresolved evidence references.`);
  }
  console.log(JSON.stringify(reports, null, 2));
}

type Snapshot = {
  board?: {
    marketEvidence?: NflPlayerPropsMarketEvidenceCapture;
    decisions?: Array<{ marketEvidenceId?: string }>;
  };
  memberDecisions?: Array<{ marketEvidenceId?: string }>;
};

function stripAuditMetadata<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripAuditMetadata) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    key === "marketEvidence" || key === "marketEvidenceId"
      ? []
      : [[key, stripAuditMetadata(item)]])) as T;
}

function count(values: readonly unknown[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([first], [second]) => first.localeCompare(second)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
