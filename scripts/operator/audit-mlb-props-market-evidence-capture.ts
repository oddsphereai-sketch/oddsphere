import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY,
  type MlbPropsMarketEvidenceCapture,
} from "../../lib/mlb/props/marketEvidenceCapture";

async function main(): Promise<void> {
  const paths = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  if (!paths.length) throw new Error("Pass one or more decoded MLB props canonical/member snapshot JSON files.");
  const reports = [];
  for (const path of paths) {
    const snapshot = JSON.parse(await readFile(path, "utf8")) as Snapshot;
    const capture = snapshot.marketEvidence;
    if (!capture) throw new Error(`${path} has no MLB props market evidence capture.`);
    if (capture.r !== MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE) {
      throw new Error(`${path} uses unexpected capture release ${capture.r}.`);
    }
    const rows = snapshot.data?.props ?? [];
    const identities = new Set(capture.i.map((identity) => identity[0]));
    const references = rows.flatMap((row) => row.marketEvidenceId ? [row.marketEvidenceId] : []);
    const missingReferences = [...new Set(references.filter((id) => !identities.has(id)))];
    const currentBytes = Buffer.byteLength(JSON.stringify(snapshot));
    const baselineBytes = Buffer.byteLength(JSON.stringify(stripAuditMetadata(snapshot)));
    const addedBytes = currentBytes - baselineBytes;
    const hardCapBytes = capture.tb <= capture.hm ? capture.hm : capture.hb;
    const maximumBooksOnIdentity = Math.max(0, ...capture.i.map((identity) => identity[2].length));
    reports.push({
      path,
      release: capture.r,
      schema: capture.s,
      currentBytes,
      baselineBytes,
      addedBytes,
      targetBytes: capture.tb,
      hardCapBytes,
      withinTarget: addedBytes <= capture.tb,
      withinHardCap: addedBytes < hardCapBytes,
      observedIdentities: capture.n,
      retainedIdentities: capture.k,
      omittedIdentities: capture.o,
      categoryRetention: capture.c,
      maximumBooksOnIdentity,
      sourceClasses: count(capture.i.flatMap((identity) => identity[2].map((book) => book[2]))),
      comparatorReasons: count(capture.i.map((identity) => identity[3][8])),
      openingReasons: count(capture.i.map((identity) => identity[3][10])),
      splitReasons: count(capture.i.map((identity) => identity[3][12])),
      splitState: capture.sp,
      referencedRows: references.length,
      missingReferences,
      decisionValueSha256: createHash("sha256")
        .update(JSON.stringify(stripAuditMetadata(snapshot)))
        .digest("hex"),
    });
    if (addedBytes >= hardCapBytes) throw new Error(`${path} exceeds the MLB props evidence hard cap.`);
    if (maximumBooksOnIdentity > MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY) {
      throw new Error(`${path} exceeds the MLB props evidence book cap.`);
    }
    if (missingReferences.length) throw new Error(`${path} contains unresolved evidence references.`);
  }
  console.log(JSON.stringify(reports, null, 2));
}

type Snapshot = {
  marketEvidence?: MlbPropsMarketEvidenceCapture;
  data?: { props?: Array<{ marketEvidenceId?: string }> };
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
