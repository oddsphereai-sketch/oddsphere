import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MlbPropsBoardSnapshot } from "./boardSnapshotStore";

export async function loadMlbPropsLivePreviewSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(previewPath(slateDate), "utf8")) as MlbPropsBoardSnapshot;
    return parsed.schemaVersion === 1 && parsed.slateDate === slateDate ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeMlbPropsLivePreviewSnapshot(snapshot: MlbPropsBoardSnapshot): Promise<string> {
  const destination = previewPath(snapshot.slateDate);
  await writeFile(destination, JSON.stringify(snapshot), "utf8");
  return destination;
}

function previewPath(slateDate: string): string {
  return path.join(tmpdir(), `oddsphere-mlb-props-live-preview-${slateDate}.json`);
}
