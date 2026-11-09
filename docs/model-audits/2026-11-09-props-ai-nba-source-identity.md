# Exact NBA offered identity and independent event evidence

Started from exact main `829398d77c4fea3273d25c6363eb1c8769d9e8ed` in a new
isolated task worktree. A normal final review was blocked before claim because
an offered actor had no native head and the first retained observation's team
was missing. Another retained feed supplied the exact same canonical actor and
game with a valid provider team ID. Choosing only the first observation discarded
that supplied identity evidence. The final stayed pending, not completed.

The adapter now considers all available exact-actor/game team declarations,
including an available native team/opponent. Missing fields are not contradictions;
conflicting known teams are not resolved by order or majority. Unknown and
wrong-game team identities still fail the existing live guard. Native snapshot
and row clocks, provider response/native observation/collection clocks and live
status are checked. A fallback archive clock does not prove reconfirmation.
No current roster membership or historical team is substituted for a source
membership declaration. Provider team IDs use the existing team-ID dictionary.

A second exact archived-input audit found that the native selected-side probability
was labelled with the final market-arbitrated side, while the frozen native model
computes it for its separate `independentSide`. The existing source schema faithfully
repeated that incorrect label. The fresh writer now preserves the native reference
side and the adapter binds that exact side to the stored independent probability.
For example, an independent Over at80% stays Over at80% even when the final native
pick is Under. Preferred direction still compares the actual probabilities.
Missing legacy reference sides remain unknown, with the original probability
explicitly labelled untyped; no side is reconstructed or old locked field changed.
Existing archived reviews remain exact evidence of the old inputs, not corrected
retroactively. Both forward fixes belong to generationR27/sourceR1/writerR14.

The actor and every market remain present, including absence of an independent
head and missing statistics/context. No model head or projection is fabricated.
The positive synthetic source previously failed as a whole game; it now retains
the offered actor, market and both providers through the actual cached adapter
and live packet. Paired missing/conflicting/future/live/wrong-game controls retain
refusal. This is input admission recovery, not an actionable grade or performance
claim; no extra model response was purchased to infer a grade impact. Private
saved-input actor/scope and source-identity impacts are audited separately.

Generation R27, NBA source R1 and sole NBA writer R14 identify the forward change.
Selection R4, NFL R88/decision R11/member R59/lifecycle R41, wire R4/reader R13,
Standard wallet R5/$50 target/$60 emergency, two slots/two phases and all existing
shared sport leases remain. No change to forecast or grade formulas, provider
requests, schedules, settlement R7/tracking R43 or native MLB champion R44.
Accepted old laws, submitted archives and stored locked fields are never repaired,
relabelled or replayed by this patch. Writer/reader lock precedence tests remain
required, together with full model gate, clean fresh-main integration, exact-tree
protected PR/CI/preview and actual normal live verification.
