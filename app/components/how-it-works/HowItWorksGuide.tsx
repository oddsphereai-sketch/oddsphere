import Image from "next/image";
import Link from "next/link";

import { PRICING_PAGE_URL } from "@/lib/marketing/trialOffer";

import styles from "./HowItWorksGuide.module.css";

const gradeRows = [
  {
    symbol: "★",
    label: "Best Angle",
    tone: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200",
    copy: "The strongest setup on the current board.",
  },
  {
    symbol: "↗",
    label: "Lean",
    tone: "border-sky-400/30 bg-sky-400/[0.06] text-sky-200",
    copy: "A playable direction, but not as strong as a Best Angle.",
  },
  {
    symbol: "◐",
    label: "Watchlist",
    tone: "border-indigo-400/30 bg-indigo-400/[0.06] text-indigo-200",
    copy: "Worth watching. The price or information is not there yet.",
  },
  {
    symbol: "○",
    label: "No Play",
    tone: "border-gray-700 bg-gray-900/50 text-gray-300",
    copy: "The current setup does not give us enough reason to play it.",
  },
];

const faqs = [
  {
    question: "Why did a pick or Play Grade change?",
    answer: "The price, line, lineup, injury report, starter, weather or other available information may have changed. OddSphere updates the board when the full picture changes.",
  },
  {
    question: "When is the best time to check OddSphere?",
    answer: "Check during the day if you want to follow the movement. Check again within about an hour of game time for the clearest final read.",
  },
  {
    question: "What does it mean when a game is locked?",
    answer: "The final version of the pick has been saved for tracking. Earlier versions may have looked different while the game was still updating.",
  },
  {
    question: "Does a Best Angle guarantee a win?",
    answer: "No. Best Angle means it is one of the strongest current setups on the board. Every pick still carries risk.",
  },
  {
    question: "Why are Sharp Book Splits sometimes missing?",
    answer: "The provider may not have supplied usable data for that game or market yet. OddSphere leaves the section out instead of filling it with a guess.",
  },
  {
    question: "Why can the projected score change?",
    answer: "The projected score is an estimate built from the latest available inputs. When those inputs change, the estimate can change too.",
  },
  {
    question: "What is the difference between probability and Play Grade?",
    answer: "Probability estimates the chance of the selected outcome. Play Grade also considers the available price, market context and whether the pick is actionable.",
  },
  {
    question: "Why can a strong prediction still be a No Play?",
    answer: "A prediction can favor one side while the current price offers too little value. The model read and the betting decision are related, but they are not the same thing.",
  },
];

