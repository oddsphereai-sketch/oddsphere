import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pipeline = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
const adapter = readFileSync(
  new URL("../lib/services/nba/adaptNbaToDailyEdgeResponse.ts", import.meta.url),
  "utf8",
);
const dto = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeDto.ts", import.meta.url),
  "utf8",
);

assert.match(
  pipeline,
  /const reader = buildNbaProfessionalMarketReader\([\s\S]*grounding_audit = \{[\s\S]*market_reader: \{ \.\.\.reader/,
  "the internal market reader must be computed inside the prediction pipeline and retained as audit evidence",
);
assert.doesNotMatch(
  adapter,
  /grounding_audit|market_reader|buildNbaProfessionalMarketReader/,
  "the member display adapter must not run or reinterpret internal market-reader decisions",
);
assert.match(
  dto,
  /operator-only audit substrate[\s\S]*Member UI must not render this\.[\s\S]*grounding_audit\?: Record<string, unknown> \| null;/,
  "the DTO contract must keep internal reader evidence operator-only",
);

console.log("NBA internal market-reader and member-display separation tests passed");
