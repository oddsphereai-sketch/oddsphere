/**
 * /legal/* shared layout — Phase 6B.4 launch.
 *
 * Light wrapper around the marketing chrome for Terms / Privacy /
 * Responsible Gambling, and Refund/Cancellation. Constrains line length, keeps typography
 * consistent across the three pages.
 */

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <article className="prose prose-invert max-w-none">{children}</article>
    </main>
  );
}