export function HowItWorksGuide({ publicCta = false }: { publicCta?: boolean }) {
  return (
      <div className={styles.reviewRoot} data-how-to-guide>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-8 sm:mb-10">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-violet-300">
            OddSphere guide
          </p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            Understanding OddSphere
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-gray-300 sm:text-lg">
            OddSphere is a live read of the game and the market. Picks, probabilities,
            projected scores and Play Grades can change until a game locks.
          </p>
          {publicCta ? (
            <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Link
                href={PRICING_PAGE_URL}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-400 px-6 py-3 text-sm font-black text-gray-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              >
                Start Free Trial
              </Link>
              <Link href="/" className="text-sm font-bold text-gray-300 hover:text-white">
                Back to homepage
              </Link>
            </div>
          ) : null}
        </header>

        <nav aria-label="Guide sections" className="mb-8 flex flex-wrap gap-x-5 gap-y-3 border-b border-gray-800 pb-5 text-xs font-bold">
          <a href="#changes" className="text-violet-300 hover:text-violet-200">Why it changes</a>
          <a href="#prediction-grade" className="text-gray-400 hover:text-white">Prediction vs Grade</a>
          <a href="#timing" className="text-gray-400 hover:text-white">When to check</a>
          <a href="#grades" className="text-gray-400 hover:text-white">Play Grades</a>
          <a href="#daily-edge" className="text-gray-400 hover:text-white">The reader</a>
          <a href="#faq" className="text-gray-400 hover:text-white">FAQ</a>
        </nav>

        <section id="changes" className="scroll-mt-28">
          <div className="rounded-2xl border border-violet-400/35 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.2),transparent_50%)] p-5 sm:p-7">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">The main thing to know</p>
            <h2 className="mt-3 max-w-3xl text-2xl font-black tracking-tight text-white sm:text-3xl">
              The board is live until the game locks.
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-gray-300">
              OddSphere keeps reading the latest game information and sportsbook market.
              When the information changes, the board may change with it. That is expected.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TimelineStep label="Early board">The first model and market read.</TimelineStep>
              <TimelineStep label="During the day">Prices and game information update.</TimelineStep>
              <TimelineStep label="Final check">Review the latest read near game time.</TimelineStep>
              <TimelineStep label="Locked">The saved version is used for tracking.</TimelineStep>
            </div>
          </div>

          <div className="pt-12 sm:pt-14">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">What changed?</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">What each movement means</h2>
            <div className="mt-6 divide-y divide-gray-800 overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/60">
              <ChangeRow title="The pick changed">The model now prefers a different side or outcome.</ChangeRow>
              <ChangeRow title="The Play Grade changed">The pick may be the same, but its price or supporting evidence became stronger or weaker.</ChangeRow>
              <ChangeRow title="The probability changed">New information changed the estimated chance of the outcome.</ChangeRow>
              <ChangeRow title="The projected score changed">The expected scoring changed as matchup inputs updated.</ChangeRow>
              <ChangeRow title="The odds or line changed">The sportsbook market moved, which can change whether the pick still has value.</ChangeRow>
            </div>
          </div>
        </section>

        <section id="prediction-grade" className="scroll-mt-28 pt-12 sm:pt-14">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Two different questions</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-sky-400/25 bg-sky-400/[0.05] p-5 sm:p-6">
              <h2 className="text-xl font-black text-white">Prediction</h2>
              <p className="mt-3 text-lg font-bold leading-7 text-sky-200">What does the model expect to happen?</p>
              <p className="mt-3 text-base leading-7 text-gray-300">This is where the projected winner, probability and score come from.</p>
            </article>
            <article className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.05] p-5 sm:p-6">
              <h2 className="text-xl font-black text-white">Play Grade</h2>
              <p className="mt-3 text-lg font-bold leading-7 text-emerald-200">Is it worth considering at the current price?</p>
              <p className="mt-3 text-base leading-7 text-gray-300">The grade also considers price, market context and how actionable the pick is.</p>
            </article>
          </div>
          <p className="mt-4 rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-base leading-7 text-gray-300">
            A prediction can stay the same while the Play Grade moves. The model may still like the same side, but the available price may be better or worse.
          </p>
        </section>

        <section id="timing" className="scroll-mt-28 pt-12 sm:pt-14">
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-gray-800 bg-gray-950/60 p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">When should I check?</p>
              <h2 className="mt-3 text-xl font-black leading-7 text-white sm:text-2xl">Watch it during the day. Check again within an hour of game time.</h2>
              <p className="mt-4 text-base leading-7 text-gray-300">The final check usually has a clearer picture of lineups, injuries, starters and current prices.</p>
            </article>
            <article className="rounded-2xl border border-gray-800 bg-gray-950/60 p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">What happens at lock?</p>
              <h2 className="mt-3 text-xl font-black leading-7 text-white sm:text-2xl">The final version is saved for tracking.</h2>
              <p className="mt-4 text-base leading-7 text-gray-300">Earlier versions may have looked different while the board was still updating.</p>
            </article>
          </div>
        </section>

        <section id="start" className="scroll-mt-28 pt-12 sm:pt-14">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/50 p-5 sm:p-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Using the app</p>
            <h2 className="mt-2 text-xl font-black text-white">The quick version</h2>
            <ol className="mt-5 grid gap-4 lg:grid-cols-3">
              <GuideStep number="1">Choose a sport in Daily Edge.</GuideStep>
              <GuideStep number="2">Scan Best Angles and Leans.</GuideStep>
              <GuideStep number="3">Open a game before deciding.</GuideStep>
            </ol>
          </div>
        </section>

        <section id="daily-edge" className="scroll-mt-28 pt-14 sm:pt-16">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Daily Edge</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Reading the game view</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">
            The reader puts the model, price, market movement and supporting information on one screen.
            Use the image as a map of the page. You do not need to read every detail here.
          </p>

          <div className="mt-6 overflow-hidden rounded-2xl border border-violet-400/30 bg-gray-950 shadow-[0_0_28px_rgba(124,58,237,0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-violet-400" />
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-200">Reader walkthrough</span>
              </div>
              <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Example screen</span>
            </div>
            <a href="/marketing/daily-edge-expanded-reader.jpg" target="_blank" rel="noreferrer" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
              <div className={styles.imageFrame}>
                <Image
                  src="/marketing/daily-edge-expanded-reader.jpg"
                  alt="OddSphere Daily Edge expanded reader showing a selected game, Quick Read, market evidence, and key stats"
                  width={2334}
                  height={1974}
                  className={styles.readerImage}
                  priority
                />
              </div>
            </a>
          </div>

          <a href="/marketing/daily-edge-expanded-reader.jpg" target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-violet-300 hover:text-violet-200">Open the reader image at full size</a>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <WalkthroughItem number="1" title="Pick a market">Moneyline, Total and 1st Inning can each have a different pick and grade.</WalkthroughItem>
            <WalkthroughItem number="2" title="Start with Quick Read">This gives you the projection, current pick, price and the simple reason behind it.</WalkthroughItem>
            <WalkthroughItem number="3" title="Check the market and notes">See how the price moved, whether market signals agree, and what could weaken the pick.</WalkthroughItem>
          </div>
        </section>

        <section id="grades" className="scroll-mt-28 pt-14 sm:pt-16">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Play grades</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">What the labels mean</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">
            Grades sort the current board by strength. They help you find the better spots faster, but they are not guarantees.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {gradeRows.map((grade) => (
              <article key={grade.label} className={`rounded-xl border p-4 ${grade.tone}`}>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em]">
                  <span aria-hidden="true">{grade.symbol}</span>
                  {grade.label}
                </div>
                <p className="mt-2 text-base leading-7 text-gray-300">{grade.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="other-tools" className="scroll-mt-28 pt-14 sm:pt-16">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Other sections</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Player Props and Tracking</h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-gray-800 bg-gray-950/60 p-5">
              <div className="text-xl" aria-hidden="true">🎮</div>
              <h3 className="mt-3 text-lg font-black text-white">Player Props</h3>
              <p className="mt-2 text-base leading-7 text-gray-300">
                Use the filters to choose a prop type, then compare the projection, available price, recent history and matchup information on each card.
              </p>
            </article>
            <article className="rounded-2xl border border-gray-800 bg-gray-950/60 p-5">
              <div className="text-xl" aria-hidden="true">📈</div>
              <h3 className="mt-3 text-lg font-black text-white">Tracking</h3>
              <p className="mt-2 text-base leading-7 text-gray-300">
                Tracking shows what the board recorded after games locked. Use the sport, market and time filters to understand the results in context.
              </p>
            </article>
          </div>
        </section>

        <section id="faq" className="scroll-mt-28 pt-14 sm:pt-16">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Frequently asked questions</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Quick answers</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">Open only the questions you need.</p>
          <div className="mt-6 divide-y divide-gray-800 overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/60">
            {faqs.map((faq) => (
              <details key={faq.question} className="group px-5 py-4 open:bg-gray-900/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold text-gray-100 marker:hidden">
                  <span>{faq.question}</span>
                  <span aria-hidden="true" className="text-lg font-normal text-violet-300 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-3xl pt-3 text-base leading-7 text-gray-300">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="pt-14 sm:pt-16">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-5 sm:p-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">One last thing</p>
            <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">
              OddSphere is a research tool. A strong grade does not guarantee a result. Use the information, check the current price and make the decision that fits you.
            </p>
          </div>
        </section>
        {publicCta ? (
          <section className="pt-14 sm:pt-16">
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] p-6 text-center sm:p-8">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Ready to explore the board?</p>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">See the full Daily Edge.</h2>
              <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-gray-300">
                Start with the current projections, prices, Play Grades, supporting evidence and tracking in one place.
              </p>
              <Link
                href={PRICING_PAGE_URL}
                className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-400 px-6 py-3 text-sm font-black text-gray-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              >
                Start Free Trial
              </Link>
            </div>
          </section>
        ) : null}
        </main>
      </div>
  );
}

function GuideStep({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3 py-2 text-base leading-7 text-gray-300">
      <span className="grid h-7 w-7 place-items-center rounded-full border border-violet-400/40 bg-violet-500/10 text-xs font-black text-violet-200">{number}</span>
      <span>{children}</span>
    </li>
  );
}

function WalkthroughItem({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full border border-violet-400/40 bg-violet-500/10 text-[10px] font-black text-violet-200">{number}</span>
        <h3 className="text-base font-black text-white">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">{children}</p>
    </article>
  );
}

function TimelineStep({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-violet-300/15 bg-gray-950/50 p-4">
      <h3 className="text-sm font-black text-white">{label}</h3>
      <p className="mt-2 text-sm leading-6 text-gray-300">{children}</p>
    </article>
  );
}

function ChangeRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="grid gap-2 px-5 py-4 sm:grid-cols-[220px_1fr] sm:gap-6 sm:px-6">
      <h3 className="text-base font-black text-white">{title}</h3>
      <p className="text-base leading-7 text-gray-300">{children}</p>
    </article>
  );
}
