/**
 * /legal/responsible-gambling — Phase 6B.4 launch-safe placeholder.
 *
 * US-focused resources and the standard 1-800-GAMBLER number. Linked
 * from Terms and from the footer of every page.
 */

import Link from "next/link";

export const metadata = {
  title: "Responsible Gambling — OddSphere AI",
  description: "Help and resources for responsible gambling.",
};

export default function ResponsibleGamblingPage() {
  return (
    <>
      <p className="text-xs uppercase tracking-[0.18em] font-bold text-violet-300 mb-3">Legal</p>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">Responsible Gambling</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated June 2026</p>

      <section className="space-y-5 text-[14px] sm:text-[15px] text-gray-200 leading-relaxed">
        <p>
          OddSphere AI is a research and analytics product. Even with
          good research, sports outcomes are uncertain and losses
          happen. Please play responsibly.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">If you need help now</h2>
        <div className="bg-violet-500/10 border border-violet-500/40 rounded-xl p-5 my-3">
          <p className="text-base text-white font-semibold mb-1">
            Call <a href="tel:18004262537" className="underline underline-offset-2">1-800-GAMBLER</a> (1-800-426-2537)
          </p>
          <p className="text-sm text-gray-200">
            24/7, free, confidential help for problem gambling in the US.
          </p>
        </div>
        <p>
          Additional national resources:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            National Council on Problem Gambling —{" "}
            <a
              href="https://www.ncpgambling.org/"
              className="text-violet-300 hover:text-violet-200 underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              ncpgambling.org
            </a>
          </li>
          <li>
            Gamblers Anonymous —{" "}
            <a
              href="https://www.gamblersanonymous.org/"
              className="text-violet-300 hover:text-violet-200 underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              gamblersanonymous.org
            </a>
          </li>
          <li>
            SAMHSA National Helpline — 1-800-662-HELP (4357)
          </li>
        </ul>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">Healthy habits</h2>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Set a budget for the week or month. Stick to it.</li>
          <li>Never wager money you can&rsquo;t afford to lose.</li>
          <li>Treat losses as the price of entertainment, not as something to chase.</li>
          <li>Take regular breaks. If betting stops being fun, stop.</li>
          <li>Avoid wagering under stress, sleep deprivation, or while drinking.</li>
        </ul>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">Warning signs</h2>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Betting more than planned, more often than planned.</li>
          <li>Chasing losses with bigger or riskier bets.</li>
          <li>Hiding the amount you wager from family or friends.</li>
          <li>Borrowing money or spending savings to keep betting.</li>
          <li>Feeling anxious, irritable, or depressed when not betting.</li>
        </ul>
        <p>
          If any of these feels familiar, please reach out using the
          resources above. There is no shame in asking for help.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">Sportsbook self-exclusion</h2>
        <p>
          Most US sportsbooks offer self-exclusion tools that block you
          from depositing or wagering for a set period (24 hours, 7
          days, 6 months, or permanent). Check your sportsbook&rsquo;s
          Responsible Gaming page. Your state gaming commission may
          also offer a statewide self-exclusion program.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">Our role</h2>
        <p>
          OddSphere AI does not take or settle bets. We provide research
          and model projections. See our{" "}
          <Link href="/legal/terms" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            Terms of Use
          </Link>{" "}
          for the full framing. Members must be 21 years of age or older.
        </p>

        <p className="text-xs text-gray-500 mt-10 italic">
          This page is a starting point, not professional advice. If you
          or someone you know needs support, please contact a qualified
          professional or one of the resources above.
        </p>
      </section>
    </>
  );
}
