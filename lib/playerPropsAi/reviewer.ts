import { gzipSync } from "node:zlib";
import type { GamePacket } from "./evidenceContract";
import { digest, invariant, instant } from "./evidence";
import { PropsAiStore, usageMicroUsd, type PropsAiJob } from "./budget";
import { jointReviewRequest, parseJointReview } from "./request";
import { countAiInput, generateAiReview, structuredAiText } from "./openai";
import { prepareReviewParts } from "./partitions";
import { PROPS_AI_MAX_OUTPUT_PER_REQUEST, PROPS_AI_PRIMARY_MODEL, PROPS_AI_STRONG_MODEL, PROPS_AI_RELEASE } from "./releases";

export type AcceptedGameReview = { release: typeof PROPS_AI_RELEASE; gameId: string; start: string; lock: string; cutoff: string;
  model: string; stage: "early" | "final"; issuedAt?: string; inputHash?: string; players: ReturnType<typeof parseJointReview>["players"];
  inputEvidence: { encoding: "gzip-base64"; digest: string; bytes: number; data: string } };
export async function runPropsReview(args: { packet: GamePacket; job: PropsAiJob; store: PropsAiStore; key: string;
  preferStronger: boolean; fetchImpl?: typeof fetch; clock?: () => string; deadline?: number }) {
  const clock = args.clock ?? (() => new Date().toISOString()), started = Date.now(), deadline = args.deadline ?? started + 250000;
  invariant(args.job.game_id === args.packet.gameId && instant(args.job.scheduled_start) === instant(args.packet.start) && args.job.stage === args.packet.stage, "job_input_identity_mismatch");
  invariant(instant(clock()) < instant(args.packet.lock) && instant(args.packet.cutoff) <= instant(clock()), "input_outside_actual_review_window");
  const parts = await prepareReviewParts(args.packet, { key: args.key, fetchImpl: args.fetchImpl });
  const requests = await Promise.all(parts.map(async part=>({input_tokens:part.inputTokens,max_output_tokens:PROPS_AI_MAX_OUTPUT_PER_REQUEST,
    strong_input_tokens:args.preferStronger ? await countAiInput(jointReviewRequest(part.packet,PROPS_AI_STRONG_MODEL,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:args.key,fetchImpl:args.fetchImpl}).catch(()=>null) : null})));
  const inputHash = digest(args.packet), claimed = await args.store.claim(args.job.job_key, inputHash, requests, args.preferStronger);
  if (!claimed.claimed) return { status: "skipped", reason: claimed.reason };
  const job = claimed.job!, token = claimed.token!, model = job.model ?? PROPS_AI_PRIMARY_MODEL;
  let phase = 1, failure = "unknown_review_failure";
  try {
    while (phase <= 2) {
      const parsed = [], errors: string[] = [];
      // At most four whole-player parts, all financially reserved together. No other source is fetched inside a frozen review.
      const results = await Promise.allSettled(parts.map(async (part, index) => {
        const body = jointReviewRequest(part.packet, model, PROPS_AI_MAX_OUTPUT_PER_REQUEST);
        if (phase === 2) body.instructions += `\nThe prior response failed this process check: ${failure.slice(0, 160)}. Correct the structured output using the SAME supplied facts; no new review window or invented evidence.`;
        const timeoutMs = Math.floor(Math.min(180000, deadline - Date.now() - 10000, instant(args.packet.lock) - instant(clock()) - 10000));
        invariant(timeoutMs > 1000, "review_completion_window_exhausted");
        const attempt = await args.store.send(job.job_key, token, phase, index + 1);
        let response;
        try { response = await generateAiReview(body, { key: args.key, timeoutMs, fetchImpl: args.fetchImpl,
          onCreated: async id => { await args.store.receipt(attempt.id, token, null, id, null); } }); }
        catch (error) { await args.store.receipt(attempt.id, token, null, null, null); throw error; }
        if (!response.usage) { await args.store.receipt(attempt.id, token, null, response.id, null); throw new Error("missing_billed_usage"); }
        const actual = usageMicroUsd(model, response.usage);
        await args.store.receipt(attempt.id, token, actual, response.id, response.usage);
        return parseJointReview(part.packet, structuredAiText(response));
      }));
      for (const result of results) if (result.status === "fulfilled") parsed.push(...result.value.players); else errors.push((result.reason as Error).message);
      if (!errors.length) {
        invariant(digest(parsed.map(p => p.playerId).sort()) === digest(args.packet.players.map(p => p.id).sort()), "accepted_review_coverage_mismatch");
        invariant(instant(clock()) < instant(args.packet.lock), "review_completed_after_lock");
        const input = Buffer.from(JSON.stringify(args.packet)), compressed = gzipSync(input);
        invariant(input.byteLength <= 16_000_000 && compressed.byteLength <= 2_000_000, "oversize_immutable_input_evidence");
        const review: AcceptedGameReview = { release: PROPS_AI_RELEASE, gameId: args.packet.gameId, start: args.packet.start, lock: args.packet.lock, cutoff: args.packet.cutoff,
          model, stage: args.packet.stage, players: parsed, inputEvidence: { encoding: "gzip-base64", digest: inputHash, bytes: input.byteLength, data: compressed.toString("base64") } };
        const completed = await args.store.finish(job.job_key, token, review, null);
        return { status: completed.state, review: completed.state === "completed" ? completed.result as AcceptedGameReview : null };
      }
      failure = errors[0];
      if (phase === 1 && deadline - Date.now() > 130000 && await args.store.repair(job.job_key, token)) { phase = 2; continue; }
      break;
    }
  } catch (error) { failure = (error as Error).message; }
  const failed = await args.store.finish(job.job_key, token, null, failure.replace(/sk-[\w-]+/g, "redacted").slice(0, 200));
  return { status: failed.state, reason: failed.error_code };
}
