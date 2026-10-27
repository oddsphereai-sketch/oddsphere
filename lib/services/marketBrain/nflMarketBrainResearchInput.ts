import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MARKET_BRAIN_CANONICAL_JSON_RELEASE,
  marketBrainCanonicalJson,
  marketBrainSha256,
} from "./marketBrainCanonical";
import {
  assertNflMarketBrainAttestedCaptureSet,
  nflMarketBrainCaptureSetSourceCaptures,
  type NflMarketBrainAttestedCaptureSet,
} from "./nflMarketBrainCaptureSet";
import {
  buildNflMarketBrainResolverFeatures,
  type NflMarketBrainResolverFeatures,
} from "./nflMarketBrainResolverFeatures";
import {
  assertNflMarketBrainSequence,
  materializeNflMarketBrainSequence,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE =
  "nfl_market_brain_research_input_2026_10_27_r9_expected_feed_roster" as const;

export type NflMarketBrainResearchInput = {
  release: typeof NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE;
  eventId: string;
  cutoffAt: string;
  startsAt: string;
  captureSetRecordId: string;
  captureSetChecksum: string;
  manifestChecksum: string;
  sequence: NflMarketBrainSequence;
  features: NflMarketBrainResolverFeatures;
  sequenceChecksum: string;
  featureChecksum: string;
  checksum: string;
};

export type NflMarketBrainAttestedResearchInput = NflMarketBrainResearchInput & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    researchInputChecksum: string;
  };
};

const attestedResearchInputs = new WeakSet<object>();

type StoredResearchInputRow = {
  id: string;
  research_input_checksum: string;
  research_input: unknown;
  research_input_payload: string;
  created_at: string;
};

export async function materializeAndPersistNflMarketBrainResearchInput(args: {
  client: SupabaseClient;
  captureSet: NflMarketBrainAttestedCaptureSet;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchInput> {
  assertNflMarketBrainAttestedCaptureSet(args.captureSet);
  const storedCaptures = nflMarketBrainCaptureSetSourceCaptures(args.captureSet);
  const cases = storedCaptures.flatMap((row) => "case" in row.captureResult ? [row.captureResult.case] : []);
  if (cases.length === 0) {
    throw new Error("NFL Market Brain research input cannot materialize a capture set with no successful tape.");
  }
  const sequence = materializeNflMarketBrainSequence({ cases, cutoffAt: args.captureSet.cutoffAt });
  if (sequence.eventId !== args.captureSet.eventId || sequence.startsAt !== args.captureSet.startsAt ||
    Date.parse(sequence.captureWindow.firstCapturedAt) < Date.parse(args.captureSet.captureWindowOpensAt) ||
    Date.parse(sequence.captureWindow.lastCapturedAt) > Date.parse(args.captureSet.captureWindowClosesAt)) {
    throw new Error("NFL Market Brain materialized sequence diverges from its finalized capture set.");
  }
  const features = buildNflMarketBrainResolverFeatures(sequence);
  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE,
    eventId: sequence.eventId,
    cutoffAt: sequence.cutoffAt,
    startsAt: sequence.startsAt,
    captureSetRecordId: args.captureSet.persistenceAttestation.recordId,
    captureSetChecksum: args.captureSet.checksum,
    manifestChecksum: args.captureSet.manifestChecksum,
    sequence,
    features,
    sequenceChecksum: sequence.checksum,
    featureChecksum: features.checksum,
  };
  const researchInput: NflMarketBrainResearchInput = {
    ...withoutChecksum,
    checksum: marketBrainSha256(withoutChecksum),
  };
  let query = args.client.from("nfl_market_brain_research_inputs").insert({
    canonical_release: MARKET_BRAIN_CANONICAL_JSON_RELEASE,
    research_input_checksum: researchInput.checksum,
    research_input_release: researchInput.release,
    event_id: researchInput.eventId,
    cutoff_at: researchInput.cutoffAt,
    starts_at: researchInput.startsAt,
    manifest_checksum: researchInput.manifestChecksum,
    capture_set_id: researchInput.captureSetRecordId,
    capture_set_checksum: researchInput.captureSetChecksum,
    sequence_checksum: researchInput.sequenceChecksum,
    feature_checksum: researchInput.featureChecksum,
    research_input: researchInput,
    research_input_payload: marketBrainCanonicalJson(withoutChecksum),
  }).select("id,research_input_checksum,research_input,research_input_payload,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research-input persistence failed: ${error.message}`);
  return attestResearchInput(data as StoredResearchInputRow | null, researchInput);
}

export async function readNflMarketBrainResearchInput(args: {
  client: SupabaseClient;
  checksum: string;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchInput> {
  let query = args.client.from("nfl_market_brain_research_inputs")
    .select("id,research_input_checksum,research_input,research_input_payload,created_at")
    .eq("research_input_checksum", args.checksum);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research-input read failed: ${error.message}`);
  return attestResearchInput(data as StoredResearchInputRow | null);
}

export function assertNflMarketBrainAttestedResearchInput(
  input: NflMarketBrainResearchInput,
): asserts input is NflMarketBrainAttestedResearchInput {
  const attested = input as NflMarketBrainAttestedResearchInput;
  const { checksum, persistenceAttestation: _receipt, ...payload } = attested;
  assertNflMarketBrainSequence(input.sequence);
  if (!attestedResearchInputs.has(input) || !attested.persistenceAttestation ||
    input.release !== NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE || checksum !== marketBrainSha256(payload) ||
    input.sequenceChecksum !== input.sequence.checksum || input.featureChecksum !== input.features.checksum ||
    input.eventId !== input.sequence.eventId || input.cutoffAt !== input.sequence.cutoffAt ||
    marketBrainCanonicalJson(buildNflMarketBrainResolverFeatures(input.sequence)) !==
      marketBrainCanonicalJson(input.features) ||
    attested.persistenceAttestation.researchInputChecksum !== checksum ||
    Date.parse(attested.persistenceAttestation.serverCreatedAt) >= Date.parse(input.startsAt)) {
    throw new Error("NFL Market Brain inference requires an append-only, capture-bound research input.");
  }
}

function attestResearchInput(
  row: StoredResearchInputRow | null,
  expected?: NflMarketBrainResearchInput,
): NflMarketBrainAttestedResearchInput {
  if (!row || typeof row.research_input !== "object" || row.research_input === null) {
    throw new Error("NFL Market Brain research-input persistence returned no verifiable row.");
  }
  const stored = row.research_input as NflMarketBrainResearchInput;
  const { checksum, ...payload } = stored;
  if (checksum !== row.research_input_checksum || checksum !== marketBrainSha256(payload) ||
    row.research_input_payload !== marketBrainCanonicalJson(payload) ||
    expected && marketBrainCanonicalJson(expected) !== marketBrainCanonicalJson(stored)) {
    throw new Error("NFL Market Brain stored research input differs from its canonical materialization.");
  }
  const attested = {
    ...structuredClone(stored),
    persistenceAttestation: {
      recordId: row.id,
      serverCreatedAt: new Date(row.created_at).toISOString(),
      researchInputChecksum: row.research_input_checksum,
    },
  } as NflMarketBrainAttestedResearchInput;
  attestedResearchInputs.add(attested);
  Object.freeze(attested);
  assertNflMarketBrainAttestedResearchInput(attested);
  return attested;
}
