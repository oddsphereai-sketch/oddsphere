# Shared prediction-market comparison window

Starting production base: `ea4b0e0d08547b450ef5e042cd5694570a07fd6d`.

The lifetime-history integration used a union time axis: Cleveland–Atlanta's
Kalshi history began October 26, while Pinnacle began October 28. That left
the sportsbook trace stranded near the right edge and compressed its actual
price changes. Opening evidence was real, but the comparison presentation
was not the aligned treatment requested by the owner.

Use the intersection of actually covered source times: later first quote to
earlier last quote, capped by the authoritative lock. Both bounded smooth
guides share identical left/right positions. A guide may hold an existing
preceding observation; it never invents an earlier opening or restamps a
quote. All earlier source receipts/opening metadata stay retained and dated
separately. The range label is “Full window,” not misleading “Full history.”

Unlocked/future archived sportsbook movement summaries and point-line
sparklines follow the selected comparison window. Existing legacy locked
summaries/quote/opening precedence remain unchanged. Missing source overlap
does not manufacture a matching book line. No prediction, price, pick, grade,
stake, split, provider request, capture cadence or stored lock is changed.

The shared-window regression renders the actual React SVG component, proving
identical pixel starts/ends, both faster-source cases, opening preservation,
raw timestamp immutability, pre-lock boundaries and in-window summary parity.

Read-only actual reader replay matched six Pinnacle NBA history receipts and
20 exact-line Circa NFL Total receipts back to their stored provider history;
every American-price implied percentage was exact. Pinnacle's actual four
distinct prices were -110, -113, -110, -109. Unlocked/future summaries now
show four prices or explicitly mark omitted intermediate moves; legacy
locked summaries keep their original three-price compact behavior.
