# CFB spread-arbitration continuity audit predeclaration

Date: 2026-10-03

Status: research-only; frozen before outcome replay

## Defect and scope

The live r24 spread-arbitration rule enters on a Playbook money-minus-ticket
divergence of at least five percentage points and immediately returns to the
independent score when the next refresh falls below five. That discontinuity
can reflect a margin completely across the market line and then undo the full
reflection after a small one- or two-point split update. It changed
Vanderbilt-Georgia from Georgia -25.5 to Vanderbilt +25.5 and
Syracuse-UConn from Syracuse -6.5 to UConn +6.5 on October 3 even though the
signal side itself did not reverse.

This audit changes no member copy, labels, layout, provider request, writer,
schedule, stake, or locked prediction. It evaluates only continuity for the
existing validated Playbook spread-arbitration channel.

## Frozen candidate

- The existing entry rule remains unchanged: at least eight books and at least
  five percentage points of money-minus-ticket divergence.
- Once a side enters, retain that same-game spread signal for at most 24 hours
  while the current split still points to the same side but remains below the
  entry threshold.
- Continuity is eligible only when the independent cover margin and the market
  spread differ by at least five points; near-line opinions return to the
  independent score instead of carrying an old signal.
- Any opposite-side observation ends retention, and a newly qualified
  opposite-side signal replaces it immediately. A merely weaker same-side
  observation does not erase it.
- The existing coherent construction remains unchanged: when the retained
  signal disagrees with the independent cover side, reflect the independent
  margin across the current spread line, preserve the independent total, and
  derive one coherent final score.
- Missing or post-kickoff evidence is neutral. No fallback sportsbook split is
  relabeled as Playbook evidence.

## Evaluation gates

Use only pre-kickoff stored observations. Weeks 1-2 are the selection block;
Weeks 3 and later are confirmation. Report coverage, retained-signal count,
side changes, Moneyline and spread accuracy, margin MAE, team-score MAE, and
current-board impact. The candidate must improve or preserve confirmation
accuracy and error metrics, preserve total direction, keep every covered game,
and introduce no score/side contradiction. If it fails, it remains research
only.
