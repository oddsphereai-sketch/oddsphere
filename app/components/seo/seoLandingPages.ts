import type { SeoLandingPageConfig } from "./PublicSeoLandingPage";

export const SEO_LANDING_PAGES = {
  aiSportsPredictions: {
    slug: "ai-sports-predictions",
    title: "AI Sports Predictions Built for Daily Betting Decisions | OddSphere AI",
    description:
      "OddSphere AI combines sports prediction models, market reads, Play Grades, and transparent tracking in one Daily Edge betting intelligence platform.",
    h1: "AI Sports Predictions Built for Daily Betting Decisions",
    eyebrow: "AI sports predictions",
    intro:
      "OddSphere is a model-driven sports prediction and betting intelligence platform. Daily Edge combines projected scores, model probabilities, price/value context, market reads, Play Grades, and transparent tracking so members can read the board without hype.",
    keywords: [
      "AI sports predictions",
      "sports betting model",
      "daily sports picks",
      "betting analytics",
      "sports prediction model",
    ],
    whatYouGet: [
      {
        title: "Daily Edge by sport",
        body: "MLB, WNBA, and World Cup/Soccer slates are organized into readable market cards when those sports are active.",
      },
      {
        title: "Play Grades",
        body: "Best Angle, Lean, Watchlist, Caution, and No Play summarize the model/value setup without pretending every pick is equal.",
      },
      {
        title: "Market context",
        body: "OddSphere uses price, movement, Consensus Splits, Sharp Book context when supported, and sport-specific evidence to explain the read.",
      },
    ],
    howItWorks: [
      {
        title: "Model projection",
        body: "The model starts with probability, projected score, projected total, or first-inning context depending on the market.",
      },
      {
        title: "Price and value",
        body: "Market implied probability and current price help separate likely winners from bets with actionable value.",
      },
      {
        title: "Reader output",
        body: "The public grade and copy are kept simple, while supporting evidence explains why the prediction is or is not actionable.",
      },
    ],
    whyDifferent: [
      {
        title: "Not just picks",
        body: "OddSphere is built around model evidence, market reads, and tracking rather than one-line pick posts.",
      },
      {
        title: "No empty sections",
        body: "Unsupported split sources are hidden. MLB, WNBA, and Soccer each get market context that fits the sport.",
      },
      {
        title: "Transparent tracking",
        body: "Public track-record pages show historical model performance so users can evaluate the product with context.",
      },
    ],
    memberView: [
      {
        title: "MLB reads",
        body: "Moneyline, totals, and first-inning cards show model probability, edge, price, movement, and available split context.",
      },
      {
        title: "World Cup reads",
        body: "Soccer predictions focus on match-result context, totals, movement, draw risk, Double Chance, and BTTS where available.",
      },
      {
        title: "Tracking",
        body: "The member dashboard and public pages are designed to keep results visible instead of cherry-picked.",
      },
    ],
    relatedLinks: [
      { href: "/mlb-predictions", label: "MLB Predictions" },
      { href: "/world-cup-predictions", label: "World Cup Predictions" },
      { href: "/sports-betting-ai", label: "Sports Betting AI" },
    ],
    ctaTitle: "See the Daily Edge dashboard.",
    ctaBody:
      "Get access to the member product built around model projections, market reads, Play Grades, and transparent tracking.",
  },
  mlbPredictions: {
    slug: "mlb-predictions",
    title: "MLB Predictions Today: AI Moneyline, Totals & Market Reads | OddSphere AI",
    description:
      "OddSphere MLB predictions cover moneyline, totals, first inning reads, market movement, Play Grades, and transparent tracking.",
    h1: "MLB Predictions Today: AI Moneyline, Totals & Market Reads",
    eyebrow: "MLB predictions",
    intro:
      "OddSphere's MLB Daily Edge gives members a cleaner way to read moneyline, totals, and first-inning markets. The product combines model probabilities, projected scores, market implied probability, odds movement, and Play Grades without exposing the full paid slate publicly.",
    keywords: [
      "MLB predictions",
      "MLB picks today",
      "MLB moneyline predictions",
      "MLB totals predictions",
      "AI MLB model",
    ],
    whatYouGet: [
      {
        title: "Moneyline reads",
        body: "MLB moneyline cards compare model win probability to market implied probability and current price.",
      },
      {
        title: "Totals reads",
        body: "Totals cards connect projected runs, the posted line, price, and movement to explain Over or Under value.",
      },
      {
        title: "First inning reads",
        body: "FI cards classify YRFI, NRFI, and Toss-Up setups with first-inning probability, price, and context.",
      },
    ],
    howItWorks: [
      {
        title: "Probability vs market",
        body: "The model looks for separation between projected probability and market implied probability, then checks whether price is playable.",
      },
      {
        title: "Movement and splits",
        body: "MLB moneyline and totals can show Consensus Splits and Sharp Book context when reliable market data is available.",
      },
      {
        title: "Grade discipline",
        body: "Best Angles and Leans are stronger public grades, while Watchlist, Caution, and No Play keep weaker or riskier setups separated.",
      },
    ],
    whyDifferent: [
      {
        title: "Likely is not enough",
        body: "The reader separates a likely winner from a good bet by showing price, value, and market friction.",
      },
      {
        title: "Context over hype",
        body: "MLB cards explain why a pick is graded the way it is without using exaggerated betting language.",
      },
      {
        title: "Results matter",
        body: "The public track record helps users evaluate performance across sports and markets.",
      },
    ],
    memberView: [
      {
        title: "Daily Edge board",
        body: "The slate board organizes each game by current top read and lets members expand the card for evidence.",
      },
      {
        title: "Supporting evidence",
        body: "Cards show model edge, market implied probability, price, movement, and split context where supported.",
      },
      {
        title: "First inning shortcuts",
        body: "YRFI, NRFI, and Toss-Up reads keep first-inning betting context separate from full-game MLB markets.",
      },
    ],
    relatedLinks: [
      { href: "/mlb-first-inning-picks", label: "MLB First Inning Picks" },
      { href: "/ai-sports-predictions", label: "AI Sports Predictions" },
      { href: "/sports-betting-ai", label: "Sports Betting AI" },
    ],
    ctaTitle: "Read today's MLB board inside Daily Edge.",
    ctaBody:
      "Join to see the member MLB slate with moneyline, totals, and first-inning reads organized by Play Grade and supporting evidence.",
  },
  mlbFirstInningPicks: {
    slug: "mlb-first-inning-picks",
    title: "MLB First Inning Picks: NRFI, YRFI & Toss-Up Reads | OddSphere AI",
    description:
      "OddSphere first inning reads evaluate NRFI, YRFI, and Toss-Up spots with model probability, price, and first-inning context.",
    h1: "MLB First Inning Picks: NRFI, YRFI & Toss-Up Reads",
    eyebrow: "MLB first inning model",
    intro:
      "OddSphere's first-inning model is built to keep NRFI, YRFI, and Toss-Up reads disciplined. The goal is not to force an action side every game, but to show when the FI probability, price, and context create a usable read.",
    keywords: [
      "NRFI picks",
      "YRFI picks",
      "MLB first inning predictions",
      "first inning betting model",
      "AI NRFI model",
    ],
    whatYouGet: [
      {
        title: "YRFI and NRFI labels",
        body: "The reader separates Yes Run First Inning, No Run First Inning, and Toss-Up spots instead of forcing action.",
      },
      {
        title: "Price-aware reads",
        body: "A first-inning prediction can be directionally interesting but still value-capped if the price is too expensive.",
      },
      {
        title: "Toss-Up discipline",
        body: "Toss-Up means the model is not creating enough separation for a clear YRFI or NRFI side right now.",
      },
    ],
    howItWorks: [
      {
        title: "FI probability",
        body: "The model evaluates first-inning probability separately from full-game moneyline and total predictions.",
      },
      {
        title: "Starter and context",
        body: "First-inning reads can use starter profile, team early-scoring context, price, and movement when available.",
      },
      {
        title: "No split dependency",
        body: "MLB FI cards do not require Consensus or Sharp split bars, so missing split sections are not treated as a problem.",
      },
    ],
    whyDifferent: [
      {
        title: "No forced picks",
        body: "FI can be volatile, so OddSphere can show No Play or Toss-Up when the evidence is not strong enough.",
      },
      {
        title: "Simple member copy",
        body: "The card explains whether the FI read is model-driven, price-capped, thin-edge, or not actionable.",
      },
      {
        title: "Tracked outcomes",
        body: "First-inning markets are part of the broader tracking philosophy, so performance can be reviewed over time.",
      },
    ],
    memberView: [
      {
        title: "FI card slot",
        body: "Daily Edge keeps first-inning predictions in their own market slot next to moneyline and total reads.",
      },
      {
        title: "FI grades",
        body: "Leans, Watchlists, Cautions, and No Plays give a cleaner sense of actionability than a raw prediction alone.",
      },
      {
        title: "FI evidence",
        body: "Members see model probability, edge, price, and context without unsupported split-source placeholders.",
      },
    ],
    relatedLinks: [
      { href: "/mlb-predictions", label: "MLB Predictions" },
      { href: "/ai-sports-predictions", label: "AI Sports Predictions" },
      { href: "/sports-betting-ai", label: "Sports Betting AI" },
    ],
    ctaTitle: "See first-inning reads inside Daily Edge.",
    ctaBody:
      "Join OddSphere to review MLB first-inning cards alongside moneyline and totals, with Play Grades and evidence in one reader.",
  },
  worldCupPredictions: {
    slug: "world-cup-predictions",
    title: "World Cup Predictions: AI Match Reads, Totals & Market Signals | OddSphere AI",
    description:
      "OddSphere World Cup predictions use model reads, soccer market context, prices, movement, totals, and match-specific evidence.",
    h1: "World Cup Predictions: AI Match Reads, Totals & Market Signals",
    eyebrow: "World Cup predictions",
    intro:
      "OddSphere's World Cup/Soccer view is built for soccer-specific market reads. Instead of forcing MLB-style split sections, it focuses on model probability, price, movement, draw risk, totals context, Double Chance, BTTS, and match evidence where available.",
    keywords: [
      "World Cup predictions",
      "World Cup picks",
      "soccer predictions",
      "AI soccer model",
      "World Cup betting analytics",
    ],
    whatYouGet: [
      {
        title: "Match-result reads",
        body: "Soccer cards can explain three-way context, draw risk, price, and whether the market makes a side actionable.",
      },
      {
        title: "Totals context",
        body: "Totals reads use projected goals, current number, price, and movement rather than unsupported split assumptions.",
      },
      {
        title: "Soccer-specific markets",
        body: "When available, Double Chance and BTTS context can be surfaced in a way that fits the sport.",
      },
    ],
    howItWorks: [
      {
        title: "Model probability",
        body: "The soccer model starts with projected match probabilities and expected-goal style context.",
      },
      {
        title: "Price and draw risk",
        body: "A team can have the stronger win case while still carrying draw risk or price limitations.",
      },
      {
        title: "Movement-aware copy",
        body: "Odds movement can support, resist, or leave the read neutral depending on the prediction and market.",
      },
    ],
    whyDifferent: [
      {
        title: "No fake split sections",
        body: "World Cup/Soccer pages do not pretend Consensus or Sharp Book split bars exist when they are not supported.",
      },
      {
        title: "Market-specific language",
        body: "The reader uses soccer terms and match-result framing rather than raw home/away copy where clearer wording exists.",
      },
      {
        title: "Transparent product",
        body: "The public site explains what members see without exposing premium live cards.",
      },
    ],
    memberView: [
      {
        title: "Daily Edge soccer tab",
        body: "Members can review active World Cup/Soccer predictions from the same Daily Edge product.",
      },
      {
        title: "Market Read",
        body: "Cards explain whether model, price, and movement support the prediction or keep it value-capped.",
      },
      {
        title: "Play Grades",
        body: "Best Angle, Lean, Watchlist, Caution, and No Play keep soccer predictions organized by actionability.",
      },
    ],
    relatedLinks: [
      { href: "/ai-sports-predictions", label: "AI Sports Predictions" },
      { href: "/sports-betting-ai", label: "Sports Betting AI" },
      { href: "/mlb-predictions", label: "MLB Predictions" },
    ],
    ctaTitle: "Review World Cup reads inside Daily Edge.",
    ctaBody:
      "Join OddSphere for soccer predictions with model context, market movement, Play Grades, and transparent tracking.",
  },
  sportsBettingAi: {
    slug: "sports-betting-ai",
    title: "Sports Betting AI for Model Projections, Market Reads & Tracking | OddSphere AI",
    description:
      "OddSphere is sports betting AI built around model projections, market reads, Play Grades, and transparent tracking instead of hype.",
    h1: "Sports Betting AI for Model Projections, Market Reads & Tracking",
    eyebrow: "Sports betting AI",
    intro:
      "OddSphere uses AI-assisted modeling and deterministic reader logic to turn sports predictions into a cleaner betting intelligence workflow. The platform is designed to show model strength, price/value, market context, Play Grades, and tracked results without promising outcomes.",
    keywords: [
      "sports betting AI",
      "AI betting model",
      "betting analytics",
      "sports prediction model",
      "AI sports betting platform",
    ],
    whatYouGet: [
      {
        title: "Model projections",
        body: "OddSphere starts with projections and probabilities instead of writing unsupported pick narratives.",
      },
      {
        title: "Market reads",
        body: "Price, movement, split context where supported, and market friction help explain why a play is graded the way it is.",
      },
      {
        title: "Tracking and transparency",
        body: "The public track record is part of the product story because accountability matters.",
      },
    ],
    howItWorks: [
      {
        title: "Evidence object",
        body: "Each prediction is evaluated with structured evidence like model probability, implied probability, edge, price, and movement.",
      },
      {
        title: "Grade mapping",
        body: "The public grade stays simple while internal logic considers value, market context, price quality, and risk.",
      },
      {
        title: "Safe reader copy",
        body: "Member-facing copy is deterministic and template-safe, not raw model prose dropped straight onto the page.",
      },
    ],
    whyDifferent: [
      {
        title: "Not a black box tout page",
        body: "OddSphere is positioned as betting intelligence: model plus market plus transparent tracking.",
      },
      {
        title: "Sport-aware context",
        body: "MLB, WNBA, and Soccer do not all get the same template. The reader adapts to what each market supports.",
      },
      {
        title: "Responsible by design",
        body: "Copy avoids guarantees and overconfident language because sports outcomes are uncertain.",
      },
    ],
    memberView: [
      {
        title: "Daily Edge",
        body: "The main member product organizes daily predictions into readable cards with grades and evidence.",
      },
      {
        title: "Best Angles and Leans",
        body: "Stronger grades highlight the model/value setups that appear more actionable, while lower grades keep risk visible.",
      },
      {
        title: "Multi-sport coverage",
        body: "MLB, WNBA, World Cup/Soccer, NBA, and NHL surfaces are represented as data and seasons are active.",
      },
    ],
    relatedLinks: [
      { href: "/ai-sports-predictions", label: "AI Sports Predictions" },
      { href: "/mlb-predictions", label: "MLB Predictions" },
      { href: "/mlb-first-inning-picks", label: "MLB First Inning Picks" },
      { href: "/world-cup-predictions", label: "World Cup Predictions" },
    ],
    ctaTitle: "Use AI betting intelligence without the noise.",
    ctaBody:
      "OddSphere gives members model-driven Daily Edge cards, market context, Play Grades, and tracking in one product.",
  },
} satisfies Record<string, SeoLandingPageConfig>;

