/**
 * /legal/terms — Phase 6B.4 launch-safe placeholder.
 *
 * Lightweight V1 Terms of Use covering the essentials: informational/
 * analytics framing, no guaranteed outcomes, user responsibility for
 * decisions. NOT a substitute for lawyer-reviewed copy — replace
 * once formal Terms are finalized.
 */

import Link from "next/link";

export const metadata = {
  title: "Terms of Use — OddSphere AI",
  description: "OddSphere AI provides sports research and model projections. Informational only.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <>
      <p className="text-xs uppercase tracking-[0.18em] font-bold text-violet-300 mb-3">Legal</p>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">Terms of Use</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated June 2026</p>

      <section className="space-y-5 text-[14px] sm:text-[15px] text-gray-200 leading-relaxed">
        <p>
          OddSphere AI provides sports research, model projections, and analytics.
          By using this site you agree to the terms below. If you do not agree,
          do not use the site.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">1. Informational only</h2>
        <p>
          Everything on this site — picks, model probabilities, edges, ratings,
          tracking, and copy — is provided for informational, analytical, and
          entertainment purposes. Nothing on this site is a guarantee of any
          outcome, financial advice, or a recommendation to place any wager.
        </p>
        <p>
          OddSphere AI is not a sportsbook and does not accept, place, or
          settle bets.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">2. No guaranteed outcomes</h2>
        <p>
          Sports outcomes are uncertain. Past tracking, historical baselines,
          and model performance do not guarantee future results. Statements
          like &ldquo;Best Angle&rdquo; or &ldquo;Lean&rdquo; describe model classification,
          not promises. You should expect losses; budget accordingly.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">3. Your responsibility</h2>
        <p>
          You are solely responsible for your decisions, including whether to
          place any wager, with whom, in what amount, and under what laws and
          regulations apply to you. You are responsible for confirming that
          your participation in sports wagering is legal in your jurisdiction
          and that you meet any applicable minimum age requirement.
        </p>
        <p>
          Members must be 21 years of age or older.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">4. Membership &amp; access</h2>
        <p>
          Premium access is sold and managed through Whop. Subscription
          billing, cancellations, refunds, and Discord access are handled by
          your Whop account. Sign-in to the OddSphere AI Lab is performed via
          your Whop OAuth identity.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">5. No warranty</h2>
        <p>
          The site is provided &ldquo;as is&rdquo; without warranty of any kind,
          express or implied. We do not warrant accuracy, completeness,
          uptime, or fitness for a particular purpose. To the maximum extent
          permitted by law, OddSphere AI and its operators are not liable for
          any damages arising from your use of the site or reliance on its
          content.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">6. Responsible gambling</h2>
        <p>
          If gambling is or becomes a problem for you, please pause and seek
          help. See our{" "}
          <Link href="/legal/responsible-gambling" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            Responsible Gambling page
          </Link>
          {" "}or call 1-800-GAMBLER (1-800-426-2537) in the US.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">7. Changes</h2>
        <p>
          We may update these Terms. The current version always lives at
          oddsphereai.com/legal/terms. Continued use of the site after a
          change constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">8. Contact</h2>
        <p>
          Questions about these Terms? Email{" "}
          <a href="mailto:support@oddsphereai.com" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            support@oddsphereai.com
          </a>.
        </p>

        <p className="text-xs text-gray-500 mt-10 italic">
          This is V1 launch copy and is not lawyer-reviewed legal advice.
          Members should consult their own counsel where appropriate.
        </p>
      </section>
    </>
  );
}
