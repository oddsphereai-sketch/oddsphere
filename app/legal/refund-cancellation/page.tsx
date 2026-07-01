import Link from "next/link";

export const metadata = {
  title: "Refund & Cancellation Policy — OddSphere AI",
  description:
    "How OddSphere AI membership cancellations and refund requests are handled through Whop.",
  alternates: { canonical: "/legal/refund-cancellation" },
};

export default function RefundCancellationPage() {
  return (
    <>
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-violet-300">Legal</p>
      <h1 className="mb-3 text-3xl font-black tracking-tight sm:text-4xl">
        Refund &amp; Cancellation Policy
      </h1>
      <p className="mb-8 text-sm text-gray-400">Last updated July 2026</p>

      <section className="space-y-5 text-[14px] leading-relaxed text-gray-200 sm:text-[15px]">
        <p>
          OddSphere AI Premium is a subscription product sold and managed through
          Whop. This page explains how cancellations and refund requests work.
        </p>

        <h2 className="mt-8 text-xl font-bold text-white">1. Cancelling your membership</h2>
        <p>
          You can cancel your membership through your Whop account. Cancellation
          stops future billing. Your access may remain active through the end of
          the billing period that has already been paid.
        </p>

        <h2 className="mt-8 text-xl font-bold text-white">2. Refund requests</h2>
        <p>
          Refund requests are reviewed case by case. Because OddSphere provides
          immediate access to digital sports analytics, historical dashboards,
          and member-only content, completed billing periods are generally not
          automatically refundable.
        </p>
        <p>
          If you believe there was a billing error, duplicate charge, accidental
          purchase, or access problem, email{" "}
          <a
            href="mailto:support@oddsphereai.com"
            className="text-violet-300 underline underline-offset-2 hover:text-violet-200"
          >
            support@oddsphereai.com
          </a>{" "}
          with the email connected to your Whop account.
        </p>

        <h2 className="mt-8 text-xl font-bold text-white">3. No outcome-based refunds</h2>
        <p>
          OddSphere does not provide refunds based on sports outcomes, pick
          results, Play Grades, model performance, or whether a user chooses to
          place a wager. Sports outcomes are uncertain, and OddSphere does not
          guarantee any result.
        </p>

        <h2 className="mt-8 text-xl font-bold text-white">4. Where billing is managed</h2>
        <p>
          Whop manages checkout, payment methods, receipts, subscription status,
          cancellations, and billing support. OddSphere does not receive full
          payment card details.
        </p>

        <h2 className="mt-8 text-xl font-bold text-white">5. Related policies</h2>
        <p>
          Please also review our{" "}
          <Link href="/legal/terms" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
            Terms of Use
          </Link>
          ,{" "}
          <Link href="/legal/privacy" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
            Privacy Policy
          </Link>
          , and{" "}
          <Link href="/legal/responsible-gambling" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
            Responsible Gambling
          </Link>{" "}
          page.
        </p>
      </section>
    </>
  );
}
