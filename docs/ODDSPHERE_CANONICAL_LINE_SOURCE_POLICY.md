# OddSphere Canonical Line Source Policy

Status: initial policy  
Date: 2026-06-24  
Purpose: prevent fake or misleading line movement by separating sportsbook lines, consensus lines, best available prices, fair prices, and closing prices.

## Core Rule

Line movement must compare the same source series over time.

Valid:

- DraftKings first observed moneyline to DraftKings current moneyline.
- FanDuel first observed total to FanDuel current total.
- Playbook consensus spread first observed to Playbook consensus spread current.
- A documented multi-book consensus open to the same documented multi-book consensus current.

Invalid:

- DraftKings open to FanDuel current.
- FanDuel previous to DraftKings current.
- SharpAPI per-book current to Playbook consensus current.
- Playbook consensus first observed to DraftKings current.
- First observed line described as opener.

If OddSphere cannot prove source continuity, the UI must call it market context, not movement.

## Source Types

### Canonical Sportsbook

A named sportsbook chosen per sport and market for movement tracking.

Use for:

- First observed to current movement.
- Lock-time movement.
- Future closing-line comparison if the same book closing price exists.

Do not use for:

- Best-price shopping.
- Consensus labels.

### Best Available Price

The most favorable current price across supported books.

Use for:

- User guidance when showing where the best number is.
- Potential future bet placement recommendation context.

Do not use for:

- Line movement unless tracked as its own separate best-price series.
- CLV unless the close is also best-price and that definition is explicit.

### Consensus Line

A provider aggregate or multi-book average/representative market line.

Use for:

- Market context.
- Fallback when per-book data is unavailable.
- Public-market comparison.

Do not use for:

- Sportsbook-specific movement.
- Named-book prices.

Playbook `/v1/lines` belongs here. Store or display it as `playbook_consensus`, never as DraftKings, FanDuel, Pinnacle, or another book.

### Fair Price / No-Vig Price

A derived probability or fair odds estimate, often from no-vig or sharp-book methodology.

Use for:

- EV comparison.
- Model calibration.
- Market sanity checks.

Do not use for:

- Book line movement.
- Public split labels.

### Closing Price

The final comparable price before market close/game start.

Use for:

- CLV only when the pick-time price and closing price are comparable.

Do not use for:

- ROI.
- Result grading.
- Movement claims before the closing data pipeline is audited.

## Initial Sport/Market Policy

This is the starting rule set. It should be revised only after provider audits show better coverage.

| Sport | Market | Movement Source | Context Fallback | Best Price | Notes |
| --- | --- | --- | --- | --- | --- |
| MLB | Moneyline | SharpAPI same sportsbook series | Playbook consensus | SharpAPI per-book | Do not use Playbook for book movement. |
| MLB | Total | SharpAPI same sportsbook series | Playbook consensus | SharpAPI per-book | First observed is not opener. |
| MLB | Run line/spread | SharpAPI same sportsbook series | Playbook consensus | SharpAPI per-book | Track source per row. |
| MLB | First inning | Existing trusted source only if same-source history exists | none | SharpAPI if available | No Playbook support confirmed for FI. |
| WNBA | Moneyline | SharpAPI same sportsbook series if available | Playbook consensus | SharpAPI per-book if available | Playbook splits are public context only. |
| WNBA | Total | SharpAPI same sportsbook series if available | Playbook consensus | SharpAPI per-book if available | Need WNBA team normalizer before ingest. |
| WNBA | Spread | SharpAPI same sportsbook series if available | Playbook consensus | SharpAPI per-book if available | Context-only unless tracking pipeline is explicit. |
| NBA | Moneyline/spread/total | SharpAPI same sportsbook series if available | Playbook consensus when in season | SharpAPI per-book | Offseason Playbook rows may be zero. |
| NHL | Moneyline/puck line/total | SharpAPI same sportsbook series if available | Playbook consensus when in season | SharpAPI per-book | Offseason Playbook rows may be zero. |
| NFL/NCAAF | Main markets | TBD after coverage audit | Playbook consensus | SharpAPI per-book if available | Playbook has strong row count but no production lane yet. |

## Required Stored Metadata

Any line row or provider snapshot used for movement should retain:

- `provider`: for example `sharpapi` or `playbook`.
- `source_type`: `sportsbook`, `consensus`, `best_available`, `fair_price`, or `closing`.
- `sportsbook`: named book when `source_type=sportsbook`; null for consensus/fair price.
- `source_key`: stable source id such as `draftkings`, `fanduel`, `playbook_consensus`.
- `sport`.
- `market_type`.
- `selection`.
- `line_value`.
- `odds_american`.
- `observed_at`.
- `event_start_time`.
- `is_first_observed`.
- `is_current`.
- `is_closing`.

If existing tables cannot store all of this cleanly, add a provider snapshot lane before expanding production movement claims.

## UI Label Rules

- Show "Line moved" only when the same `source_key` is compared over time.
- Show "Market moved" only for documented consensus-to-consensus movement.
- Show "Best price" only for current cross-book comparison.
- Show "Public split" only for bet percentage and money/handle percentage.
- Show "+EV" only when current odds are compared to fair probability/fair odds.
- Show "CLV" only when pick price and closing price are both stored and comparable.
- Never show steam/RLM unless those are explicitly computed from valid same-source history or a provider supplies a verified field.

## Implementation Gate

Before any line movement code changes:

1. Identify the exact source series.
2. Confirm historical rows contain that source.
3. Confirm current rows use the same source.
4. Confirm UI copy distinguishes movement, best price, consensus context, and public splits.
5. Add an audit output showing examples of valid and rejected movement comparisons.

No production change should pass review if it mixes books or mixes consensus with named-book lines.

## Reverse Line Movement And Steam

Reverse line movement and steam are allowed only when OddSphere can compute them from valid source series.

RLM requires:

- A public side from public split data.
- A line movement direction from same-source line history.
- A clear rule that the line moved against the heavy public side.
- Enough timestamped observations to distinguish movement from a source switch.

Steam requires:

- Multiple books moving in the same direction within a defined time window, or a verified provider field that explicitly represents coordinated movement.
- Per-book source identity.
- Same-market, same-selection comparison.

Forbidden:

- Inferring RLM from Playbook public splits alone.
- Inferring steam from Playbook `booksUsed`.
- Comparing Playbook consensus movement to a SharpAPI sportsbook line.
- Calling a one-time consensus snapshot "movement."

Until those conditions are met, the UI should show public split context and market context, not RLM or steam.
