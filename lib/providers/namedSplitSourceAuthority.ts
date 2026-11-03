import type { MarketSplitDisplaySection } from "../types/domain/RecommendationDecision";

export const NAMED_SPLIT_SOURCE_AUTHORITY_RELEASE = "named_split_source_authority_2026_11_03_r1_explicit_book_class";

/** The compatibility display slot is named sportsbookSplits/sharpBookSplits,
 * but a complete retail pair does not establish professional-book coverage.
 * Labels are presentation, never evidence of source identity. */
export function professionalSplitSource(section: MarketSplitDisplaySection | null | undefined): boolean {
  return section?.sourceBook === "circa";
}

export function namedSplitSourceLabel(section: MarketSplitDisplaySection): string {
  if (professionalSplitSource(section)) return "Sharp book splits";
  if (section.sourceBook === "draftkings" || section.sourceBook === "draftkings_network") return "DraftKings splits";
  if (section.sourceBook === "betmgm") return "BetMGM splits";
  if (section.sourceBook === "consensus") return "Consensus splits";
  return "Unclassified sportsbook splits";
}
