// Persistence and runtime attestation intentionally live in the evaluator
// module so its private brand cannot be minted from caller-owned receipt data.
export {
  persistNflMarketBrainResearchManifest,
  readNflMarketBrainResearchManifest,
} from "./nflMarketBrainResearchEvaluator";
