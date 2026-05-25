📘 OddSphere Premium — V2.1 Locked Build Spec
Version: 2.1 (Final)
Status: APPROVED & LOCKED
Date: May 24, 2026
Owner: Daniel Mengel
Last Decision Cycle: 6 founder docs → V1 spec → 17 revisions → V2 spec → 6 final edits → V2.1 LOCKED

Part 1 — Product Foundation
Product Name: OddSphere Premium
Pricing: $25/month, billed monthly, locked for life
Tagline: "One membership unlocks everything."
Brand Hierarchy:

OddSphere Premium — the product (what users buy)
The Lab — the premium dashboard (where users live)
Discord — community/alerts (included)
Whop — payment & access management (invisible plumbing)

Brand Positioning: "OddSphere turns model projections, market movement, and betting context into clear daily signals."
Lab Positioning: "The Lab is your premium betting intelligence board — daily model picks, player prop edges, sharp-market context, and transparent tracking in one place."

Part 2 — Data Mode Strategy (CRITICAL)
Three-Mode Architecture

Mock Mode — Fake but realistic API-shaped data; used for UI dev and testing
Manual Upload Mode — Daniel uploads CSV or pastes data via admin pages
Real API Mode — Paid providers plug into same normalized layer (post-launch)

Adapter Pattern
Five normalized provider adapters:

oddsProviderAdapter
sharpSignalProviderAdapter
weatherProviderAdapter
playerStatsProviderAdapter
parkFactorProviderAdapter

Per-adapter mode selection via env vars:
ODDS_PROVIDER=mock | manual | real
SHARP_SIGNAL_PROVIDER=mock | manual | real
WEATHER_PROVIDER=mock | manual | real
PLAYER_STATS_PROVIDER=mock | manual | real
PARK_FACTOR_PROVIDER=mock | manual | real
Critical: UI never knows which mode is active. Consumes only normalized OddSphere data.
Source Type Tracking
Schema additions:
```sql
ALTER TABLE game_predictions ADD COLUMN source_type TEXT DEFAULT 'mock';
ALTER TABLE prop_predictions ADD COLUMN source_type TEXT DEFAULT 'mock';
ALTER TABLE prediction_results ADD COLUMN source_type TEXT DEFAULT 'mock';
-- Values: mock / manual / real_api
```
User-facing pages hide source_type. Admin views show it.

Part 3 — Visual System (LOCKED)
Colors

Main background: #05070D
Surface: #0B1020
Elevated card: #101827
Border: #1E293B
Border hover: #334155
Primary purple: #7C3AED
Bright purple: #A855F7
Best Signal / Confirmed: #22C55E
Sharp Confirmed (deeper): #10B981
Model Only / Neutral: #94A3B8
Public Smoke: #A78BFA
Market-Led / Market Watch: #38BDF8
Caution: #F59E0B
Hard Conflict / Loss: #FB7185

Color rules (never violate):

Purple = brand
Green = confirmation
Amber = caution
Red/pink = loss/conflict ONLY (never decorative)

Typography

Sora — page headings, hero, card scores
Inter — body, UI, labels, numbers

Numbers
All numeric displays use tabular-nums.
Badges

999px radius pills, NOT full-width banners
Cards use hover transitions (200ms)
Focus rings on all interactive elements


Part 4 — Site Structure
Public Routes
```
/                  → Home (landing)
/track-record      → Public Track Record (curated)
/pricing           → Pricing page → Whop checkout
/login             → Login page
```
Premium Routes (signed-in)
```
/lab               → Lab home (auto-redirect to /lab/daily-edge)
/lab/daily-edge    → Daily Edge module
/lab/player-props  → Player Props module
/lab/track-record  → Lab Track Record (analytical)
/lab/my-bets       → My Bets STUB ("Coming Soon")
/lab/account       → Account / Settings
```
Admin Routes
```
/admin                          → Dashboard with provider mode indicators
/admin/scores-model            → Existing
/admin/cron-status             → Existing
/admin/site-status             → V1 NEW
/admin/results                 → V1 NEW (Grading Review)
/admin/manual/daily-edge       → V1 NEW (Manual upload)
/admin/manual/player-props     → V1 NEW (Manual upload)
/admin/manual/sharp-signals    → V1 NEW (Manual upload)
/admin/manual/results          → V1 NEW (Manual results)
/admin/manual/tracking-baseline → V1 NEW (One-time import)
```
Navigation
Public Nav: Home | Track Record | Pricing | Log In | Join Premium
Premium Nav: OddSphere AI Lab    Daily Edge | Player Props | Track Record | My Bets    Account
Admin Nav: Dashboard | Slates | Picks | Props | Signals | Results | Users | Status

