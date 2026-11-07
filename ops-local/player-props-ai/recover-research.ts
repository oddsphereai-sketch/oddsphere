/** Recover raw hypotheses from an immutable receipt; NEVER accept a failed review. No API calls. */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { digest, invariant, parseRequiredReview, validateReview } from "./core";
import { expandReadableCitations } from "./readable";
import { probabilityProposals } from "./probability-proposals";
import type { GamePacket } from "./catalog";
const [receiptFile, packetFile, out] = process.argv.slice(2);
invariant(out?.startsWith("/private/tmp/"), "NEW private research output required");
const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
const archived = JSON.parse(readFileSync(receiptFile.replace(/\.json$/, ".request.json"), "utf8"));
const input = JSON.parse(archived.body.input), packet = JSON.parse(readFileSync(packetFile, "utf8")) as GamePacket;
invariant(input.rawPacketDigest === digest(packet) && receipt.response.status === "completed", "Original packet/complete receipt required");
const text = receipt.response.output.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []).filter((c: { type: string }) => c.type === "output_text");
invariant(text.length === 1, "One structured result required");
const review = validateReview(packet, expandReadableCitations(packet, parseRequiredReview(JSON.parse(text[0].text), packet)));
// Conservative original receipt-write time, not replay time or a backdated scheduled slot.
const issuedAt = statSync(receiptFile).mtime.toISOString();
writeFileSync(out, JSON.stringify({ issuedAt, recoveredAt: new Date().toISOString(), sourceReceipt: receiptFile,
  sourceDigest: digest(receipt), qualityGate: "failed; retained only to avoid dropping failed games from raw-hypothesis scoring",
  timestampLimitation: "local receipt filesystem time; not a production locked public record",
  proposals: probabilityProposals(packet, review, archived.body.model, issuedAt) }), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ out, players: review.players.length, acceptedReview: false, apiCalls: 0 }));
