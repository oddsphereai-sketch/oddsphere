import type { Metadata } from "next";

/**
 * Admin subtree — internal only. Belt-and-suspenders noindex (the routes are
 * already middleware-gated to /login and robots-disallowed). Passthrough
 * layout: no rendering/behavior change, SEO metadata only. Mirrors the
 * `robots: { index:false }` already on app/lab/layout.tsx.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
