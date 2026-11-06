/** Exact preflight cost profiles for the full market catalog, including request partitions. No generation. */
import { readFileSync, writeFileSync } from "node:fs";
import { planPartitions } from "./partitions";
import { digest, invariant } from "./core";
import type { GamePacket } from "./catalog";
import { AI_REVIEW_BEHAVIOR_RELEASE } from "./probability-proposals";
const arg = (key: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
async function main() {
  const input = arg("manifest"), out = arg("out"); invariant(input && out && out.startsWith("/private/tmp/"), "--manifest=LOCAL_JSON --out=/private/tmp/NEW_FILE required");
  const manifest = JSON.parse(readFileSync(input, "utf8")) as { packets: { sport: string; gameId: string; stage: string; research: string }[] };
  const selected = manifest.packets.filter(p => p.stage === "final"); invariant(selected.length <= 50, "Profile bound exceeded");
  const profiles = [], errors = [];
  for (const row of selected) {
    const packet = JSON.parse(readFileSync(row.research, "utf8")) as GamePacket;
    const unsuitable = packet.players.some(p => p.missing.some(g => /stat cache unavailable at this cutoff|model\/context unavailable at this cutoff/.test(g)));
    for (const model of ["gpt-6-luna", "gpt-6.1-terra"] as const) {
      try {
        const parts = await planPartitions(packet, model, 16000);
        profiles.push({ sport: row.sport, gameId: row.gameId, model, players: packet.players.length,
          scopes: packet.players.reduce((n, p) => n + p.markets.length, 0), suitableForLoadProjection: !unsuitable,
          packetDigest: digest(packet), parts: parts.map(p => ({ inputTokens: p.inputTokens, players: p.packet.players.length, scopes: p.packet.players.reduce((n, player) => n + player.markets.length, 0) })) });
      } catch (error) { errors.push({ sport: row.sport, gameId: row.gameId, model, error: (error as Error).message }); }
    }
  }
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), protocol: AI_REVIEW_BEHAVIOR_RELEASE, generationCalls: 0, source: input,
    conservativeEarlySize: "final-size packets reserved for both logical reviews; missing historical early snapshots never treated as zero workload", profiles, errors, complete: !errors.length }), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ out, profiles: profiles.length, errors: errors.length, generationCalls: 0 }));
}
void main().catch(error => { console.error((error as Error).message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")); process.exitCode = 1; });
