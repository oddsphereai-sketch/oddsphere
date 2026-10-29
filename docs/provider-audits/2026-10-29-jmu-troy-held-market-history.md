# JMU–Troy held spread history

Starting production base: `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`.

The published CFB snapshot contains a JMU -18.5 context forecast at 55.665%,
an empty exact-price actionable pick, and No Play because fewer than two
other named books corroborate an identical line. Its real public BetMGM
history terminates at JMU -19 / -110. The model probability at -18.5 is not
a probability or offer at -19. The two-other-books gate is grading policy,
not an API quota; this change does not relax or qualify that policy.

The prediction-market integration incorrectly required the actionable pick
to identify a spread/total contract. The UI skipped its request despite real
book history and an exactly matched dated Kalshi event. North Texas passed
because its actionable pick was populated. One unlocked CFB spread with real
book history was affected in the read-only audit.

## Repair

- Keep the legacy selection function intact. For history only, a validated
  available published forecast may supply explicitly named side/direction
  when the actionable pick is empty. Never infer a side from scores or odds.
- Use the actual displayed sportsbook threshold, not the forecast's different
  context threshold. Retain exact/push-adjusted/nearby Kalshi semantics.
- Use the same display-only identity for public book enrichment, contract
  retention, and existing bounded history priority/pre-lock capture. No new
  collector, cadence, request ceiling, provider or model writer is introduced.
- Legacy frozen readers remain unavailable when their old selection was
  absent. Only an actual eligible pre-lock receipt may enable the repaired
  display for a future lock. Exact stored bookmaker quotes have precedence;
  missing stored evidence, unknown boundaries and post-lock receipts fail closed.

No prediction, probability, score, pick, grade, stake, model release, source
field, member payload, stored locked record, tracking record or model input
is changed. This does not claim that the CFB two-other-books policy is optimal
or that a move from a context -18.5 to an offered -19 improves a new bet's EV.

## Acceptance

Held-history regression, all existing prediction-market suites, shared reader
checks, CFB production tests, full model-change safety suite, TypeScript,
focused ESLint, production build, clean committed latest-main integration
proof, open-PR overlap/protection checks, and actual desktop/mobile live JMU
history verification. Preserve the stored locked-game checksum sentinel.