Part 5 — Access & Auth (5 States)
Five User States

Logged Out — Login page or marketing; redirect /lab/* to /login
Logged In, Not Premium — Upgrade prompt, "Join Premium" CTA
Premium Active — Full Lab access
Premium Expired/Canceled — Reactivation prompt, 24-48hr grace period
Admin (Daniel) — Premium + admin pages, identified via env var

Auth Methods

Continue with Whop (OAuth)
Continue with Email (passwordless magic link)

Purchase Flow

User clicks "Join Premium"
→ Whop checkout
→ Pays $25/month
→ Whop grants Discord access automatically
→ Returns to Lab
→ Site verifies Whop membership
→ Lab unlocks (no manual approval)

Data Storage Split
Whop stores: Subscription, payment, Discord access
OddSphere stores: Email, Whop user ID, cached membership status (24hr TTL), role, preferences, audit logs
Webhook Events
membership.created / membership.canceled / membership.expired / payment.failed

Part 6 — Signal & Grade System
Seven Grade Categories
| Tier | Daily Edge Label | Player Props Label | Color |
|------|------------------|--------------------|-------|
| 1 | 🔥 Best Signal | 🔥 Elite Prop | Green |
| 2 | ✅ Sharp Confirmed | ✅ Confirmed Edge | Green |
| 3 | ⚡ Market-Led Signal | ⚡ Market-Led | Cyan/Blue |
| 4 | 📊 Model Only | 📊 Model Edge | Gray |
| 5 | 👀 Market Watch | 👀 Market Watch | Cyan |
| 6 | 💨 Public Smoke | 💨 Public Smoke | Light Purple |
| 7 | ⚠️ Sharp Conflict | ⚠️ Caution | Amber/Red |

Best Signal Thresholds (STRICT)

5%+ edge for games
10%+ edge for props
Market alignment required
No major risk conflict
No artificial cap; if 8 games qualify, all 8 are Best Signal
Monitor: if >25% of slate qualifies, log for review

Public Smoke Positioning
NOT a Top Signal — used only as caution context. Appears in filters, board counts, "Biggest Caution" slot. Never in "Best Overall."
Signal Source Attribution (Honest Copy)

🔥 Best Signal: "Model + sharps agree on [pick]."
✅ Sharp Confirmed: "Market supports the model pick."
⚡ Market-Led: "Sharp money is driving this read, even though model edge is light."
📊 Model Only: "Strong model edge with no major market signal."
👀 Market Watch: "Movement exists, but signal is mixed."
💨 Public Smoke: "Public is heavy on this side, but sharp confirmation is weak."
⚠️ Sharp Conflict: "Market is moving against the model."

Three-Layer Engine

Layer 1: Model (edge, confidence, projection)
Layer 2: Context (10 existing signals)
Layer 3: Market (NEW — market_confirmed / market_neutral / market_resistance / public_smoke / steam_alert)


V2.1.1 Evolution — Per-Pick Grade Granularity (Phase 6.3.5)

The V2.1 schema landed row-level grades on game_predictions: ONE grade per row, derived from the row's "primary pick" via ML → OU → NRFI precedence. External review surfaced the limitation — a game can be Sharp Confirmed on the moneyline and Market Watch on the total; the headline-only model collapses that nuance. Phase 6.3.5 refactors game_predictions to carry per-pick grade triplets (ml_grade / ou_grade / nrfi_grade plus matching signal_type and market_signal columns). prop_predictions is unchanged — props were already per-pick by table shape.

The "headline grade" remains a meaningful surface concept; it's derived from the per-pick grades via the same ML → OU → NRFI precedence (with grade rank as tiebreaker). Tonight's Board now counts both games AND picks ("12 games · 36 picks"). Top Reads pulls the single highest-graded pick of each market type. The Daily Edge card surfaces per-pick GradeBadges on each tile instead of one row-level badge.

This section is a forward-pointer. Comprehensive Part 6 + Part 11 spec updates land in Phase 6.3.5f when the refactor is verified end-to-end. See migration V13 in Part 7 for the schema entry. Phase 6.3.5 sub-commit arc: V13 migration (6.3.5a) → service rewrites (6.3.5b) → DTO + route (6.3.5c) → UI refactor (6.3.5d) → tests (6.3.5e) → backfill + visual QA + final spec update (6.3.5f).


Part 7 — Data & Schema
V1 Migrations
V6 — Market signals
```sql
ALTER TABLE prop_predictions ADD COLUMN market_signal TEXT;
ALTER TABLE game_predictions ADD COLUMN market_signal TEXT;
```
V7 — Grade + Signal type
```sql
ALTER TABLE game_predictions ADD COLUMN grade TEXT;
ALTER TABLE game_predictions ADD COLUMN signal_type TEXT;
ALTER TABLE prop_predictions ADD COLUMN grade TEXT;
ALTER TABLE prop_predictions ADD COLUMN signal_type TEXT;
ALTER TABLE prediction_results ADD COLUMN signal_type TEXT;
```
V8 — Slate publish status
```sql
ALTER TABLE games ADD COLUMN slate_status TEXT DEFAULT 'draft';
-- Values: draft / published / final / hidden
```
V9 — Users table
```sql
CREATE TABLE users (
  id, email, whop_user_id, role,
  membership_status, membership_synced_at,
  unit_size, odds_format, timezone,
  created_at, last_login_at
);
```
V10 — Tracking baseline
```sql
CREATE TABLE tracking_baseline (
  sport, market, baseline_wins, baseline_losses,
  baseline_pushes, baseline_units, imported_at
);
```
V11 — Source type tracking (V2.1 addition)
```sql
ALTER TABLE game_predictions ADD COLUMN source_type TEXT DEFAULT 'mock';
ALTER TABLE prop_predictions ADD COLUMN source_type TEXT DEFAULT 'mock';
ALTER TABLE prediction_results ADD COLUMN source_type TEXT DEFAULT 'mock';
```
V12 — Audit log (V2.1 addition)
```sql
CREATE TABLE admin_audit_log (
  id, admin_user_id, action_type, target_table, target_id,
  before_state JSONB, after_state JSONB, source_type, created_at
);
```
V13 — Per-pick grade columns on game_predictions (V2.1.1 evolution — Phase 6.3.5a)
```sql
ALTER TABLE game_predictions
  ADD COLUMN ml_grade           TEXT,    -- 7-grade vocab, same as legacy `grade`
  ADD COLUMN ml_signal_type     TEXT,    -- 5-attribution vocab
  ADD COLUMN ml_market_signal   TEXT,    -- 5-Layer-3 vocab
  ADD COLUMN ou_grade           TEXT,
  ADD COLUMN ou_signal_type     TEXT,
  ADD COLUMN ou_market_signal   TEXT,
  ADD COLUMN nrfi_grade         TEXT,
  ADD COLUMN nrfi_signal_type   TEXT,
  ADD COLUMN nrfi_market_signal TEXT;
-- 9 CHECK constraints inherit the V6/V7 value lists. Nullable; populated
-- by Phase 6.3.5b services. Legacy row-level grade/signal_type/market_signal
-- columns kept during transition (dual-write through Phase 6.3.5f) and
-- dropped in a future V14 cleanup commit once nothing reads them.
```
DEFERRED to post-launch:

V14 — Cleanup: drop legacy game_predictions.grade / signal_type / market_signal columns (post-Phase 6.3.5f)
V15+ — user_bets, user_settings (My Bets)


Part 8 — Manual Upload Validation Pattern
Every manual upload follows this universal workflow:

Upload — CSV file OR paste table; template downloadable
Validate — Schema, types, business logic; row-by-row errors
Preview — Show exact published state; compare against existing
Confirm — One-click publish OR cancel
Publish — Status changes to published; audit log entry created

Universal rule: NO manual upload publishes directly. Always validate → preview → publish.

Part 9 — Publish/Draft Protection
Every slate has a status:

draft — Admin loaded, not visible to users
published — Visible to users, pre-game
final — Game complete, results graded
hidden — Pulled from public view

User-facing pages query:
```sql
SELECT * FROM games WHERE slate_status IN ('published', 'final')
```
Admin previews drafts in admin-only views.

Part 10 — Data Freshness (Required Everywhere)
Every prediction page displays:

Last updated: 10:42 AM ET
Lines synced: 10:39 AM ET
"Showing latest available slate" (when fallback)
"Data sync delayed" (when stale)

Reuse extended RefreshIndicator pattern from 5F.3.

Part 11 — Page Specifications
Daily Edge

Tonight's Board summary (game counts by signal)
Top Reads curated cards (4 categories)
14 filter chips
Sort dropdown (Start Time / Signal Strength / Confidence)
Game cards with grade badges (7 categories)
Expanded breakdown (✓/⚠ bullets)
Pick labels: Moneyline / Total / 1st Inning
YRFI color: purple (#A78BFA)
NO "Add to My Bets" buttons
Compact badges replace banners

Player Props

Tonight's Prop Board summary
Top Prop Edges (4 curated cards)
Edge plain-English translation
"No History" softened: "Tracking — History begins after this prop type is graded"
"Why this prop? →" CTA
Category tab counts (Hits · 5, etc.)
Card/Table toggle on Tonight's Best
Grade + Market columns in table
"Recent Hit Rate" filter rename
NO "Add to My Bets" buttons
Fresh model disclaimer

Player Props Drill-Down (NEW)
Desktop drawer / Mobile bottom sheet:

Header (player, line, grade)
Quick Read (one plain-English sentence)
Model Edge (projection, line, edge%, confidence)
Supporting Signals (grouped chips: Form, Matchup, Environment, Market)
Risk Check (juiced price, low sample, market resistance, etc.)
CTA: "Add to My Bets" — REMOVED for V1

Responsible tone: "high-edge prop according to the model," not "winner."
Track Record (Lab — Analytical)
Page order (LOCKED):

Filter bar (sport × time × market)
Top stat cards (This Week / Most Recent / All-Time / Best Market)
Latest Resolved Day
This Week
Last 30 Days chart (with legend)
All-Time Record table
Confidence Check (renamed from Calibration Honesty, moved BELOW All-Time)
Tracking Notes

Best Market REPLACES Streak card.
Sample-size chips when <30 picks.
Colors: green 55%+, neutral 50-54%, pink <50%.
Profitability disclaimer: "Hit rate does not equal profitability. Odds and unit sizing matter."
Track Record (Public — Marketing)
"Performance Snapshot" framing:

Lifetime overview
Current season snapshot
Strongest markets
"Every model pick tracked" note
CTA: Join Premium for full analytical view

Account / Settings (V1 Simplified)

Email
Membership status
"Manage Membership through Whop" link
Unit size ($25 default)
Odds format (American / Decimal)
Timezone
Log out

Everything else deferred.
My Bets (V1 STUB)
"Coming Soon" page with feature preview list. No real build.
Home / Marketing Landing
9 sections:

Hero with CTAs
Problem statement
What You Get (4 cards)
How It Works (3 steps)
Signal Language Preview
Track Record Preview
Pricing CTA
FAQ
Responsible footer

Login

Continue with Whop
Continue with Email (magic link)
"Not a member yet? Join Premium"

Pricing
Single card: $25/month locked for life, feature list, "Join through Whop" CTA, Whop disclaimer.
Admin (V1 Minimal)

Admin Dashboard with provider mode indicators
Site Status
Results / Grading Review (mandatory)
5 Manual Upload pages with validation/preview/publish
Audit log viewer


Part 12 — Empty/Loading/Error State Library
Universal copy rule: What is happening / Why it matters / What to do next.
All state copy locked in V2.1 spec — refer to Part 11 of the V2 conversation thread for full library.

Part 13 — Global Footer
Every public page footer:
Terms · Privacy · Responsible Gambling · Contact

OddSphere provides sports research and model projections.
It does not guarantee betting outcomes.

© 2026 OddSphere AI

Part 14 — Phase Execution Plan
| Phase | Hours | Description |
|-------|-------|-------------|
| 6.2 | 12-16 | UI Architecture Restructure |
| 6.3 | 12-16 | Signal + Grade Engine + Adapter Layer |
| 6.4 | 6-8 | Daily Edge Overhaul |
| 6.5 | 8-10 | Player Props + Drill-Down |
| 6.6 | 6-8 | Tracking Overhaul |
| 6.7 | 6-8 | Polish + Footer + Source Tracking |
| 7 | 10-12 | Whop Auth + Magic Link + Access States |
| 7.25 | 10-14 | Manual Upload Admin + Manual Providers |
| 7.5 | 10-14 | Minimal Admin + Grading Review + Launch Prep |

V1 TOTAL: 80-106 hours / 10-13 build sessions
Launch target: Mid-to-late July 2026
Post-Launch
| Phase | Hours | Description |
|-------|-------|-------------|
| 8 | 14-18 | Real APIs |
| 9 | 12-14 | My Bets MVP |
| 10 | 6-8 | My Bets Insights |

Part 15 — V1 Scope Boundaries (NEVER EXPAND WITHOUT APPROVAL)
INCLUDED in V1:

Public/premium architecture
7-grade signal system (including Market-Led)
Daily Edge with Tonight's Board + Top Reads
Player Props + Drill-Down with Risk Check
Track Record with Confidence Check + Performance Snapshot
Whop OAuth + Email magic link
Mock + Manual Upload modes (NO paid APIs)
5 manual upload admin pages with validation/preview/publish
Minimal admin (Dashboard + Site Status + Grading Review)
Provider mode indicators (admin only)
Source type tracking
Publish/draft protection
Data freshness everywhere
Global responsible gambling footer
Sora + Inter typography
Locked color system

EXPLICITLY DEFERRED (DO NOT BUILD IN V1):

Real paid APIs (Phase 8 post-launch)
My Bets full feature (Phase 9 post-launch)
"Add to My Bets" buttons on cards
Multi-sport real data (MLB only at launch)
Notifications system
CSV export (only import)
Parlay tracking
Closing Line Value
Public service status page
Annual billing
Referral program
Mobile native apps
Public API
Discord OAuth (use Whop)
Full admin (Slates, Games, Props, Sharp Signals, Users editors)
Avatar uploads
Notification preferences
Account expanded preferences


Part 16 — Success Criteria

Users sign up via Whop and reach Lab within 5 minutes
Email magic link login works as alternative
Daily Edge loads with 7-grade signals in <2s
Player Props shows ranked edges
Drill-Down explains every pick with Risk Check
Tracking shows honest records
Confidence Check displays calibration transparently
Mobile usable end-to-end at 375px
Daniel uploads daily slate in <5 minutes via manual admin
Validation catches CSV errors before publish
Publish/draft protection prevents bad data going live
Provider mode indicators clear in admin
Source type tracked on every prediction
Discord access works automatically post-payment
Data freshness displayed on every prediction page
Global responsible gambling footer on every public page
Zero paid API costs at launch
Site runs reliably 14+ days on manual data alone
5+ beta testers navigate without support
No "Phase N" or internal references leak to users


Part 17 — Document Audit

6 founder docs processed
V1 spec produced
17 revisions integrated
V2 spec produced
6 final edits integrated
V2.1 spec LOCKED

Total decisions captured: ~200+ specific UI/UX/architectural choices.

END OF V2.1 LOCKED SPEC
