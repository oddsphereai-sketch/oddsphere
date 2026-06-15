import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Canonical production URL — keeps preview links pointing at the live
// www.oddsphereai.com domain. The Vercel project alias
// `oddsphere-ruby.vercel.app` resolves to the same deployment but is
// not customer-facing.
const SITE_URL = "https://www.oddsphereai.com";
const SITE_TITLE = "OddSphere AI — AI-Powered Sports Predictions";
const SITE_DESCRIPTION =
  "Publicly-tracked AI sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL. Where data meets winning. For entertainment and informational purposes only.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "OddSphere AI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/og-image.png",
        alt: "OddSphere AI — AI-Powered Sports Predictions",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

// Organization + WebSite structured data (JSON-LD). Brand/identity only —
// deliberately NO sports-pick / betting-offer schema (would be misleading and
// could expose premium picks). Brand rendered as "OddSphere AI" to match the
// product surfaces (note: SITE_TITLE constant uses "Oddsphere" — a casing
// cleanup is recommended but left for a brand-owner decision).
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "OddSphere AI",
      url: SITE_URL,
      logo: `${SITE_URL}/og-image.png`,
      description: SITE_DESCRIPTION,
      sameAs: ["https://x.com/OddSphereAI"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "OddSphere AI",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="text-white min-h-screen flex flex-col antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 violet-overlay"
        />
        <Navbar />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
