# CBB r9: coherent matchup + market test (private)

R8's score improvements did not carry through to all opening-line markets. The
independent r2 preview is still unchanged. Test the combined product, not a
different winner/score selected independently for each market.

Recompute R8 at the 353 retained target opening timestamps; rebuild the existing
16 market features relative to that new independent forecast, excluding target
book/family and future references exactly as r5. No movement or splits inference
is fabricated. The retained evidence is opening-price context only.

Fit exactly three joint conditional ML/spread/total log-loss heads (penalties
1/10/100), using the existing trainer without new optimizer or authority
ablations. Fit the same 151 early games; select on the same 162 later February
games. A candidate must gain net correct picks without reducing any individual
market's wins against the frozen R2 product. Rank by net wins, then aggregate
conditional log loss. Refit the selected setting on both earlier blocks and
evaluate the final 40 March games, also against frozen R2. Report R8 without
market correction separately so reader effect is not confused with base changes.

All outcomes in this research have already been opened. This does not restore
holdout status or justify a live accuracy claim. No head is deployed, no lock or
grade is changed, and small later gains would still require stronger validation.

The new reader head carries its own r9 release and explicitly binds to the r8
independent release. A mismatched independent release must fail before inference.
