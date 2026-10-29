# Stored locked opening precedence

Starting base: `a1be05ba85c582ace54915d5a0b06f67a0f94dd9` (#868).

Final display-only guard: auxiliary pre-lock metadata may fill an absent
opening, but cannot outrank an explicit same-book/side/line provider opening
already stored in a locked market. Existing opening and main-line-history
metadata retain reference precedence too, just as stored quote points do.
No model, split, capture, provider-request, locked-payload or layout change.
Regression supplies intentionally conflicting archived/stored opening prices
and proves the exact stored opening wins. Old locks remain unchanged.
