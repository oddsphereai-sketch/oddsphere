import type { NflPlayerPropsMemberSnapshot } from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE =
  "nfl_player_props_member_transport_2026_09_17_r1_gzip" as const;

export const NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_JSON_BYTES = 16_000_000;
export const NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES = 2_000_000;
const MAX_BASE64_CHARACTERS = 4 * Math.ceil(NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES / 3);

export type NflPlayerPropsMemberTransport = {
  kind: "nfl_player_props_member_transport_v1";
  release: typeof NFL_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  compressedBytes: number;
  uncompressedBytes: number;
  payload: string;
};

export async function decodeNflPlayerPropsMemberTransport(
  value: NflPlayerPropsMemberTransport,
): Promise<NflPlayerPropsMemberSnapshot> {
  if (!isNflPlayerPropsMemberTransport(value)) {
    throw new Error("NFL player props member transport is invalid.");
  }
  const compressed = decodeBase64(value.payload);
  if (compressed.byteLength !== value.compressedBytes) {
    throw new Error("NFL player props member transport compressed length does not match.");
  }
  const decompressed = await decompressGzip(compressed);
  if (decompressed.byteLength !== value.uncompressedBytes) {
    throw new Error("NFL player props member transport decoded length does not match.");
  }
  if (await sha256(decompressed) !== value.checksum) {
    throw new Error("NFL player props member transport checksum does not match.");
  }
  const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as unknown;
  if (!isNflPlayerPropsMemberSnapshot(parsed)) {
    throw new Error("NFL player props member transport payload is invalid.");
  }
  return parsed;
}

export function isNflPlayerPropsMemberTransport(value: unknown): value is NflPlayerPropsMemberTransport {
  if (!isRecord(value)) return false;
  return value.kind === "nfl_player_props_member_transport_v1"
    && value.release === NFL_PLAYER_PROPS_MEMBER_TRANSPORT_RELEASE
    && value.encoding === "gzip-base64"
    && typeof value.checksum === "string"
    && /^[a-f0-9]{64}$/.test(value.checksum)
    && Number.isInteger(value.compressedBytes)
    && Number(value.compressedBytes) >= 0
    && Number(value.compressedBytes) <= NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_GZIP_BYTES
    && Number.isInteger(value.uncompressedBytes)
    && Number(value.uncompressedBytes) >= 0
    && Number(value.uncompressedBytes) <= NFL_PLAYER_PROPS_MEMBER_TRANSPORT_MAX_JSON_BYTES
    && typeof value.payload === "string"
    && value.payload.length <= MAX_BASE64_CHARACTERS
    && value.payload.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value.payload);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decompressGzip(value: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decode the NFL player props board.");
  }
  const source = new Blob([toArrayBuffer(value)]).stream();
  const decoded = source.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(decoded).arrayBuffer());
}

async function sha256(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify the NFL player props board.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function isNflPlayerPropsMemberSnapshot(value: unknown): value is NflPlayerPropsMemberSnapshot {
  if (!isRecord(value) || !isRecord(value.board)) return false;
  return typeof value.lifecycleRelease === "string"
    && Number.isInteger(value.season)
    && Number.isInteger(value.week)
    && typeof value.generatedAt === "string"
    && typeof value.board.evaluatedAt === "string"
    && isRecord(value.board.counts)
    && isRecord(value.board.diagnostics)
    && Array.isArray(value.memberDecisions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
