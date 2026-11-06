# FIU–West Florida actual member layout

Starting base4af12298586c2f4896a8e58c5d5fb9231c0155cc contains the protected
hash-bound locked recovery from #1053. Its production DTO and corrected West
Florida name were verified, but a real Chrome member-page check found the recovered
odds were absent from the active layout. The page uses CandidateDailyEdgePage and
ActualDailyEdgePreview, rather than the legacy DailyEdgeShell reader.

Mount the existing pure historical-context panel in the actual member Quick Read
for all three markets. Extend the exact-lock test to render that active Quick Read,
not merely the isolated panel. This changes no server data, forecast, probabilities,
price used for a decision, grade, stake, evidence, provider call, writer or lock.
The exact original lock remains the public prediction; recovered history stays
separate and explicitly labelled retrieved after lock. Verify actual visible
member-page name and odds after production deployment.
