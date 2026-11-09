# Complete-sentence admission and combined correction diagnostics

Base `972b45016c3bcec499636bb996c8cd976dc82c10`.

An otherwise structured response could satisfy the advertised maximum text length
while ending mid-sentence. Backend admission correctly rejects that response, but
the request schema advertised only length, leaving the finish requirement solely
in prose. Physical preflight could also mask a simultaneous assessment failure
until the existing second phase had already been used.

R22 includes the existing terminal punctuation requirement in assessment and
reader observation schemas, and the existing no-digits reader condition in its
pattern. This is supported by the official [structured output schema guide](https://developers.openai.com/api/docs/guides/structured-outputs).
Shorter target lengths encourage complete concise sentences; maximum lengths and
all backend checks remain unchanged. No client-side text completion or punctuation
append is permitted, and punctuation alone does not prove semantic support.

A pure diagnostic pass lists every affected player/category before optional
numeric examples within the existing 1,024-character finding bound. The existing
bounded correction phase receives both physical and text failures. It cannot
waive a physical identity or source constraint. The original returned bytes and
immutable financial receipts remain the evidence, including unsuccessful output.

Synthetic multi-actor tests verify combined findings, unchanged bytes, strict
schema patterns and physical failures surviving text correction. Disposable
PostgreSQL reviewer tests mock all HTTP and prove one failed-part correction,
no successful-part regeneration and unchanged two-phase billing. Existing
source/price/lock/promotion controls remain required. Valid numeric laws, prices,
selection and grades are unchanged: zero same-input board promotions/demotions.

This does not resolve provider availability, every generated sentence's factual
entailment or the separate unresolved interception source-event contract. Do not
replay closed jobs, alter legacy laws or buy live proof. Observe ordinary
scheduled reviews and their complete source/qualification/member/lock evidence.
