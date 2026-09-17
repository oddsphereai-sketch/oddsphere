import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { NflPlayerPropsMemberSnapshot } from "./nflPlayerPropsProductionContract";
import {
  NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES,
  NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_JSON_BYTES,
  NFL_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE,
  type NflPlayerPropsMemberTransport,
} from "./nflPlayerPropsMemberTransport";

export function encodeNflPlayerPropsMemberTransport(
  snapshot: NflPlayerPropsMemberSnapshot,
): NflPlayerPropsMemberTransport {
  const json = JSON.stringify(snapshot);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_JSON_BYTES) {
    throw new Error(`NFL player props member transport exceeds the ${NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_JSON_BYTES}-byte JSON limit.`);
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES) {
    throw new Error(`NFL player props member transport exceeds the ${NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES}-byte gzip limit.`);
  }
  return {
    kind: "nfl_player_props_member_transport_v1",
    release: NFL_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    compressedBytes: compressed.byteLength,
    uncompressedBytes,
    payload: compressed.toString("base64"),
  };
}
