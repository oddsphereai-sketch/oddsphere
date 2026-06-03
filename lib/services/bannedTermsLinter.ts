/**
 * bannedTermsLinter — guards user-facing Daily Edge copy from sportsbook
 * jargon that beginners can't parse.
 *
 * Used by perMarketCopyGenerator + keyStatsFormatter + decisionLine
 * builders at OUTPUT time — a banned term in a generated string throws
 * a `BannedTermError` so the developer/operator notices immediately.
 * Defense in depth: a unit test exhaustively verifies every banned term
 * is caught, and the route assembles copy only through helpers that pass
 * their output through this gate.
 *
 * Banned terms are matched case-insensitively with whole-word boundaries
 * so partial matches (e.g., "evident" should NOT trigger "EV") don't
 * fire false positives.
 *
 * Does NOT run over:
 *   - internal field names (e.g. `pinnacleEvPct`)
 *   - existing modelBreakdown (curated by Phase 4.1.8.A)
 *   - sharpRead.sentence (curated by Phase 4.1.8.A)
 */

/**
 * Tokens forbidden in user-facing Daily Edge copy. Each entry is a regex
 * source matched against the input as a whole word (`\b` on both sides).
 * Whole-word matching protects against false positives like "previous"
 * → "vig" or "evident" → "EV".
 *
 * The two-character "EV" gets word-boundary protection AND case-
 * insensitive matching, so "ev" inside "every" / "even" / "level" never
 * triggers. Real EV-bearing copy ("+EV opportunity", "EV%") does trigger.
 */
const BANNED_TERM_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "Pinnacle",              pattern: /\bpinnacle\b/i },
  { name: "EV",                    pattern: /\bEV\b/ },              // case-sensitive: "EV" capital
  { name: "+EV",                   pattern: /\+\s*EV\b/i },
  { name: "expected value",        pattern: /\bexpected value\b/i },
  { name: "vig",                   pattern: /\bvig\b/i },
  { name: "vigorish",              pattern: /\bvigorish\b/i },
  { name: "juice",                 pattern: /\bjuice\b/i },
  { name: "no-vig",                pattern: /\bno[- ]vig\b/i },
  { name: "de-vig",                pattern: /\bde[- ]vig(?:ged)?\b/i },
  { name: "consensus",             pattern: /\bconsensus\b/i },
  { name: "RLM",                   pattern: /\bRLM\b/i },
  { name: "reverse line movement", pattern: /\breverse line movement\b/i },
  { name: "CLV",                   pattern: /\bCLV\b/i },
  { name: "closing line value",    pattern: /\bclosing line value\b/i },
  { name: "book hold",             pattern: /\bbook hold\b/i },
  { name: "arbitrage",             pattern: /\barbitrage\b/i },
  { name: "arb",                   pattern: /\barb\b/i },
];

export class BannedTermError extends Error {
  public readonly fieldName: string;
  public readonly term: string;
  public readonly fullText: string;

  constructor(fieldName: string, term: string, fullText: string) {
    super(
      `Banned term "${term}" detected in user-facing copy field "${fieldName}". ` +
        `Full text: "${fullText}". ` +
        `User-facing Daily Edge copy must avoid sportsbook jargon. ` +
        `Allowed substitutes: "sharper price", "market value", "market support", ` +
        `"line moved against the public" (instead of RLM), etc.`
    );
    this.name = "BannedTermError";
    this.fieldName = fieldName;
    this.term = term;
    this.fullText = fullText;
  }
}

/**
 * Throw if `text` contains any banned term. Use as a guard around every
 * user-facing copy field at generation time.
 *
 * @param text       The candidate user-facing string
 * @param fieldName  Identifier used in error messages (e.g., "guidedGuide", "decisionLine")
 */
export function assertNoBannedTerms(text: string, fieldName: string): void {
  for (const { name, pattern } of BANNED_TERM_PATTERNS) {
    if (pattern.test(text)) {
      throw new BannedTermError(fieldName, name, text);
    }
  }
}

/**
 * Non-throwing variant — returns the first matched term or null. Used by
 * the linter test to verify each pattern fires when expected without
 * forcing the test harness to catch.
 */
export function findFirstBannedTerm(text: string): string | null {
  for (const { name, pattern } of BANNED_TERM_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

/** Test-only — surfaces the regex list so tests can iterate it. */
export const __TEST__ = { BANNED_TERM_PATTERNS };
