/**
 * /legal/privacy — Phase 6B.4 launch-safe placeholder.
 *
 * Covers what data we actually handle today: Whop OAuth identity,
 * session cookies, and standard server logs. No analytics tracker
 * inventory yet — keep this honest. Update once the analytics stack
 * is finalized.
 */

export const metadata = {
  title: "Privacy Policy — OddSphere AI",
  description: "How OddSphere AI handles your data.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <p className="text-xs uppercase tracking-[0.18em] font-bold text-violet-300 mb-3">Legal</p>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">Privacy Policy</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated June 2026</p>

      <section className="space-y-5 text-[14px] sm:text-[15px] text-gray-200 leading-relaxed">
        <p>
          This Privacy Policy explains what information OddSphere AI
          collects when you use the site, how we use it, and the choices
          you have.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">1. What we collect</h2>
        <p className="font-semibold text-white">Account &amp; access (via Whop)</p>
        <p>
          We use Whop as our identity and billing provider. When you sign
          in with Whop we receive your Whop user id, your email, and your
          membership status for our product. We do not receive your Whop
          password or full payment details.
        </p>
        <p className="font-semibold text-white mt-3">Session cookies</p>
        <p>
          We set a small signed cookie after sign-in so the Lab can
          recognize you on subsequent requests. The cookie holds an
          identifier and a signature — not your password. We may also
          set a session cookie during the OAuth handshake for CSRF
          protection; it is cleared shortly after sign-in completes.
        </p>
        <p className="font-semibold text-white mt-3">Server logs</p>
        <p>
          Our hosting provider (Vercel) collects standard request logs:
          IP address, user agent, URL, status code, and timestamp. These
          are used for security, debugging, and abuse prevention.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">2. What we do NOT collect</h2>
        <p>
          We do not collect bank account information, credit card
          numbers, government IDs, or social security numbers. Billing
          is handled entirely by Whop. We do not sell personal data.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">3. How we use information</h2>
        <p>
          We use the data above to (a) authenticate you and gate access
          to the Lab, (b) keep the site working and secure, (c) respond
          to support requests, and (d) understand aggregate site usage
          so we can improve OddSphere AI.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">4. Service providers</h2>
        <p>
          We rely on a small number of third-party service providers to
          run OddSphere AI:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Whop — identity, membership, billing, Discord access.</li>
          <li>Vercel — application hosting and request logging.</li>
          <li>Supabase — database storage for app content.</li>
          <li>Sports data providers — public game / odds / stats data.</li>
        </ul>
        <p>
          Each provider has its own privacy policy. We share only what
          is necessary for them to perform their function.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">5. Retention</h2>
        <p>
          Account data persists for as long as you have an active
          membership and a reasonable period afterward for support and
          tax/financial records. Server logs are retained per our
          hosting provider&rsquo;s defaults.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">6. Your choices</h2>
        <p>
          You can sign out at any time from the Lab. You can manage your
          subscription or cancel via Whop. Email{" "}
          <a href="mailto:support@oddsphereai.com" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            support@oddsphereai.com
          </a>{" "}
          if you want a copy of your data on file or want it deleted.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">7. Children</h2>
        <p>
          OddSphere AI is intended for adults 21 years of age or older.
          We do not knowingly collect data from anyone under 21.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">8. Changes</h2>
        <p>
          We may update this Privacy Policy. The current version lives
          at oddsphereai.com/legal/privacy.
        </p>

        <h2 className="text-xl font-bold text-white mt-8 mb-2">9. Contact</h2>
        <p>
          Privacy questions? Email{" "}
          <a href="mailto:support@oddsphereai.com" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            support@oddsphereai.com
          </a>.
        </p>

        <p className="text-xs text-gray-500 mt-10 italic">
          This is V1 launch copy and is not lawyer-reviewed legal advice.
        </p>
      </section>
    </>
  );
}
