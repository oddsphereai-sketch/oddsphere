import { gzipSync, gunzipSync } from "node:zlib";
import type { CfbMemberFixture } from "./cfbMemberFixture";
import { CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES } from "./cfbForwardMemberSnapshotStore";

/** Cache transport only. Keep every stored reader/lock field byte-for-byte
 * equivalent as JSON while fitting Next's 2 MB data-cache entry limit. */
export function encodeCfbMemberFixtureCache(fixture: CfbMemberFixture | null): string {
  return gzipSync(JSON.stringify(fixture)).toString("base64");
}

export function decodeCfbMemberFixtureCache(encoded: string): CfbMemberFixture | null {
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64"), {
    maxOutputLength: CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES,
  }).toString("utf8")) as CfbMemberFixture | null;
}
