import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FootballPreviewFixture } from "@/app/dev/football-preview/footballPreviewFixture";

export const NFL_MEMBER_SNAPSHOT_RELEASE =
  "nfl_daily_edge_local_member_snapshot_2026_08_20_r3" as const;

export type NflMemberSnapshot = FootballPreviewFixture & {
  memberSnapshotRelease: typeof NFL_MEMBER_SNAPSHOT_RELEASE;
  storedAt: string;
};

export type NflMemberSnapshotPointer = {
  memberSnapshotRelease: typeof NFL_MEMBER_SNAPSHOT_RELEASE;
  filename: string;
  sha256: string;
  seasonPhase: "preseason" | "regular";
  week: number;
  storedAt: string;
};

export type CurrentNflMemberSnapshot = {
  pointer: NflMemberSnapshotPointer;
  snapshot: NflMemberSnapshot;
};

export async function readCurrentNflMemberSnapshotWithPointer(): Promise<CurrentNflMemberSnapshot> {
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const pointer = JSON.parse(await readFile(path.join(root, "nfl_daily_edge.current.json"), "utf8")) as NflMemberSnapshotPointer;
  if (
    pointer.memberSnapshotRelease !== NFL_MEMBER_SNAPSHOT_RELEASE ||
    typeof pointer.filename !== "string" ||
    typeof pointer.sha256 !== "string"
  ) {
    throw new Error("Invalid current NFL Daily Edge snapshot pointer.");
  }
  const bytes = await readFile(path.join(root, pointer.filename));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== pointer.sha256) throw new Error("Current NFL Daily Edge snapshot checksum mismatch.");
  const snapshot = JSON.parse(bytes.toString("utf8")) as NflMemberSnapshot;
  if (
    snapshot.memberSnapshotRelease !== NFL_MEMBER_SNAPSHOT_RELEASE ||
    snapshot.tracking.seasonPhase !== pointer.seasonPhase ||
    snapshot.week.week !== pointer.week ||
    snapshot.snapshot.sport !== "nfl" ||
    snapshot.snapshot.games.length === 0 ||
    snapshot.snapshot.games.length * 3 !== snapshot.snapshot.games.flatMap((game) => [
      game.markets.moneyline,
      game.markets.total,
      game.markets.first_inning,
    ]).length
  ) {
    throw new Error("Current NFL Daily Edge snapshot contract mismatch.");
  }
  return { pointer, snapshot };
}

export async function readCurrentNflMemberSnapshot(): Promise<NflMemberSnapshot> {
  return (await readCurrentNflMemberSnapshotWithPointer()).snapshot;
}
